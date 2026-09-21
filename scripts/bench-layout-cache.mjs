/**
 * F4：森林布局缓存基准（C5 取证批收口脚本）。
 * ══════════════════════════════════════════════════════════════════════
 * 两个口径：
 *   ① C5 矩阵复测（**全量路径**——「改前」口径，与 634ef9b 直比）：
 *      单树 vs 森林（多中心）×规模/中心数。
 *   ② 编辑型对照（「改后」主战场，§1.3 四行场景 + 森林版）：
 *      反复编辑一个深层叶子——无缓存（每次全量）vs 有缓存（F 批增量）。
 *      森林场景每轮在计时外重建投影（buildIslandView），只计 layoutDemo——
 *      与 C5 的 forestMs 口径一致。
 *
 * 目标线（F-A7）：编辑类操作 22–33ms → <16ms（岛级）→ 争取 <5ms（岛内）。
 *
 * 用法：先 `pnpm -r build`（或分别重建 kernel/react dist），再
 *   node scripts/bench-layout-cache.mjs
 */
import { astToEditable, layoutMindmap, LayoutCache, updateNode } from '../packages/kernel/dist/index.js'
import { buildIslandView, layoutDemo } from '../packages/react/dist/demo/pipeline.js'
import { collectCenters, upsertCenter } from '../packages/react/dist/render/centers.js'
import { anchorOfNode } from '../packages/react/dist/render/freeEdges.js'

const measure = (n) => ({ w: 40 + (n.text ? n.text.length : 0) * 6, h: 30 })
const char = () => 6
const entities = new Map()
const collapsed = new Set()
const SAMPLES = 15
const KEY = 'bench-cache-v1'

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

/** BFS 收集前 k 个后代作为中心（一级分支优先；k=8 时含嵌套升格——与 C5 一致） */
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

const countNodes = (r) => {
  let c = 0
  const walk = (n) => {
    c += 1
    for (const ch of n.children) walk(ch)
  }
  walk(r)
  return c
}

/** 沿 children[0] 链取最深层叶子（编辑点） */
const deepLeaf = (n) => {
  let cur = n
  while (cur.children.length > 0) cur = cur.children[0]
  return cur
}

// ══════════════════════════════════════════════════════════════════
// ① C5 矩阵复测（全量路径——「改前」口径，与 634ef9b 直比）
// ══════════════════════════════════════════════════════════════════
console.log('### ① C5 森林布局耗时矩阵复测（全量路径；同机 15 次取中位）')
console.log('规模,节点数,中心数,单树ms,森林ms,比值,>1.5x,>16ms')
const SIZES = [
  ['N≈384', 5],
  ['N≈1000', 6],
  ['N≈3000', 7],
]
const KS = [0, 1, 3, 8]
const matrixRows = []
for (const [label, depth] of SIZES) {
  const base = buildTree(depth)
  const n = countNodes(base)
  const singleOut = []
  for (let i = 0; i < SAMPLES; i++) {
    const a = performance.now()
    layoutMindmap(base, measure, collapsed)
    singleOut.push(performance.now() - a)
  }
  const singleMs = median(singleOut)
  for (const k of KS) {
    const doc = withCenters(buildTree(depth), k)
    const iv = buildIslandView(doc, collectCenters(doc))
    const forestOut = []
    for (let i = 0; i < SAMPLES; i++) {
      const a = performance.now()
      layoutDemo(doc, entities, char, collapsed, null, undefined, KEY, null, new Set(), iv.specs)
      forestOut.push(performance.now() - a)
    }
    const forestMs = median(forestOut)
    const ratio = forestMs / singleMs
    matrixRows.push({ label, n, k, singleMs, forestMs, ratio })
    console.log(
      `${label},${n},${k},${singleMs.toFixed(1)},${forestMs.toFixed(1)},${ratio.toFixed(2)}x,${
        ratio > 1.5 ? 'Y' : '-'
      },${forestMs > 16 ? 'Y' : '-'}`,
    )
  }
}
const hit = matrixRows.filter((r) => r.ratio > 1.5 && r.forestMs > 16)
console.log(`触发条款（>1.5× 且 >16ms）命中格数: ${hit.length}（与 634ef9b 复核口径一致）`)

// ══════════════════════════════════════════════════════════════════
// ② 编辑型对照（「改后」主战场）
// ══════════════════════════════════════════════════════════════════

/** 单树：反复编辑深层叶子（text 交替，保证每次真改） */
function singleEdit(useCache) {
  let root = buildTree(7)
  const leafId = deepLeaf(root).id
  const cache = useCache ? new LayoutCache() : undefined
  const opts = cache ? { cache, measureKey: KEY } : undefined
  layoutMindmap(root, measure, collapsed, opts) // 预热（填缓存 / JIT）
  const out = []
  let flip = false
  for (let i = 0; i < SAMPLES; i++) {
    flip = !flip
    root = updateNode(root, leafId, { text: flip ? 'changed-1' : 'changed-2' })
    const a = performance.now()
    layoutMindmap(root, measure, collapsed, opts)
    out.push(performance.now() - a)
  }
  return median(out)
}

/** 森林：反复编辑「第 1 个中心」岛内的深层叶子（投影重建在计时外） */
function forestEdit(k, useCache, mutate) {
  let doc = withCenters(buildTree(7), k)
  const island = pickCenters(doc, k)[0]
  if (!island) throw new Error('no island')
  const leafId = deepLeaf(island).id
  const cache = useCache ? new LayoutCache() : undefined
  {
    const iv = buildIslandView(doc, collectCenters(doc))
    layoutDemo(doc, entities, char, collapsed, null, cache, KEY, null, new Set(), iv.specs) // 预热
  }
  const out = []
  let flip = false
  for (let i = 0; i < SAMPLES; i++) {
    flip = !flip
    if (mutate) doc = updateNode(doc, leafId, { text: flip ? 'changed-1' : 'changed-2' })
    const iv = buildIslandView(doc, collectCenters(doc))
    const a = performance.now()
    layoutDemo(doc, entities, char, collapsed, null, cache, KEY, null, new Set(), iv.specs)
    out.push(performance.now() - a)
  }
  return median(out)
}

console.log('')
console.log('### ② 编辑型对照（每次编辑一个深层叶子；同机 15 次取中位）')
console.log('场景,无缓存 ms,有缓存 ms,增益')
const rows = []
{
  const no = singleEdit(false)
  const yes = singleEdit(true)
  rows.push(['单树 N=3280·编辑深层叶子', no, yes])
}
for (const k of [1, 3]) {
  const no = forestEdit(k, false, true)
  const yes = forestEdit(k, true, true)
  rows.push([`森林 N≈3280 k=${k}·编辑大岛深层叶子`, no, yes])
}
{
  const no = forestEdit(1, false, false)
  const yes = forestEdit(1, true, false)
  rows.push(['森林 N≈3280 k=1·无改动复跑（纯命中）', no, yes])
}
for (const [label, no, yes] of rows) {
  console.log(`${label},${no.toFixed(2)},${yes.toFixed(2)},${(no / yes).toFixed(1)}x`)
}

console.log('')
console.log('目标线（F-A7）：编辑类操作 22–33ms → <16ms（岛级）→ 争取 <5ms（岛内）')
const worstEdit = rows[0]
if (worstEdit) {
  const [, no, yes] = worstEdit
  console.log(
    `编辑场景（${worstEdit[0]}）：无缓存 ${no.toFixed(2)}ms → 有缓存 ${yes.toFixed(2)}ms`,
  )
}
