// @vitest-environment jsdom
/**
 * P0-D 接线：FileManager 的**收藏与「最近」真的走索引**（不是「旧键还在」）。
 *
 * 为什么需要这组用例（独立于 `doc-index.test.ts` 的模块级断言）：
 *  ① `apps/canvas/src/docIndex.ts` 必须是**被真实组件调用**的模块——
 *     只在测试里 `new DocIndex()` 不构成接线（depcruise 的 no-orphans 只看
 *     packages，apps 侧的「死模块」只能靠这种用例兜住）；
 *  ② 收藏换数据源后最容易出的错是「界面看着对、其实还在写旧键」——
 *     这里同时断索引与降级投影两侧；
 *  ③ UD-2：`openedAt === null` 的行必须显示「未记录打开时间」，而不是「刚刚」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocLibrary } from '@mindcanvas/react';
import { FileManager } from '../src/FileManager.js';
import { DocIndex, LEGACY_STARRED_KEY, browserDocKey } from '../src/docIndex.js';

const STARRED = LEGACY_STARRED_KEY;

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

function libraryWith(): DocLibrary {
  const lib = new DocLibrary();
  lib.upsert({ id: 'a.mm.md', name: 'a.mm.md', source: '# A', folder: '工作' });
  lib.upsert({ id: 'b.mm.md', name: 'b.mm.md', source: '# B', folder: '工作' });
  return lib;
}

type RenderResult = ReturnType<typeof render>;

function renderFm(index: DocIndex | null): RenderResult {
  return render(
    <FileManager
      library={libraryWith()}
      index={index}
      workspace={null}
      onOpenEntry={vi.fn()}
      onOpenFile={vi.fn()}
      onCreate={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

function tab(container: HTMLElement, key: string): HTMLButtonElement {
  const el = container.querySelector(`[data-tab="${key}"]`);
  if (el === null) throw new Error(`missing tab ${key}`);
  return el as HTMLButtonElement;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('FileManager · 收藏走索引（P0-D 接线）', () => {
  it('点星标写进索引，并经降级投影同步到旧键', async () => {
    const index = indexFor();
    const { container } = renderFm(index);
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());

    fireEvent.click(screen.getByText('工作'));
    fireEvent.click(await screen.findByText('a.mm.md'));

    const star = container.querySelector('[data-doc-star]') as HTMLButtonElement;
    fireEvent.click(star);

    // ① 索引侧：收藏落在稳定身份上
    expect(index.starredKeys().has('a.mm.md')).toBe(true);
    expect(JSON.parse(localStorage.getItem(STARRED) ?? '[]')).toContain('a.mm.md');

    // ② 取消收藏：两侧同步移除（投影是当前状态的镜像）
    fireEvent.click(container.querySelector('[data-doc-star]') as HTMLButtonElement);
    expect(index.starredKeys().has('a.mm.md')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STARRED) ?? '[]')).not.toContain('a.mm.md');
  });

  it('不注入索引时不写任何键（不产生第二写入口）', async () => {
    const { container } = renderFm(null);
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());
    fireEvent.click(screen.getByText('工作'));
    fireEvent.click(await screen.findByText('a.mm.md'));
    fireEvent.click(container.querySelector('[data-doc-star]') as HTMLButtonElement);
    expect(localStorage.getItem(STARRED)).toBeNull();
  });
});

describe('FileManager · 「最近」走索引（openedAt，UD-2）', () => {
  it('迁移来的条目 openedAt === null → 显示「未记录打开时间」，不显示「刚刚」', async () => {
    // 直接写入一条「刚迁移」的索引条目（openedAt 为 null，savedAt 是刚刚）
    const index = indexFor();
    index.saveDoc({
      docKey: browserDocKey('a.mm.md'),
      relPath: 'a.mm.md',
      name: 'a.mm.md',
      scopeId: 'browser:local',
      sourceRef: { kind: 'none' },
    });
    // saveDoc 只推进 savedAt；openedAt 从未被推进 → null
    expect(index.getDoc(browserDocKey('a.mm.md'))?.openedAt).toBeNull();

    const { container } = renderFm(index);
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());
    fireEvent.click(tab(container, 'recent'));

    await waitFor(() => {
      const rows = container.querySelectorAll('[data-flat-doc]');
      expect(rows.length).toBeGreaterThan(0);
    });
    const whens = [...container.querySelectorAll('[data-flat-doc-when]')].map(
      (n) => n.textContent ?? '',
    );
    expect(whens).toContain('未记录打开时间');
    expect(whens).not.toContain('刚刚');
  });

  it('打开推进 openedAt 后按打开时间排序（保存不影响次序）', async () => {
    const index = indexFor();
    // 两条都已登记；b 打开得更晚
    index.registerDoc({
      docKey: browserDocKey('a.mm.md'),
      relPath: 'a.mm.md',
      name: 'a.mm.md',
      scopeId: 'browser:local',
      persisted: true,
      sourceRef: { kind: 'none' },
    });
    index.registerDoc({
      docKey: browserDocKey('b.mm.md'),
      relPath: 'b.mm.md',
      name: 'b.mm.md',
      scopeId: 'browser:local',
      persisted: true,
      sourceRef: { kind: 'none' },
    });
    index.openDoc({ docKey: browserDocKey('b.mm.md'), relPath: 'b.mm.md' }, 100);
    index.openDoc({ docKey: browserDocKey('a.mm.md'), relPath: 'a.mm.md' }, 900);
    // b 被保存得更晚——但「最近」只看打开时间
    index.saveDoc({ docKey: browserDocKey('b.mm.md'), relPath: 'b.mm.md' }, 5_000);

    const { container } = renderFm(index);
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());
    fireEvent.click(tab(container, 'recent'));
    await waitFor(() => {
      expect(container.querySelectorAll('[data-flat-doc]').length).toBe(2);
    });
    const names = [...container.querySelectorAll('[data-flat-doc]')].map(
      (n) => n.getAttribute('data-doc-name'),
    );
    expect(names).toEqual(['a.mm.md', 'b.mm.md']); // a 先（openedAt 更大）
  });

  it('Tab 标签与实际排序依据一致（「最近打开」，不是「最近修改」）', async () => {
    const { container } = renderFm(indexFor());
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());
    expect(tab(container, 'recent').textContent).toContain('最近打开');
    expect(tab(container, 'recent').textContent).not.toContain('最近修改');
  });
});

describe('FileManager · 历史池（§6.2.1）', () => {
  it('无归属证据的旧记录默认折叠呈现，展开后可逐条处理', async () => {
    const index = new DocIndex({
      ctx: () => ({
        scopeId: 'ws:adopted',
        persisted: true,
        hasHistoryEvidence: false, // legacy adoption 新生成的作用域
        handleStoreAvailable: false,
      }),
    });
    localStorage.setItem(
      'mindcanvas.library.v1',
      JSON.stringify([{ id: '研发/架构.mm.md', name: '架构.mm.md', ts: 5, folder: '研发', tags: [] }]),
    );
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        index={index}
        workspace={null}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-history]')).not.toBeNull());
    // 用户语言，不暴露「索引/作用域」内部概念
    expect(container.querySelector('[data-fm-history-toggle]')?.textContent).toContain(
      '1 条旧记录未关联工作区',
    );
    // 默认折叠
    expect(container.querySelector('[data-fm-history-list]')).toBeNull();
    fireEvent.click(container.querySelector('[data-fm-history-toggle]') as HTMLElement);
    expect(container.querySelectorAll('[data-fm-history-row]').length).toBe(1);
    // 忽略只影响呈现，不删旧键
    fireEvent.click(container.querySelector('[data-fm-history-ignore]') as HTMLElement);
    expect(localStorage.getItem('mindcanvas.library.v1')).not.toBeNull();
  });

  it('迁移失败条目可见（不把「未迁移」伪报成完成）', async () => {
    const index = new DocIndex({
      ctx: () => ({
        scopeId: 'ws:x',
        persisted: true,
        hasHistoryEvidence: true,
        handleStoreAvailable: false,
      }),
    });
    // 旧键存在但**结构非法**（不是数组）→ 迁移记 failed，且不删旧数据。
    // 用空库渲染：本用例只关心「未迁移」这条反馈是否可见，
    // 多余的库条目只会把信号埋进树里（与该断言无关）。
    localStorage.setItem('mindcanvas.library.v1', '{"not":"array"}');
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        index={index}
        workspace={null}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-migrate-failed]')).not.toBeNull());
    expect(container.querySelector('[data-fm-migrate-failed]')?.textContent).toContain('未迁移');
    expect(localStorage.getItem('mindcanvas.library.v1')).toBe('{"not":"array"}');
  });
});

describe('FileManager · 打开工作区文件推进 openedAt', () => {
  it('openNode 走索引推进 openedAt 后才回调 onOpenFile', async () => {
    const index = indexFor();
    // 兼容模式的条目：TreeNode.entry 非空，点击经 openNode
    const onOpenEntry = vi.fn();
    const { container } = render(
      <FileManager
        library={libraryWith()}
        index={index}
        workspace={null}
        onOpenEntry={onOpenEntry}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());
    fireEvent.click(screen.getByText('工作'));
    const row = await screen.findByText('a.mm.md');
    // 打开前：索引里没有打开时间
    expect(index.getDoc(browserDocKey('a.mm.md'))?.openedAt ?? null).toBeNull();
    fireEvent.click(row);
    expect(onOpenEntry).toHaveBeenCalledTimes(1);
    // 打开后：openedAt 被推进（真实打开才推进，UD-2）
    await waitFor(() => {
      expect(index.getDoc(browserDocKey('a.mm.md'))?.openedAt).not.toBeNull();
    });
  });
});

describe('FileManager · 工作区作用域身份（评审 R2 高风险项的回归守卫）', () => {
  /**
   * 生产上「工作区文档被登记成 `browser::<相对路径>`」是最危险的一类回归：
   * 那样 M5/M6 永远认领不到这些条目、降级投影会把纯相对路径写进旧库的 `id`，
   * 反过来破坏旧版本的恢复路径。
   *
   * 本用例走**真实 FileManager**（不是直接调 DocIndex），用一个带 `scopeId`
   * 的工作区替身驱动 `registerDocs`，断言产出的确实是 `ws:<scopeId 主体>::<relPath>`。
   */
  const wsFile = (path: string) => ({
    kind: 'file' as const,
    name: path.split('/').pop() ?? path,
    path,
    handle: {
      name: path,
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
    },
    ts: 0,
    size: 0,
  });

  it('挂了工作区：登记为 ws:<scopeId>::<relPath>（不是 browser::）', async () => {
    const index = new DocIndex({
      ctx: () => ({
        scopeId: 'ws:AAAA',
        persisted: true,
        hasHistoryEvidence: true,
        handleStoreAvailable: false,
      }),
    });
    const workspace = {
      mounted: true,
      name: 'notes',
      scopeId: 'ws:AAAA',
      scopeState: { kind: 'disk', persisted: true },
      scan: async () => [wsFile('研发/架构.mm.md')],
      createFile: vi.fn(),
      createDir: vi.fn(),
      renameFile: vi.fn(),
      removeFile: vi.fn(),
      removeDir: vi.fn(),
      moveFile: vi.fn(),
    };
    const { container } = render(
      <FileManager
        library={new DocLibrary()}
        index={index}
        workspace={workspace as never}
        onOpenEntry={vi.fn()}
        onOpenFile={vi.fn()}
        onCreate={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    await waitFor(() => expect(container.querySelector('[data-fm-tree]')).not.toBeNull());
    await waitFor(() => {
      expect(index.listDocs().length).toBeGreaterThan(0);
    });
    const doc = index.listDocs()[0];
    expect(doc?.docKey).toBe('ws:AAAA::研发/架构.mm.md');
    expect(doc?.scopeId).toBe('ws:AAAA');
    // 绝不能被写成浏览器身份（那会让 M5/M6 与投影全部错位）
    expect(doc?.docKey.startsWith('browser::')).toBe(false);
  });
});
