// @vitest-environment jsdom
/**
 * FA2-T1：本地目录工作区（DirectoryWorkspaceHost）行为测试。
 *
 * 用**内存 Fake FS** 替身而非真实磁盘：真实 `showDirectoryPicker` 在 jsdom 里不存在，
 * 且无头浏览器根本无法授权。Fake 实现的接口面与真实句柄一致
 * （values() 异步迭代 / getFileHandle / getDirectoryHandle / removeEntry / createWritable），
 * 于是本文件测的是**本模块的逻辑**（遍历、排序、去重命名、先写后删、资产落盘），
 * 而不是浏览器的 FS 实现 —— 后者只能人工验证。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ASSETS_DIR,
  DirectoryWorkspaceHost,
  filterTree,
  flattenDirs,
  flattenFiles,
  isDirectoryPickerSupported,
} from '../src/edit/directoryHost.js';
import type { FsDirectoryHandle, FsEntryHandle, WorkspaceNode } from '../src/edit/directoryTypes.js';

/**
 * 按引用存储的内存 IDB 替身。
 *
 * 真实 `FileSystemDirectoryHandle` 是浏览器原生对象，可被结构化克隆；
 * 但 JS 替身的**方法无法克隆**（fake-indexeddb 会抛 DataCloneError），
 * 克隆回来只剩数据字段、`getDirectoryHandle` 变成 undefined → 窄化谓词判定为「不是目录句柄」。
 * 故这里用按引用存储，测的是本模块的存取逻辑而非浏览器克隆实现。
 */
const memStore = new Map<string, unknown>();

type FakeRequest = {
  result: unknown;
  error: unknown;
  onsuccess: null | (() => void);
  onerror: null | (() => void);
  onupgradeneeded: null | (() => void);
};

function valueReq(value: unknown): FakeRequest {
  const r: FakeRequest = {
    result: value,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => r.onsuccess?.());
  return r;
}

function openReq(): FakeRequest {
  const r: FakeRequest = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
    onupgradeneeded: null,
  };
  queueMicrotask(() => {
    r.result = {
      objectStoreNames: { contains: () => true },
      createObjectStore: () => undefined,
      transaction: () => ({
        objectStore: () => ({
          put: (v: unknown, k: string) => {
            memStore.set(k, v);
            return valueReq(undefined);
          },
          get: (k: string) => valueReq(memStore.get(k)),
          delete: (k: string) => valueReq(memStore.delete(k)),
        }),
        set oncomplete(fn: () => void) {
          queueMicrotask(fn);
        },
        set onerror(_fn: () => void) {
          /* 内存实现不会失败 */
        },
      }),
    } as unknown as IDBDatabase;
    r.onupgradeneeded?.();
    r.onsuccess?.();
  });
  return r;
}

// 每个用例前重置存储，隔离工作区残留
beforeEach(() => {
  memStore.clear();
  globalThis.indexedDB = { open: () => openReq() } as unknown as IDBFactory;
});

// ---------------------------------------------------------------- Fake FS

class FakeFile {
  name: string;
  content: string;
  constructor(name: string, content = '') {
    this.name = name;
    this.content = content;
  }
  async getFile(): Promise<File> {
    return new File([this.content], this.name, { type: 'text/markdown' });
  }
  async createWritable() {
    const self = this;
    let buf = '';
    return {
      async write(d: string | Blob) {
        buf += typeof d === 'string' ? d : await d.text();
      },
      async close() {
        self.content = buf;
      },
    };
  }
}

class FakeDir {
  name: string;
  children = new Map<string, FakeDir | FakeFile>();
  constructor(name: string) {
    this.name = name;
  }
  dir(name: string, create = true): FakeDir {
    const hit = this.children.get(name);
    if (hit instanceof FakeDir) return hit;
    if (!create) throw new Error(`ENOENT: ${name}`);
    const d = new FakeDir(name);
    this.children.set(name, d);
    return d;
  }
  file(name: string, content = ''): FakeFile {
    const f = new FakeFile(name, content);
    this.children.set(name, f);
    return f;
  }
  async getDirectoryHandle(name: string, opts?: { create?: boolean }): Promise<FakeDir> {
    const hit = this.children.get(name);
    if (hit instanceof FakeDir) return hit;
    if (hit instanceof FakeFile) throw new Error('ENOTDIR');
    return this.dir(name, opts?.create ?? false);
  }
  async getFileHandle(name: string, opts?: { create?: boolean }): Promise<FakeFile> {
    const hit = this.children.get(name);
    if (hit instanceof FakeFile) return hit;
    if (hit instanceof FakeDir) throw new Error('EISDIR');
    if (opts?.create) return this.file(name, '');
    throw new Error(`ENOENT: ${name}`);
  }
  async removeEntry(name: string, opts?: { recursive?: boolean }): Promise<void> {
    const hit = this.children.get(name);
    if (!hit) throw new Error(`ENOENT: ${name}`);
    if (hit instanceof FakeDir && opts?.recursive !== true && hit.children.size > 0) {
      throw new Error('ENOTEMPTY');
    }
    this.children.delete(name);
  }
  async *values(): AsyncGenerator<FsEntryHandle> {
    for (const v of this.children.values()) yield v as unknown as FsEntryHandle;
  }
  /** 以目录句柄视角暴露（内部实现即本对象） */
  asHandle(): FsDirectoryHandle {
    return this as unknown as FsDirectoryHandle;
  }
}

