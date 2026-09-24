// @vitest-environment jsdom
/**
 * P1-A ④：文件树的**键盘导航与 a11y 语义**（`file-management.md` §6 键位表）。
 * ══════════════════════════════════════════════════════════════════════
 * 两个层次：
 *  - **纯函数层**（`intentFor` / `visibleRows` / `reconcileFocus`）：键位表逐键断言，
 *    不需要渲染；
 *  - **交互层**（渲染 `FileManager`）：真的按键 → 真的看 DOM 的 `tabIndex` /
 *    `aria-current` / 展开态。**属性存在性不算证据**（派单书 §8 第 9 条）——
 *    故这里的判据是「焦点归属变了没有」「展开态变了没有」。
 *
 * 判别核心（负控 1）：焦点在重命名输入框内时，`↑`/`↓`/`Delete`/`F2`
 * **不得**移动树焦点、不得删除文档、不得重进改名。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocLibrary, type WorkspaceDir, type WorkspaceFile, type WorkspaceNode } from '@mindcanvas/react';
import { FileManager, type WorkspaceLike } from '../src/FileManager.js';
import { DocIndex } from '../src/docIndex.js';
import { intentFor, reconcileFocus, visibleRows, type VisibleRow } from '../src/fileTreeKeyboard.js';

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
 * 内存工作区替身。
 *
 * ⑤ 的关键：替身必须**如实模拟宿主的两级口径** —— 默认扫描**不**返回
 * `unopenable` 项（与 `isWorkspaceDocName` 过滤同规），只有
 * `scan(true, { includeOtherFiles: true })` 才返回。若替身总是原样返回全部节点，
 * 「开关打开前后」就没有差别，用例会变成空转（假绿）。
 */
function fakeWorkspace(nodes: WorkspaceNode[]) {
  const calls = { removed: [] as string[], moved: [] as Array<{ from: string; to: string }> };
  let current = nodes;
  const ws: WorkspaceLike = {
    mounted: true,
    name: 'MyNotes',
    async scan(_force?: boolean, options?: { includeOtherFiles?: boolean }) {
      return options?.includeOtherFiles === true
        ? current
        : current.filter((n) => n.kind !== 'file' || n.unopenable !== true);
    },
    async createFile(dirPath, name) {
      const f = file(dirPath === '' ? name : `${dirPath}/${name}`);
      current = [...current, f];
      return f;
    },
    async createDir(parent, name) {
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
      calls.moved.push({ from: f.path, to: target });
      return { ...f, path: `${target}/${f.name}` };
    },
  };
  return { ws, calls };
}

const TREE: WorkspaceNode[] = [
  dir('研发', [file('研发/架构.mm.md'), file('研发/接口.mm.md')]),
  dir('日记', []),
  file('首页.mm.md'),
];

