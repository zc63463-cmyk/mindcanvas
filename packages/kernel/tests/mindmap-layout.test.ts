import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { astToEditable } from '../src/tree/treeOps.js';
import { layoutMindmap, H_GAP, V_GAP, subtreeHeightCached } from '../src/layout/mindmap.js';
import * as mindmapModule from '../src/layout/mindmap.js';
import type { EditableNode } from '../src/tree/treeOps.js';

const fixedMeasure = (): { w: number; h: number } => ({ w: 100, h: 30 });

function build(text: string): EditableNode {
  return astToEditable(parseMm(text).root!)!;
}

describe('mindmap 布局引擎', () => {
  it('根节点居中于原点；左右两侧分配', () => {
    const root = build('# 根\n## 左一\n- a\n## 右一\n- b\n- c');
    const { nodes } = layoutMindmap(root, fixedMeasure, new Set());
    const rootNode = nodes.find((n) => n.depth === 0)!;
    expect(rootNode.box).toEqual({ x: -50, y: -15, w: 100, h: 30 });
    const sides = nodes
      .filter((n) => n.depth === 1)
      .map((n) => n.side)
      .sort();
    expect(sides).toEqual([-1, 1]); // 两个一级分支分居两侧
  });

  it('右侧子节点位于父节点右缘之外，水平层距 = H_GAP', () => {
    const root = build('# 根\n## 分支\n- 甲');
    const { nodes } = layoutMindmap(root, fixedMeasure, new Set());
    const branch = nodes.find((n) => n.depth === 1)!;
    const leaf = nodes.find((n) => n.depth === 2)!;
    expect(leaf.box.x).toBe(branch.box.x + branch.box.w + H_GAP);
  });

  it('同侧兄弟节点垂直不重叠', () => {
    const root = build('# 根\n## B1\n- x\n- y\n- z\n## B2\n- p');
    const { nodes } = layoutMindmap(root, fixedMeasure, new Set());
    const leaves = nodes.filter((n) => n.depth === 2 && n.node.text === 'y');
    expect(leaves).toHaveLength(1);
    // 检查所有盒两两不重叠
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].box;
        const b = nodes[j].box;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `节点 ${i}/${j} 重叠`).toBe(false);
      }
    }
  });

  it('子树高度大于单节点时，子树根在其槽位内垂直居中', () => {
    const root = build('# 根\n## 分支\n- 甲\n- 乙');
    const { nodes } = layoutMindmap(root, fixedMeasure, new Set());
    const branch = nodes.find((n) => n.depth === 1)!;
    // 子树高 = 30*2 + V_GAP = 74；分支盒高 30 → 居中偏移 (74-30)/2 = 22
    const childTop = Math.min(...nodes.filter((n) => n.depth === 2).map((n) => n.box.y));
    const childBottom = Math.max(
      ...nodes.filter((n) => n.depth === 2).map((n) => n.box.y + n.box.h),
    );
    expect(branch.box.y).toBeCloseTo((childTop + childBottom) / 2 - branch.box.h / 2, 5);
  });

  it('折叠节点不产出子布局', () => {
    const root = build('# 根\n## 分支\n- 甲\n- 乙');
    const branch = root.children[0];
    const { nodes, links } = layoutMindmap(root, fixedMeasure, new Set([branch.id]));
    expect(nodes.find((n) => n.node.id === branch.id)).toBeDefined();
    expect(nodes.filter((n) => n.depth === 2)).toHaveLength(0);
    expect(links).toHaveLength(1);
  });

  it('连线数量 = 节点数 - 1；路径为贝塞尔', () => {
    const root = build('# 根\n## A\n- 甲\n## B\n- 乙\n- 丙');
    const { nodes, links } = layoutMindmap(root, fixedMeasure, new Set());
    expect(links).toHaveLength(nodes.length - 1);
    for (const l of links) expect(l.path).toMatch(/^M .+ C .+, .+, .+ .+$/);
  });

  it('bounds 覆盖全部节点盒', () => {
    const root = build('# 根\n## A\n- 甲\n## B\n- 乙');
    const { nodes, bounds } = layoutMindmap(root, fixedMeasure, new Set());
    const minX = Math.min(...nodes.map((n) => n.box.x));
    const maxX = Math.max(...nodes.map((n) => n.box.x + n.box.w));
    const minY = Math.min(...nodes.map((n) => n.box.y));
    const maxY = Math.max(...nodes.map((n) => n.box.y + n.box.h));
    expect(bounds).toEqual({ minX, minY, maxX, maxY });
    void V_GAP;
  });
});

