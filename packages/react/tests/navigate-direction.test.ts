// @vitest-environment jsdom
/**
 * 方向键几何导航（A 档）——判别测试。
 *
 * 为什么需要它（用户实测反馈）：旧语义 `EditorController.navigate` 是「可见前序（DFS）
 * 线性导航」——↓ 会先钻入当前节点子树、走完整棵子树才轮到下一个兄弟；且 **↓ 与 → 实现
 * 逐字相同**（都是 `ids[i+1]`）。在左右双翼的二维画布里，用户心智是**屏幕方向**：
 *   - 双翼一侧的父在右、另一侧在左 → 任何「左=父 / 右=子」语义映射必有一侧反向；
 *   - 「正下方优先于斜下方」也不能由树序表达。
 * 本文件把几何语义逐条钉死（含真实布局的双翼/折叠用例）。
 *
 * 判别力锚点：用例 ①（↓ 取正下方兄弟而非子节点）与用例 ②（左翼的 ← 取更深的子节点、
 * → 取父节点）在旧实现下必红——这两个正是用户抱怨的两种体感。
 */
import { describe, expect, it } from 'vitest';
import { layoutMindmap, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { nextNodeInDirection, revealTargetInViewport } from '../src/render/navigateDirection.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

/** 合成盒：结构与布局产物同形（{ node: { id }, box }），尺寸 100×40 便于手算中心 */
const box = (id: string, x: number, y: number, w = 100, h = 40) => ({
  node: { id },
  box: { x, y, w, h },
});

describe('几何导航 · 纯函数（合成盒）', () => {
  it('① ↓ 取**正下方**的兄弟，而不是钻进子树（旧语义必红）', () => {
    const nodes = [
      box('根', 0, 0),
      box('A', 200, -60),
      box('B', 200, 60), // A 的正下方兄弟
      box('A1', 400, -60), // A 的子节点：几何上在**右**，不在下
    ];
    expect(nextNodeInDirection(nodes, 'A', 'down')).toBe('B');
    expect(nextNodeInDirection(nodes, 'A', 'right')).toBe('A1');
    expect(nextNodeInDirection(nodes, 'A', 'left')).toBe('根');
  });

  it('② 左翼分支：← 是更深的子节点、→ 是父节点（几何方向，与语义相反；旧语义必红）', () => {
    const nodes = [
      box('根', 0, 0),
      box('L1', -200, 0),
      box('L1a', -400, 0), // 左翼的后代：更靠左
    ];
    expect(nextNodeInDirection(nodes, 'L1', 'left')).toBe('L1a');
    expect(nextNodeInDirection(nodes, 'L1', 'right')).toBe('根');
  });

  it('③ 对齐带优先：正下方（远）胜过斜下方（近）', () => {
    // B 正下方 primary=200（band 0）；C 斜下方 primary=100 但 lateral=150（band 1）
    const nodes = [box('A', 0, 0), box('B', 0, 200), box('C', 150, 100)];
    expect(nextNodeInDirection(nodes, 'A', 'down')).toBe('B');
    expect(nextNodeInDirection(nodes, 'A', 'right')).toBe('C'); // 右方向同理：C 在右
  });

  it('④ 锥外过滤：只有"过斜"的邻居 → 无候选（不硬跳）', () => {
    // D 几乎在正下方但横向偏了 500px（lateral 500 > primary 20 × 1.6）
    const nodes = [box('A', 0, 0), box('D', 500, 20)];
    expect(nextNodeInDirection(nodes, 'A', 'down')).toBeNull();
  });

  it('⑤ 确定性：等距镜像候选取输入顺序靠前者', () => {
    const p = box('P', 60, 100);
    const q = box('Q', -60, 100);
    expect(nextNodeInDirection([box('A', 0, 0), p, q], 'A', 'down')).toBe('P');
    expect(nextNodeInDirection([box('A', 0, 0), q, p], 'A', 'down')).toBe('Q');
  });

  it('⑥ 边界：反方向/未知源 → null（不越界、不抛错）', () => {
    const nodes = [box('A', 0, 0), box('B', 0, 200)];
    expect(nextNodeInDirection(nodes, 'A', 'up')).toBeNull(); // A 上方无节点
    expect(nextNodeInDirection(nodes, 'B', 'down')).toBeNull(); // B 下方无节点
    expect(nextNodeInDirection(nodes, '不存在', 'down')).toBeNull();
  });

  it('⑦ 同排相邻不算"下方"（primary 需 > 0）', () => {
    const nodes = [box('A', 0, 0), box('B', 200, 0)];
    expect(nextNodeInDirection(nodes, 'A', 'down')).toBeNull();
    expect(nextNodeInDirection(nodes, 'A', 'right')).toBe('B');
  });
});

describe('几何导航 · 真实布局（layoutMindmap 产物）', () => {
  // 布局事实（本文件 dump 实测，默认布局本身就是双翼）：
  //   根(0,0) · 第一子右翼(+108,0) · 第二子左翼(−108,0) · 同翼孙子垂直堆叠(±24)
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  const layoutOf = (root: EditableNode, collapsed = new Set<string>()) =>
    layoutMindmap(root, createNodeMeasure(char, new Map()), collapsed);

  it('⑧ 右翼：↓/↑ 在同翼兄弟间垂直移动，→ 钻入子节点（不再穿子树）', () => {
    const a = makeTextNode('A', [makeTextNode('A1'), makeTextNode('A2')]);
    const root = makeTextNode('根', [a, makeTextNode('B')]);
    const layout = layoutOf(root);
    const [a1, a2] = a.children as [EditableNode, EditableNode];
    expect(nextNodeInDirection(layout.nodes, a1.id, 'down')).toBe(a2.id);
    expect(nextNodeInDirection(layout.nodes, a2.id, 'up')).toBe(a1.id);
    expect(nextNodeInDirection(layout.nodes, a1.id, 'left')).toBe(a.id); // 父在左
    expect(nextNodeInDirection(layout.nodes, a.id, 'right')).toBe(a1.id); // 钻入（等距取先序）
    expect(nextNodeInDirection(layout.nodes, a.id, 'down')).toBeNull(); // A 的正下方真的没有节点
  });

  it('⑨ 左翼：← 是更深的节点、→ 是父（真实几何，双翼反向）', () => {
    const b = makeTextNode('B', [makeTextNode('B1'), makeTextNode('B2')]);
    const root = makeTextNode('根', [makeTextNode('A'), b]);
    const layout = layoutOf(root);
    const [b1, b2] = b.children as [EditableNode, EditableNode];
    expect(nextNodeInDirection(layout.nodes, b.id, 'left')).toBe(b1.id); // 几何左 = 更深
    expect(nextNodeInDirection(layout.nodes, b.id, 'right')).toBe(root.id); // 几何右 = 父
    expect(nextNodeInDirection(layout.nodes, b1.id, 'down')).toBe(b2.id);
    expect(nextNodeInDirection(layout.nodes, b1.id, 'left')).toBeNull(); // 左翼尽头
  });

  it('⑩ 折叠天然被尊重（layout.nodes 已裁剪子树）', () => {
    const b = makeTextNode('B', [makeTextNode('B1')]);
    const root = makeTextNode('根', [makeTextNode('A'), b]);
    const layout = layoutOf(root, new Set([b.id]));
    expect(layout.nodes.some((n) => n.node.id === b.children[0]!.id)).toBe(false);
    expect(nextNodeInDirection(layout.nodes, b.id, 'left')).toBeNull(); // 不再误跳进已折叠子树
    expect(nextNodeInDirection(layout.nodes, b.id, 'right')).toBe(root.id);
  });
});

describe('几何导航 · 视口最小推入（revealTargetInViewport，纯计算）', () => {
  const view = (tx: number, ty: number, k = 1, viewW = 800, viewH = 600) => ({
    transform: { k, x: tx, y: ty },
    viewW,
    viewH,
  });
  const box = { x: 100, y: 100, w: 60, h: 30 };

  it('⑪ 完全可见 → null（零动作，不晃画面）', () => {
    expect(revealTargetInViewport(view(0, 0), box)).toBeNull();
  });

  it('⑫ 右侧越界 → 只挪到刚好可见（最小量，不居中）', () => {
    // 屏幕右缘 = 760 + 60 = 820 > 800 − 24 → dx = 776 − 820 = −44（非「居中到 400」）
    const t = revealTargetInViewport(view(0, 0), { x: 760, y: 100, w: 60, h: 30 });
    expect(t).toEqual({ k: 1, x: -44, y: 0 });
  });

  it('⑬ 缩放 k≠1：按屏幕口径换算，k 不变', () => {
    // k=2：sx=1000、sw=120 → 右缘 1120 > 776 → dx = −344
    const t = revealTargetInViewport(view(0, 0, 2), { x: 500, y: 100, w: 60, h: 30 });
    expect(t).toEqual({ k: 2, x: -344, y: 0 });
  });

  it('⑭ 视口未测量 / 变换非有限 → null（不炸、不自作主张）', () => {
    expect(revealTargetInViewport(view(0, 0, 1, 1, 1), box)).toBeNull();
    expect(revealTargetInViewport(view(Number.NaN, 0), box)).toBeNull();
    expect(revealTargetInViewport(view(0, 0, 0), box)).toBeNull();
  });
});