function setup(over: { currentPath?: string | null; workspace?: WorkspaceLike | null } = {}) {
  const { ws, calls } = fakeWorkspace(TREE);
  const workspace = over.workspace !== undefined ? over.workspace : ws;
  const utils = render(
    <FileManager
      library={new DocLibrary()}
      workspace={workspace}
      currentPath={over.currentPath ?? null}
      onOpenEntry={vi.fn()}
      onOpenFile={vi.fn()}
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  return { ...utils, calls };
}

const must = (c: HTMLElement, sel: string): HTMLElement => {
  const el = c.querySelector(sel);
  if (el === null) throw new Error(`找不到元素 ${sel}`);
  return el as HTMLElement;
};
const rowOf = (c: HTMLElement, path: string): HTMLElement =>
  must(c, `[data-doc-path="${path}"], [data-dir-path="${path}"]`);
const focusKeyOf = (c: HTMLElement): string | null =>
  c.querySelector('[tabindex="0"]')?.getAttribute('data-doc-path') ??
  c.querySelector('[tabindex="0"]')?.getAttribute('data-dir-path') ??
  null;

// ---------------------------------------------------------------- 纯函数层

describe('P1-A ④ · 键盘状态机（纯函数）', () => {
  const rows: VisibleRow[] = [
    { key: 'dir:A', isDir: true, isExpanded: true, parentKey: null, siblingKeys: ['dir:A', 'doc:z'] },
    { key: 'doc:a1', isDir: false, isExpanded: false, parentKey: 'dir:A', siblingKeys: ['doc:a1', 'doc:a2'] },
    { key: 'doc:a2', isDir: false, isExpanded: false, parentKey: 'dir:A', siblingKeys: ['doc:a1', 'doc:a2'] },
    { key: 'doc:z', isDir: false, isExpanded: false, parentKey: null, siblingKeys: ['dir:A', 'doc:z'] },
  ];
  const ctx = (focusedKey: string | null, inRenameInput = false) => ({ rows, focusedKey, inRenameInput });

  it('↓ / ↑ 在可见行上移动，边界处不越界', () => {
    expect(intentFor('ArrowDown', ctx('dir:A'))).toEqual({ kind: 'focus', key: 'doc:a1' });
    expect(intentFor('ArrowUp', ctx('doc:a1'))).toEqual({ kind: 'focus', key: 'dir:A' });
    // 首行按 ↑ / 末行按 ↓ → none（不环绕，避免用户误以为已到列表另一端）
    expect(intentFor('ArrowUp', ctx('dir:A'))).toEqual({ kind: 'focus', key: 'dir:A' });
    expect(intentFor('ArrowDown', ctx('doc:z'))).toEqual({ kind: 'focus', key: 'doc:z' });
  });

  it('→ 折叠目录先展开；已展开则进第一个子行', () => {
    const collapsed = [{ ...rows[0], isExpanded: false } as VisibleRow, rows[3] as VisibleRow];
    expect(intentFor('ArrowRight', { rows: collapsed, focusedKey: 'dir:A', inRenameInput: false })).toEqual({
      kind: 'expand',
      key: 'dir:A',
    });
    expect(intentFor('ArrowRight', ctx('dir:A'))).toEqual({ kind: 'focus', key: 'doc:a1' });
    // 叶子：无可展开 → none
    expect(intentFor('ArrowRight', ctx('doc:a1'))).toEqual({ kind: 'none' });
  });

  it('← 已展开的目录 → 折叠；已折叠 / 叶子 → 回父级；根层 → none', () => {
    expect(intentFor('ArrowLeft', ctx('dir:A'))).toEqual({ kind: 'collapse', key: 'dir:A' });
    expect(intentFor('ArrowLeft', ctx('doc:a1'))).toEqual({ kind: 'focus', key: 'dir:A' });
    expect(intentFor('ArrowLeft', ctx('doc:z'))).toEqual({ kind: 'none' });
  });

  it('Home / End 到首尾行', () => {
    expect(intentFor('Home', ctx('doc:z'))).toEqual({ kind: 'focus', key: 'dir:A' });
    expect(intentFor('End', ctx('dir:A'))).toEqual({ kind: 'focus', key: 'doc:z' });
  });

  it('Enter / F2 / Delete / Esc 各对应一个意图', () => {
    expect(intentFor('Enter', ctx('doc:a1'))).toEqual({ kind: 'open', key: 'doc:a1' });
    expect(intentFor('F2', ctx('doc:a1'))).toEqual({ kind: 'rename', key: 'doc:a1' });
    expect(intentFor('Delete', ctx('doc:a1'))).toEqual({ kind: 'delete', key: 'doc:a1' });
    expect(intentFor('Escape', ctx('doc:a1'))).toEqual({ kind: 'close-panel' });
  });

  it('★负控 1：焦点在重命名输入框内 → 全部键位返回 none（零副作用）', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Delete', 'F2', 'Enter']) {
      expect(intentFor(key, ctx('doc:a1', true))).toEqual({ kind: 'none' });
    }
  });

  it('未聚焦时游标退化为首行（不原地不动、也不越界）', () => {
    // `ctx(null)` 时 `currentRow` 取 `rows[0]` → ↓ 落到第二行（不是原地不动）
    expect(intentFor('ArrowDown', ctx(null))).toEqual({ kind: 'focus', key: 'doc:a1' });
    expect(intentFor('Enter', ctx(null))).toEqual({ kind: 'open', key: 'dir:A' });
  });

  it('visibleRows 只展平已展开目录的子项', () => {
    const nodes = [
      { key: 'dir:A', type: 'dir' as const, children: [{ key: 'doc:a1', type: 'doc' as const, children: [] }] },
      { key: 'doc:z', type: 'doc' as const, children: [] },
    ];
    expect(visibleRows(nodes, new Set()).map((r) => r.key)).toEqual(['dir:A', 'doc:z']);
    expect(visibleRows(nodes, new Set(['dir:A'])).map((r) => r.key)).toEqual([
      'dir:A',
      'doc:a1',
      'doc:z',
    ]);
  });

  it('焦点收敛：原 key 消失 → 落到邻近行，绝不留下无焦点行', () => {
    const before: VisibleRow[] = [
      { key: 'a', isDir: false, isExpanded: false, parentKey: null, siblingKeys: [] },
      { key: 'b', isDir: false, isExpanded: false, parentKey: null, siblingKeys: [] },
      { key: 'c', isDir: false, isExpanded: false, parentKey: null, siblingKeys: [] },
    ];
    const after = [before[0] as VisibleRow, before[2] as VisibleRow];
    expect(reconcileFocus(after, 'b', before)).toBe('c'); // 原索引处的那一行
    expect(reconcileFocus(after, 'a', before)).toBe('a'); // 仍在 → 不动
    expect(reconcileFocus([], 'a', before)).toBeNull();
  });
});

