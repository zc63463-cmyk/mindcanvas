// @vitest-environment jsdom
/**
 * FA2-T2：文件工作台的树交互。
 *
 * 锁死这次重构要解决的三件事：
 *  1. **拖拽文件到文件夹即归位** —— 旧版「弹出 input 手敲路径字符串」的交互彻底没了；
 *  2. 右键菜单可新建文件夹 / 新建导图 / 重命名 / 删除（删除带确认）；
 *  3. 顶部搜索按文件名与路径实时过滤，且**保留目录层级**（不能把树拍平）。
 *
 * 工作区用 `WorkspaceLike` 替身注入：不依赖浏览器 FS Access API。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocLibrary, type WorkspaceDir, type WorkspaceFile, type WorkspaceNode } from '@mindcanvas/react';
import { FileManager, type WorkspaceLike } from '../src/FileManager.js';
import { DocIndex } from '../src/docIndex.js';

/**
 * 索引层替身/真身（P0-D）：收藏与「最近」已改为**读写索引**，
 * 不再直接读写 `mindcanvas.starred.v1`。不注入索引时收藏为只读、点击不写任何键
 * （这正是「不产生第二写入口」的守卫）。
 */
function indexFor(): DocIndex {
  return new DocIndex({
    ctx: () => ({
      scopeId: 'browser:local',
      persisted: true,
      hasHistoryEvidence: true,
      handleStoreAvailable: false,
    }),
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- 替身

function file(path: string, content = ''): WorkspaceFile {
  return {
    kind: 'file',
    name: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
    path,
    handle: { name: path, createWritable: async () => ({ write: async () => {}, close: async () => {} }) },
    ts: Date.now(),
    size: content.length,
  };
}

function dir(path: string, children: WorkspaceNode[] = []): WorkspaceDir {
  return {
    kind: 'dir',
    name: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
    path,
    handle: {} as WorkspaceDir['handle'],
    children,
  };
}

/** 内存工作区替身：记录调用，供断言 */
function fakeWorkspace(nodes: WorkspaceNode[]) {
  const calls = {
    created: [] as Array<{ dir: string; name: string }>,
    dirs: [] as Array<{ parent: string; name: string }>,
    moved: [] as Array<{ from: string; to: string }>,
    removed: [] as string[],
    renamed: [] as Array<{ from: string; to: string }>,
  };
  let current = nodes;
  const ws: WorkspaceLike = {
    mounted: true,
    name: 'MyNotes',
    async scan() {
      return current;
    },
    async createFile(dirPath, name) {
      calls.created.push({ dir: dirPath, name });
      const f = file(dirPath === '' ? name : `${dirPath}/${name}`);
      current = [...current, f];
      return f;
    },
    async createDir(parent, name) {
      calls.dirs.push({ parent, name });
      const d = dir(parent === '' ? name : `${parent}/${name}`);
      current = [...current, d];
      return d;
    },
    async renameFile(f, name) {
      calls.renamed.push({ from: f.path, to: name });
      return { ...f, name };
    },
    async removeFile(f) {
      calls.removed.push(f.path);
      current = current.filter((n) => n.kind !== 'file' || n.path !== f.path);
    },
    async removeDir(d) {
      calls.removed.push(d.path);
      current = current.filter((n) => n.kind !== 'dir' || n.path !== d.path);
    },
    async moveFile(f, target) {
      calls.moved.push({ from: f.path, to: target });
      return { ...f, path: `${target}/${f.name}` };
    },
  };
  return { ws, calls };
}

const TREE: WorkspaceNode[] = [
  dir('研发', [file('研发/架构.mm.md', '# 架构'), file('研发/接口.mm.md', '# 接口')]),
  dir('日记', []),
  file('首页.mm.md', '# 首页'),
];

function setup(over: { workspace?: WorkspaceLike | null } = {}) {
  const { ws, calls } = fakeWorkspace(TREE);
  const workspace = over.workspace !== undefined ? over.workspace : ws;
  const onOpenFile = vi.fn();
  const onOpenEntry = vi.fn();
  const onCreate = vi.fn();
  const utils = render(
    <FileManager
      library={new DocLibrary()}
      workspace={workspace}
      onOpenEntry={onOpenEntry}
      onOpenFile={onOpenFile}
      onCreate={onCreate}
      onClose={vi.fn()}
    />,
  );
  return { ...utils, calls, onOpenFile, onOpenEntry, onCreate };
}

const dirRow = (c: HTMLElement, path: string): HTMLElement => {
  const el = c.querySelector(`[data-dir-path="${path}"]`);
  if (!el) throw new Error(`找不到目录行 ${path}`);
  return el as HTMLElement;
};
/** 展开目录：切换按钮在目录行**内部**（点行 DIV 不会展开） */
const expandDir = (c: HTMLElement, path: string): void => {
  const row = c.querySelector(`[data-dir-path="${path}"]`);
  if (!row) throw new Error(`找不到目录行 ${path}`);
  const btn = row.querySelector('button');
  if (!btn) throw new Error(`目录行 ${path} 没有切换按钮`);
  fireEvent.click(btn);
};
const docRow = (c: HTMLElement, name: string): HTMLElement => {
  const el = c.querySelector(`[data-doc-name="${name}"]`);
  if (!el) throw new Error(`找不到文件行 ${name}`);
  return el as HTMLElement;
};

describe('文件工作台 · 树渲染', () => {
  it('渲染真实目录树：目录在前、文件在后，并按名称排序', async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    const rows = Array.from(container.querySelectorAll('[data-dir-path]')).map((e) =>
      e.getAttribute('data-dir-path'),
    );
    // 中文按拼音排序：日(ri) < 研(yan)
    expect(rows).toEqual(['日记', '研发']);
  });

  it('点击文件名 → onOpenFile 带真实句柄', async () => {
    const { container, onOpenFile } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.click(screen.getByText('首页.mm.md'));
    await waitFor(() => expect(onOpenFile).toHaveBeenCalled());
    expect(onOpenFile.mock.calls[0]?.[0]?.path).toBe('首页.mm.md');
    expect(container).toBeTruthy();
  });

  it('折叠/展开：点击目录切换子项可见性（状态被记住）', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    // 默认折叠：子项不在 DOM
    expect(screen.queryByText('架构.mm.md')).toBeNull();
    fireEvent.click(screen.getByText('研发'));
    await waitFor(() => expect(screen.getByText('架构.mm.md')).toBeDefined());
    fireEvent.click(screen.getByText('研发'));
    await waitFor(() => expect(screen.queryByText('架构.mm.md')).toBeNull());
    expect(container).toBeTruthy();
  });
});

describe('文件工作台 · 搜索过滤', () => {
  it('按文件名过滤（保留命中项的目录层级）', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.change(container.querySelector('[data-fm-search]')!, { target: { value: '架构' } });
    await waitFor(() => expect(screen.getByText('架构.mm.md')).toBeDefined());
    expect(screen.queryByText('首页.mm.md')).toBeNull();
    // 父目录仍在 → 没有把树拍平
    expect(container.querySelector('[data-dir-path="研发"]')).not.toBeNull();
  });

  it('按目录名过滤 → 保留整棵子树', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.change(container.querySelector('[data-fm-search]')!, { target: { value: '日记' } });
    await waitFor(() => expect(screen.getByText('日记')).toBeDefined());
    expect(screen.queryByText('首页.mm.md')).toBeNull();
  });

  it('无命中 → 空态提示，而不是空白', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.change(container.querySelector('[data-fm-search]')!, { target: { value: 'zzz' } });
    await waitFor(() => expect(container.textContent).toContain('没有匹配'));
  });
});

