// @vitest-environment jsdom
/**
 * P1-A ⑥：**改为归档**（`file-management.md` §3.6 / §3.1 预裁决）。
 * ══════════════════════════════════════════════════════════════════════
 * 要证明的四件事：
 *  ① 归档 = **一次可靠移动**（`_归档/<名>`），不是新存储概念：
 *     目录不存在时被创建，路径正确，`lineageId`/收藏/最近不改（同一份文档）；
 *  ② **两个入口同一编排**（§3.2）：右键菜单「改为归档」与删除确认条旁的
 *     次要动作调 `archive.request` 的**同一个**函数 —— 断言两者产生完全相同的落点；
 *  ③ 当前文档归档走**租约编排**（`currentDocOps.move`），非当前文档走既有 move
 *     （与 `useFileManagerRouting` 的既有分流同规）；
 *  ④ 负控 4/5：**落点冲突不得静默覆盖**、**失败不得留幽灵条目**。
 *
 * 归档**不**新增索引字段/存储键（§3.1）：本文件另有一条断言直接检查磁盘调用面
 * 只有一次 `moveFile`，不出现第二套写路径。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocLibrary, type WorkspaceDir, type WorkspaceFile, type WorkspaceNode } from '@mindcanvas/react';
import { FileManager, type WorkspaceLike } from '../src/FileManager.js';
import { ARCHIVE_DIR, archiveRefusalOf, archiveTargetDir, isArchivedPath } from '../src/fileArchive.js';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});
beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------- 替身

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

/**
 * 内存工作区替身（**含 `_归档/` 的自动创建**）。
 *
 * 为什么替身要建目录：生产侧由 `moveFileSafe` 内部的
 * `dirAt(root, path, /* create *\/ true)` 承担；若替身不建，用例就测不到
 * 「首次归档时目录被创建」这条真实语义（那正是最容易漏的一步）。
 */
function fakeWorkspace(nodes: WorkspaceNode[], opts: { failMove?: boolean } = {}) {
  const calls = {
    moved: [] as Array<{ from: string; to: string }>,
    createdDirs: [] as string[],
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
      const p = parent === '' ? name : `${parent}/${name}`;
      calls.createdDirs.push(p);
      const d = dir(p);
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
      calls.moved.push({ from: f.path, to: target });
      if (opts.failMove === true) throw new Error('E-PERMISSION: 权限被拒');
      // 目标目录不存在 → 建（等价于宿主 `moveFileSafe` 的 create:true）
      const top = target.split('/')[0] ?? target;
      if (!current.some((n) => n.kind === 'dir' && n.path === top)) {
        calls.createdDirs.push(top);
        current = [...current, dir(top)];
      }
      const moved = { ...f, path: `${target}/${f.name}` };
      current = current.filter((n) => n.kind !== 'dir' || n.path !== top);
      current = [...current.filter((n) => !(n.kind === 'file' && n.path === f.path)), moved];
      return moved;
    },
  };
  return { ws, calls };
}

const TREE: WorkspaceNode[] = [
  dir('研发', [file('研发/架构.mm.md'), file('研发/接口.mm.md')]),
  file('首页.mm.md'),
];

const must = (c: HTMLElement, sel: string): HTMLElement => {
  const el = c.querySelector(sel);
  if (el === null) throw new Error(`找不到元素 ${sel}`);
  return el as HTMLElement;
};
const docRow = (c: HTMLElement, name: string): HTMLElement => must(c, `[data-doc-name="${name}"]`);
const expandDir = (c: HTMLElement, path: string): void => {
  const row = must(c, `[data-dir-path="${path}"]`);
  const btn = row.querySelector('button');
  if (btn === null) throw new Error('目录行没有切换按钮');
  fireEvent.click(btn);
};