/** 装一个假工作区：返回 host + 根 FakeDir */
async function mount(build: (root: FakeDir) => void): Promise<{
  host: DirectoryWorkspaceHost;
  root: FakeDir;
}> {
  const root = new FakeDir('MyNotes');
  build(root);
  window.showDirectoryPicker = (async () => root.asHandle()) as typeof window.showDirectoryPicker;
  const host = new DirectoryWorkspaceHost();
  await host.pick();
  return { host, root };
}

/** 取节点名称序列（便于断言树结构） */
function names(nodes: readonly WorkspaceNode[]): string[] {
  return nodes.map((n) => `${n.kind}:${n.name}`);
}

describe('能力探测与挂载', () => {
  it('jsdom 无 showDirectoryPicker → isDirectoryPickerSupported() 为 false', () => {
    delete window.showDirectoryPicker;
    expect(isDirectoryPickerSupported()).toBe(false);
  });

  it('不支持时 pick() 返回 null（调用方回落单文件模式，不抛错）', async () => {
    delete window.showDirectoryPicker;
    const host = new DirectoryWorkspaceHost();
    expect(await host.pick()).toBeNull();
    expect(host.mounted).toBe(false);
  });

  it('pick() 成功 → mounted=true 且 name 为目录名', async () => {
    const { host } = await mount(() => {});
    expect(host.mounted).toBe(true);
    expect(host.name).toBe('MyNotes');
  });

  it('用户取消（AbortError）→ null，不挂载', async () => {
    window.showDirectoryPicker = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as typeof window.showDirectoryPicker;
    const host = new DirectoryWorkspaceHost();
    expect(await host.pick()).toBeNull();
    expect(host.mounted).toBe(false);
    delete window.showDirectoryPicker;
  });

  it('未挂载时 scan/read 抛明确错误（不静默返回空）', async () => {
    const host = new DirectoryWorkspaceHost();
    await expect(host.scan()).rejects.toThrow('工作区未挂载');
  });
});

describe('目录树扫描', () => {
  it('递归收录 .mm.md / .md，并按「目录在前、名称排序」组织', async () => {
    const { host } = await mount((r) => {
      r.file('b.mm.md', '# B');
      r.file('a.mm.md', '# A');
      const sub = r.dir('研发');
      sub.file('架构.mm.md', '# 架构');
      sub.file('note.txt', '忽略我');
    });
    const tree = await host.scan();
    // 目录在前、文件在后；.txt 不收录
    expect(names(tree)).toEqual(['dir:研发', 'file:a.mm.md', 'file:b.mm.md']);
    const sub = tree[0];
    expect(sub?.kind === 'dir' && names(sub.children)).toEqual(['file:架构.mm.md']);
  });

  it('跳过 node_modules / .git 等噪声目录', async () => {
    const { host } = await mount((r) => {
      r.dir('node_modules').file('x.mm.md', '#');
      r.dir('.git').file('y.mm.md', '#');
      r.file('ok.mm.md', '# OK');
    });
    const tree = await host.scan();
    expect(names(tree)).toEqual(['file:ok.mm.md']);
  });

  it('空目录保留（用户要能在里面新建导图）', async () => {
    const { host } = await mount((r) => {
      r.dir('空的');
    });
    expect(names(await host.scan())).toEqual(['dir:空的']);
  });

  it('读到文件的 mtime/size', async () => {
    const { host } = await mount((r) => {
      r.file('a.mm.md', '# 内容');
    });
    const [f] = flattenFiles(await host.scan());
    expect(f?.size).toBeGreaterThan(0);
  });

  it('扫描结果缓存；force=true 才重新扫盘', async () => {
    const { host, root } = await mount((r) => r.file('a.mm.md', '# A'));
    const first = await host.scan();
    root.file('b.mm.md', '# B');
    expect((await host.scan()).length).toBe(first.length); // 缓存未失效
    expect((await host.scan(true)).length).toBe(2); // 强制重扫
  });

  it('深度上限生效（防超深目录拖死浏览器）', async () => {
    const { host } = await mount((r) => {
      let cur = r;
      for (let i = 0; i < 12; i++) cur = cur.dir(`d${i}`);
      cur.file('deep.mm.md', '#');
    });
    const files = flattenFiles(await host.scan());
    expect(files.length).toBe(0); // 超过默认 maxDepth=8 的部分不再深入
  });
});