describe('文件工作台 · 拖拽归位（取代手敲路径）', () => {
  it('拖文件到目录行 → moveFile(文件, 目标目录)', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());

    const src = docRow(container, '首页.mm.md');
    const target = dirRow(container, '研发');
    fireEvent.dragStart(src);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() => expect(calls.moved.length).toBe(1));
    expect(calls.moved[0]).toEqual({ from: '首页.mm.md', to: '研发' });
  });

  it('拖拽经过目录时高亮（投放前可预知落点）', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    const src = docRow(container, '首页.mm.md');
    const target = dirRow(container, '日记');
    fireEvent.dragStart(src);
    fireEvent.dragOver(target);
    await waitFor(() => expect(target.getAttribute('data-drop-active')).not.toBeNull());
  });

  it('拖到文件**所在**目录 = 无操作（不产生冗余移动）', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    // 「首页.mm.md」已在根；根不是一个目录行，故用「研发」的子项验证归属判定
    fireEvent.click(screen.getByText('研发'));
    await waitFor(() => expect(screen.getByText('架构.mm.md')).toBeDefined());
    fireEvent.dragStart(docRow(container, '架构.mm.md'));
    fireEvent.drop(dirRow(container, '研发'));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.moved.length).toBe(0);
  });
});

describe('文件工作台 · 右键菜单', () => {
  it('文件夹右键 → 含「新建文件夹 / 新建导图 / 重命名 / 删除」', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(dirRow(container, '研发'));
    await waitFor(() => expect(container.querySelector('[data-context-menu]')).not.toBeNull());
    expect(container.querySelector('[data-menu-new-dir]')).not.toBeNull();
    expect(container.querySelector('[data-menu-new-doc]')).not.toBeNull();
    expect(container.querySelector('[data-menu-rename]')).not.toBeNull();
    expect(container.querySelector('[data-menu-delete]')).not.toBeNull();
  });

  it('新建文件夹 → 内联命名 + Enter → 走工作区 createDir（真实落盘）', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(dirRow(container, '研发'));
    await waitFor(() => expect(container.querySelector('[data-menu-new-dir]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-new-dir]')!);
    // A-D3：原 window.prompt 改为内联命名输入（data-fm-name）
    const input = await waitFor(
      () => container.querySelector('[data-fm-name] input') as HTMLInputElement,
    );
    fireEvent.change(input, { target: { value: '新项目' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.dirs.length).toBe(1));
    expect(calls.dirs[0]).toEqual({ parent: '研发', name: '新项目' });
  });

  it('新建导图 → 走工作区 createFile（真实落盘）', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(dirRow(container, '日记'));
    await waitFor(() => expect(container.querySelector('[data-menu-new-doc]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-new-doc]')!);
    await waitFor(() => expect(calls.created.length).toBe(1));
    expect(calls.created[0]?.dir).toBe('日记');
  });

  it('删除：确认条「取消」→ 不删；「删除」→ 删', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());

    // A-D3：原 window.confirm 改为内联确认条（data-fm-confirm）
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-fm-confirm-cancel]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).toBeNull());
    expect(calls.removed.length).toBe(0);

    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-fm-confirm-ok]')!);
    await waitFor(() => expect(calls.removed.length).toBe(1));
    expect(calls.removed[0]).toBe('首页.mm.md');
  });

  it('重命名 → 出现内联输入框，失焦提交', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-rename]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-rename]')!);
    const input = await waitFor(() => container.querySelector('[data-rename-input]') as HTMLInputElement);
    fireEvent.change(input, { target: { value: '新首页.mm.md' } });
    fireEvent.blur(input);
    await waitFor(() => expect(calls.renamed.length).toBe(1));
    expect(calls.renamed[0]).toEqual({ from: '首页.mm.md', to: '新首页.mm.md' });
  });
});