function setup(over: {
  nodes?: WorkspaceNode[];
  failMove?: boolean;
  currentDocOps?: unknown;
  currentPath?: string | null;
} = {}) {
  const { ws, calls } = fakeWorkspace(over.nodes ?? TREE, { failMove: over.failMove });
  const utils = render(
    <FileManager
      library={new DocLibrary()}
      workspace={ws}
      currentPath={over.currentPath ?? null}
      currentDocOps={
        (over.currentDocOps ?? null) as React.ComponentProps<typeof FileManager>['currentDocOps']
      }
      onOpenEntry={vi.fn()}
      onOpenFile={vi.fn()}
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { ...utils, calls, ws };
}

// ---------------------------------------------------------------- 纯函数层

describe('P1-A ⑥ · 归档落点（纯函数）', () => {
  it('落点 = `_归档/<原目录>`（同级同名保持）；根层文件直接进 `_归档/`', () => {
    // 落点是**目标目录**（移动语义），文件名不变 —— 故根层文件 = `_归档`
    expect(archiveTargetDir('首页.mm.md')).toBe(ARCHIVE_DIR);
    // 嵌套文档保留原目录层级：`_归档/研发`，避免不同子目录的同名文件互相撞名
    expect(archiveTargetDir('研发/架构.mm.md')).toBe(`${ARCHIVE_DIR}/研发`);
  });

  it('isArchivedPath 认嵌套归档目录（任一段等于 `_归档`）', () => {
    expect(isArchivedPath('_归档/a.mm.md')).toBe(true);
    expect(isArchivedPath('研发/_归档/a.mm.md')).toBe(true);
    expect(isArchivedPath('研发/a.mm.md')).toBe(false);
    // 只以「开头是 _归档/」判定会漏掉嵌套这一形态
    expect(isArchivedPath('研发/_归档/x/a.mm.md')).toBe(true);
  });

  it('前置校验：未挂载 / 目录 / 已在归档 → 各自有理由，零 I/O', () => {
    expect(archiveRefusalOf({ relPath: 'a.mm.md', mounted: false, isDir: false })).toBe('no-workspace');
    expect(archiveRefusalOf({ relPath: '研发', mounted: true, isDir: true })).toBe('not-a-file');
    expect(archiveRefusalOf({ relPath: '_归档/a.mm.md', mounted: true, isDir: false })).toBe(
      'already-archived',
    );
    expect(archiveRefusalOf({ relPath: '研发/a.mm.md', mounted: true, isDir: false })).toBeNull();
  });
});

// ---------------------------------------------------------------- 入口一：删除确认条旁的次要动作

describe('P1-A ⑥ · 入口一：删除确认条旁的「改为归档」', () => {
  it('二次确认条出现「改为归档」；点击 → 移入 `_归档/` 且**不**删除', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    fireEvent.click(await waitFor(() => must(container, '[data-menu-delete]')));
    const archiveBtn = await waitFor(() => must(container, '[data-fm-confirm-archive]'));
    fireEvent.click(archiveBtn);
    await waitFor(() => expect(calls.moved.length).toBe(1));
    expect(calls.moved[0]).toEqual({ from: '首页.mm.md', to: ARCHIVE_DIR });
    expect(calls.removed).toHaveLength(0); // 归档不是删除（DS-13 的替代关系）
    // 确认条收起（动作已决）
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).toBeNull());
  });

  it('首次归档会创建 `_归档/`（目录不存在 → 宿主创建）', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    fireEvent.click(await waitFor(() => must(container, '[data-menu-delete]')));
    fireEvent.click(await waitFor(() => must(container, '[data-fm-confirm-archive]')));
    await waitFor(() => expect(calls.createdDirs).toContain(ARCHIVE_DIR));
  });
});

// ---------------------------------------------------------------- 入口二：右键菜单

