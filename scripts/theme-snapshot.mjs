/**
 * 三主题 SVG 快照脚本（T6 交付）：gateway.mm.md → 各主题 SVG 视觉基线存档。
 * 用法：node scripts/theme-snapshot.mjs
 * 产物：docs/preview/themes/{classic,sticker,glass}.svg
 *
 * 与 React 组件同源：直接消费 react dist 的 theme tokens + render geometry
 * （nodeCardStyle / buildLinkPath / computeBranchIndex）——快照即渲染层拍摄，
 * 非重复实现的另一套样式。视觉 spec = mindmap-design-styles-report.html 内联 SVG。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import {
  parseMm,
  astToEditable,
  layoutMindmap,
  defaultMeasure,
  displayMetrics,
  defaultCharMeasure,
} from '../packages/kernel/dist/index.js'
import { buildEntities } from '../packages/react/dist/demo/pipeline.js'
import { computeBranchIndex, nodeCardStyle, buildLinkPath } from '../packages/react/dist/render/geometry.js'
import { classicToken, stickerToken, glassToken } from '../packages/react/dist/theme/tokens.js'

/** gateway 实体标题表（与 apps/canvas/MindmapStage 一致；缺口 → unresolved） */
const GATEWAY_TITLES = {
  'doc:docs/01-architecture.md': { title: '01 · 架构设计', status: 'published' },
  'doc:docs/07-entity-ref-protocol.md': { title: '07 · 实体引用协议', status: 'published' },
  'doc:docs/09-knowledge-canvas-and-conventions.md': { title: '09 · 知识画布与约定', status: 'published' },
  'issue:1': { title: '门户显示优化', status: 'open' },
  'issue:6': { title: '解析链路验证', status: 'open' },
  'issue:8': { title: 'K3 渲染层', status: 'open' },
  'milestone:门户显示优化': { title: '门户显示优化里程碑', status: 'open' },
  'idea:forge-inbox:2': { title: '灵感：只读先行', status: 'open' },
}

const canvas = 'gateway'
const src = readFileSync(new URL(`../packages/kernel/tests/fixtures/${canvas}.mm.md`, import.meta.url), 'utf8')
const parsed = parseMm(src)
if (!parsed.root) throw new Error('解析失败：无根节点')
const editable = astToEditable(parsed.root)
const layout = layoutMindmap(editable, defaultMeasure, new Set())

const entities = buildEntities(parsed.refs, GATEWAY_TITLES)
const bi = computeBranchIndex(layout.nodes)
const metricsOf = (node) => displayMetrics(node, entities, defaultCharMeasure)

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const b = layout.bounds
const pad = 60
const outDir = new URL(`../docs/preview/themes/`, import.meta.url)
mkdirSync(outDir, { recursive: true })

for (const [themeId, token] of [
  ['classic', classicToken],
  ['sticker', stickerToken],
  ['glass', glassToken],
]) {
  const parts = []
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}" font-family="${token.font.family}">`,
    `<rect x="${b.minX - pad}" y="${b.minY - pad}" width="${b.maxX - b.minX + pad * 2}" height="${b.maxY - b.minY + pad * 2}" fill="${token.color.canvas}"/>`,
  )

  // 连线（与 LinkG 同源：buildLinkPath）
  for (const l of layout.links) {
    const fromBox = layout.nodes.find((n) => n.node.id === l.fromId)?.box
    const toBox = layout.nodes.find((n) => n.node.id === l.toId)?.box
    if (!fromBox || !toBox) continue
    const palette = token.color.branches[bi.get(l.toId) ?? 0]
    const p = buildLinkPath(token, fromBox, toBox, palette)
    parts.push(`<path d="${p.d}" fill="none" stroke="${p.stroke}" stroke-width="${p.width}" stroke-linecap="round"/>`)
  }

  // 节点（与 NodeG 同源：nodeCardStyle + displayMetrics 排版）
  for (const ln of layout.nodes) {
    const b = ln.box
    const m = metricsOf(ln.node)
    const palette = token.color.branches[bi.get(ln.node.id) ?? 0] ?? token.color.branches[0]
    const entityKind = ln.node.type === 'entity' ? (ln.node.ref?.kind ?? null) : null
    const style = nodeCardStyle(token, palette, ln.depth >= 2 ? 'leaf' : 'branch', entityKind)
    const shadow = style.filter !== 'none' ? ` style="filter:${style.filter}"` : ''
    const fontSize = ln.depth >= 2 ? token.font.sizeLeaf : token.font.size
    const fontWeight = ln.depth === 0 ? token.font.weightRoot : token.font.weight
    const LINE_H = 16
    const textTop = (b.h - m.lines.length * LINE_H) / 2
    parts.push(
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${style.radius}" fill="${style.fill}" stroke="${style.stroke}" stroke-width="${style.strokeWidth}" stroke-linejoin="round"${shadow}/>`,
    )
    if (m.kindLabel !== null) {
      parts.push(
        `<text x="${b.x + 12}" y="${b.y + textTop + LINE_H / 2}" font-size="${fontSize}" font-weight="${token.font.weightRoot}" fill="${m.kindColor}" dominant-baseline="central">${esc(m.kindLabel)}</text>`,
      )
    }
    m.lines.forEach((line, i) => {
      parts.push(
        `<text x="${b.x + m.contentX}" y="${b.y + textTop + i * LINE_H + LINE_H / 2}" font-size="${fontSize}" font-weight="${fontWeight}" fill="${style.text}" dominant-baseline="central">${esc(line)}</text>`,
      )
    })
    if (m.hasNote) {
      parts.push(`<circle cx="${b.x + b.w - 12}" cy="${b.y + b.h - 12}" r="2.5" fill="${token.color.accent ?? token.color.textMuted}" opacity="0.85"/>`)
    }
    if (m.warn) {
      parts.push(`<circle cx="${b.x + b.w - 12}" cy="${b.y + 12}" r="3.5" fill="none" stroke="${token.color.warn}" stroke-width="1.4" opacity="0.9"/>`)
    }
  }

  parts.push('</svg>')
  const outFile = new URL(`./${themeId}.svg`, outDir)
  writeFileSync(outFile, parts.join('\n'))
  console.log(`[snapshot] ${themeId}: ${layout.nodes.length} 节点 / ${layout.links.length} 连线 → ${outFile.pathname.replace(/\//g, '\\')}`)
}