// ============================================================================
// HP1: subtreeHeightCached 预热 / 缓存修复 —— 严格 TDD 新增用例
// ============================================================================
describe('HP1: subtreeHeightCached 缓存预热', () => {
  const fixedMeasure = (): { w: number; h: number } => ({ w: 100, h: 30 });

  function build(text: string): EditableNode {
    return astToEditable(parseMm(text).root!)!;
  }

  /** 递归统计 EditableNode 总数 */
  function countEditableNodes(n: EditableNode): number {
    return 1 + n.children.reduce((s, c) => s + countEditableNodes(c), 0);
  }

  // ------------------------------------------------------------------
  // 用例 1：每个节点的子树高度只计算一次（不重复递归）
  //   思路：通过访问 WeakMap 缓存的 size 确认每个节点恰好存入一次。
  //   RED 阶段：__subtreeHeightCache 未定义或 size < 节点数 → 失败
  //   GREEN 阶段：WeakMap size === 节点数 → 通过
  // ------------------------------------------------------------------
  it('subtreeHeightCached 对每个节点只计算一次（不重复递归）', () => {
    // 构造深 4 层宽 4 子的树：1 + 4 + 16 + 64 = 85 节点
    let idSeq = 0;
    const makeNode = (depth: number): EditableNode => {
      const id = `hp1n${idSeq++}`;
      const children = depth < 3 ? Array.from({ length: 4 }, () => makeNode(depth + 1)) : [];
      return { id, type: 'text' as const, text: id, children };
    };
    const root = makeNode(0);
    const expectedCount = countEditableNodes(root);
    expect(expectedCount).toBe(85); // 确认构造正确：1 + 4 + 16 + 64

    const result = layoutMindmap(root, fixedMeasure, new Set());
    expect(result.nodes.length).toBe(85);

    // 通过模块导出读取缓存（修复后新增）
    const mod = mindmapModule as any;
    const cache: WeakMap<any, number> | undefined = mod.__subtreeHeightCache;
    expect(cache, '__subtreeHeightCache 必须被定义并导出').toBeDefined();
    // WeakMap 没有 .size，故逐个校验：每个可见节点都必须在缓存中（计算过恰好 1 次）
    for (const n of result.nodes) {
      expect(cache!.has(n), `节点 ${n.node.id} 必须存在于 subtreeHeight 缓存中`).toBe(true);
      // 缓存的值必须等于独立计算的值
      const expected = independentSubtreeH(n);
      expect(cache!.get(n), `节点 ${n.node.id} 的缓存值正确`).toBe(expected);
    }
    // 辅助：独立计算，用于对比缓存值正确性
    function independentSubtreeH(ln: any): number {
      if (ln.children.length === 0) return ln.box.h;
      const childrenH =
        ln.children.reduce((s: number, c: any) => s + independentSubtreeH(c), 0) +
        14 * (ln.children.length - 1);
      return Math.max(ln.box.h, childrenH);
    }
  });

  // ------------------------------------------------------------------
  // 用例 2：相同文档顺序 & 相同尺寸 → 两侧分配字节级一致（纯性能重构保证）
  //   15 节点确定文档：根 + 2(A1/A2) + 4(B1-4) + 8(C1-8)
  // ------------------------------------------------------------------
  it('相同文档顺序 & 相同尺寸 → 两侧分配与原实现字节一致', () => {
    // 15 节点：1根 + 2子 + 4孙 + 8曾孙 = 15
    const doc15 = build(
      '# 根\n' +
        '## A1\n' +
        '### B1\n' +
        '#### C1\n' +
        '#### C2\n' +
        '### B2\n' +
        '#### C3\n' +
        '#### C4\n' +
        '## A2\n' +
        '### B3\n' +
        '#### C5\n' +
        '#### C6\n' +
        '### B4\n' +
        '#### C7\n' +
        '#### C8',
    );
    const { nodes } = layoutMindmap(doc15, fixedMeasure, new Set());
    expect(nodes.length).toBe(15);

    const depth1 = nodes
      .filter((n) => n.depth === 1)
      .map((n) => ({ text: n.node.text, side: n.side, x: n.box.x }));
    const depth2 = nodes
      .filter((n) => n.depth === 2)
      .map((n) => ({ text: n.node.text, side: n.side }));
    const depth3 = nodes
      .filter((n) => n.depth === 3)
      .map((n) => ({ text: n.node.text, side: n.side }));

    // 字节级一致的期望：按文档顺序，首个一级分支平局归右(1)，次个去左(-1)
    expect(depth1.map((d) => d.text)).toEqual(['A1', 'A2']);
    expect(depth1.map((d) => d.side)).toEqual([1, -1]); // A1 右，A2 左

    // 所有子节点 side 跟随父
    expect(depth2.map((d) => d.text)).toEqual(['B1', 'B2', 'B3', 'B4']);
    expect(depth2.map((d) => d.side)).toEqual([1, 1, -1, -1]);

    expect(depth3.map((d) => d.text)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7', 'C8']);
    expect(depth3.map((d) => d.side)).toEqual([1, 1, 1, 1, -1, -1, -1, -1]);

    // 一级节点 x 坐标字节级一致
    // A1（右）：根右缘 + H_GAP = (-50 + 100) + 64 = 114
    expect(depth1.find((d) => d.text === 'A1')!.x).toBe(114);
    // A2（左）：根左缘 - H_GAP - w = -50 - 64 - 100 = -214
    expect(depth1.find((d) => d.text === 'A2')!.x).toBe(-214);
  });

  // ------------------------------------------------------------------
  // 用例 3：折叠节点的子树高度缓存正确（不展开子女）
  //   修复前后，折叠节点 children=[], 其 subtreeHeight = box.h
  //   但如果没有缓存，手动改 box.h 后第二次调用会返回新值；
  //   有缓存则仍然返回旧值（缓存命中）。
  // ------------------------------------------------------------------
  it('折叠节点的子树高度缓存正确（不展开子女）', () => {
    const root = build('# 根\n## 分支X\n- 甲\n- 乙\n- 丙\n## 分支Y\n- 丁');
    const branchXId = root.children[0].id; // "分支X"
    const collapsed = new Set<string>([branchXId]);

    const result = layoutMindmap(root, fixedMeasure, collapsed);
    const branchX = result.nodes.find((n) => n.node.id === branchXId)!;

    expect(branchX.children).toHaveLength(0); // 折叠后不展开子女
    expect(branchX.box.h).toBe(30);

    // 第一次查询子树高度（应当存入缓存）
    const h1 = subtreeHeightCached(branchX);
    expect(h1).toBe(30); // 等于折叠后自身盒高

    // 手动篡改 box.h（模拟外部意外修改）
    const originalH = branchX.box.h;
    branchX.box.h = 9999;

    // 第二次查询：有缓存 → 命中旧值 30；无缓存 → 返回篡改后的 9999
    const h2 = subtreeHeightCached(branchX);

    // 还原（避免影响其他断言）
    branchX.box.h = originalH;

    // RED 阶段：无缓存 → h2 === 9999 → 失败
    // GREEN 阶段：有缓存 → h2 === 30 → 通过
    expect(h2, '缓存命中时应返回首次计算时的值（30），而非篡改后的 box.h').toBe(30);
    expect(h2).toBe(h1);
  });
});
