/**
 * B0 · 提示词准备脚本（T3 的 prompt 组装部分）
 *
 * 作用：读一张 .mm.md 画布 → 用内核公开 API 提取全部节点路径与其内容指纹 →
 * 与 `prompts/analyze-outbound.md` 模板拼装 → 输出可直接复制给任意 LLM 的完整 prompt。
 *
 * 设计要点：
 * - LLM 无法计算 sha256，故指纹由本脚本预计算并作为「可用节点清单」附进 prompt，
 *   LLM 只能从清单中挑选引用 —— 既满足契约要求，又天然防「凭空构造节点」的幻觉。
 * - 指纹规则与 B1/B2 的锚定校验必须一致：sha256(path + "\n" + text)，取前 16 位十六进制。
 *
 * 用法：
 *   node scripts/b0-prepare.mjs gateway
 *   node scripts/b0-prepare.mjs gateway ideas-pool roadmap
 * 输出：llm/out/<画布名>.prompt.md
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// 注意：scripts/ 不在 workspace 包内，无法用包名解析；直接指向 kernel 构建产物。
// llm/ 与 scripts/ 迁入 forgejo-bridge 独立仓库后，改为依赖发布版本（import '@mindcanvas/kernel'）。
import { parseMm, astToEditable } from '../packages/kernel/dist/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(root, 'packages/kernel/tests/fixtures')
const OUT_DIR = join(root, 'llm/out')
const TEMPLATE = join(root, 'llm/prompts/analyze-outbound.md')

/** 内容指纹：sha256(path + "\n" + text) 取前 16 位（与 B1/B2 锚定校验同源） */
function textHash(path, text) {
  return createHash('sha256').update(`${path}\n${text ?? ''}`).digest('hex').slice(0, 16)
}

/** 深度优先收集全部节点的路径与指纹 */
function collectNodes(node, parentPath, out) {
  const label = node.text ?? (node.ref ? `${node.ref.kind}:${node.ref.id}` : '')
  const path = parentPath ? `${parentPath}/${label}` : label
  out.push({ path, hash: textHash(path, node.text ?? '') })
  for (const child of node.children ?? []) collectNodes(child, path, out)
  return out
}

function prepare(name) {
  const src = readFileSync(join(FIXTURES, `${name}.mm.md`), 'utf8')
  const parsed = parseMm(src)
  const editable = astToEditable(parsed.root)
  const nodes = collectNodes(editable, '', [])

  const list = nodes.map((n) => `- \`${n.path}\`  指纹 \`${n.hash}\``).join('\n')
  const tpl = readFileSync(TEMPLATE, 'utf8')
  const prompt = tpl
    .replace('{{NODE_LIST}}', list)
    .replace('{{CANVAS_TEXT}}', src.replace(/\s+$/, ''))
    .replaceAll('{{CANVAS_NAME}}', name)

  mkdirSync(OUT_DIR, { recursive: true })
  const dest = join(OUT_DIR, `${name}.prompt.md`)
  writeFileSync(dest, prompt, 'utf8')
  const e = parsed.diagnostics.filter((d) => d.level === 'error').length
  console.log(`✓ ${name}: ${nodes.length} 节点, 诊断 E 级 ${e} → ${dest}`)
  return nodes.length
}

const names = process.argv.slice(2)
if (names.length === 0) {
  console.log('用法: node scripts/b0-prepare.mjs <画布名...>   （如 gateway ideas-pool roadmap）')
  process.exit(1)
}
for (const n of names) prepare(n)
