/**
 * A6 验收性能采样（layout-islands）：同机器、同文档，baseline（单树自动布局）vs
 * candidate（中心岛 layoutForest + 跨岛边界边 + detached 切断岛）各重复采样取中位数。
 *
 * 指标分布（plan A6：布局/路由/提交/绘制）：
 *   layoutBaselineMs — baseline 全量布局（layoutMindmap，无缓存）
 *   layoutIslandsMs  — candidate 全量布局（layoutForest 多岛合并，森林路径无缓存）
 *   projectionMs     — 岛投影 + 边界边过滤（buildIslandView，candidate 每渲染新增成本）
 *   boundaryPathMs   — 跨岛边界边 path 构建（buildLinkPath × N，渲染/导出共享）
 *   commitCutMs      — 切断事务（planCutTreeEdge + applyTransaction，原子提交全成本）
 *   drawCullMs       — 可见集过滤（fit 最坏情形，与 T8 renderBody 同价）
 *   drawLinksMs      — 全量连线 path 构建（渲染侧同价）
 *
 * 用法：pnpm -r build 后 `node scripts/bench-islands-a6.mjs`
 */
import {
  astToEditable,
  isBoxInView,
  LayoutCache,
  layoutMindmap,
  makeTextNode,
  OpHistory,
} from '../packages/kernel/dist/index.js'
import { buildIslandView, layoutDemo } from '../packages/react/dist/demo/pipeline.js'
import { collectCenters, upsertCenter } from '../packages/react/dist/render/centers.js'
import { planCutTreeEdge } from '../packages/react/dist/edit/cutAttach.js'
import { buildLinkPath } from '../packages/react/dist/render/geometry.js'
import { glassToken } from '../packages/react/dist/theme/tokens.js'

const measure = (n) => ({ w: 40 + (n.text ? n.text.length : 0) * 6, h: 30 })
const char = () => 6
const entities = new Map()
const collapsed = new Set()

/** 3 叉深度 6 文档（≈1093 节点）：升格 3 中心（其一 parent_link:show）+ 切断 1 深层分支 */
function buildDoc() {
  let seq = 0
  const mk = (d, text) => {
    const node = { id: '', type: 'text', text: text ?? 'n' + seq, children: [] }
    seq += 1
    if (d < 6) for (let i = 0; i < 3; i++) node.children.push(mk(d + 1))
    return node
  }
  const md = mk(0, '根')
  md.children[0].children[0].children[0].children.push(mk(5, '切我'))
  return astToEditable(md)
}

/** 候选文档：3 中心 + 真实切断（planCutTreeEdge 事务提交）→ detached 岛 */
function buildCandidateDoc() {
  const root = buildDoc()
  const find = (r, text) => {
    if (r.text === text) return r
    for (const c of r.children) {
      const hit = find(c, text)
      if (hit) return hit
    }
    return null
  }
  // 升格：两个分支（带坐标）+ 一个二级节点（parent_link: show → 产生边界边）
  //（DFS 先序编号：一级分支为 n1/n123/n244；n1 的孩子为 n2/n123/n244 逐子树展开）
  // upsertCenter 是纯函数——必须把返回值赋回 root.note
  root.note = upsertCenter(root.note, 'node:根/n1', { dir: 'right', x: 300, y: 0 })
  root.note = upsertCenter(root.note, 'node:根/n123', { dir: 'left', x: -300, y: 0 })
  root.note = upsertCenter(root.note, 'node:根/n1/n2', {
    dir: 'down',
    x: 300,
    y: 200,
    parentLink: 'show',
  })
  // 切断深层分支 → detached
  const cutTarget = find(root, '切我')
  const plan = planCutTreeEdge(root, cutTarget.id, { pos: { x: 600, y: 300 } })
  if (!plan.ok) throw new Error('fixture cut failed: ' + JSON.stringify(plan))
  const history = new OpHistory(root)
  const tx = history.applyTransaction(plan.ops)
  if (!tx.ok) throw new Error('fixture tx failed')
  return history.current
}

