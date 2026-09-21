/**
 * FE-FRAME-1：跨框自由边端点贴盒（纯函数）——设计 §7 测试计划。
 *
 * 口径（F1–F5）：
 * - 跨 Section → 该端取 frame.bounds；同 Section → 两端不提升（回退节点盒）；
 * - 嵌套 Section → 取面积最小（最深）者；
 * - 总览档 → 先查卡（迷你优先于父卡）；同卡不提升；未命中卡的端才走 Section；
 * - 无命中 → **原对象引用**（下游路由缓存 key / 引用稳定性的前提）；
 * - renderable=false / ghost → 原样。
 */
import { describe, expect, it } from 'vitest';
import type { Box } from '@mindcanvas/kernel';
import type { EdgeEndpoints, FreeEdge } from '../src/render/freeEdges.js';
import { routeCacheKey } from '../src/render/routeCache.js';
import {
  buildSectionMemberIndex,
  owningOverviewCard,
  owningSectionId,
  refineFreeEdgeEndpoints,
  type OverviewCardIndex,
  type SectionBoundsIndex,
} from '../src/render/freeEdgeFrameAnchor.js';

const NODE_A: Box = { x: 0, y: 0, w: 40, h: 20 };
const NODE_B: Box = { x: 300, y: 0, w: 40, h: 20 };

function epsOf(fromId: string, toId: string, from: Box = NODE_A, to: Box = NODE_B): EdgeEndpoints {
  return { fromId, toId, from, to, ghost: false, renderable: true };
}

/** 父区（大）⊃ 子区（小）：b / x 同时在两区（嵌套）；a 只在父区 */
const SEC_P_BOUNDS: Box = { x: -24, y: -34, w: 220, h: 180 };
const SEC_C_BOUNDS: Box = { x: -10, y: -20, w: 90, h: 70 };
const SECTION_MEMBERS = buildSectionMemberIndex([
  { id: 'sec_p', memberIds: ['a', 'b', 'c'] },
  { id: 'sec_c', memberIds: ['b', 'x'] },
]);
const SECTION_BOUNDS: SectionBoundsIndex = new Map([
  ['sec_p', SEC_P_BOUNDS],
  ['sec_c', SEC_C_BOUNDS],
]);
const NO_SECTIONS = new Map<string, ReadonlySet<string>>();
const NO_BOUNDS: SectionBoundsIndex = new Map();

const CARD1: Box = { x: -30, y: -50, w: 200, h: 120 };
const CARD2: Box = { x: 400, y: -50, w: 160, h: 100 };
const MINI: Box = { x: 0, y: 0, w: 60, h: 40 };
const CARDS: OverviewCardIndex = [
  { rootId: 'k1', bounds: CARD1, memberIds: new Set(['a', 'c']) },
  { rootId: 'k2', bounds: CARD2, memberIds: new Set(['y', 'z']) },
];

describe('owningSectionId / buildSectionMemberIndex', () => {
  it('成员命中 → 返回 sectionId；未命中 → undefined', () => {
    expect(owningSectionId('a', SECTION_MEMBERS, SECTION_BOUNDS)).toBe('sec_p');
    expect(owningSectionId('zzz', SECTION_MEMBERS, SECTION_BOUNDS)).toBeUndefined();
  });

  it('F3：多框重叠取 bounds 面积最小者（嵌套最深代理）', () => {
    expect(owningSectionId('b', SECTION_MEMBERS, SECTION_BOUNDS)).toBe('sec_c');
  });

  it('F4：成员在索引但无成框 bounds → 不命中（不提升到隐形框）', () => {
    expect(owningSectionId('a', SECTION_MEMBERS, NO_BOUNDS)).toBeUndefined();
  });
});

describe('owningOverviewCard', () => {
  it('顺序匹配 = 迷你优先（迷你注册在前，member 集更小）', () => {
    const cards: OverviewCardIndex = [
      { rootId: 'k_mini', bounds: MINI, memberIds: new Set(['x']) },
      { rootId: 'k_parent', bounds: CARD1, memberIds: new Set(['x', 'q']) },
    ];
    expect(owningOverviewCard('x', cards)).toEqual({ rootId: 'k_mini', bounds: MINI });
  });

  it('未命中 → undefined', () => {
    expect(owningOverviewCard('nobody', CARDS)).toBeUndefined();
  });
});

