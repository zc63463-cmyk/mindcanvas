/**
 * A-D3：FileManager 的删除确认 / 新建命名交互——**去原生对话框**。
 *
 * 为什么有它：IDE webview 会静默吞掉 confirm/prompt（见 no-native-dialogs.test.ts），
 * 删除与新建命名必须走内联 UI。本文件锁住替换后的四个行为面：
 *  1. 点「删除」→ 出内联确认条（data-fm-confirm），且**未**触碰 removeFile/removeDir；
 *  2. 「取消」→ 确认条消失、仍未删除；「删除」→ 恰好调用一次（workspace / library 两路径）；
 *  3. 顶栏「新建文件夹」→ 内联命名输入（data-fm-name）→ Enter 提交 / Esc 取消；
 *  4. 右键菜单「新建文件夹」→ 同一 namingTarget 管线（目标目录 = 菜单所在目录）。
 *
 * confirm / prompt 均被换成会抛错的 spy：实现只要触碰原生对话框即测试失败。
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

// ---------------------------------------------------------------- 替身（沿用 file-manager-tree.test.tsx 形态）

function file(path: string): WorkspaceFile {
  return {
    kind: 'file',
    name: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
    path,
    handle: { name: path, createWritable: async () => ({ write: async () => {}, close: async () => {} }) },
    ts: Date.now(),
    size: 0,
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

function fakeWorkspace(nodes: WorkspaceNode[]) {
  const calls = {
    dirs: [] as Array<{ parent: string; name: string }>,
    removed: [] as string[],
  };
  let current = nodes;
  const ws: WorkspaceLike = {
    mounted: true,
    name: 'MyNotes',
    async scan() {
      return current;
    },
    async createFile(dirPath, name) {
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
      return { ...f, path: `${target}/${f.name}` };
    },
  };
  return { ws, calls };
}

const TREE: WorkspaceNode[] = [dir('研发', [file('研发/架构.mm.md')]), dir('日记', []), file('首页.mm.md')];

function setup() {
  const { ws, calls } = fakeWorkspace(TREE);
  const utils = render(
    <FileManager
      library={new DocLibrary()}
      workspace={ws}
      onOpenEntry={vi.fn()}
      onOpenFile={vi.fn()}
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { ...utils, calls };
}

const dialogGuard = (): void => {
  // 原生对话框一律不得触碰：被调用即抛错（webview 下它们是「静默假死」源）
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('native confirm() 被调用');
  });
  vi.spyOn(window, 'prompt').mockImplementation(() => {
    throw new Error('native prompt() 被调用');
  });
};

const docRow = (c: HTMLElement, name: string): HTMLElement => {
  const el = c.querySelector(`[data-doc-name="${name}"]`);
  if (!el) throw new Error(`找不到文件行 ${name}`);
  return el as HTMLElement;
};
const dirRow = (c: HTMLElement, path: string): HTMLElement => {
  const el = c.querySelector(`[data-dir-path="${path}"]`);
  if (!el) throw new Error(`找不到目录行 ${path}`);
  return el as HTMLElement;
};

beforeEach(() => {
  localStorage.clear();
  dialogGuard();
});

describe('FileManager · 删除确认（内联确认条，替代 window.confirm）', () => {
  it('点删除 → 出确认条且未删除；点取消 → 确认条消失、仍未删除', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());

    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);

    const bar = await waitFor(() => container.querySelector('[data-fm-confirm]'));
    expect(bar!.textContent).toContain('文件「首页.mm.md」');
    expect(calls.removed.length).toBe(0);

    fireEvent.click(container.querySelector('[data-fm-confirm-cancel]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).toBeNull());
    expect(calls.removed.length).toBe(0);
  });

  it('确认条点「删除」→ 恰好删除一次（workspace 路径）', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());

    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());

    fireEvent.click(container.querySelector('[data-fm-confirm-ok]')!);
    await waitFor(() => expect(calls.removed.length).toBe(1));
    expect(calls.removed[0]).toBe('首页.mm.md');
    expect(container.querySelector('[data-fm-confirm]')).toBeNull();
  });

  it('文件夹删除：文案含「及其全部内容」', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('日记')).toBeDefined());

    fireEvent.contextMenu(dirRow(container, '日记'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);

    const bar = await waitFor(() => container.querySelector('[data-fm-confirm]'));
    expect(bar!.textContent).toContain('文件夹「日记」及其全部内容');
  });

  it('确认条点「删除」→ 恰好删除一次（library 兼容路径）', async () => {
    const lib = new DocLibrary();
    lib.upsert({ id: 'a.mm.md', name: 'a.mm.md', source: '# A', folder: '工作' });
    const removeSpy = vi.spyOn(lib, 'remove');
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
    fireEvent.click(await screen.findByText('工作'));
    await screen.findByText('a.mm.md');

    fireEvent.contextMenu(docRow(container, 'a.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());
    expect(removeSpy).not.toHaveBeenCalled();

    fireEvent.click(container.querySelector('[data-fm-confirm-ok]')!);
    await waitFor(() => expect(removeSpy).toHaveBeenCalledTimes(1));
    expect(removeSpy).toHaveBeenCalledWith('a.mm.md');
  });
});

describe('FileManager · 新建文件夹命名（内联输入，替代 window.prompt）', () => {
  it('顶栏「新建文件夹」→ 出内联输入；输入名 + Enter → createDir 收到该名', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());

    fireEvent.click(container.querySelector('[data-fm-new-folder]')!);
    const input = await waitFor(() => container.querySelector('[data-fm-name] input') as HTMLInputElement);
    expect(input.value).toBe('新文件夹');

    fireEvent.change(input, { target: { value: '新项目文件夹' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(calls.dirs.length).toBe(1));
    expect(calls.dirs[0]).toEqual({ parent: '', name: '新项目文件夹' });
    expect(window.prompt).not.toHaveBeenCalled();
    expect(container.querySelector('[data-fm-name]')).toBeNull();
  });

  it('Esc → 取消命名（不出现在 createDir、输入条消失）', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());

    fireEvent.click(container.querySelector('[data-fm-new-folder]')!);
    const input = await waitFor(() => container.querySelector('[data-fm-name] input') as HTMLInputElement);
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(container.querySelector('[data-fm-name]')).toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.dirs.length).toBe(0);
  });

  it('右键菜单「新建文件夹」→ 同一内联输入（目标目录 = 菜单所在目录）', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('日记')).toBeDefined());

    fireEvent.contextMenu(dirRow(container, '日记'));
    await waitFor(() => expect(container.querySelector('[data-menu-new-dir]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-new-dir]')!);

    const input = await waitFor(() => container.querySelector('[data-fm-name] input') as HTMLInputElement);
    fireEvent.change(input, { target: { value: '子目录' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(calls.dirs.length).toBe(1));
    expect(calls.dirs[0]).toEqual({ parent: '日记', name: '子目录' });
  });
});

/**
 * P0-A：删除确认的内容分级（§3.6「确认内容分级」）与当前文档的 F2 分流。
 *
 * 既有四条用例（普通文档 / 目录 / 兼容路径）保持不变 —— 它们锚定「内联确认条」这一层。
 * 本组补的是 P0-A 新增的两件事：
 *  ① 当前打开的文档：删除必须走 F2 流程（草稿/组合/未保存三选），**不**直接进确认条；
 *  ② 其余文档仍走确认条（零弱化）。
 */