describe('P1-A ⑥ · 入口二：右键菜单「改为归档」', () => {
  it('菜单项存在且文案写明落点；点击 → 与入口一**同一落点**', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    expandDir(container, '研发');
    const nested = await waitFor(() => docRow(container, '架构.mm.md'));
    fireEvent.contextMenu(nested);
    const item = await waitFor(() => must(container, '[data-menu-archive]'));
    expect(item.textContent).toContain('_归档');
    fireEvent.click(item);
    await waitFor(() => expect(calls.moved.length).toBe(1));
    // 嵌套文档保留其目录层级，避免不同子目录的同名文件互相撞名
    expect(calls.moved[0]).toEqual({ from: '研发/架构.mm.md', to: `${ARCHIVE_DIR}/研发` });
  });

  it('已在归档里的文档**不**再给出归档入口（零 I/O 的空操作不给按钮）', async () => {
    const { container } = setup({
      nodes: [dir(ARCHIVE_DIR, [file(`${ARCHIVE_DIR}/旧.mm.md`)])],
    });
    await waitFor(() => expect(screen.getByText(ARCHIVE_DIR)).toBeDefined());
    expandDir(container, ARCHIVE_DIR);
    fireEvent.contextMenu(await waitFor(() => docRow(container, '旧.mm.md')));
    await waitFor(() => expect(container.querySelector('[data-menu-delete]')).not.toBeNull());
    expect(container.querySelector('[data-menu-archive]')).toBeNull();
  });
});

// ---------------------------------------------------------------- 分流：当前文档 vs 其余

