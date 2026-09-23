/**
 * 真浏览器验收共享库（P0-C §七 人工项补验）
 * ══════════════════════════════════════════════════════════════════════
 * **为什么需要**：P0-A/P0-B 两个施工包把「playwright 不可用」当作硬约束，
 * 于是 A1 人工、N1/N4 真实重开、F1③、F2 IME、no-native-dialogs 真实验证
 * 全部积压为 unconfirmed。经实测该约束不成立（chromium-1243 已在
 * ~/Library/Caches/ms-playwright，playwright 1.63.0 已装）。本库把「真实浏览器里
 * 可复用的最小设施」集中一处：页面内 **文件系统访问 API 替身**（内存磁盘）、
 * **原生对话框探针**、**结果收口**。
 *
 * 纪律（对齐 acceptance-and-backlog §3 证据等级）：
 * - 替身只顶替**系统手势**（`showDirectoryPicker`）与磁盘 I/O；被验的是应用真实
 *   运行路径（真实 React 组件树、真实 host、真实归一化、真实原子写）。
 * - 不冒充：需要真实 OS 输入法的项（F2 IME ⑤）本库不伪造，由调用方标 unconfirmed。
 * - 本库不产出 `console.*`（与 releaseAcceptance.mjs 同纪律），由验收脚本统一输出。
 */

/**
 * 注入页面的**多工作区内存磁盘**源码（自包含，`toString()` 后可直接注入）。
 *
 * 暴露 `window.__ws`：
 *   - `mount(name)`  把名为 `name` 的工作区注册为「下一次 showDirectoryPicker 返回的句柄」
 *   - `disks`        各工作区的文件表（脚本侧读断言用）
 *   - `writes`       外部写入记录（直写，非应用写入）
 *   - `pickCount`    `showDirectoryPicker` 调用次数
 *
 * 目录句柄实现 File System Access 的最小面（getDirectoryHandle / getFileHandle /
 * removeEntry / entries / values / isSameEntry / query+requestPermission），
 * 文件句柄实现 getFile / createWritable / isSameEntry / query+requestPermission。
 * 磁盘是纯内存 + **同步语义**（写立刻可见）——足以覆盖归一化/同名三选/重开。
 */
