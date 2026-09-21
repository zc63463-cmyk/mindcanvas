/**
 * C5：森林布局耗时矩阵（规模 × 中心数）——缓存批立项判定取证
 * ══════════════════════════════════════════════════════════════════════
 * 背景：森林路径（layoutForest 多岛）**不接管 LayoutCache**（islands.ts:18）；
 * A6 验收记「森林路径无缓存（已知取舍）」、P2「中心局部布局缓存」待实测收益。
 * 本脚本只测不实现：产出「布局耗时 vs 单树基线」表，按触发条款判定是否立项。
 *
 * 触发条款（计划 C-A6）：多中心布局耗时 > 单树 **1.5×** 且 > **16ms**（帧预算）
 * 才立项缓存批；否则记录数据、不立项。
 *
 * 用法：先 `pnpm -r build`（或分别重建 kernel/react dist），再
 *   node scripts/bench-islands-matrix.mjs
 */
import { astToEditable, layoutMindmap } from '../packages/kernel/dist/index.js'
import { buildIslandView, layoutDemo } from '../packages/react/dist/demo/pipeline.js'
import { collectCenters, upsertCenter } from '../packages/react/dist/render/centers.js'
import { anchorOfNode } from '../packages/react/dist/render/freeEdges.js'

const measure = (n) => ({ w: 40 + (n.text ? n.text.length : 0) * 6, h: 30 })
const char = () => 6
const entities = new Map()
const collapsed = new Set()
const SAMPLES = 15

/** 3 叉树：depth d → 节点数 (3^(d+1)−1)/2（d=5:364 / d=6:1093 / d=7:3280） */
function buildTree(depth) {
  let seq = 0
  const mk = (d) => {
    const node = { id: '', type: 'text', text: d === 0 ? '根' : 'n' + seq, children: [] }
    seq += 1
    if (d < depth) for (let i = 0; i < 3; i++) node.children.push(mk(d + 1))
    return node
  }
  return astToEditable(mk(0))
}

/** BFS 收集前 k 个后代作为中心（一级分支优先；k=8 时含嵌套升格——如实测） */
function pickCenters(root, k) {
  const out = []
  const q = [...root.children]
  while (q.length > 0 && out.length < k) {
    const n = q.shift()
    out.push(n)
    for (const c of n.children) q.push(c)
  }
  return out
}

/** 升格 k 个中心（坐标沿圆周散布，模拟真实「独立落位」形态） */
function withCenters(root, k) {
  if (k === 0) return root
  const picks = pickCenters(root, k)
  picks.forEach((node, i) => {
    const at = anchorOfNode(root, node.id)
    if (at === null) throw new Error('anchor failed: ' + node.text)
    const angle = (i / Math.max(k, 1)) * 2 * Math.PI
    root.note = upsertCenter(root.note, at, {
      dir: 'right',
      x: Math.round(700 * Math.cos(angle)),
      y: Math.round(500 * Math.sin(angle)),
    })
  })
  return root
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const timeN = (fn, n) => {
  const out = []
  for (let i = 0; i < n; i++) {
    const a = performance.now()
    fn()
    out.push(performance.now() - a)
  }
  return out
}

const countNodes = (r) => {
  let c = 0
  const walk = (n) => {
    c += 1
    for (const ch of n.children) walk(ch)
  }
  walk(r)
  return c
}

const SIZES = [
  ['N≈384', 5],
  ['N≈1000', 6],
  ['N≈3000', 7],
]
const KS = [0, 1, 3, 8]

console.log('C5 森林布局耗时矩阵（同机、15 次取中位；单树=layoutMindmap 全量 / 森林=layoutDemo+islandView.specs）')
console.log('规模,节点数,中心数,单树ms,森林ms,比值,>1.5x,>16ms')
const rows = []
for (const [label, depth] of SIZES) {
  const base = buildTree(depth)
  const n = countNodes(base)
  const singleMs = median(timeN(() => layoutMindmap(base, measure, collapsed), SAMPLES))
  for (const k of KS) {
    const doc = withCenters(buildTree(depth), k)
    const iv = buildIslandView(doc, collectCenters(doc))
    const forestMs = median(
      timeN(
        () =>
          layoutDemo(doc, entities, char, collapsed, null, undefined, 'k', null, new Set(), iv.specs)
            .layout,
        SAMPLES,
      ),
    )
    const ratio = forestMs / singleMs
    rows.push({ label, n, k, singleMs, forestMs, ratio })
    console.log(
      `${label},${n},${k},${singleMs.toFixed(1)},${forestMs.toFixed(1)},${ratio.toFixed(2)}x,${
        ratio > 1.5 ? 'Y' : '-'
      },${forestMs > 16 ? 'Y' : '-'}`,
    )
  }
}

console.log('')
const hit = rows.filter((r) => r.ratio > 1.5 && r.forestMs > 16)
console.log(`触发条款（>1.5× 且 >16ms）命中格数: ${hit.length}`)
if (hit.length > 0) {
  for (const r of hit) {
    console.log(
      `  → ${r.label} × ${r.k} 中心: ${r.forestMs.toFixed(1)}ms = 单树 ${r.singleMs.toFixed(1)}ms 的 ${r.ratio.toFixed(2)}x`,
    )
  }
  console.log('判定：立项缓存批（数据支持）。')
} else {
  const worst = rows.reduce((a, b) => (b.forestMs > a.forestMs ? b : a))
  console.log(
    `判定：不立项（最坏格 ${worst.label} × ${worst.k} 中心 = ${worst.forestMs.toFixed(1)}ms，` +
      `比值 ${worst.ratio.toFixed(2)}x，未同时越过 1.5× 与 16ms 双门槛）。`,
  )
}