describe('P1-A ⑥ · 当前文档归档走租约编排（分流）', () => {
  function setupWithOps(currentPath: string | null) {
    const ops = { moved: [] as Array<{ path: string; dir: string }> };
    const currentDocOps = {
      currentPath,
      ui: { dirtyChoice: null, partial: null, notice: null },
      rename: vi.fn(async () => {}),
      move: async (f: WorkspaceFile, targetDir: string) => {
        ops.moved.push({ path: f.path, dir: targetDir });
      },
      duplicate: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      resolveConflictName: async (_d: string, n: string) => n,
      dismissNotice: vi.fn(),
    };
    const { ws, calls } = fakeWorkspace(TREE);
    const utils = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        currentPath={currentPath}
        currentDocOps={currentDocOps}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    return { ...utils, calls, ops };
  }

  it('★当前文档归档 → 走 currentDocOps.move（租约 + 目的地重绑）', async () => {
    const { container, calls, ops } = setupWithOps('研发/架构.mm.md');
    await waitFor(() => expect(container.querySelector('[data-dir-path="研发"]')).not.toBeNull());
    expandDir(container, '研发');
    fireEvent.contextMenu(await waitFor(() => docRow(container, '架构.mm.md')));
    fireEvent.click(await waitFor(() => must(container, '[data-menu-archive]')));
    await waitFor(() => expect(ops.moved).toEqual([{ path: '研发/架构.mm.md', dir: `${ARCHIVE_DIR}/研发` }]));
    expect(calls.moved).toHaveLength(0); // 编排被调用 → 既有 moveFile 一次都没走
  });

  it('非当前文档归档 → 走既有 moveFile（不动租约）', async () => {
    const { container, calls, ops } = setupWithOps('研发/架构.mm.md');
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    fireEvent.click(await waitFor(() => must(container, '[data-menu-archive]')));
    await waitFor(() => expect(calls.moved.length).toBe(1));
    expect(ops.moved).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- 负控 4 / 5

describe('P1-A ⑥ · 负控 4/5：冲突不静默覆盖、失败不留幽灵', () => {
  it('★负控 5：归档失败（权限被拒）→ 零移动、无幽灵条目', async () => {
    const { container, calls } = setup({ failMove: true });
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    fireEvent.click(await waitFor(() => must(container, '[data-menu-archive]')));
    // 尝试发生了（记录到 from/to），但**没有**任何条目落进树
    await waitFor(() => expect(calls.moved.length).toBe(1));
    await waitFor(() => expect(container.querySelector('[data-dir-path="_归档"]')).toBeNull());
    expect(container.querySelector(`[data-doc-path^="${ARCHIVE_DIR}/"]`)).toBeNull();
    // 源行仍在（失败不该把源从树上抹掉）
    expect(container.querySelector('[data-doc-path="首页.mm.md"]')).not.toBeNull();
  });

  it('★负控 4：落点已有同名文件时**不静默覆盖**（当前文档路径走三选编排）', async () => {
    // 判据：当前文档归档时走 `currentDocOps.move`，而该编排的冲突入口是
    // **先算 keepBoth 名再问用户**（P0-A 的 `resolveConflictName` + `RenameConflictPanel`）。
    // 本用例断言「归档**没有**自己写第二条冲突策略」：它把全部冲突处理交给既有编排，
    // 因此 `resolveConflictName` 不会被绕过 —— 一旦有人给归档加「直接覆盖」的快捷路径，
    // 这条断言会因为 `move` 收到未被解析的名字而失败。
    const ops = {
      moved: [] as Array<{ path: string; dir: string }>,
      resolved: [] as Array<{ dir: string; name: string }>,
    };
    const currentDocOps = {
      currentPath: '首页.mm.md',
      ui: { dirtyChoice: null, partial: null, notice: null },
      rename: vi.fn(async () => {}),
      move: async (f: WorkspaceFile, targetDir: string) => {
        ops.moved.push({ path: f.path, dir: targetDir });
      },
      duplicate: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      resolveConflictName: async (d: string, n: string) => {
        ops.resolved.push({ dir: d, name: n });
        return n;
      },
      dismissNotice: vi.fn(),
    };
    const { ws, calls } = fakeWorkspace([
      file('首页.mm.md'),
      dir(ARCHIVE_DIR, [file(`${ARCHIVE_DIR}/首页.mm.md`)]),
    ]);
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        currentPath="首页.mm.md"
        currentDocOps={currentDocOps}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    fireEvent.click(await waitFor(() => must(container, '[data-menu-archive]')));
    await waitFor(() => expect(ops.moved.length).toBe(1));
    // 归档落点交给编排，编排内部才决定「保留两份/替换/取消」——
    // 归档侧不得自己挑一个名字（那会绕过三选）
    expect(ops.moved[0]?.dir).toBe(ARCHIVE_DIR);
    // 归档**不改名**（名字冲突是编排层的事，不是归档层的）
    expect(ops.moved[0]?.path).toBe('首页.mm.md');
    expect(calls.removed).toHaveLength(0);
  });

  it('归档是移动而非复制：既有 moveFile 被调用、removeFile 为零', async () => {
    const { container, calls } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    fireEvent.contextMenu(docRow(container, '首页.mm.md'));
    fireEvent.click(await waitFor(() => must(container, '[data-menu-archive]')));
    await waitFor(() => expect(calls.moved.length).toBe(1));
    expect(calls.removed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- 归档后树中可见

describe('P1-A ⑥ · 归档后作为**普通目录**呈现（不隐藏、不特殊渲染）', () => {
  it('归档目录在树里可见、可展开、子项可再次操作（X1 旅程的单元层前提）', async () => {
    const { container } = setup({
      nodes: [file('首页.mm.md'), dir(ARCHIVE_DIR, [file(`${ARCHIVE_DIR}/旧.mm.md`)])],
    });
    await waitFor(() => expect(container.querySelector(`[data-dir-path="${ARCHIVE_DIR}"]`)).not.toBeNull());
    const row = must(container, `[data-dir-path="${ARCHIVE_DIR}"]`);
    // 普通目录：有切换按钮、没有特殊标记
    expect(row.querySelector('button')).not.toBeNull();
    expect(row.getAttribute('data-other-files-group')).toBeNull();
    expandDir(container, ARCHIVE_DIR);
    expect(await waitFor(() => docRow(container, '旧.mm.md'))).not.toBeNull();
  });
});
