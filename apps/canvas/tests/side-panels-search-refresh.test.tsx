// @vitest-environment jsdom
/**
 * SidePanels · 搜索面板在文档编辑后自动刷新结果（P6 伴随回归修复）
 *
 * 背景（复核发现）：B-P6 把 SearchPanel 的检索 memo 化为 `useMemo([query, search])`，
 * 而 SidePanels 的 `searchFn` deps 是 `[controller]` —— controller 对象长寿命（编辑时
 * root 换引用、对象不换），于是**面板开着、query 不变时，重命名/编辑节点后结果不再刷新**
 * （P6 之前内联 lambda 每父渲染换身份 → 每次都重算，该行为被丢失；窄路径但真实：面板浮
 * 在画布上，编辑与搜索可同时存在）。
 *
 * 判别场景：面板开着、query 恒为「甲」→ 编辑把「甲」重命名为「乙」（root 换引用）→
 * 结果必须重算（`useCallback(..., [controller, controller.root])`）。
 * 修复前：memo 不失效 → 仍显示陈旧的「甲」（红）；修复后：0 条（绿）。
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { makeTextNode } from '@mindcanvas/kernel';
import type { AssetHost, EditorController } from '@mindcanvas/react';
import { SidePanels } from '../src/SidePanels';

const STUBS = {
  assetList: [],
  assetHost: {} as AssetHost, // 搜索分支不触碰图库
  setEntities: vi.fn(),
  relations: [],
  activeRefKey: null,
  edgeItems: [],
  onUpload: vi.fn(),
  onSelectNode: vi.fn(),
  onClose: vi.fn(),
};

/** 最小 controller 桩：搜索分支只读 root（对象长寿命，编辑时 root 换引用） */
function makeController(root: ReturnType<typeof makeTextNode>): EditorController {
  return { root } as EditorController;
}

describe('SidePanels · 搜索面板编辑后自动刷新（P6 回归修复）', () => {
  it('面板开着、query 不变，编辑（root 换引用）→ 结果自动重算', () => {
    const rootV1 = makeTextNode('根', [makeTextNode('甲')]);
    const controller = makeController(rootV1);
    const { container, rerender } = render(
      <SidePanels panel="search" controller={controller} {...STUBS} />,
    );
    const input = container.querySelector('[data-search-input]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '甲' } });
    expect(container.querySelectorAll('[data-search-result]')).toHaveLength(1);

    // 模拟编辑：controller 对象不变、root 换引用（kernel 纯函数，编辑产出新 root），query 不变
    const rootV2 = makeTextNode('根', [makeTextNode('乙')]);
    controller.root = rootV2;
    rerender(<SidePanels panel="search" controller={controller} {...STUBS} />);

    // 修复前：searchFn 闭包未失效 → memo 不重算 → 仍 1 条（陈旧「甲」）；修复后 → 0 条
    expect(container.querySelectorAll('[data-search-result]')).toHaveLength(0);
    expect(container.textContent).not.toContain('甲');
  });
});
