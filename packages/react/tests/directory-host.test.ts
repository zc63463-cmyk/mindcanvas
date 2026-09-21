// @vitest-environment jsdom
/**
 * FA2-T1：本地目录工作区（DirectoryWorkspaceHost）行为测试。
 *
 * 用**内存 Fake FS** 替身而非真实磁盘：真实 `showDirectoryPicker` 在 jsdom 里不存在，
 * 且无头浏览器根本无法授权。Fake 实现的接口面与真实句柄一致
 * （values() 异步迭代 / getFileHandle / getDirectoryHandle / removeEntry / createWritable），
 * 于是本文件测的是**本模块的逻辑**（遍历、排序、去重命名、先写后删、资产落盘、身份解析），
 * 而不是浏览器的 FS 实现 —— 后者只能人工验证。
 *
 * P0-0：内存 IDB 替身升级为 v3（暂存 / 失败中止 / 提交发布 / abort 丢弃 / 互斥结算），
 * 抽取到 `tests/helpers/memoryIdb.ts` 共用；新增「工作区身份：注册表与同一性」用例组（§4.4）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASSETS_DIR,
  DirectoryWorkspaceHost,
  filterTree,
  flattenDirs,
  flattenFiles,
  isDirectoryPickerSupported,
} from '../src/edit/directoryHost.js';
import {
  WORKSPACE_REGISTRY_KEY,
  getDirectoryHandle,
  readWorkspaceRegistry,
  setDirectoryHandle,
  writeWorkspaceRegistry,
} from '../src/edit/handleStore.js';
import type { FsDirectoryHandle, FsEntryHandle, WorkspaceNode } from '../src/edit/directoryTypes.js';
import type { RegistryReadResult } from '../src/edit/workspaceScope.js';
import { fail, installMemoryIndexedDB, memStore, resetFixture } from './helpers/memoryIdb.js';

// 每个用例前重置共享态（夹具 + 身份脚手架），隔离工作区残留
beforeEach(() => {
  installMemoryIndexedDB();
  resetFixture();
  PERM.state = 'granted'; // 权限复位
  nextPicker = null;
  reboot();
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

// ---------------------------------------------------------------- P0-0 身份测试脚手架（计划 §4.4）
/**
 * 测试脚手架（CR2-3：给出可落地的 helper 与权限初始化/复位规则，避免依赖未定义 helper）。
 *
 * 设计要点：
 * - `handleOf(name, sameEntry?)` 造目录句柄替身；**是否带 `isSameEntry` 由此决定**
 *   （这是区分 `different` 与 `unknown` 的唯一手段）。
 * - `sameByLabel(label)` 是 `isSameEntry` 的语义替身：按「对方句柄的 name」判断（**只用于测试**）。
 * - `patchPicker(h)` 让下一次 `window.showDirectoryPicker` 返回该句柄。
 * - 权限：改 `PERM.state` 即可（`handleOf` 的 `queryPermission`/`requestPermission` 实时读它）；
 *   **`beforeEach` 复位为 `granted`**。
 * - `reboot()` 丢弃当前 host 实例（保留 IDB），模拟页面刷新。
 * - 断言对象：**只断言可读目标**（句柄 `name`、注册表的 `activeScopeId` 与 `scopeId` 列表），
 *   **不对含函数/句柄的对象做 `JSON.stringify` 深比较**（CR2-3）。
 */
const PERM = { state: 'granted' as PermissionState };

function handleOf(name: string, sameEntry?: (other: unknown) => Promise<boolean>) {
  return {
    name,
    kind: 'directory' as const,
    getDirectoryHandle: async () => handleOf(name),
    queryPermission: async () => PERM.state,
    requestPermission: async () => PERM.state,
    ...(sameEntry ? { isSameEntry: sameEntry } : {}),
  } as unknown as FsDirectoryHandle;
}

/** `isSameEntry` 的语义替身：按「对方句柄的 name」判断（只用于测试，不代表生产逻辑） */
const sameByLabel = (label: string) => (other: unknown): Promise<boolean> =>
  Promise.resolve((other as { name?: string }).name === label);

