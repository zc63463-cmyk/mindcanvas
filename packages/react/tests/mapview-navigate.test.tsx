// @vitest-environment jsdom
/**
 * MapViewApi · navigateFrom（A 档几何导航**接线层**）。
 *
 * 纯函数语义由 navigate-direction.test.ts 钉死；本文件只验证 MapView 把「真实布局 +
 * 宿主 id」正确穿起来（算法读的是 layout.nodes，而不是任何树序）。
 * 视口推入在此环境不可断言（jsdom 视口 1×1 → 纯函数按契约返回 null，不动画面）——
 * 该路径由 navigate-direction 的 ⑫⑬⑭ 单测 + 真浏览器脚本覆盖。
 */
import { expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { layoutMindmap, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import type { MapViewApi } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

function mount() {
  const a = makeTextNode('A', [makeTextNode('A1'), makeTextNode('A2')]);
  const root = makeTextNode('根', [a, makeTextNode('B')]);
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layout = layoutMindmap(root, createNodeMeasure(char, new Map()), new Set());
  const apiRef: { current: MapViewApi | null } = { current: null };
  render(
    <ThemeProvider>
      <MapView layout={layout} entities={new Map()} char={char} apiRef={apiRef} />
    </ThemeProvider>,
  );
  return {
    api: apiRef.current!,
    root,
    a,
    a1: a.children[0]!,
    a2: a.children[1]!,
    b: root.children[1]!,
  };
}

it('navigateFrom：右翼 ↓/↑ 走同翼兄弟、← 走父、→ 钻入子节点（真实布局）', () => {
  const { api, a, a1, a2 } = mount();
  expect(api.navigateFrom(a1.id, 'down')).toBe(a2.id);
  expect(api.navigateFrom(a2.id, 'up')).toBe(a1.id);
  expect(api.navigateFrom(a1.id, 'left')).toBe(a.id);
  expect(api.navigateFrom(a.id, 'right')).toBe(a1.id);
  expect(api.navigateFrom(a.id, 'down')).toBeNull(); // A 正下方真的没有节点
});

it('navigateFrom：左翼几何方向（→ 父、← 更深/尽头）+ 未知源兜底', () => {
  const { api, root, a, a1, b } = mount();
  expect(api.navigateFrom(b.id, 'right')).toBe(root.id); // 左翼的"右"是父
  expect(api.navigateFrom(b.id, 'left')).toBeNull(); // 左翼尽头（B 无子）
  expect(api.navigateFrom(a1.id, 'left')).toBe(a.id);
  expect(api.navigateFrom('不存在', 'down')).toBeNull();
});