// ---------------------------------------------------------------- 交互层

describe('P1-A ④ · 树 a11y 语义与 roving tabindex', () => {
  it('树容器 role=tree，行 role=treeitem 且 aria-level 逐层递增', async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelector('[data-fm-tree-root]')).not.toBeNull());
    expect(must(container, '[data-fm-tree-root]').getAttribute('role')).toBe('tree');
    // 根层目录 = level 1
    expect(rowOf(container, '研发').getAttribute('role')).toBe('treeitem');
    expect(rowOf(container, '研发').getAttribute('aria-level')).toBe('1');
    fireEvent.click(must(container, '[data-dir-path="研发"] button'));
    await waitFor(() => expect(container.querySelector('[data-doc-path="研发/架构.mm.md"]')).not.toBeNull());
    // 子项 = level 2
    expect(rowOf(container, '研发/架构.mm.md').getAttribute('aria-level')).toBe('2');
  });

  it('roving tabindex：全树恰有一行 tabIndex=0', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    const zero = container.querySelectorAll('[data-fm-tree-root] [tabindex="0"]');
    expect(zero.length).toBe(1);
    // 首行 = 中文按拼音排序的第一项（日 ri < 研 yan）
    expect(focusKeyOf(container)).toBe('日记');
  });

  it('↓ 移动焦点：tabIndex=0 随之转移（焦点归属真的变了）', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    // 游标先落在首行「日记」，↓ 应移到「研发」——行节点在重渲染时会被替换，
    // 故每次都用**重新查询**的行（持有旧引用是本测试最容易写错的地方）
    rowOf(container, '日记').focus();
    await waitFor(() => expect(focusKeyOf(container)).toBe('日记'));
    fireEvent.keyDown(rowOf(container, '日记'), { key: 'ArrowDown' });
    await waitFor(() => expect(focusKeyOf(container)).toBe('研发'));
    expect(rowOf(container, '日记').getAttribute('tabindex')).toBe('-1');
  });

  it('→ 展开目录；← 折叠回来（键位真的改了展开态）', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    expect(rowOf(container, '研发').getAttribute('aria-expanded')).toBe('false');
    rowOf(container, '研发').focus();
    await waitFor(() => expect(focusKeyOf(container)).toBe('研发'));
    fireEvent.keyDown(rowOf(container, '研发'), { key: 'ArrowRight' });
    await waitFor(() => expect(rowOf(container, '研发').getAttribute('aria-expanded')).toBe('true'));
    await waitFor(() =>
      expect(container.querySelector('[data-doc-path="研发/架构.mm.md"]')).not.toBeNull(),
    );
    // 展开不改焦点：仍是这一行
    expect(focusKeyOf(container)).toBe('研发');
    fireEvent.keyDown(rowOf(container, '研发'), { key: 'ArrowLeft' });
    await waitFor(() => expect(rowOf(container, '研发').getAttribute('aria-expanded')).toBe('false'));
    await waitFor(() => expect(container.querySelector('[data-doc-path="研发/架构.mm.md"]')).toBeNull());
  });

  it('Home / End 直到首行 / 末行', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    rowOf(container, '首页.mm.md').focus();
    await waitFor(() => expect(focusKeyOf(container)).toBe('首页.mm.md'));
    fireEvent.keyDown(rowOf(container, '首页.mm.md'), { key: 'Home' });
    await waitFor(() => expect(focusKeyOf(container)).toBe('日记'));
    fireEvent.keyDown(rowOf(container, '日记'), { key: 'End' });
    await waitFor(() => expect(focusKeyOf(container)).toBe('首页.mm.md'));
  });

  it('Enter 打开当前行（真调用 onOpenFile）', async () => {
    const { ws } = fakeWorkspace(TREE);
    const onOpenFile = vi.fn();
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={onOpenFile}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    rowOf(container, '首页.mm.md').focus();
    await waitFor(() => expect(focusKeyOf(container)).toBe('首页.mm.md'));
    fireEvent.keyDown(rowOf(container, '首页.mm.md'), { key: 'Enter' });
    await waitFor(() => expect(onOpenFile).toHaveBeenCalled());
  });

  it('F2 进入改名；Delete 走既有确认条（非当前文档）', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    rowOf(container, '首页.mm.md').focus();
    await waitFor(() => expect(focusKeyOf(container)).toBe('首页.mm.md'));
    fireEvent.keyDown(rowOf(container, '首页.mm.md'), { key: 'F2' });
    await waitFor(() => expect(container.querySelector('[data-rename-input]')).not.toBeNull());
    fireEvent.keyDown(must(container, '[data-rename-input]'), { key: 'Escape' });
    await waitFor(() => expect(container.querySelector('[data-rename-input]')).toBeNull());

    fireEvent.keyDown(rowOf(container, '首页.mm.md'), { key: 'Delete' });
    await waitFor(() => expect(container.querySelector('[data-fm-confirm]')).not.toBeNull());
  });

  it('★负控 1：焦点在重命名输入框内，↑/↓ 不移动树焦点、Delete 不弹确认条', async () => {
    const { container } = setup();
    await waitFor(() => expect(screen.getByText('首页.mm.md')).toBeDefined());
    rowOf(container, '首页.mm.md').focus();
    await waitFor(() => expect(focusKeyOf(container)).toBe('首页.mm.md'));
    fireEvent.keyDown(rowOf(container, '首页.mm.md'), { key: 'F2' });
    const input = await waitFor(() => must(container, '[data-rename-input]'));
    const before = focusKeyOf(container);
    // 输入框内按方向键 / Delete / F2：全部留在输入框
    for (const key of ['ArrowDown', 'ArrowUp', 'Delete', 'F2']) {
      fireEvent.keyDown(input, { key });
    }
    expect(focusKeyOf(container)).toBe(before); // 焦点没动
    expect(container.querySelector('[data-fm-confirm]')).toBeNull(); // 没弹删除确认
    expect(container.querySelectorAll('[data-rename-input]').length).toBe(1); // 没重进改名
  });
});