describe('文件工作台 · 未连接工作区时的降级', () => {
  it('workspace=null → 显示「打开本地文件夹…」入口，且仍可浏览 DocLibrary', async () => {
    const lib = new DocLibrary();
    lib.upsert({ id: 'a.mm.md', name: 'a.mm.md', source: '# A', folder: '工作' });
    const onPick = vi.fn();
    render(
      <FileManager
        library={lib}
        workspace={null}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onPickWorkspace={onPick}
        onClose={vi.fn()}
      />,
    );
    const pick = await waitFor(() => screen.getByText('打开本地文件夹…'));
    fireEvent.click(pick);
    expect(onPick).toHaveBeenCalled();
    // 兼容模式仍渲染 DocLibrary 的虚拟目录（默认折叠，展开后可见文档）
    expect(await screen.findByText('工作')).toBeDefined();
    fireEvent.click(screen.getByText('工作'));
    expect(await screen.findByText('a.mm.md')).toBeDefined();
  });

  it('已连接工作区 → 显示「🟢 本地磁盘已同步」与工作区名', async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelector('[data-ws-mounted]')).not.toBeNull());
    expect(container.querySelector('[data-ws-mounted]')?.textContent).toContain('工作区已连接');
    expect(container.textContent).toContain('MyNotes');
  });
});