const median = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}
const timeN = (fn, n, setup) => {
  const out = []
  for (let i = 0; i < n; i++) {
    const arg = setup ? setup(i) : undefined
    const a = performance.now()
    fn(arg)
    out.push(performance.now() - a)
  }
  return out
}

const SAMPLES = 15
const baselineRoot = buildDoc()
const candidateRoot = buildCandidateDoc()
const count = (r) => {
  let c = 0
  const walk = (n) => {
    c += 1
    for (const ch of n.children) walk(ch)
  }
  walk(r)
  return c
}

// --- 布局（全量，无缓存，等价比较） ---
const baselineLayout = () => layoutMindmap(baselineRoot, measure, collapsed)
const islandView = buildIslandView(candidateRoot, collectCenters(candidateRoot))
const candidateLayout = () =>
  layoutDemo(candidateRoot, entities, char, collapsed, null, undefined, 'k', null, new Set(), islandView.specs).layout

const layoutBaselineMs = timeN(baselineLayout, SAMPLES)
const layoutIslandsMs = timeN(candidateLayout, SAMPLES)
const projectionMs = timeN(() => buildIslandView(candidateRoot, collectCenters(candidateRoot)), SAMPLES)

// --- 路由：跨岛边界边 path 构建（渲染 + 导出共享） ---
const candLayout = candidateLayout()
const boxes = new Map(candLayout.nodes.map((n) => [n.node.id, n.box]))
const boundaryLinks = islandView.boundaryLinks
const boundaryPathMs = timeN(() => {
  for (const l of boundaryLinks) {
    const f = boxes.get(l.fromId)
    const t = boxes.get(l.toId)
    if (f && t) buildLinkPath(glassToken, f, t)
  }
}, SAMPLES)

// --- 提交：切断事务全成本（每次 fresh doc） ---
const commitCutMs = timeN(
  (doc) => {
    const target = (() => {
      let found = null
      const walk = (n) => {
        if (n.text === '切我') found = n
        for (const c of n.children) walk(c)
      }
      walk(doc)
      return found
    })()
    const plan = planCutTreeEdge(doc, target.id, { pos: { x: 600, y: 300 } })
    if (!plan.ok) throw new Error('cut failed')
    new OpHistory(doc).applyTransaction(plan.ops)
  },
  SAMPLES,
  () => buildDoc(),
)

// --- 绘制：fit 最坏情形 cull + 全量连线构建（T8 renderBody 同价） ---
const b = candLayout.bounds
const view = { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }
const drawCullMs = timeN(() => candLayout.nodes.filter((n) => isBoxInView(n.box, view, 0)), SAMPLES)
const drawLinksMs = timeN(() => {
  for (const l of candLayout.links) {
    const f = boxes.get(l.fromId)
    const t = boxes.get(l.toId)
    if (f && t) buildLinkPath(glassToken, f, t)
  }
}, SAMPLES)

console.log('A6 layout-islands 性能采样（同机同文档，15 次取中位，ms）')
console.log('文档节点数:', count(baselineRoot), '（候选含 detached 岛同源）')
console.log('中心数:', collectCenters(candidateRoot).length, ' 边界边（parent_link:show）:', boundaryLinks.length)
console.log('')
console.log('指标,baseline,candidate')
console.log('布局 layoutMs,' + median(layoutBaselineMs).toFixed(1) + ',' + median(layoutIslandsMs).toFixed(1))
console.log('投影+路由 projectionMs,-,' + median(projectionMs).toFixed(2))
console.log('边界边 path boundaryPathMs,-,' + median(boundaryPathMs).toFixed(2) + '（×' + boundaryLinks.length + ' 条）')
console.log('切断事务 commitCutMs,-,' + median(commitCutMs).toFixed(2))
console.log('绘制 cull drawCullMs,' + '-', median(drawCullMs).toFixed(2))
console.log('绘制 links drawLinksMs,-,' + median(drawLinksMs).toFixed(2))
console.log('')
const ratio = median(layoutIslandsMs) / median(layoutBaselineMs)
console.log('candidate/baseline 布局比: ' + ratio.toFixed(2) + 'x')