describe('P0-A · 当前文档删除走 F2 分流', () => {
  function setupWithOps(currentPath: string | null) {
    const { ws, calls } = fakeWorkspace(TREE);
    const ops = { deleted: [] as string[], dismissed: 0 };
    const currentDocOps = {
      currentPath,
      ui: { dirtyChoice: null, partial: null, notice: null },
      rename: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      duplicate: vi.fn(async () => {}),
      delete: async (f: WorkspaceFile) => {
        ops.deleted.push(f.path);
      },
      resolveConflictName: async (_d: string, n: string) => n,
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

  it('★当前文档：点删除 → 直接进 F2（确认条不出现，删除由流程决定）', async () => {
    const { container, ops } = setupWithOps('首页.mm.md');
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(ops.deleted).toEqual(['首页.mm.md']));
    // 关键：**不**出现既有确认条 —— 当前文档的确认由 F2 自己的状态机负责
    expect(container.querySelector('[data-fm-confirm]')).toBeNull();
  });

  it('★非当前文档：仍走既有确认条（零弱化）', async () => {
    const { container, calls, ops } = setupWithOps('研发/架构.mm.md');
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-menu-delete]')!);
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());
    expect(ops.deleted).toHaveLength(0);
    // 确认后走既有 removeFile（既有断言边界不动）
    fireEvent.click(container.querySelector('[data-fm-confirm-ok]')!);
    await waitFor(() => expect(calls.removed).toEqual(['首页.mm.md']));
  });

  it('提示条：notice 非空 → 渲染并可「知道了」关闭', async () => {
    const { ws } = fakeWorkspace(TREE);
    let dismissed = 0;
    const notice = '没有写入权限：请重新授权后重试。';
    const currentDocOps = {
      currentPath: '首页.mm.md',
      ui: { dirtyChoice: null, partial: null, notice },
      rename: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      duplicate: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      resolveConflictName: async (_d: string, n: string) => n,
      dismissNotice: () => {
        dismissed += 1;
      },
    };
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        currentDocOps={currentDocOps}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const bar = await waitFor(() => container.querySelector('[data-fm-op-notice]'));
    expect(bar!.textContent).toContain('没有写入权限');
    fireEvent.click(container.querySelector('[data-fm-op-notice-dismiss]')!);
    expect(dismissed).toBe(1);
  });

  it('空 notice（如「与源同名」的静默取消）→ **不渲染**提示条', async () => {
    const { ws } = fakeWorkspace(TREE);
    const currentDocOps = {
      currentPath: '首页.mm.md',
      ui: { dirtyChoice: null, partial: null, notice: '' },
      rename: vi.fn(async () => {}),
      move: vi.fn(async () => {}),
      duplicate: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      resolveConflictName: async (_d: string, n: string) => n,
      dismissNotice: vi.fn(),
    };
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        currentDocOps={currentDocOps}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    // 静默取消 = 没有反馈就是正确反馈
    expect(container.querySelector('[data-fm-op-notice]')).toBeNull();
  });
});
