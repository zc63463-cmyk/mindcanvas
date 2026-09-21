/**
 * 静态预览脚本（K2 交付即体验窗口）：kernel headless 布局 → SVG。
 * 用法：node scripts/preview.mjs [画布名]  （默认 gateway；可选 roadmap / ideas-pool）
 * 产物：docs/preview/<画布名>-preview.svg —— 浏览器直接打开。
 * 注：抛掷式原型，仅为「看到 → 反馈」循环；正式渲染层属 K3。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { parseMm } from '../packages/kernel/dist/index.js'
import { astToEditable, layoutMindmap, defaultMeasure } from '../packages/kernel/dist/index.js'

const canvas = process.argv[2] ?? 'gateway'
const src = readFileSync(new URL(`../packages/kernel/tests/fixtures/${canvas}.mm.md`, import.meta.url), 'utf8')

const parsed = parseMm(src)
if (!parsed.root) throw new Error('解析失败：无根节点')
const editable = astToEditable(parsed.root)
const layout = layoutMindmap(editable, defaultMeasure, new Set())

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const nodeLabel = (n) =>
  n.type === 'entity' && n.ref ? `@${n.ref.kind}:${n.ref.id}` : n.type === 'image' ? '[图]' : (n.text ?? '')

const fills = ['#d9d7ef', '#e4e2f4', '#eceaf8', '#f2f1fb']
const b = layout.bounds
const pad = 60
const parts = []
parts.push(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}" font-family="'Segoe UI', 'Microsoft YaHei', sans-serif">`,
  `<rect x="${b.minX - pad}" y="${b.minY - pad}" width="${b.maxX - b.minX + pad * 2}" height="${b.maxY - b.minY + pad * 2}" fill="#fafaf8"/>`,
)
for (const l of layout.links) {
  parts.push(`<path d="${l.path}" fill="none" stroke="#b4b2a9" stroke-width="1.2"/>`)
}
for (const ln of layout.nodes) {
  const { x, y, w, h } = ln.box
  const fill = fills[Math.min(ln.depth, fills.length - 1)]
  const label = esc(nodeLabel(ln.node))
  parts.push(
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${ln.depth === 0 ? '#534ab7' : '#c9c7e8'}" stroke-width="${ln.depth === 0 ? 1.5 : 0.8}"/>`,
    `<text x="${x + 8}" y="${y + h / 2}" dominant-baseline="central" font-size="13" fill="#26215c">${label}</text>`,
  )
}
parts.push('</svg>')

mkdirSync(new URL('../docs/preview/', import.meta.url), { recursive: true })
const out = new URL(`../docs/preview/${canvas}-preview.svg`, import.meta.url)
writeFileSync(out, parts.join('\n'))
console.log(`[preview] ${layout.nodes.length} 节点 / ${layout.links.length} 连线 → ${out.pathname.replace(/\//g, '\\')}`)
