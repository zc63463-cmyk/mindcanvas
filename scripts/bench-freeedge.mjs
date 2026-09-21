/**
 * G-P0 自由边路由规模基准（2026-09-12 自由边路由重算治理批次）。
 *
 * 测量「单次全量重算」成本：镜像 `FreeEdgeLayer` 路由 useMemo 的内层循环——
 *   for each edge: freeEdgeEndpoints（含 collapsedAncestors O(N) DFS）
 *                  → obstacles.filter(excl).map(box)（O(N) 重扫 + 新数组）
 *                  → routeAesthetic（走廊粗筛 + 锚点×曲率枚举）
 *   最后 applyLineJumps（跨边跳线，O(E²×P²) broad-phase 版）
 * 输出 E ∈ {1,10,50,100} × 障碍 ∈ {1K,10K} 的 median of 5：
 *   routeTotalMs  — 整表重算总耗时（loop + jumps；G-P5 判定 G-P6 的口径）
 *   perEdgeMs     — loop 部分 / E（逐边成本）
 *   jumpsMs       — applyLineJumps 单独计时（本批不优化，仅观察）
 *   routeIndexMs  — 预留列（G-P3b 索引粗筛若做，在此记录对照）
 *
 * 口径说明：不含真机 DOM/React 渲染成本；node 纯计算。25 节点 demo 规模下
 * 单次重算 < 1ms（不可观测）——风险在规模，本脚本即量规模。
 *
 * 用法（先 `node node_modules/.pnpm/typescript@5.9.3/node_modules/typescript/bin/tsc
 *   -p packages/react/tsconfig.build.json` 重建 dist）：
 *   node scripts/bench-freeedge.mjs
 */
import { edgeResolverOf, freeEdgeEndpoints } from '../packages/react/dist/render/freeEdges.js'
import { buildObstacleTable } from '../packages/react/dist/render/obstacleTable.js'
import { routeAesthetic, applyLineJumps } from '../packages/react/dist/render/edgeRouting.js'

/** --legacy：旧管线（每端点 collapsedAncestors DFS + 每边 filter+map）；缺省 = 现行管线（G-P3 后） */
const LEGACY = process.argv.includes('--legacy')

const REPEAT = 5
const EDGE_COUNTS = [1, 10, 50, 100]
const OBSTACLE_COUNTS = [1000, 10000]
/** demo 规模（25 节点 / 2 边）：对照「不可观测」口径——单次重算 < 1ms */
const DEMO = { obstacles: 25, edges: 2 }

/** 确定性伪随机（mulberry32）：同一 seed 全量可复现 */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 构造 n 节点内容树（4 叉；shape 与 freeEdgeEndpoints 的 collapsedAncestors 遍历同构） */
function buildTree(n) {
  const mk = (id) => ({ id, type: 'text', text: 't' + id, children: [] })
  const root = mk(0)
  const nodes = [root]
  for (let i = 1; i < n; i++) {
    const parent = nodes[Math.floor((i - 1) / 4)]
    const node = mk(i)
    parent.children.push(node)
    nodes.push(node)
  }
  return { root, nodes }
}

/** 网格盒（世界坐标）：列宽 160 / 行高 56，抖动 ±16（确定性 seed） */
function gridBox(i, cols, rnd) {
  const col = i % cols
  const row = Math.floor(i / cols)
  return {
    x: col * 160 + (rnd() - 0.5) * 32,
    y: row * 56 + (rnd() - 0.5) * 16,
    w: 96 + rnd() * 40,
    h: 28 + rnd() * 8,
  }
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 一个组合的一次整表重算计时。
 *  G-P3 注：现行管线中解析器/预构建表为独立 useMemo（随 root/boxOf/obstacles 变化摊销，
 *  不进「edges 变化」触发的路由重算），故其构建计在计时外——计时 = 每边循环
 *  （与生产 FreeEdgeLayer 的 routes useMemo 内层同构）。 */
function runOnce(scene) {
  const { root, edges, obstacles, boxOf, collapsed } = scene
  const resolver = LEGACY ? undefined : edgeResolverOf(root, collapsed, boxOf)
  const table = LEGACY ? null : buildObstacleTable(obstacles)
  const routedPolylines = []
  const m = new Map()
  const t0 = performance.now()
  for (const e of edges) {
    const eps = freeEdgeEndpoints(e, boxOf, root, collapsed, resolver)
    if (!eps.renderable) continue
    const obs = table
      ? (table.near(eps.from, eps.to, eps.fromId, eps.toId) ?? table.without(eps.fromId, eps.toId))
      : obstacles.filter((o) => o.id !== eps.fromId && o.id !== eps.toId).map((o) => o.box)
    const route = routeAesthetic(eps.from, eps.to, obs, routedPolylines, {})
    m.set(e.key, { eps, route })
    if (route.points.length >= 2) routedPolylines.push([...route.points])
  }
  const t1 = performance.now()
  applyLineJumps(m)
  const t2 = performance.now()
  return { loopMs: t1 - t0, jumpsMs: t2 - t1 }
}

/** 构造一个 (障碍数, 边数) 场景 */
function buildScene(nObstacles, nEdges) {
  const rnd = mulberry32(0xc0ffee + nObstacles)
  const { root, nodes } = buildTree(nObstacles)
  const cols = Math.ceil(Math.sqrt(nObstacles))
  const boxes = new Map()
  const obstacles = []
  for (let i = 0; i < nObstacles; i++) {
    const box = gridBox(i, cols, rnd)
    boxes.set('n' + i, box)
    obstacles.push({ id: 'n' + i, box })
  }
  const edges = []
  for (let k = 0; k < nEdges; k++) {
    const a = (k * 7919 + 17) % nObstacles
    const b = (a + Math.floor(nObstacles / 3) + k * 31) % nObstacles
    if (a === b) continue
    edges.push({
      key: 'e' + k,
      sourceId: 'n' + a,
      targetId: 'n' + b,
      dir: 'fwd',
    })
  }
  return {
    root,
    edges,
    obstacles,
    collapsed: new Set(),
    boxOf: (id) => boxes.get(id),
  }
}

console.log(
  '# bench-freeedge —— 自由边路由「单次全量重算」规模基线（median of ' +
    REPEAT +
    '；node 纯计算；pipeline=' +
    (LEGACY ? 'legacy' : 'current') +
    '）',
)
console.log('obstacles,E,routeTotalMs,perEdgeMs,jumpsMs,routeIndexMs')
const combos = [[DEMO.obstacles, DEMO.edges]]
for (const n of OBSTACLE_COUNTS) {
  for (const e of EDGE_COUNTS) combos.push([n, e])
}
for (const [n, e] of combos) {
  const scene = buildScene(n, e)
  runOnce(scene) // 预热（JIT；不计入）
  const loop = []
  const jumps = []
  for (let i = 0; i < REPEAT; i++) {
    const r = runOnce(scene)
    loop.push(r.loopMs)
    jumps.push(r.jumpsMs)
  }
  const loopMs = median(loop)
  const jumpsMs = median(jumps)
  const total = loopMs + jumpsMs
  console.log([n, e, total.toFixed(2), (loopMs / e).toFixed(3), jumpsMs.toFixed(2), '-'].join(','))
}