describe('文件增删改（真实句柄操作）', () => {
  it('readFile 读到磁盘内容', async () => {
    const { host } = await mount((r) => r.file('a.mm.md', '# 正文'));
    const [f] = flattenFiles(await host.scan());
    expect(f).toBeDefined();
    if (f) expect(await host.readFile(f)).toBe('# 正文');
  });

  it('writeFile 写回（不弹任何系统对话框）', async () => {
    const { host, root } = await mount((r) => r.file('a.mm.md', '# 旧'));
    const [f] = flattenFiles(await host.scan());
    if (f) await host.writeFile(f, '# 新');
    expect(root.children.get('a.mm.md')).toBeInstanceOf(FakeFile);
    expect((root.children.get('a.mm.md') as FakeFile).content).toBe('# 新');
  });

  it('createFile 生成文件并写入内容', async () => {
    const { host, root } = await mount(() => {});
    const f = await host.createFile('', '新建.mm.md', '# 新');
    expect(f.path).toBe('新建.mm.md');
    expect((root.children.get('新建.mm.md') as FakeFile).content).toBe('# 新');
  });

  it('createFile 同名不覆盖：自动改名为「x 2.mm.md」', async () => {
    const { host, root } = await mount((r) => r.file('架构.mm.md', '# 旧'));
    const f = await host.createFile('', '架构.mm.md', '# 新');
    expect(f.name).toBe('架构 2.mm.md');
    // 原文件未被覆盖
    expect((root.children.get('架构.mm.md') as FakeFile).content).toBe('# 旧');
  });

  it('createDir 建真实子目录', async () => {
    const { host, root } = await mount(() => {});
    await host.createDir('', '项目A');
    expect(root.children.get('项目A')).toBeInstanceOf(FakeDir);
  });

  it('renameFile = 写新 + 删旧（FS API 无 rename）', async () => {
    const { host, root } = await mount((r) => r.file('旧名.mm.md', '# 内容'));
    const [f] = flattenFiles(await host.scan());
    if (!f) throw new Error('没扫到文件');
    const renamed = await host.renameFile(f, '新名.mm.md');
    expect(renamed.name).toBe('新名.mm.md');
    expect(root.children.has('旧名.mm.md')).toBe(false);
    expect((root.children.get('新名.mm.md') as FakeFile).content).toBe('# 内容');
  });

  it('removeFile 删真实文件', async () => {
    const { host, root } = await mount((r) => r.file('a.mm.md', '#'));
    const [f] = flattenFiles(await host.scan());
    if (f) await host.removeFile(f);
    expect(root.children.has('a.mm.md')).toBe(false);
  });

  it('removeDir 递归删除（非空目录也删得掉）', async () => {
    const { host, root } = await mount((r) => r.dir('项目A').file('a.mm.md', '#'));
    const tree = await host.scan();
    const dir = tree.find((n) => n.kind === 'dir');
    if (dir?.kind === 'dir') await host.removeDir(dir);
    expect(root.children.has('项目A')).toBe(false);
  });

  it('moveFile 拖拽归位：内容迁到目标目录，源目录不再有它', async () => {
    const { host, root } = await mount((r) => {
      r.file('a.mm.md', '# A');
      r.dir('目标');
    });
    const [f] = flattenFiles(await host.scan());
    if (!f) throw new Error('没扫到文件');
    const moved = await host.moveFile(f, '目标');
    expect(moved.path).toBe('目标/a.mm.md');
    expect(root.children.has('a.mm.md')).toBe(false);
    expect((root.dir('目标').children.get('a.mm.md') as FakeFile).content).toBe('# A');
  });
});

