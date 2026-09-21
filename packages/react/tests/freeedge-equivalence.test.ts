/**
 * G-P3：等价性守护 —— 「每边成本」优化（G-P3a 解析器预计算 + 障碍预构建表）与旧路径逐字段等价。
 *
 * 本文件在**接线前**先立标准（对当时生产旧路径必绿），接线路径后仍须绿；
 * 任一路径语义/顺序漂移即变红。覆盖（确定性随机，mulberry32）：
 *  ① freeEdgeEndpoints：随机树（含折叠子树）× 随机折叠集 × 随机边
 *     （normal / 自关联 / ghost 靶点 / 缺盒 / 零盒 / 不在树中的 id / null 端）→
 *     旧路径 vs resolve 注入路径**逐字段相等**（含 renderable / ghost / from / to）；
 *  ② ObstacleTable.without：与旧 filter+map 逐项**同序同引用**相等；
 *  ③ 整表重算管线模拟：旧管线（每端点 DFS + 每边 filter/map）vs 新管线（解析器 + 表复用）
 *     → 全部 RouteResult 逐位相等（d 字符串 / points / mid / nx / ny / routed）；
 *     并加索引粗筛管线（G-P3b：near() 命中 / 收益不足回退两分支）同断言。
 *  ④ 索引粗筛两分支确定性用例（1200 障碍网格）：短边命中（结果等价）/ 长边回退 null。
 *  ⑤ G-P9b 保守界**充分性** property test：大场域随机场景 × 强制开索引（indexMinNodes: 0）→
 *     「near() 剪枝 vs 全量」RouteResult 逐位相等（200+ 边对拍，含贴弦 threading 边）；
 *  ⑥ G-P9b 界内缘对抗几何：障碍置于推导界内缘（1.65·chordMax + 180 + ε）必须被 near() 纳入
 *     —— R 保守界一缩（低于推导必要界）本用例即红。
 */
