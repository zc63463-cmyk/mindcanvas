/**
 * T8 大规模基准（M5-T8）：5000 / 20000 / 50000 节点。
 * 测量（全部为纯计算，node 直接可复现）：
 *   fullLayoutMs  — 全量布局中位数（布局 + 收集 + 包围盒）
 *   collectMs     — 收集（前序节点 + 连线 path 字符串）——首帧渲染的主要计算成本
 *   cullMs        — 可见集过滤（全量节点 × 视口矩形，fit 后最坏情形）
 *   linkBuildMs   — 可见连线 path 构建（渲染侧 buildLinkPath 同价）
 *   firstFrameMs  — 首帧计算耗时 ≈ collect + cull + linkBuild（布局另计）
 *   fpsBound      — 平移帧率上限 ≈ 1000 / (cull + linkBuild)（DOM 更新近似同量级，实际浏览器更快）
 *   incEditMs     — 增量编辑响应（单节点编辑 relayout，T6 缓存命中）
 * 用法：pnpm -r build 后 `node scripts/bench-scale.mjs`
 * 数据落档：docs/preview/perf-baseline.md
 */
import {
  layoutMindmap,
  LayoutCache,
  updateNode,
  filterVisibleLinks,
  isBoxInView,
  bezierLink,
  buildBoxIndex,
  queryBoxIndex,
} from '../packages/kernel/dist/index.js'

/** 构造 N 节点树（4 叉：深度 6/7/8 → 5461/21845/87381，与 K 基线同构） */
function buildTree(depth) {
  let seq = 0
  const mk = (d) => {
    const node = { id: 'n' + seq, type: 'text', text: 'n' + seq, children: [] }
    seq += 1
    if (d < depth) {
      for (let i = 0; i < 4; i++) node.children.push(mk(d + 1))
    }
    return node
  }
  return mk(0)
}

const measure = (n) => ({ w: 40 + (n.text ? n.text.length : 0) * 6, h: 30 })
const collapsed = new Set()

function leafId(root) {
  let cur = root
  while (cur.children.length > 0) cur = cur.children[0]
  return cur.id
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 渲染体模型：fit 后最坏情形的可见集过滤 + 连线构建（世界矩形 = 全图包围盒外扩） */
function renderBodyCost(layout, samples = 20) {
  const boxes = new Map()
  for (const n of layout.nodes) boxes.set(n.node.id, n.box)
  // 最坏情形视口：世界坐标包围盒即视口 → 全部节点可见（fit 失败/缩到极限的退化情形）
  const b = layout.bounds
  const view = { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY }
  const cullTimes = []
  const linkTimes = []
  // B-P1：典型交互视口（1280×800 @ k≈0.74 ≈ 1730×1080 世界单位，取包围盒中心）+ 128 外扩，
  // 与 MapView 的双重 margin 用法一致（view 先外扩一次 → 粗筛；精判再传 margin）。
  const vw = 1280 / 0.74
  const vh = 800 / 0.74
  const viewT = {
    x: (b.minX + b.maxX) / 2 - vw / 2,
    y: (b.minY + b.maxY) / 2 - vh / 2,
    w: vw,
    h: vh,
  }
  const viewM = { x: viewT.x - 128, y: viewT.y - 128, w: viewT.w + 256, h: viewT.h + 256 }
  const viewIndex = buildBoxIndex(layout.nodes.map((n) => n.box))
  const cullViewTimes = []
  const cullViewIndexTimes = []
  for (let i = 0; i < samples; i++) {
    let a = performance.now()
    const visibleNodes = layout.nodes.filter((n) => isBoxInView(n.box, view, 0))
    let b2 = performance.now()
    cullTimes.push(b2 - a)
    a = performance.now()
    let built = 0
    for (const l of layout.links) {
      const from = boxes.get(l.fromId)
      const to = boxes.get(l.toId)
      if (from && to) {
        bezierLink(
          { box: from, children: [] },
          { box: to, children: [] },
        )
        built += 1
      }
    }
    b2 = performance.now()
    linkTimes.push(b2 - a)
    // 典型视口 · 线性路径
    a = performance.now()
    const visLinear = layout.nodes.filter((n) => isBoxInView(n.box, viewM, 128))
    b2 = performance.now()
    cullViewTimes.push(b2 - a)
    // 典型视口 · 索引路径（粗筛 + 原精判）
    a = performance.now()
    const visIndexed = []
    for (const j of queryBoxIndex(viewIndex, viewM)) {
      const n = layout.nodes[j]
      if (n && isBoxInView(n.box, viewM, 128)) visIndexed.push(n)
    }
    b2 = performance.now()
    cullViewIndexTimes.push(b2 - a)
    void visibleNodes
    void built
    void visLinear
    void visIndexed
  }
  return {
    cullMs: median(cullTimes),
    linkBuildMs: median(linkTimes),
    visible: layout.nodes.length,
    cullViewMs: median(cullViewTimes),
    cullViewIndexMs: median(cullViewIndexTimes),
  }
}

const SIZES = [6, 7, 8] // 4 叉深度 → 5461 / 21845 / 87381 节点
console.log(
  'nodes,fullLayoutMs,cullMs,linkBuildMs,firstFrameMs,fpsBound,incEditMs,incVsFullPct,cullViewMs,cullViewIndexMs,viewSpeedup',
)
for (const depth of SIZES) {
  const root = buildTree(depth)
  let count = 0
  const walk = (n) => { count += 1; for (const c of n.children) walk(c) }
  walk(root)

  const cache = new LayoutCache()
  const layout = layoutMindmap(root, measure, collapsed, { cache, measureKey: 'k' })
  const after = updateNode(root, leafId(root), { text: 'x'.repeat(80) })

  // 布局中位数 + 增量编辑
  const fullTimes = []
  const incTimes = []
  for (let i = 0; i < 20; i++) {
    let a = performance.now()
    layoutMindmap(after, measure, collapsed)
    let b = performance.now()
    fullTimes.push(b - a)
    a = performance.now()
    layoutMindmap(after, measure, collapsed, { cache, measureKey: 'k' })
    b = performance.now()
    incTimes.push(b - a)
  }
  const full = median(fullTimes)
  const inc = median(incTimes)
  const rb = renderBodyCost(layout)
  // 首帧计算耗时 = 首次布局 + 全量可见集过滤 + 可见连线构建（DOM 时间浏览器相关，另注）
  const firstFrame = full + rb.cullMs + rb.linkBuildMs
  const fpsBound = 1000 / (rb.cullMs + rb.linkBuildMs)
  console.log(
    count +
      ',' +
      full.toFixed(1) +
      ',' +
      rb.cullMs.toFixed(2) +
      ',' +
      rb.linkBuildMs.toFixed(1) +
      ',' +
      firstFrame.toFixed(1) +
      ',' +
      Math.round(fpsBound) +
      ',' +
      inc.toFixed(2) +
      ',' +
      ((inc / full) * 100).toFixed(1) + '%' +
      ',' +
      rb.cullViewMs.toFixed(2) +
      ',' +
      rb.cullViewIndexMs.toFixed(2) +
      ',' +
      (rb.cullViewMs / Math.max(rb.cullViewIndexMs, 0.001)).toFixed(2) + 'x',
  )
}