export const FAKE_FS_SOURCE = `(() => {
  const disks = Object.create(null);
  const pickOrder = [];
  const writes = [];
  let pickCount = 0;

  const norm = (p) => String(p).replace(/^\\/+/, '');
  const diskOf = (wsName) => disks[wsName] || (disks[wsName] = Object.create(null));

  /**
   * 磁盘值 → 真实 File。
   *
   * 两条编码（都存成字符串，便于脚本侧读出/断言）：
   *  - 前缀为 data: 的 base64 data URL → 解码为二进制，type = mime
   *    （夹具图片走这条：img.src 的 blob 才可渲染，从而「无错图」能用真实像素断言）
   *  - 其余 → 纯文本，type = text/markdown
   */
  const fileOf = (value, name) => {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(value);
    if (m !== null) {
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      return new File([bytes], name, { type: m[1] });
    }
    return new File([value], name, { type: 'text/markdown' });
  };

  const makeFileHandle = (wsName, relPath, name) => ({
    kind: 'file',
    name,
    async getFile() {
      await window.__ws.wait('getFile', relPath);
      const text = diskOf(wsName)[relPath];
      if (text === undefined) throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
      return fileOf(text, name);
    },
    async createWritable() {
      let buf = null;
      return {
        /**
         * 收集写入内容。
         *
         * 归一成磁盘值约定（与 fileOf 对称）：
         *   - 字符串 → 原样文本（.mm.md 等）
         *   - Blob / ArrayBuffer / TypedArray → data URL（data:&lt;mime&gt;;base64,...）
         * 这样二进制资产（应用用 writeAsset(name, data: ArrayBuffer) 落盘）也能被
         * __ws.read() 读回并与夹具逐字节比较 —— 否则资产写盘内容不可断言。
         * atob/btoa 在本页上下文可用（Chromium）。
         */
        async write(data) {
          if (typeof data === 'string') { buf = data; return; }
          let bytes;
          let mime = 'application/octet-stream';
          if (data && typeof data.arrayBuffer === 'function') {
            if (typeof data.type === 'string' && data.type !== '') mime = data.type;
            bytes = new Uint8Array(await data.arrayBuffer());
          } else if (data instanceof ArrayBuffer) {
            bytes = new Uint8Array(data);
          } else if (ArrayBuffer.isView(data)) {
            bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          } else {
            buf = '[unsupported-write]';
            return;
          }
          let bin = '';
          for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
          buf = 'data:' + mime + ';base64,' + btoa(bin);
        },
        async close() {
          await window.__ws.wait('close', relPath);
          diskOf(wsName)[relPath] = buf;
          writes.push({ ws: wsName, path: relPath, bytes: buf === null ? 0 : buf.length });
        },
        async abort() {},
      };
    },
    async isSameEntry(other) { return other && other.__wsName === wsName && other.__relPath === relPath; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
    __wsName: wsName,
    __relPath: relPath,
  });

  const makeDirHandle = (wsName, relDir) => {
    const prefix = relDir === '' ? '' : relDir + '/';
    const handle = {
      kind: 'directory',
      name: relDir === '' ? wsName : relDir.split('/').pop(),
      async getDirectoryHandle(name) { return makeDirHandle(wsName, prefix + name); },
      /**
       * 取/建文件。
       *
       * create 缺省或 false：文件不存在必须抛错（真实 FSA 语义）。
       * 这条不是细节：assetInsert.uniqueName 靠「hasAsset 探名字是否占用」逐个试名，
       * 若这里对不存在的文件静默建空文件，试名循环会把候选名全部创建出来
       * （实测：一次插入生成 a 2.png…a 1000.png 上千个文件）——是替身的假象，不是产品行为。
       */
      async getFileHandle(name, opts) {
        const rel = prefix + name;
        const d = diskOf(wsName);
        if (d[rel] === undefined) {
          if (!(opts && opts.create === true)) {
            throw Object.assign(new Error('NotFoundError'), { name: 'NotFoundError' });
          }
          d[rel] = '';
        }
        return makeFileHandle(wsName, rel, name);
      },
      async removeEntry(name) {
        const d = diskOf(wsName);
        const rel = prefix + name;
        await window.__ws.wait('removeEntry', rel);
        delete d[rel];
        for (const k of Object.keys(d)) if (k.startsWith(rel + '/')) delete d[k];
      },
      async *entries() {
        const d = diskOf(wsName);
        const seen = new Set();
        for (const key of Object.keys(d)) {
          if (prefix !== '' && !key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          const seg = rest.split('/')[0];
          if (seg === '' || seen.has(seg)) continue;
          seen.add(seg);
          const isDir = rest.includes('/');
          if (isDir) {
            const dir = makeDirHandle(wsName, prefix + seg);
            yield [seg, { ...dir, kind: 'directory' }];
          } else {
            const fh = makeFileHandle(wsName, prefix + seg, seg);
            yield [seg, { ...fh, kind: 'file' }];
          }
        }
      },
      async *values() { for await (const [, v] of handle.entries()) yield v; },
      async isSameEntry(other) { return other && other.__wsName === wsName && other.__relDir === relDir; },
      async queryPermission() { return 'granted'; },
      async requestPermission() { return 'granted'; },
      __wsName: wsName,
      __relDir: relDir,
    };
    return handle;
  };

  window.__ws = {
    disks,
    writes,
    /**
     * 人为延迟（毫秒），按「操作类型 → 匹配片段 → 延迟」配置。
     * 用于制造「慢盘窗口」：F1③ 要在租约持有期间按 Ctrl+S，
     * 而租约只在一次真实的、耗时的文件操作进行中才持有 ——
     * 故需要把 removeEntry（改名/移动的第二步「删源」）拉长。
     *
     * 形如 { removeEntry: { 'old.mm.md': 1500 } }；
     * 值也可写成 { '*': 800 } 匹配任意路径。
     */
    delays: Object.create(null),
    /** 命中延迟则等待；返回实际等待毫秒（0 = 未命中） */
    async wait(kind, path) {
      const table = window.__ws.delays[kind];
      if (!table) return 0;
      let ms = 0;
      for (const [frag, v] of Object.entries(table)) {
        if (frag === '*' || String(path).includes(frag)) { ms = Math.max(ms, Number(v) || 0); }
      }
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      return ms;
    },
    get pickCount() { return pickCount; },
    /** 注册一个工作区磁盘；files 形如 { 'a.mm.md': '# A', 'assets/a.png': '<bytes>' } */
    seed(wsName, files) { const d = diskOf(wsName); for (const [k, v] of Object.entries(files)) d[norm(k)] = String(v); },
    /** 声明「下一次 showDirectoryPicker 返回哪个工作区」 */
    mount(wsName) { pickOrder.length = 0; pickOrder.push(wsName); diskOf(wsName); },
    /** 读磁盘文本（断言用） */
    read(wsName, relPath) { const v = diskOf(wsName)[norm(relPath)]; return v === undefined ? null : v; },
    /** 列磁盘文件路径（断言用） */
    list(wsName) { return Object.keys(diskOf(wsName)).sort(); },
    /** 直写（下毒/夹具，不经应用） */
    put(wsName, relPath, text) { diskOf(wsName)[norm(relPath)] = String(text); },
  };

  window.showDirectoryPicker = async () => {
    pickCount += 1;
    const wsName = pickOrder.length > 0 ? pickOrder[pickOrder.length - 1] : 'workspace';
    return makeDirHandle(wsName, '');
  };
})()`;