import { describe, expect, it } from 'vitest';
import { makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import type { Box } from '@mindcanvas/kernel';
import { edgeResolverOf, freeEdgeEndpoints, type FreeEdge } from '../src/render/freeEdges.js';
import { buildObstacleTable } from '../src/render/obstacleTable.js';
import { routeAesthetic } from '../src/render/edgeRouting.js';

/** 确定性伪随机（与 scripts/bench-freeedge.mjs 同款 mulberry32） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RandScene {
  root: EditableNode;
  nodes: EditableNode[];
  collapsed: Set<string>;
  boxes: Map<string, Box>;
  boxOf: (id: string) => Box | undefined;
}

/** 随机树 + 随机折叠 + 盒怪癖（缺盒 15% / 零盒 10% / 正常盒） */
function makeScene(rnd: () => number, count: number): RandScene {
  const nodes: EditableNode[] = [];
  for (let i = 0; i < count; i++) nodes.push(makeTextNode(`n${i}`));
  for (let i = 1; i < count; i++) {
    const parent = nodes[Math.floor(rnd() * i)];
    const node = nodes[i];
    if (parent && node) parent.children.push(node);
  }
  const root = nodes[0];
  if (!root) throw new Error('empty scene');
  const collapsed = new Set<string>();
  for (const n of nodes) {
    if (n !== root && rnd() < 0.3) collapsed.add(n.id);
  }
  const boxes = new Map<string, Box>();
  for (const n of nodes) {
    const r = rnd();
    if (r < 0.15) continue; // 缺盒
    if (r < 0.25) boxes.set(n.id, { x: rnd() * 500, y: rnd() * 300, w: 0, h: 0 }); // 零盒
    else
      boxes.set(n.id, {
        x: rnd() * 1200,
        y: rnd() * 700,
        w: 40 + rnd() * 120,
        h: 20 + rnd() * 40,
      });
  }
  return { root, nodes, collapsed, boxes, boxOf: (id) => boxes.get(id) };
}

/** 随机端点：null 12% / 不在树中的 id 12% / 树内节点 */
function randomEnd(rnd: () => number, nodes: EditableNode[]): string | null {
  const r = rnd();
  if (r < 0.12) return null;
  if (r < 0.24) return `missing-${Math.floor(rnd() * 100)}`;
  const n = nodes[Math.floor(rnd() * nodes.length)];
  return n ? n.id : null;
}

function mkEdge(key: string, sourceId: string | null, targetId: string | null): FreeEdge {
  return {
    key,
    index: 0,
    sourceId,
    targetId,
    from: 'x',
    to: 'y',
    rel: 'relates-to',
    dir: 'fwd',
    state: 'well-formed',
  };
}

describe('G-P3 等价性守护', () => {
  it('① freeEdgeEndpoints：resolve 注入路径与旧路径逐字段相等（随机树/折叠/边）', () => {
    const rnd = mulberry32(0xbeef);
    for (let s = 0; s < 25; s++) {
      const scene = makeScene(rnd, 8 + Math.floor(rnd() * 12));
      const resolver = edgeResolverOf(scene.root, scene.collapsed, scene.boxOf);
      for (let j = 0; j < 14; j++) {
        // 每 7 条强制一条自关联（fromId === toId 退化路径）
        const selfCase = j % 7 === 3;
        const src = randomEnd(rnd, scene.nodes);
        const tgt = selfCase ? src : randomEnd(rnd, scene.nodes);
        const edge = mkEdge(`e${s}-${j}`, src, tgt);
        const oldEps = freeEdgeEndpoints(edge, scene.boxOf, scene.root, scene.collapsed);
        const newEps = freeEdgeEndpoints(
          edge,
          scene.boxOf,
          scene.root,
          scene.collapsed,
          resolver,
        );
        expect(newEps).toEqual(oldEps);
      }
    }
  });

  it('② ObstacleTable.without：与旧 filter+map 逐项同序同引用相等', () => {
    const rnd = mulberry32(0xcafe);
    for (let s = 0; s < 40; s++) {
      const count = 10 + Math.floor(rnd() * 31);
      const obstacles: { id: string; box: Box }[] = [];
      for (let i = 0; i < count; i++) {
        obstacles.push({
          id: `o${i}`,
          box: { x: rnd() * 800, y: rnd() * 400, w: 20 + rnd() * 100, h: 16 + rnd() * 30 },
        });
      }
      const table = buildObstacleTable(obstacles);
      const pairs: [string, string][] = [
        ['o0', 'o1'], // 两端都在场
        [`o${count - 1}`, `o${count}`], // 一端缺场
        ['none-a', 'none-b'], // 全缺场（零拷贝路径）
        ['o2', 'o2'], // 同 id 两次（自关联）
      ];
      for (const [f, t] of pairs) {
        const old = obstacles.filter((o) => o.id !== f && o.id !== t).map((o) => o.box);
        const got = table.without(f, t);
        expect(got).toEqual(old);
        expect(got.length).toBe(old.length);
        old.forEach((b, i) => {
          expect(got[i]).toBe(b); // 顺序不变 + 同引用
        });
      }
    }
    // 空障碍：without 应返回空数组
    expect(buildObstacleTable([]).without('a', 'b')).toEqual([]);
  });

  it('③ 整表重算管线模拟：旧管线 vs 新管线 RouteResult 逐位相等（含跨边累积）', () => {
    const rnd = mulberry32(0xdead);
    for (let s = 0; s < 12; s++) {
      const scene = makeScene(rnd, 10 + Math.floor(rnd() * 20));
      // 障碍 = 有盒节点全量（与生产一致：端点也在障碍集内，按 id 排除）
      const obstacles: { id: string; box: Box }[] = [];
      for (const n of scene.nodes) {
        const b = scene.boxes.get(n.id);
        if (b) obstacles.push({ id: n.id, box: b });
      }
      const edges: FreeEdge[] = [];
      for (let j = 0; j < 6; j++) {
        const a = scene.nodes[Math.floor(rnd() * scene.nodes.length)];
        const b = scene.nodes[Math.floor(rnd() * scene.nodes.length)];
        if (a && b) edges.push(mkEdge(`p${s}-${j}`, a.id, b.id));
      }

      const runOld = (): { key: string; route: ReturnType<typeof routeAesthetic> }[] => {
        const out: { key: string; route: ReturnType<typeof routeAesthetic> }[] = [];
        const polylines: { x: number; y: number }[][] = [];
        for (const e of edges) {
          const eps = freeEdgeEndpoints(e, scene.boxOf, scene.root, scene.collapsed);
          if (!eps.renderable) continue;
          const obs = obstacles
            .filter((o) => o.id !== eps.fromId && o.id !== eps.toId)
            .map((o) => o.box);
          const route = routeAesthetic(eps.from, eps.to, obs, polylines, {});
          out.push({ key: e.key, route });
          if (route.points.length >= 2) polylines.push([...route.points]);
        }
        return out;
      };

      const runNew = (): { key: string; route: ReturnType<typeof routeAesthetic> }[] => {
        const out: { key: string; route: ReturnType<typeof routeAesthetic> }[] = [];
        const resolver = edgeResolverOf(scene.root, scene.collapsed, scene.boxOf);
        const table = buildObstacleTable(obstacles);
        const polylines: { x: number; y: number }[][] = [];
        for (const e of edges) {
          const eps = freeEdgeEndpoints(e, scene.boxOf, scene.root, scene.collapsed, resolver);
          if (!eps.renderable) continue;
          const route = routeAesthetic(eps.from, eps.to, table.without(eps.fromId, eps.toId), polylines, {});
          out.push({ key: e.key, route });
          if (route.points.length >= 2) polylines.push([...route.points]);
        }
        return out;
      };

      expect(runNew()).toEqual(runOld());

      // ④ 索引粗筛管线（G-P3b）：indexMinNodes=0 强制走 near()（null 时自动回退）——
      //    与旧管线逐位相等（覆盖：粗筛命中 / 收益不足回退 两种分支）。
      const runIndexed = (): { key: string; route: ReturnType<typeof routeAesthetic> }[] => {
        const out: { key: string; route: ReturnType<typeof routeAesthetic> }[] = [];
        const resolver = edgeResolverOf(scene.root, scene.collapsed, scene.boxOf);
        const table = buildObstacleTable(obstacles, { indexMinNodes: 0 });
        const polylines: { x: number; y: number }[][] = [];
        for (const e of edges) {
          const eps = freeEdgeEndpoints(e, scene.boxOf, scene.root, scene.collapsed, resolver);
          if (!eps.renderable) continue;
          const obs =
            table.near(eps.from, eps.to, eps.fromId, eps.toId) ??
            table.without(eps.fromId, eps.toId);
          const route = routeAesthetic(eps.from, eps.to, obs, polylines, {});
          out.push({ key: e.key, route });
          if (route.points.length >= 2) polylines.push([...route.points]);
        }
        return out;
      };
      expect(runIndexed()).toEqual(runOld());
    }
  });

  it('④ 索引粗筛两分支：短边粗筛命中（子集小）、长边回退 null —— 路由结果逐位等价', () => {
    // 1200 障碍网格（40 列 × 30 行）→ 默认阈值 1000 建索引
    const COLS = 40;
    const obstacles: { id: string; box: Box }[] = [];
    for (let i = 0; i < 1200; i++) {
      obstacles.push({
        id: `g${i}`,
        box: { x: (i % COLS) * 160, y: Math.floor(i / COLS) * 56, w: 100, h: 30 },
      });
    }
    const table = buildObstacleTable(obstacles);
    // 短边（同区邻列，窗口小 → 粗筛命中）
    const s0 = obstacles[520];
    const s1 = obstacles[521];
    if (!s0 || !s1) throw new Error('scene incomplete');
    const nearShort = table.near(s0.box, s1.box, s0.id, s1.id);
    expect(nearShort).not.toBeNull();
    if (nearShort) {
      const full = routeAesthetic(s0.box, s1.box, table.without(s0.id, s1.id), [], {});
      const pruned = routeAesthetic(s0.box, s1.box, nearShort, [], {});
      expect(pruned).toEqual(full);
    }
    // 长边（跨约 3/4 图高 → 窗口≈全图 → 收益不足回退）
    const l0 = obstacles[30];
    const l1 = obstacles[1170];
    if (!l0 || !l1) throw new Error('scene incomplete');
    expect(table.near(l0.box, l1.box, l0.id, l1.id)).toBeNull();
  });

  it('⑤ G-P9b 保守界充分性 property test：near() 剪枝 vs 全量 RouteResult 逐位相等（200+ 边，强制开索引）', () => {
    const rnd = mulberry32(0x5eed);
    let comparisons = 0;
    let prunedHits = 0;
    for (let s = 0; s < 50; s++) {
      // 大场域稀疏障碍（24000×14000 撒 120~240 盒）→ 短边 near() 窗口子集远小于 60%，
      // 真正走剪枝路径而非回退；端点取自障碍集（生产口径：端点自身在障碍集内按 id 排除）。
      const obstacles: { id: string; box: Box }[] = [];
      const n = 120 + Math.floor(rnd() * 120);
      for (let i = 0; i < n; i++) {
        obstacles.push({
          id: `o${s}-${i}`,
          box: { x: rnd() * 24000, y: rnd() * 14000, w: 30 + rnd() * 120, h: 20 + rnd() * 60 },
        });
      }
      // 强制开索引（生产阈值 1000，本测 indexMinNodes: 0）——判别对象是 near() 本身
      const edges: { a: Box; b: Box; fromId: string; toId: string }[] = [];
      /** 随机取一障碍：显式空集守卫替代非空断言（rnd 调用序与原实现一致） */
      const pick = (): { id: string; box: Box } => {
        const o = obstacles[Math.floor(rnd() * obstacles.length)];
        if (!o) throw new Error('pick from empty obstacles');
        return o;
      };
      for (let j = 0; j < 5; j++) {
        const o1 = pick();
        // 近端点（同场景随机找距离 <1600 的伴侣 → 短边，near() 命中为主）与远端点（长边 → 回退分支）混合
        let o2 = pick();
        if (j < 3) {
          for (let t = 0; t < 40; t++) {
            const cand = pick();
            const d = Math.hypot(
              cand.box.x - o1.box.x,
              cand.box.y - o1.box.y,
            );
            if (cand !== o1 && d < 1600) {
              o2 = cand;
              break;
            }
          }
        }
        if (o1 === o2) continue;
        edges.push({ a: o1.box, b: o2.box, fromId: o1.id, toId: o2.id });
      }
      // 每场景一条贴弦 threading 边：障碍压在两盒中心连线中点上（必须经 corridor/threading 判定分支）。
      // 先入障碍全集、后建表 —— 保证剪枝/全量两条路径都能看到它。
      if (edges.length > 0) {
        const e0 = edges[0];
        if (!e0) throw new Error('no edge to thread');
        const midC = {
          x: (e0.a.x + e0.a.w / 2 + e0.b.x + e0.b.w / 2) / 2 - 40,
          y: (e0.a.y + e0.a.h / 2 + e0.b.y + e0.b.h / 2) / 2 - 20,
        };
        obstacles.push({ id: `thread-${s}`, box: { ...midC, w: 80, h: 40 } });
        edges.push({
          a: e0.a,
          b: e0.b,
          fromId: e0.fromId,
          toId: e0.toId,
        });
      }
      const table = buildObstacleTable(obstacles, { indexMinNodes: 0 });

      const runWith = (
        pick: (e: { a: Box; b: Box; fromId: string; toId: string }) => readonly Box[],
      ): ReturnType<typeof routeAesthetic>[] => {
        const out: ReturnType<typeof routeAesthetic>[] = [];
        const polylines: { x: number; y: number }[][] = [];
        for (const e of edges) {
          const route = routeAesthetic(e.a, e.b, pick(e), polylines, {});
          out.push(route);
          if (route.points.length >= 2) polylines.push([...route.points]);
        }
        return out;
      };

      const full = runWith((e) => table.without(e.fromId, e.toId));
      const pruned = runWith((e) => {
        const near = table.near(e.a, e.b, e.fromId, e.toId);
        if (near !== null) prunedHits++;
        return near ?? table.without(e.fromId, e.toId);
      });
      comparisons += edges.length;
      expect(pruned).toEqual(full);
    }
    // 非空转双守卫：对拍规模 ≥ 200；且确实存在走剪枝路径的边（回退分支不计数）
    expect(comparisons).toBeGreaterThanOrEqual(200);
    expect(prunedHits, `剪枝命中 ${prunedHits} 次——用例未真正覆盖 near() 路径`).toBeGreaterThan(100);
  }, 60000);

  it('⑥ G-P9b 界内缘对抗几何：障碍在推导界内缘（1.65·chordMax + 180 + ε）必须被 near() 纳入', () => {
    // 端点盒极小（halfDiag 贡献小）→ chordMax ≈ 中心距，界余量全部暴露给判别：
    // R = 2·chordMax + 210 vs 对抗障碍距离 d = 1.65·chordMax + 180 + ε（ε = 1）。
    // R 收缩到推导必要界以下（如去掉 2× 系数、或砍掉 210 余量至 <181）→ 障碍出窗 → 本用例红。
    const a: Box = { x: 0, y: 0, w: 20, h: 10 };
    const b: Box = { x: 600, y: 0, w: 20, h: 10 };
    const halfDiag = (x: Box): number => Math.hypot(x.w, x.h) / 2;
    const chordMax =
      Math.hypot(a.x + a.w / 2 - (b.x + b.w / 2), a.y + a.h / 2 - (b.y + b.h / 2)) +
      halfDiag(a) +
      halfDiag(b);
    const spanYMax = Math.max(a.y + a.h, b.y + b.h);
    const d = 1.65 * chordMax + 180 + 1; // 推导界内缘（ε = 1，必要界 = …+183）
    const adv: Box = { x: 290, y: spanYMax + d, w: 20, h: 20 };

    // 背景障碍网（间距 2500、避开弦线 y=0 ±1800）→ near() 窗口子集 ≪ 60%，不触发回退
    const obstacles: { id: string; box: Box }[] = [
      { id: 'ep-a', box: a },
      { id: 'ep-b', box: b },
      { id: 'adv', box: adv },
    ];
    for (let gy = -8; gy <= 8; gy++) {
      if (Math.abs(gy) < 1) continue; // 弦线走廊留空：本用例只判纳入，不让背景参与路由
      for (let gx = -12; gx <= 12; gx++) {
        obstacles.push({
          id: `bg-${gx}-${gy}`,
          box: { x: gx * 2500, y: gy * 2500, w: 200, h: 120 },
        });
      }
    }
    const table = buildObstacleTable(obstacles, { indexMinNodes: 0, cellSize: 32 });
    // cellSize 收小：queryBoxIndex 按 1 格膨胀（默认 512px）会把「窗口外 < 512px」的障碍也捞回，
    // 掩盖 R 收缩 ≤512px 的突变——小格径让判别锐利到推导界内缘（生产默认 512 不受影响）。
    const near = table.near(a, b, 'ep-a', 'ep-b');
    expect(near, 'near() 回退了 null——背景网密度不足以让窗口子集 < 60%').not.toBeNull();
    if (!near) return;
    expect(
      near.includes(adv),
      `界内缘障碍（距 span ${d.toFixed(1)}px）未被纳入——R 保守界被收缩`,
    ).toBe(true);
  });
});
