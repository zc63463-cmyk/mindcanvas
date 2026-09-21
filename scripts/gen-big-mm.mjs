/**
 * GH-T5：生成 10K 节点 .mm 文件（真实大图验收用）。
 * 3 叉树深度 8 → 9841 节点（与 M5/T8 基准同构）。
 * 用法：node scripts/gen-big-mm.mjs
 * 产出：bench-assets/big-10k.mm.md（浏览器 Ctrl+O 打开验收）
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEPTH = 8
const lines = ['# 10K 节点验收图', '']
let seq = 0
const walk = (depth, indent) => {
  if (depth >= DEPTH) return
  for (let i = 0; i < 3; i++) {
    const id = `n${seq++}`
    lines.push(`${indent}- ${id}（第 ${depth + 1} 层 / 分支 ${i + 1}）`)
    walk(depth + 1, indent + '  ')
  }
}
walk(0, '')
// 附实体引用样例（关系面板联动验收）
lines.push('', '## 实体引用样例', '- @issue:1', '- @doc:docs/01-architecture.md', '- @img:demo-assets/demo-diagram.svg')

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'bench-assets')
mkdirSync(root, { recursive: true })
const out = join(root, 'big-10k.mm.md')
writeFileSync(out, lines.join('\n'), 'utf8')
console.log(`written: ${out} (${seq} nodes, ${lines.length} lines)`)
