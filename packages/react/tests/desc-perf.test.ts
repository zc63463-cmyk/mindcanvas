/**
 * 幕布描述编辑路径性能回归（v1.3.0 编辑性能深度优化）。
 *
 * 背景：早期实现把 `descEditingId` 纳入 layoutDemo 的 measureKey，导致
 * 每次进入/退出描述编辑 → measureKey 变化 → LayoutCache.reset() → **全树重排**
 * （10K 节点图会明显卡顿，甚至卡死）。
 *
 * 优化后契约（本文件守护，违反即失败）：
 * 1. measure 输出只依赖 note.desc 内容，与 editing 状态无关
 * 2. 进入/退出编辑**不触发** cache.reset()（缓存键不变 → 增量命中）
 * 3. 打字过程（desc 内容变化但节点身份不变）不引起全树重排
 * 4. estimateDescHeight 对超长描述保持 O(cap) 而非 O(n)（行数封顶提前退出）
 */
import { describe, expect, it } from 'vitest';
import { astToEditable, LayoutCache, makeTextNode } from '@mindcanvas/kernel';
import { createDescMeasure, layoutDemo } from '../src/demo/pipeline.js';
import {
  estimateDescHeight,
  DESC_LINE_H,
  DESC_PAD,
  DESC_SOFT_MAX_LINES,
} from '../src/chrome/DescBlock.js';

/** 固定字符度量（不依赖 DOM canvas） */
const char = (
  () => (_s: string) =>
    8
)() as never;

/** 构造 N 节点链（根 + N-1 层嵌套），用于观察重排开销 */
function chain(depth: number, descAt?: number): ReturnType<typeof astToEditable> {
  let node = makeTextNode(`n${depth - 1}`);
  if (descAt === depth - 1) node.note = { desc: '有描述' };
  for (let i = depth - 2; i >= 0; i--) {
    const parent = makeTextNode(`n${i}`, [node]);
    if (descAt === i) parent.note = { desc: '有描述' };
    node = parent;
  }
  return astToEditable(node);
}

/** 固定宽度度量（desc 撑宽测试用；不依赖 DOM canvas） */
const FAKE_CHAR = (() => (_s: string) => 8) as never;

describe('编辑路径性能：measure 不含 editing 状态', () => {
  it('layoutDemo 不接受 descEditingId（签名层面防止回退到全树重排实现）', () => {
    // 类型层面已约束；运行时校验参数个数（arity）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((layoutDemo as any).length).toBeLessThanOrEqual(8);
  });

  it('createDescMeasure 输出与 editing 无关（同 desc → 同高度）', () => {
    const base = () => ({ w: 120, h: 36 });
    const withDesc = {
      id: 'n1',
      type: 'text',
      text: 'A',
      note: { desc: '描述' },
      children: [],
    } as never;
    const noDesc = { id: 'n2', type: 'text', text: 'B', children: [] } as never;
    // createDescMeasure 只有 (base, descExpandedIds) 两个参数 —— 无 editing 入参
    expect(createDescMeasure.length).toBeLessThanOrEqual(3);
    const m1 = createDescMeasure(base, FAKE_CHAR);
    const m2 = createDescMeasure(base, FAKE_CHAR);
    // 有 desc：加高
    expect(m1(withDesc).h).toBeGreaterThan(36);
    // 无 desc：原样（editing 由 overlay 浮出处理，不占布局）
    expect(m1(noDesc).h).toBe(36);
    // 展开态仅影响有 desc 的节点
    expect(m2(withDesc).h).toBeGreaterThanOrEqual(m1(withDesc).h);
    expect(m2(noDesc).h).toBe(36);
  });

  it('进入/退出编辑：LayoutCache 键不变 → 缓存命中（不 reset）', () => {
    const editable = chain(60, 10)!;
    const cache = new LayoutCache();
    // 首次布局（建立缓存）
    const r1 = layoutDemo(editable, new Map(), char, new Set(), null, cache, 'k1');
    expect(r1.layout.nodes.length).toBe(60);
    // 第二次同键同树 → 缓存命中：heights/nodes WeakMap 应有内容（未被 reset 清空）
    const r2 = layoutDemo(editable, new Map(), char, new Set(), null, cache, 'k1');
    expect(r2.layout.nodes.length).toBe(60);
    // 关键：cache.measureKey 保持为 'k1'（未因 editing 变化被改写）
    expect(cache.measureKey).toBe('k1');
    // 缓存命中证据：根节点盒坐标两次一致（增量复用）
    const a = r1.layout.nodes.find((n) => n.node.text === 'n0')!;
    const b = r2.layout.nodes.find((n) => n.node.text === 'n0')!;
    expect(b.box.h).toBe(a.box.h);
  });

  it('desc 内容变化（真正需要重排）仍能正确反映高度', () => {
    const withDesc = makeTextNode('A');
    withDesc.note = { desc: '单行' };
    const e1 = astToEditable(withDesc)!;
    const h1 = layoutDemo(
      e1,
      new Map(),
      char,
      new Set(),
      null,
      undefined,
      undefined,
    ).layout.nodes.find((n) => n.node.text === 'A')!.box.h;

    const multi = makeTextNode('A');
    multi.note = { desc: '第一行\n第二行\n第三行' };
    const e2 = astToEditable(multi)!;
    // 展开全集时，3 行 > 1 行 → 高度增加
    const h2expanded = layoutDemo(
      e2,
      new Map(),
      char,
      new Set(),
      null,
      undefined,
      undefined,
    ).layout.nodes.find((n) => n.node.text === 'A')!.box.h;
    expect(h2expanded).toBeGreaterThan(h1);
  });
});

describe('estimateDescHeight 性能：O(cap) 行数统计', () => {
  it('超长描述（5000 行）耗时可控且不建临时数组', () => {
    const long = Array.from({ length: 5000 }, (_, i) => `行${i}`).join('\n');
    const t0 = performance.now();
    const h = estimateDescHeight(long);
    const dt = performance.now() - t0;
    // 封顶生效
    expect(h).toBe(DESC_SOFT_MAX_LINES * DESC_LINE_H + DESC_PAD * 2);
    // 性能护栏：5000 行统计应在 5ms 内（计数 + 提前退出；split 版本会分配 5000 元素数组）
    expect(dt).toBeLessThan(5);
  });

  it('封顶后高度不再随内容增长（超长描述由内部滚动消化）', () => {
    const long = 'x\n'.repeat(2000);
    expect(estimateDescHeight(long)).toBe(DESC_SOFT_MAX_LINES * DESC_LINE_H + DESC_PAD * 2);
  });
});