let nextPicker: FsDirectoryHandle | null = null;
function patchPicker(h: FsDirectoryHandle | null): void {
  nextPicker = h;
  (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = async () => nextPicker;
}

let host: DirectoryWorkspaceHost;
function reboot(): void {
  host = new DirectoryWorkspaceHost(); // 新实例，IDB 保留
}

describe('工作区身份：注册表与同一性', () => {
  /** 经 picker 挂载（多数用例的入口） */
  const mountByPick = async (h: FsDirectoryHandle): Promise<void> => {
    patchPicker(h);
    await host.pick();
  };
  /** 读注册表中某个条目的状态 */
  const stateOf = (got: RegistryReadResult, scopeId: string | null): string | undefined =>
    got.kind === 'ok' && scopeId !== null
      ? got.record.entries.find((e) => e.scopeId === scopeId)?.state
      : undefined;

  it('同目录重新选择（isSameEntry 命中）→ 同一 scopeId', async () => {
    await mountByPick(handleOf('MyNotes', () => Promise.resolve(false)));
    const id1 = host.scopeId;
    reboot(); // 新实例、保留 IDB
    await mountByPick(handleOf('MyNotes', sameByLabel('MyNotes'))); // 新句柄对象，但声称同一
    expect(host.scopeId).toBe(id1);
    expect(host.scopeState.kind).toBe('disk');
  });

  it('不同目录同名 → 不同 scopeId（名称不构成证据）', async () => {
    await mountByPick(handleOf('notes', () => Promise.resolve(false)));
    const id1 = host.scopeId;
    reboot();
    await mountByPick(handleOf('notes', () => Promise.resolve(false))); // 同名但明确不同
    expect(host.scopeId).not.toBe(id1);
  });

  it('★CR2-1：A 登记后选择可证明不同的 B → **B 被持久登记**；刷新后仍是 B；再选 A 恢复原 ID', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false))); // empty → register
    const idA = host.scopeId;
    expect(host.scopeState).toMatchObject({ kind: 'disk', persisted: true });

    reboot();
    await mountByPick(handleOf('B', () => Promise.resolve(false))); // 与 A 明确不同 → register
    const idB = host.scopeId;
    expect(idB).not.toBe(idA);
    expect(host.scopeState).toMatchObject({ kind: 'disk', persisted: true }); // ★ 不得降级

    const got = await readWorkspaceRegistry();
    expect(got.kind).toBe('ok');
    expect(got.kind === 'ok' && got.record.activeScopeId).toBe(idB); // active = B
    expect(stateOf(got, idA)).toBe('dormant'); // A 转 dormant
    expect((await getDirectoryHandle())?.name).toBe('B'); // 裸键 = B

    reboot(); // 刷新恢复
    expect(await host.restore()).toBe(true);
    expect(host.scopeId).toBe(idB);

    reboot(); // 再选 A
    await mountByPick(handleOf('A', sameByLabel('A')));
    expect(host.scopeId).toBe(idA);
    expect(host.scopeState).toMatchObject({ kind: 'disk' });
  });

  it('A→B→A：A 条目保持 dormant，回到 A 恢复原 scopeId', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const idA = host.scopeId;
    reboot();
    await mountByPick(handleOf('B', () => Promise.resolve(false)));
    expect(host.scopeId).not.toBe(idA);
    reboot();
    await mountByPick(handleOf('A', sameByLabel('A')));
    expect(host.scopeId).toBe(idA);
  });

  it('断开再连接 → 不删条目，重连恢复同一 scopeId', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const id = host.scopeId;
    await host.detach();
    expect(host.scopeState.kind).toBe('browser');
    await mountByPick(handleOf('A', sameByLabel('A')));
    expect(host.scopeId).toBe(id);
  });

  it('★CR2-3-a：注册表非空 + 无 isSameEntry → disk-session(unassociated)，注册表与**裸键保持原值**', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const idA = host.scopeId;
    const regBefore = await readWorkspaceRegistry();
    expect((await getDirectoryHandle())?.name).toBe('A'); // A 的裸键已存在

    reboot();
    await mountByPick(handleOf('NewFolder')); // 无 isSameEntry → 全部 unknown → degrade
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'unassociated' });
    expect(host.mounted).toBe(true); // 目录仍可用
    expect(host.scopeId).not.toBe(idA); // 不声称恢复旧身份

    const regAfter = await readWorkspaceRegistry();
    expect(regAfter.kind).toBe('ok');
    if (regBefore.kind !== 'ok' || regAfter.kind !== 'ok') throw new Error('unreachable');
    expect(regAfter.record.activeScopeId).toBe(regBefore.record.activeScopeId);
    expect(regAfter.record.entries.map((e) => e.scopeId)).toEqual(
      regBefore.record.entries.map((e) => e.scopeId),
    );
    // ★ 关键修正：断言**可读目标**，而不是对象深比较；旧句柄仍在，不是 null
    expect((await getDirectoryHandle())?.name).toBe('A');
  });

  it('I-23：同一工作区经 restore 与 requestPermission 得到同一 scopeId', async () => {
    await mountByPick(handleOf('A', sameByLabel('A')));
    const id = host.scopeId;

    reboot(); // 模拟刷新：新实例、root 空
    PERM.state = 'prompt';
    expect(await host.restore()).toBe(false); // prompt → 不挂载（既有语义）
    PERM.state = 'granted'; // 用户点「连接工作区」的手势
    expect(await host.requestPermission()).toBe(true);
    expect(host.scopeId).toBe(id); // 与 restore 同一条解析路径
  });

  it('I-23 负向：requestPermission 在已挂载时不改 scopeId、不变 epoch', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const id = host.scopeId;
    const ep = host.scopeEpoch;
    await host.requestPermission();
    expect(host.scopeId).toBe(id);
    expect(host.scopeEpoch).toBe(ep);
  });

  it('★CR2-3-b：只有注册表读取失败 + 裸键仍可读 → 冷启动可挂载但身份降级', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    reboot();
    fail.readKey = WORKSPACE_REGISTRY_KEY; // 只让注册表键读失败
    expect(await host.restore()).toBe(true);
    fail.readKey = null;
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-unavailable' });
    expect((await readWorkspaceRegistry()).kind).toBe('empty'); // 未留下任何记录
    expect((await getDirectoryHandle())?.name).toBe('Legacy'); // 裸键未被改写
  });

  it('★CR2-3-c：整个存储不可读 → 冷启动无法恢复（restore=false，未挂载）', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    reboot();
    fail.open = true;
    expect(await host.restore()).toBe(false);
    fail.open = false;
    expect(host.mounted).toBe(false);
    expect(host.scopeState.kind).toBe('browser');
  });

  it('R2：picker 已给可用句柄 + 注册表读失败 → 会话挂载，不 legacy adoption、不写键', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    fail.readKey = WORKSPACE_REGISTRY_KEY;
    await mountByPick(handleOf('New'));
    fail.readKey = null;
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-unavailable' });
    expect(host.mounted).toBe(true);
    expect((await readWorkspaceRegistry()).kind).toBe('empty');
    expect((await getDirectoryHandle())?.name).toBe('Legacy'); // 裸键未被改写
  });

  it('旧裸句柄（无注册表）→ legacy adoption 生成新 scopeId，旧读路径仍可用', async () => {
    await setDirectoryHandle(handleOf('Legacy'));
    expect(await host.restore()).toBe(true);
    expect(host.scopeId).toMatch(/^ws:/);
    expect((await readWorkspaceRegistry()).kind).toBe('ok');
  });

  it('注册表损坏 → disk-session(registry-corrupt)，不删除记录', async () => {
    memStore.set(WORKSPACE_REGISTRY_KEY, { not: 'a registry' }); // 直接写脏记录
    await setDirectoryHandle(handleOf('X'));
    expect(await host.restore()).toBe(true);
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-corrupt' });
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt'); // 仍在、未被改写
  });

  it('★G0：损坏库时 pick 与 restore 一致 —— 不覆盖损坏记录，仅本次会话可用', async () => {
    memStore.set(WORKSPACE_REGISTRY_KEY, { not: 'a registry' }); // 直接写脏记录
    await mountByPick(handleOf('X'));
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-corrupt' });
    expect(host.mounted).toBe(true); // 目录仍可用
    expect((await readWorkspaceRegistry()).kind).toBe('corrupt'); // 损坏记录未被改写
    expect(await getDirectoryHandle()).toBeNull(); // 裸键也未被写入
  });

  it('注册表写入失败 → disk-session(registry-write-failed)，但目录仍可用', async () => {
    fail.writeAt = 1; // 第 1 个写请求即失败
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    fail.writeAt = 0;
    expect(host.scopeState).toMatchObject({ kind: 'disk-session', reason: 'registry-write-failed' });
    expect(host.mounted).toBe(true);
  });

  it('R1：detach 把 active 置 dormant、不删条目，且同事务删除裸键', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    expect(await getDirectoryHandle()).not.toBeNull(); // pick 已写裸键
    await host.detach();
    const got = await readWorkspaceRegistry();
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1);
    expect(got.kind === 'ok' && got.record.entries[0]?.state).toBe('dormant');
    expect(got.kind === 'ok' && got.record.activeScopeId).toBeNull();
    expect(await getDirectoryHandle()).toBeNull(); // 同事务一并删除
  });

  it('CR2-4：mutate 返回 conflict → 不写任何键，交调用方重解析', async () => {
    await mountByPick(handleOf('A', () => Promise.resolve(false)));
    const before = await readWorkspaceRegistry();
    const out = await writeWorkspaceRegistry(() => 'conflict', { kind: 'delete' });
    expect(out).toEqual({ kind: 'conflict' });
    expect((await getDirectoryHandle())?.name).toBe('A'); // 裸键未动
    const after = await readWorkspaceRegistry();
    expect(after.kind === 'ok' && after.record.entries.map((e) => e.scopeId)).toEqual(
      before.kind === 'ok' ? before.record.entries.map((e) => e.scopeId) : [],
    );
  });

  it('CR2-4：两调用方从空注册表同时 pick 同一目录 → 不产生重复条目', async () => {
    // 两个独立的 directory-host 模块实例（各自 handleStore 副本 / 各自 writeChain），
    // 共用同一个夹具数据库 —— 对应真实世界的两个标签页。
    vi.resetModules();
    const M1 = await import('../src/edit/directoryHost.js');
    vi.resetModules();
    const M2 = await import('../src/edit/directoryHost.js');
    const h1 = new M1.DirectoryWorkspaceHost();
    const h2 = new M2.DirectoryWorkspaceHost();
    const dir = handleOf('MyNotes', sameByLabel('MyNotes'));

    patchPicker(dir);
    const pick1 = h1.pick();
    patchPicker(dir);
    const pick2 = h2.pick();
    await Promise.all([pick1, pick2]);

    const got = await readWorkspaceRegistry();
    expect(got.kind).toBe('ok');
    expect(got.kind === 'ok' && got.record.entries).toHaveLength(1); // ★ 不重复登记
    expect(h1.scopeId).toBe(h2.scopeId); // 两方最终同一身份
  });

  it('G-3：uuid 源抛错时仍生成合法 scopeId（回退源，不依赖 crypto）', async () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('uuid unavailable');
      },
    });
    try {
      await mountByPick(handleOf('A', () => Promise.resolve(false)));
    } finally {
      vi.unstubAllGlobals();
    }
    expect(host.scopeId).toMatch(/^ws:/);
    expect(String(host.scopeId)).not.toContain('undefined');
    expect(host.scopeState).toMatchObject({ kind: 'disk', persisted: true });
  });
});