describe('T4：资产写入 ./assets/', () => {
  it('writeAsset 在工作区根创建 assets/ 并落盘，返回相对路径', async () => {
    const { host, root } = await mount(() => {});
    const rel = await host.writeAsset('diagram.png', new Uint8Array([1, 2, 3]).buffer, 'image/png');
    expect(rel).toBe(`${ASSETS_DIR}/diagram.png`);
    const assets = root.children.get(ASSETS_DIR);
    expect(assets).toBeInstanceOf(FakeDir);
    expect((assets as FakeDir).children.has('diagram.png')).toBe(true);
  });

  it('assets/ 已存在 → 复用，不重建', async () => {
    const { host, root } = await mount((r) => r.dir(ASSETS_DIR).file('old.png', ''));
    await host.writeAsset('new.png', new Uint8Array([1]).buffer, 'image/png');
    const assets = root.children.get(ASSETS_DIR) as FakeDir;
    expect(assets.children.has('old.png')).toBe(true);
    expect(assets.children.has('new.png')).toBe(true);
  });

  it('hasAsset：已落盘 → true；未落盘 → false', async () => {
    const { host } = await mount(() => {});
    await host.writeAsset('a.png', new Uint8Array([1]).buffer, 'image/png');
    expect(await host.hasAsset(`${ASSETS_DIR}/a.png`)).toBe(true);
    expect(await host.hasAsset(`${ASSETS_DIR}/missing.png`)).toBe(false);
  });

  it('文本资产（SVG 源码）也能落盘', async () => {
    const { host, root } = await mount(() => {});
    await host.writeAsset('icon.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml');
    const assets = root.children.get(ASSETS_DIR) as FakeDir;
    const f = assets.children.get('icon.svg') as FakeFile;
    expect(f.content).toContain('<svg');
  });
});

describe('工作区持久化（IndexedDB）', () => {
  it('pick 后新实例 restore() 可恢复（免重复选目录）', async () => {
    const root = new FakeDir('MyNotes');
    root.file('a.mm.md', '# A');
    window.showDirectoryPicker = (async () => root.asHandle()) as typeof window.showDirectoryPicker;

    const first = new DirectoryWorkspaceHost();
    await first.pick();

    const second = new DirectoryWorkspaceHost();
    // Fake 句柄没有权限 API → verifyPermission 按「老浏览器」口径返回 true
    expect(await second.restore()).toBe(true);
    expect(second.name).toBe('MyNotes');
    delete window.showDirectoryPicker;
  });

  it('无历史记录 → restore() 返回 false（不误报已连接）', async () => {
    const host = new DirectoryWorkspaceHost();
    expect(await host.restore()).toBe(false);
    expect(host.mounted).toBe(false);
  });

  it('detach 后 restore 拿不回（断开即清干净）', async () => {
    const { host } = await mount((r) => r.file('a.mm.md', '#'));
    await host.detach();
    expect(host.mounted).toBe(false);
    expect(await new DirectoryWorkspaceHost().restore()).toBe(false);
    delete window.showDirectoryPicker;
  });
});

describe('树工具函数', () => {
  const tree: WorkspaceNode[] = [
    {
      kind: 'dir',
      name: '研发',
      path: '研发',
      handle: new FakeDir('研发').asHandle(),
      children: [
        {
          kind: 'file',
          name: '架构.mm.md',
          path: '研发/架构.mm.md',
          handle: new FakeFile('架构.mm.md') as never,
          ts: 0,
          size: 0,
        },
      ],
    },
    {
      kind: 'file',
      name: '首页.mm.md',
      path: '首页.mm.md',
      handle: new FakeFile('首页.mm.md') as never,
      ts: 0,
      size: 0,
    },
  ];

  it('flattenFiles：递归取出全部文件', () => {
    expect(flattenFiles(tree).map((f) => f.path)).toEqual(['研发/架构.mm.md', '首页.mm.md']);
  });

  it('flattenDirs：递归取出全部目录', () => {
    expect(flattenDirs(tree).map((d) => d.path)).toEqual(['研发']);
  });

  it('filterTree 命中文件 → 保留其祖先目录链（不把树拍平）', () => {
    const out = filterTree(tree, '架构');
    expect(names(out)).toEqual(['dir:研发']);
    const dir = out[0];
    expect(dir?.kind === 'dir' && names(dir.children)).toEqual(['file:架构.mm.md']);
  });

  it('filterTree 命中目录名 → 保留整棵子树', () => {
    const out = filterTree(tree, '研发');
    const dir = out[0];
    expect(dir?.kind === 'dir' && dir.children.length).toBe(1);
  });

  it('filterTree 无命中 → 空；空查询 → 原样返回', () => {
    expect(filterTree(tree, '不存在').length).toBe(0);
    expect(filterTree(tree, '').length).toBe(2);
  });
});