describe('文件工作台 · 状态与面包屑', () => {
  it('dirty → 📝 未保存；否则 🟢 本地磁盘已同步', async () => {
    const { ws } = fakeWorkspace(TREE);
    const { unmount } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        currentPath="研发/架构.mm.md"
        dirty
      />,
    );
    await waitFor(() => expect(screen.getByText('📝 未保存')).toBeDefined());
    unmount();

    render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        currentPath="研发/架构.mm.md"
      />,
    );
    await waitFor(() => expect(screen.getByText('🟢 本地磁盘已同步')).toBeDefined());
  });

  it('面包屑逐级展示物理路径', async () => {
    const { ws } = fakeWorkspace(TREE);
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
        currentPath="研发/架构.mm.md"
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-breadcrumb]')).not.toBeNull());
    const crumb = container.querySelector('[data-fm-breadcrumb]')!.textContent ?? '';
    expect(crumb).toContain('研发');
    expect(crumb).toContain('架构.mm.md');
  });
});

describe('文件工作台 · 预设目录与分类 Tab 与星标', () => {
  it('本地模式自动展示预设分类目录', async () => {
    const lib = new DocLibrary();
    lib.ensurePresetFolders();
    lib.upsert({ id: 'demo.mm.md', name: 'demo.mm.md', source: '# Demo', folder: '示例导图' });

    render(
      <FileManager
        library={lib}
        workspace={null}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(await screen.findByText('示例导图')).toBeDefined();
    expect(screen.getByText('工作项目')).toBeDefined();
    expect(screen.getByText('个人笔记')).toBeDefined();
    expect(screen.getByText('灵感草稿')).toBeDefined();
  });

  it('点击「+ 新建文件夹」→ 内联命名 + Enter → 创建空目录并在树中呈现', async () => {
    const lib = new DocLibrary();

    const { container } = render(
      <FileManager
        library={lib}
        workspace={null}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const btn = container.querySelector('[data-fm-new-folder]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    fireEvent.click(btn);

    // A-D3：原 window.prompt 改为内联命名输入（data-fm-name）
    const input = await waitFor(
      () => container.querySelector('[data-fm-name] input') as HTMLInputElement,
    );
    fireEvent.change(input, { target: { value: '新项目文件夹' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(await screen.findByText('新项目文件夹')).toBeDefined();
  });

  it('分类 Tab 切换：全部目录 ↔ 最近打开 ↔ 收藏星标', async () => {
    const lib = new DocLibrary();
    lib.upsert({ id: 'a.mm.md', name: 'a.mm.md', source: '# A', folder: '工作' });
    lib.upsert({ id: 'b.mm.md', name: 'b.mm.md', source: '# B', folder: '生活' });

    const index = indexFor();
    const { container } = render(
      <FileManager
        library={lib}
        index={index}
        workspace={null}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    // 默认展示树
    expect(container.querySelector('[data-fm-tree]')).not.toBeNull();

    // 切换到「最近打开」
    const recentTab = container.querySelector('[data-tab="recent"]') as HTMLButtonElement;
    fireEvent.click(recentTab);
    await waitFor(() => {
      const flatDocs = container.querySelectorAll('[data-flat-doc]');
      expect(flatDocs.length).toBe(2);
    });

    // 切换到「收藏星标」，此时尚无星标
    const starredTab = container.querySelector('[data-tab="starred"]') as HTMLButtonElement;
    fireEvent.click(starredTab);
    expect(screen.getByText(/暂无收藏导图/)).toBeDefined();

    // 切换回「全部目录」，为 a.mm.md 加星
    const treeTab = container.querySelector('[data-tab="tree"]') as HTMLButtonElement;
    fireEvent.click(treeTab);

    // 展开「工作」目录以看到文档
    fireEvent.click(screen.getByText('工作'));
    expect(await screen.findByText('a.mm.md')).toBeDefined();

    // 点击加星按钮
    const starBtn = container.querySelector('[data-doc-star]') as HTMLButtonElement;
    fireEvent.click(starBtn);

    // 再次切到「收藏星标」
    fireEvent.click(starredTab);
    await waitFor(() => {
      const flatDocs = container.querySelectorAll('[data-flat-doc]');
      expect(flatDocs.length).toBe(1);
      expect(flatDocs[0]?.textContent).toContain('a.mm.md');
    });
    // 收藏落在**索引**里，并经降级投影同步到旧键（§6.3 / I-21）
    expect(index.starredKeys().has('a.mm.md')).toBe(true);
    expect(JSON.parse(localStorage.getItem('mindcanvas.starred.v1') ?? '[]')).toContain('a.mm.md');
  });
});

beforeEach(() => {
  localStorage.clear();
});

/**
 * P0-A：当前文档操作的**分流**（只有当前文档走租约/重绑，其余节点语义不变）。
 *
 * 判别核心：面板必须按「这个文件是不是当前正在编辑的那份」分流 ——
 * 分流错了会出现两种事故：当前文档走旧路径（目的地不重绑，R-01），
 * 或普通文件走新路径（无谓地占用租约、动离开语义）。
 */
describe('P0-A · 当前文档操作分流', () => {
  function setupWithCurrent(currentPath: string | null) {
    const { ws, calls } = fakeWorkspace(TREE);
    const ops = {
      renamed: [] as Array<{ path: string; name: string; overwrite?: boolean }>,
      moved: [] as Array<{ path: string; dir: string }>,
      deleted: [] as string[],
      duplicated: [] as string[],
      notices: [] as string[],
      dismissed: 0,
    };
    const ui = { dirtyChoice: null, partial: null, notice: null };
    const currentDocOps = {
      currentPath,
      ui,
      rename: async (f: WorkspaceFile, name: string, overwrite?: boolean) => {
        ops.renamed.push({ path: f.path, name, overwrite });
      },
      move: async (f: WorkspaceFile, targetDir: string) => {
        ops.moved.push({ path: f.path, dir: targetDir });
      },
      duplicate: async (f: WorkspaceFile) => {
        ops.duplicated.push(f.path);
      },
      delete: async (f: WorkspaceFile) => {
        ops.deleted.push(f.path);
      },
      resolveConflictName: async (_dir: string, name: string) => name,
      dismissNotice: () => {
        ops.dismissed += 1;
      },
    };
    const utils = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        currentDocOps={currentDocOps}
        currentPath={currentPath}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    return { ...utils, calls, ops };
  }

  it('★非当前文档保持既有语义（不走 currentDocOps）', async () => {
    const { container, calls, ops } = setupWithCurrent('研发/架构.mm.md');
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    // 「首页.mm.md」不是当前文档 → 拖拽归位应走既有 moveFile
    const src = docRow(container, '首页.mm.md');
    const target = dirRow(container, '日记');
    fireEvent.dragStart(src);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(() => expect(calls.moved.length).toBe(1));
    expect(ops.moved).toHaveLength(0); // 编排一次都没被调用
  });

  it('★当前文档删除 → 走 F2 流程（不走既有确认条）', async () => {
    const { container, ops } = setupWithCurrent('研发/架构.mm.md');
    await waitFor(() => expect(dirRow(container, '研发')).not.toBeNull());
    // 展开目录才能看到嵌套文档（树默认只展开根）
    expandDir(container, '研发');
    await waitFor(() => expect(container.querySelector('[data-doc-path="研发/架构.mm.md"]')).not.toBeNull());
    fireEvent.contextMenu(docRow(container, '架构.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    // 当前文档：直接进 F2 流程，**不**出现既有确认条
    await waitFor(() => expect(ops.deleted).toEqual(['研发/架构.mm.md']));
    expect(container.querySelector('[data-fm-confirm]')).toBeNull();
  });

  it('★非当前文档删除 → 仍走既有内联确认条（零弱化）', async () => {
    const { container, calls, ops } = setupWithCurrent('研发/架构.mm.md');
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());
    expect(ops.deleted).toHaveLength(0);
    expect(calls.removed).toHaveLength(0); // 确认条未确认 → 零删除
  });

  it('★右键菜单有「创建副本」入口 → 走 currentDocOps.duplicate', async () => {
    const { container, ops } = setupWithCurrent('研发/架构.mm.md');
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    const dup = await waitFor(() => container.querySelector('[data-menu-duplicate]'));
    fireEvent.click(dup!);
    await waitFor(() => expect(ops.duplicated).toEqual(['首页.mm.md']));
  });

  it('★F5：同名不同目录 —— 只有真正打开的那一份被当作当前文档', async () => {
    // 前置：研发/笔记.mm.md 与 个人/笔记.mm.md 同名；当前打开的是研发那一份。
    // 判别：对「个人」那一份做删除必须走**既有确认条**（它不是当前文档），
    // 对「研发」那一份必须走 F2 —— 若按名字判定当前文档，两者会分错。
    const { ws, calls } = fakeWorkspace([
      dir('研发', [file('研发/笔记.mm.md')]),
      dir('个人', [file('个人/笔记.mm.md')]),
    ]);
    const ops = { deleted: [] as string[] };
    const currentDocOps = {
      currentPath: '研发/笔记.mm.md',
      ui: { dirtyChoice: null, partial: null, notice: null },
      rename: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      duplicate: vi.fn(async () => {}),
      delete: async (f: WorkspaceFile) => {
        ops.deleted.push(f.path);
      },
      resolveConflictName: async (_d: string, n: string) => n,
      dismissNotice: vi.fn(),
    };
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        currentDocOps={currentDocOps}
        currentPath="研发/笔记.mm.md"
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    // 展开两个目录（展开态是 Set，互不影响）
    await waitFor(() => expect(dirRow(container, '研发')).not.toBeNull());
    expandDir(container, '研发');
    expandDir(container, '个人');
    await waitFor(() => expect(container.querySelectorAll('[data-doc-name="笔记.mm.md"]').length).toBe(2));

    // 「个人」那一份：同名但**不是**当前文档 → 既有确认条
    const personal = container.querySelector(
      '[data-doc-path="个人/笔记.mm.md"]',
    ) as HTMLElement | null;
    if (personal === null) throw new Error('找不到 个人/笔记.mm.md 行');
    fireEvent.contextMenu(personal);
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());
    expect(ops.deleted).toHaveLength(0); // 不是当前文档 → 没进 F2
    expect(calls.removed).toHaveLength(0); // 确认条未确认 → 零删除
    fireEvent.click(container.querySelector('[data-fm-confirm-cancel]')!);
  });

  it('未注入 currentDocOps（旧调用方）→ 不渲染副本入口且不报错', async () => {
    const { ws } = fakeWorkspace(TREE);
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    expect(container.querySelector('[data-menu-duplicate]')).toBeNull();
  });

});