describe('P1-A ① · 当前文档高亮与状态行', () => {
  it('当前文档行有 aria-current=true 与「◀ 当前」标记（判据 = 完整路径）', async () => {
    const { container } = setup({ currentPath: '研发/架构.mm.md' });
    await waitFor(() => expect(screen.getByText('研发')).toBeDefined());
    fireEvent.click(must(container, '[data-dir-path="研发"] button'));
    const row = await waitFor(() => rowOf(container, '研发/架构.mm.md'));
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(row.getAttribute('data-doc-current')).toBe('true');
    expect(row.textContent).toContain('◀ 当前');
  });

  it('★负控 2：两个同名不同目录的文件，只有真正打开的那一份高亮', async () => {
    const { ws } = fakeWorkspace([
      dir('研发', [file('研发/笔记.mm.md')]),
      dir('个人', [file('个人/笔记.mm.md')]),
    ]);
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        currentPath="研发/笔记.mm.md"
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-dir-path="研发"]')).not.toBeNull());
    fireEvent.click(must(container, '[data-dir-path="研发"] button'));
    fireEvent.click(must(container, '[data-dir-path="个人"] button'));
    await waitFor(() =>
      expect(container.querySelectorAll('[data-doc-name="笔记.mm.md"]').length).toBe(2),
    );
    const current = container.querySelectorAll('[data-doc-current]');
    expect(current.length).toBe(1); // 只高亮一份
    expect(current[0]?.getAttribute('data-doc-path')).toBe('研发/笔记.mm.md');
    // 另一份没有任何 aria-current
    const other = container.querySelector('[data-doc-path="个人/笔记.mm.md"]');
    expect(other?.getAttribute('aria-current')).toBeNull();
  });

  it('状态行 role=status（保存态变化读屏可听）', async () => {
    const { container } = setup({ currentPath: '研发/架构.mm.md' });
    await waitFor(() => expect(container.querySelector('[data-doc-status]')).not.toBeNull());
    expect(must(container, '[data-doc-status]').getAttribute('role')).toBe('status');
    expect(must(container, '[data-doc-status]').getAttribute('aria-live')).toBe('polite');
  });
});