/**
 * 原生对话框探针源码：把 confirm/alert/prompt 换成本地无副作用替身，
 * 并计数调用。**必须在页面脚本执行前注入**（`addInitScript`）。
 * 探针不改变被观测行为，只记录 —— 因此「零调用」是真实观测，
 * 而「有调用」会如实计入 `window.__dialogs`。
 */
export const DIALOG_PROBE_SOURCE = `(() => {
  window.__dialogs = [];
  const mk = (name, ret) => (...args) => {
    window.__dialogs.push({ name, args: args.map((a) => String(a)).slice(0, 3) });
    return ret;
  };
  window.confirm = mk('confirm', false);
  window.alert = mk('alert', undefined);
  window.prompt = mk('prompt', null);
})()`;

/** 读页面里的原生对话框调用记录 */
export const readDialogs = (page) => page.evaluate(() => window.__dialogs ?? []);

/** 读页面里某个工作区磁盘的文件表 */
export const diskList = (page, wsName) => page.evaluate((w) => window.__ws.list(w), wsName);

/** 读页面里某个工作区磁盘的某文件文本 */
export const diskRead = (page, wsName, relPath) =>
  page.evaluate(([w, p]) => window.__ws.read(w, p), [wsName, relPath]);

/** 当前 showDirectoryPicker 调用次数 */
export const pickCount = (page) => page.evaluate(() => window.__ws.pickCount);

/**
 * 设置页面内磁盘的**人为延迟**（制造慢盘窗口）。
 * @param table 形如 `{ removeEntry: { 'old.mm.md': 1500 }, getFile: { '*': 800 } }`
 */
export const setDelays = (page, table) => page.evaluate((t) => {
  window.__ws.delays = t;
}, table);

/** 清空人为延迟 */
export const clearDelays = (page) => page.evaluate(() => {
  window.__ws.delays = Object.create(null);
});

/** 读页面里已发生的磁盘写入记录（应用的真实写入） */
export const writes = (page) => page.evaluate(() => window.__ws.writes);

/**
 * 把某张 `img[src]` 画到 canvas 上取像素 → 返回 `#rrggbb`。
 * 用于「无错图」的**像素级**判据：同名资产在两个作用域里是红/蓝两张图，
 * 断言的是**真的画出了哪个颜色**，不是「DOM 里有个元素」。
 * @param selector CSS 选择器，命中一个 `<img>`
 * @returns 形如 `{ ok, hex, r, g, b, w, h }`；取不到图像 → `{ ok: false, reason }`
 */
export const probeImageColor = (page, selector) =>
  page.evaluate((sel) => {
    const img = document.querySelector(sel);
    if (img === null) return { ok: false, reason: 'no-img' };
    if (typeof img.decode === 'function') {
      /* 已在别处 decode 过也无妨 */
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w === 0 || h === 0) return { ok: false, reason: 'not-decoded', src: img.getAttribute('src') };
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const ctx = cv.getContext('2d');
    if (ctx === null) return { ok: false, reason: 'no-2d-context' };
    ctx.drawImage(img, 0, 0);
    let px;
    try {
      px = ctx.getImageData(0, 0, 1, 1).data;
    } catch (e) {
      return { ok: false, reason: 'tainted-canvas', detail: String(e) };
    }
    const hex = `#${[px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return { ok: true, hex, r: px[0], g: px[1], b: px[2], w, h, src: img.getAttribute('src') };
  }, selector);

/**
 * 结果收口（与 verify-save-lifecycle.mjs 同风格）：逐项记录 ok/detail，
 * 任何一项 false → `result: 'FAIL'`，脚本以退出码 1 结束。
 * `unconfirmed` 项显式分离：**不计入 pass**，也不写入问题（如实留白）。
 */
export function createReport(name, base) {
  const out = { script: name, base, checks: {}, unconfirmed: [] };
  let pass = true;
  const check = (label, ok, detail) => {
    out.checks[label] = { ok: ok === true, detail: detail ?? null };
    if (ok !== true) pass = false;
  };
  const unconfirmed = (label, reason) => {
    out.unconfirmed.push({ label, reason });
  };
  const finish = () => {
    out.result = pass ? 'PASS' : 'FAIL';
    return pass;
  };
  return { out, check, unconfirmed, finish };
}