describe('refineFreeEdgeEndpoints（F1–F5）', () => {
  it('F1：一端属框、另一端不属 → 该端取 frame.bounds，对端保持节点盒', () => {
    const eps = epsOf('a', 'zzz');
    const out = refineFreeEdgeEndpoints(eps, {
      overview: false,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out.from).toBe(SEC_P_BOUNDS);
    expect(out.to).toBe(NODE_B); // 严格原引用
    // F8：边身份不变
    expect(out.fromId).toBe('a');
    expect(out.toId).toBe('zzz');
    expect(out.renderable).toBe(true);
    expect(out.ghost).toBe(false);
  });

  it('F1：两端分属不同 Section → 两端各自提升到自己的框', () => {
    const eps = epsOf('a', 'x');
    const out = refineFreeEdgeEndpoints(eps, {
      overview: false,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out.from).toBe(SEC_P_BOUNDS);
    expect(out.to).toBe(SEC_C_BOUNDS);
  });

  it('F2：两端同 Section → 两端回退节点盒（返回原引用）', () => {
    const eps = epsOf('a', 'c');
    const out = refineFreeEdgeEndpoints(eps, {
      overview: false,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out).toBe(eps);
  });

  it('F3：嵌套 Section → 提升到最深（面积最小）框', () => {
    const out = refineFreeEdgeEndpoints(epsOf('b', 'zzz'), {
      overview: false,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out.from).toBe(SEC_C_BOUNDS);
  });

  it('F4：无 Section（索引空）→ 原引用（不改锚）', () => {
    const eps = epsOf('a', 'zzz');
    const out = refineFreeEdgeEndpoints(eps, {
      overview: false,
      sectionMembers: NO_SECTIONS,
      sectionBounds: NO_BOUNDS,
    });
    expect(out).toBe(eps);
  });

  it('F5：总览档两端不同卡 → 各自取卡 bounds（卡优先于 Section）', () => {
    // a 既属 sec_p 又属卡 k1；y 只属卡 k2 → 两端都应是卡盒
    const out = refineFreeEdgeEndpoints(epsOf('a', 'y'), {
      overview: true,
      overviewCards: CARDS,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out.from).toBe(CARD1);
    expect(out.to).toBe(CARD2);
  });

  it('F5：总览未激活（overview=false）→ 卡索引被忽略，走 Section', () => {
    const out = refineFreeEdgeEndpoints(epsOf('a', 'y'), {
      overview: false,
      overviewCards: CARDS,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out.from).toBe(SEC_P_BOUNDS);
    expect(out.to).toBe(NODE_B); // y 不在任何 Section → 节点盒
  });

  it('F2：两端同总览卡 → 不提升（原引用）', () => {
    const eps = epsOf('a', 'c');
    const out = refineFreeEdgeEndpoints(eps, {
      overview: true,
      overviewCards: CARDS,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out).toBe(eps);
  });

  it('F5：迷你优先于父卡（同一 id 命中迷你 → 用迷你 bounds）', () => {
    const cards: OverviewCardIndex = [
      { rootId: 'k_mini', bounds: MINI, memberIds: new Set(['x']) },
      { rootId: 'k_parent', bounds: CARD1, memberIds: new Set(['x', 'q']) },
    ];
    const out = refineFreeEdgeEndpoints(epsOf('x', 'nobody'), {
      overview: true,
      overviewCards: cards,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out.from).toBe(MINI);
  });

  it('F5：一端命中卡、另一端未命中 → 未命中端走 Section 提升', () => {
    // a ∈ 卡 k1 且 ∈ sec_p；x ∈ sec_c 但不在任何卡
    const out = refineFreeEdgeEndpoints(epsOf('a', 'x'), {
      overview: true,
      overviewCards: CARDS,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(out.from).toBe(CARD1);
    expect(out.to).toBe(SEC_C_BOUNDS);
  });

  it('路由缓存键：提升后的端点盒进入 key —— 盒变 key 变（自然 miss，无需手改 cache gen）', () => {
    const edge: FreeEdge = {
      key: 'e0',
      index: 0,
      sourceId: 'a',
      targetId: 'zzz',
      from: 'x',
      to: 'y',
      rel: 'relates-to',
      dir: 'fwd',
      state: 'well-formed',
    };
    const raw = epsOf('a', 'zzz');
    const refined = refineFreeEdgeEndpoints(raw, {
      overview: false,
      sectionMembers: SECTION_MEMBERS,
      sectionBounds: SECTION_BOUNDS,
    });
    expect(refined.from).not.toBe(raw.from);
    expect(routeCacheKey(edge, refined, 0)).not.toBe(routeCacheKey(edge, raw, 0));
  });

  it('不可渲染 / ghost → 原样返回（幽灵锚点不伪造可达性）', () => {
    const notRenderable: EdgeEndpoints = {
      fromId: '',
      toId: '',
      from: { x: 0, y: 0, w: 0, h: 0 },
      to: { x: 0, y: 0, w: 0, h: 0 },
      ghost: false,
      renderable: false,
    };
    expect(
      refineFreeEdgeEndpoints(notRenderable, {
        overview: false,
        sectionMembers: SECTION_MEMBERS,
        sectionBounds: SECTION_BOUNDS,
      }),
    ).toBe(notRenderable);

    const ghost: EdgeEndpoints = { ...epsOf('a', ''), ghost: true };
    expect(
      refineFreeEdgeEndpoints(ghost, {
        overview: false,
        sectionMembers: SECTION_MEMBERS,
        sectionBounds: SECTION_BOUNDS,
      }),
    ).toBe(ghost);
  });
});

/**
 * FE-FRAME-1.1 护航 · property / 不变式矩阵（确定性表驱动，无需 fast-check）。
 *
 * 组合覆盖：命中来源（单框 / 嵌套多框 / 同框 / 索引无框 F4 / 完全无命中）× 总览开关 ×
 * 卡命中（迷你 / 父 / 同卡 / 卡外）× ghost / !renderable。每行统一断言五条不变式：
 *   ① 身份：fromId / toId / ghost / renderable 与输入逐项相同（F8）；
 *   ② 提升盒来源：端盒一旦变化 → 新盒 ∈ sectionBounds 值集 ∪ overviewCards[].bounds（引用同一）；
 *   ③ 同框：两端同 sectionId 或同卡 rootId → 原对象引用；
 *   ④ 无命中：两端不在任何索引 → 原对象引用；
 *   ⑤ ghost / !renderable → 原对象引用。
 */
describe('FE-FRAME-1.1 property：refineFreeEdgeEndpoints 不变式矩阵', () => {
  // 成员宇宙：a ∈ 仅 sec_p；b ∈ sec_p ∩ sec_c；c ∈ 仅 sec_p；x ∈ 仅 sec_c；
  // g ∈ sec_g（索引登记但无成框 bounds → F4 不成框）；q / q2 ∈ 仅卡 k_p；u ∈ 未登记任何索引。
  const INDEX = buildSectionMemberIndex([
    { id: 'sec_p', memberIds: ['a', 'b', 'c'] },
    { id: 'sec_c', memberIds: ['b', 'x'] },
    { id: 'sec_g', memberIds: ['g'] },
  ]);
  const BOUNDS: SectionBoundsIndex = new Map([
    ['sec_p', SEC_P_BOUNDS],
    ['sec_c', SEC_C_BOUNDS],
  ]);
  const K_MINI: Box = { x: 0, y: 0, w: 60, h: 40 };
  const K_P: Box = { x: -30, y: -50, w: 200, h: 120 };
  const K_Q: Box = { x: 400, y: -50, w: 160, h: 100 };
  const CARDS_11: OverviewCardIndex = [
    { rootId: 'k_mini', bounds: K_MINI, memberIds: new Set(['x']) },
    { rootId: 'k_p', bounds: K_P, memberIds: new Set(['x', 'q', 'q2']) },
    { rootId: 'k_q', bounds: K_Q, memberIds: new Set(['a']) },
  ];
  /** 合法提升盒值集（引用同一性判别：新盒必须是索引里那个对象，不是等值副本） */
  const PROMOTED = new Set<Box>([SEC_P_BOUNDS, SEC_C_BOUNDS, K_MINI, K_P, K_Q]);

  interface Row {
    name: string;
    from: string;
    to: string;
    overview: boolean;
    ghost?: boolean;
    renderable?: boolean;
    /** true = 期望原对象引用（同框 / 无命中 / ghost / 不可渲染） */
    identity: boolean;
    /** 期望 from 盒（引用）；undefined = 期望与输入同引用 */
    fromBox?: Box;
    toBox?: Box;
  }

  const ROWS: Row[] = [
    {
      name: 'F1 单端命中：a ∈ 仅 sec_p → from 提升，to 原引用',
      from: 'a', to: 'u', overview: false, identity: false, fromBox: SEC_P_BOUNDS,
    },
    {
      name: 'F3 多框重叠：b 同属 P/C → 取面积最小 sec_c',
      from: 'b', to: 'u', overview: false, identity: false, fromBox: SEC_C_BOUNDS,
    },
    {
      name: 'F1 两端分属不同框：a→b → P / C 各自提升',
      from: 'a', to: 'b', overview: false, identity: false,
      fromBox: SEC_P_BOUNDS, toBox: SEC_C_BOUNDS,
    },
    {
      name: 'F3 单向不对称：b→c → from 取最深 C，to 取 P',
      from: 'b', to: 'c', overview: false, identity: false,
      fromBox: SEC_C_BOUNDS, toBox: SEC_P_BOUNDS,
    },
    { name: 'F2 两端同框（sec_p）：a→c → 原引用', from: 'a', to: 'c', overview: false, identity: true },
    { name: 'F2 两端同最深框（sec_c）：b→x → 原引用', from: 'b', to: 'x', overview: false, identity: true },
    {
      name: 'F4 索引有成员但无成框 bounds：g→u → 无命中，原引用',
      from: 'g', to: 'u', overview: false, identity: true,
    },
    { name: '无命中：u→u 双端均不在任何索引 → 原引用', from: 'u', to: 'u', overview: false, identity: true },
    {
      name: 'F5 迷你优先：x→q → k_mini / k_p',
      from: 'x', to: 'q', overview: true, identity: false, fromBox: K_MINI, toBox: K_P,
    },
    { name: 'F5 同卡不提升：q→q2（同 k_p）→ 原引用', from: 'q', to: 'q2', overview: true, identity: true },
    {
      name: 'F5 单端卡命中：a→u → from 卡 k_q，to 原引用',
      from: 'a', to: 'u', overview: true, identity: false, fromBox: K_Q,
    },
    {
      name: 'F5 卡优先于 Section：a→x → k_q / k_mini（不走 sec_p / sec_c 框）',
      from: 'a', to: 'x', overview: true, identity: false, fromBox: K_Q, toBox: K_MINI,
    },
    {
      name: 'F5 卡一侧 + Section 兜底一侧：b→q → sec_c / k_p',
      from: 'b', to: 'q', overview: true, identity: false, fromBox: SEC_C_BOUNDS, toBox: K_P,
    },
    {
      name: 'F5+F4 卡外无框端保持原引用：g→q → to 卡 k_p',
      from: 'g', to: 'q', overview: true, identity: false, toBox: K_P,
    },
    {
      name: 'F5 总览未激活（overview=false）：卡索引被忽略，a→q 走 Section / 无命中',
      from: 'a', to: 'q', overview: false, identity: false, fromBox: SEC_P_BOUNDS,
    },
    { name: 'F5 总览档双端均未命中：u→u → 原引用', from: 'u', to: 'u', overview: true, identity: true },
    {
      name: 'F8 ghost 边整体不提升：a→u（ghost=true）→ 原引用',
      from: 'a', to: 'u', overview: true, ghost: true, identity: true,
    },
    {
      name: 'F8 不可渲染边整体不提升：a→u（renderable=false）→ 原引用',
      from: 'a', to: 'u', overview: true, renderable: false, identity: true,
    },
  ];

  it.each(ROWS)('$name', (row) => {
    const epsIn: EdgeEndpoints = {
      ...epsOf(row.from, row.to),
      ...(row.ghost !== undefined ? { ghost: row.ghost } : {}),
      ...(row.renderable !== undefined ? { renderable: row.renderable } : {}),
    };
    const out = refineFreeEdgeEndpoints(epsIn, {
      overview: row.overview,
      overviewCards: CARDS_11,
      sectionMembers: INDEX,
      sectionBounds: BOUNDS,
    });

    // ① 身份 / 命中语义原样通过（F8）
    expect(out.fromId).toBe(epsIn.fromId);
    expect(out.toId).toBe(epsIn.toId);
    expect(out.ghost).toBe(epsIn.ghost);
    expect(out.renderable).toBe(epsIn.renderable);

    // ② 提升盒来源：端盒一旦变化，必来自成框 bounds 或卡 bounds（同一引用）
    if (out.from !== epsIn.from) expect(PROMOTED.has(out.from)).toBe(true);
    if (out.to !== epsIn.to) expect(PROMOTED.has(out.to)).toBe(true);

    // ③④⑤ 原引用场景（同框 / 无命中 / ghost / 不可渲染）
    if (row.identity) {
      expect(out).toBe(epsIn);
      return;
    }
    expect(out).not.toBe(epsIn);
    expect(out.from).toBe(row.fromBox ?? epsIn.from);
    expect(out.to).toBe(row.toBox ?? epsIn.to);
  });
});