describe('P1-A ③ · 排序依据可选（仅全部目录）', () => {
  it('工具条写明当前依据，默认「名称」', async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelector('[data-fm-sort-active]')).not.toBeNull());
    expect(must(container, '[data-fm-sort-active]').textContent).toContain('名称');
  });

  it('切到「最近修改」→ 行序按 ts 降序（真的重排）', async () => {
    const older = { ...file('研发/旧.mm.md'), ts: 1000 };
    const newer = { ...file('研发/新.mm.md'), ts: 9_000_000 };
    const { ws } = fakeWorkspace([dir('研发', [older, newer])]);
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
    await waitFor(() => expect(container.querySelector('[data-fm-sort-select]')).not.toBeNull());
    fireEvent.click(must(container, '[data-dir-path="研发"] button'));
    // 名称序：旧 < 新（拼音 jiù < xīn）
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll('[data-doc-path^="研发/"]')).map((e) =>
          e.getAttribute('data-doc-path'),
        ),
      ).toEqual(['研发/旧.mm.md', '研发/新.mm.md']),
    );
    fireEvent.change(must(container, '[data-fm-sort-select]'), { target: { value: 'mtime' } });
    await waitFor(() =>
      expect(
        Array.from(container.querySelectorAll('[data-doc-path^="研发/"]')).map((e) =>
          e.getAttribute('data-doc-path'),
        ),
      ).toEqual(['研发/新.mm.md', '研发/旧.mm.md']),
    );
    expect(must(container, '[data-fm-sort-active]').textContent).toContain('最近修改');
  });

  it('「最近」视图不出现排序工具条（排序不动 openedAt，§3.3 / UD-2）', async () => {
    const index = new DocIndex({
      ctx: () => ({
        scopeId: 'browser:local',
        persisted: true,
        hasHistoryEvidence: true,
        handleStoreAvailable: false,
      }),
    });
    const { container } = setup();
    cleanup();
    const { ws } = fakeWorkspace(TREE);
    const utils = render(
      <FileManager
        library={new DocLibrary()}
        index={index}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(utils.container.querySelector('[data-fm-sort]')).not.toBeNull());
    fireEvent.click(must(utils.container, '[data-tab="recent"]'));
    await waitFor(() => expect(utils.container.querySelector('[data-fm-sort]')).toBeNull());
    expect(container).toBeTruthy();
  });
});

