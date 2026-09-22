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

  it('分类 Tab 切换：全部目录 ↔ 最近修改 ↔ 收藏星标', async () => {
    const lib = new DocLibrary();
    lib.upsert({ id: 'a.mm.md', name: 'a.mm.md', source: '# A', folder: '工作' });
    lib.upsert({ id: 'b.mm.md', name: 'b.mm.md', source: '# B', folder: '生活' });

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

    // 默认展示树
    expect(container.querySelector('[data-fm-tree]')).not.toBeNull();

    // 切换到「最近修改」
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
  });
});

beforeEach(() => {
  localStorage.clear();
});