describe('P1-A ⑤ · 显示其他文件', () => {
  it('开关存在；树里出现灰显不可打开的分组与条目', async () => {
    const { ws } = fakeWorkspace([
      dir('研发', [file('研发/架构.mm.md')]),
      { ...file('说明.txt'), unopenable: true },
      { ...file('.env'), unopenable: true },
    ]);
    const onOpenFile = vi.fn();
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={onOpenFile}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-show-other-input]')).not.toBeNull());
    // 默认关闭：不支持的文件根本不进树（§2.3 的开关是唯一入口）
    expect(container.querySelector('[data-doc-path="说明.txt"]')).toBeNull();
    fireEvent.click(must(container, '[data-fm-show-other-input]'));
    const group = await waitFor(() => must(container, '[data-other-files-group]'));
    expect(group.textContent).toContain('其他文件（2 项，本应用不打开）');
    // 分组默认折叠（§2.3）：展开前条目不可见
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-doc-path="说明.txt"]')).toBeNull();
    // 展开分组 → 条目出现且带「不可打开」标记（灰显由样式承担，标记是判据）
    const toggle = group.querySelector('button');
    if (toggle === null) throw new Error('分组没有切换按钮');
    fireEvent.click(toggle);
    await waitFor(() => expect(group.getAttribute('aria-expanded')).toBe('true'));
    const txt = await waitFor(() => must(container, '[data-doc-path="说明.txt"]'));
    expect(txt.getAttribute('data-doc-unopenable')).toBe('true');
    // 边界：同一文件只出现一次（不是在主树里又留了一份可操作的行）
    expect(container.querySelectorAll('[data-doc-path="说明.txt"]').length).toBe(1);
    expect(container.querySelector('[data-doc-path=".env"]')).not.toBeNull();
    expect(
      must(container, '[data-doc-path="说明.txt"]').getAttribute('data-doc-unopenable'),
    ).toBe('true');
  });

  it('★负控 6：点击不支持文件 → 提示而非静默、也不打开', async () => {
    const { ws } = fakeWorkspace([{ ...file('说明.txt'), unopenable: true }]);
    const onOpenFile = vi.fn();
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={onOpenFile}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-show-other-input]')).not.toBeNull());
    fireEvent.click(must(container, '[data-fm-show-other-input]'));
    const group = await waitFor(() => must(container, '[data-other-files-group]'));
    const toggle = group.querySelector('button');
    if (toggle === null) throw new Error('分组没有切换按钮');
    fireEvent.click(toggle);
    const row = await waitFor(() => must(container, '[data-doc-path="说明.txt"]'));
    fireEvent.click(must(row, '[data-doc-open]'));
    // 有提示（role=status），且**没有**尝试打开
    const notice = await waitFor(() => must(container, '[data-fm-tree-notice]'));
    expect(notice.getAttribute('role')).toBe('status');
    expect(notice.textContent).toContain('非导图文件，本应用不打开');
    expect(onOpenFile).not.toHaveBeenCalled();
  });
});

describe('P1-A ② · 搜索内部标题（限已索引文档）', () => {
  it('标题命中出现在树里（消费索引既有 title，不新扫描）', async () => {
    const { ws } = fakeWorkspace([dir('研发', [file('研发/架构.mm.md')])]);
    const index = new DocIndex({
      ctx: () => ({
        scopeId: 'browser:local',
        persisted: true,
        hasHistoryEvidence: true,
        handleStoreAvailable: false,
      }),
    });
    // 标题与文件名不同：只有索引里的 title 能被搜到（走 saveDoc 的既有 title 入参，
    // 不新增测试专用的写入口 —— 那会造出第二条与生产不同的写路径）
    index.saveDoc({
      docKey: 'browser::研发/架构.mm.md',
      relPath: '研发/架构.mm.md',
      name: '架构.mm.md',
      title: '系统总览',
    });
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        index={index}
        workspace={ws}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-search]')).not.toBeNull());
    fireEvent.change(must(container, '[data-fm-search]'), { target: { value: '系统总览' } });
    await waitFor(() =>
      expect(container.querySelector('[data-doc-path="研发/架构.mm.md"]')).not.toBeNull(),
    );
  });

  it('搜索框文案明示范围（标题仅搜索已记录的文档）', async () => {
    const { container } = setup();
    await waitFor(() => expect(container.querySelector('[data-fm-search]')).not.toBeNull());
    const ph = must(container, '[data-fm-search]').getAttribute('placeholder') ?? '';
    expect(ph).toContain('已记录');
  });
});
