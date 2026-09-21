/**
 * B0 · 提议集校验器（T1 的 schema 校验部分）
 *
 * 用法：
 *   node scripts/b0-validate.mjs gateway llm/out/gateway.raw.md
 *   node scripts/b0-validate.mjs gateway llm/out/gateway.raw.md --json
 *
 * 行为：
 * - 从回复文本中剥离 markdown 代码栅栏后解析 JSON
 * - 输出 E（结构违规）/ W（内容告警）两级问题 + 硬指标汇总
 * - **不静默修复、不丢弃违规提议** —— 违规数据是本次测量的核心产出
 *
 * 分级定义：
 *   E = 结构违规：缺必填字段 / 枚举外取值 / JSON 解析失败 / 类型错误
 *   W = 内容告警：锚点路径不在该画布节点清单中（幻觉嫌疑）/ 指纹不匹配 / 对已落库实体重复 create_issue
 */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMm, astToEditable } from '../packages/kernel/dist/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FIXTURES = join(root, 'packages/kernel/tests/fixtures')

const ACTIONS = ['create_issue', 'create_milestone', 'add_comment', 'link_issues', 'skip']
const SEM_ROLES = ['task', 'question', 'risk', 'decision', 'context', 'idea']

// 内容指纹（与 b0-prepare.mjs / B1-B2 锚定校验同源）
const hashOf = (path, text) => createHash('sha256').update(`${path}\n${text ?? ''}`).digest('hex').slice(0, 16)

function collectNodes(node, parentPath, out) {
  const label = node.text ?? (node.ref ? `${node.ref.kind}:${node.ref.id}` : '')
  const path = parentPath ? `${parentPath}/${label}` : label
  out.push({ path, hash: hashOf(path, node.text ?? ''), isEntity: node.type === 'entity' })
  for (const c of node.children ?? []) collectNodes(c, path, out)
  return out
}

function stripFences(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (m ? m[1] : text).trim()
}

function validate(canvasName, rawText) {
  const src = readFileSync(join(FIXTURES, `${canvasName}.mm.md`), 'utf8')
  const nodes = collectNodes(astToEditable(parseMm(src).root), '', [])
  const byPath = new Map(nodes.map((n) => [n.path, n]))
  const errors = []
  const warnings = []

  let data
  try {
    data = JSON.parse(stripFences(rawText))
  } catch (e) {
    errors.push(`E: JSON 解析失败 — ${e.message}`)
    return { errors, warnings, stats: { total: 0 } }
  }

  if (data.canvas !== canvasName) warnings.push(`W: canvas 字段为 "${data.canvas}"，期望 "${canvasName}"`)
  if (data.direction !== 'outbound') errors.push(`E: direction 必须为 "outbound"，实际 "${data.direction}"`)
  if (!Array.isArray(data.proposals)) {
    errors.push('E: proposals 必须是数组')
    return { errors, warnings, stats: { total: 0 } }
  }

  const dist = { action: {}, sem_role: {} }
  let confSum = 0

  data.proposals.forEach((p, i) => {
    const tag = `proposals[${i}]`
    const anchorPath = p?.node_anchor?.path

    if (!anchorPath) errors.push(`E: ${tag} 缺 node_anchor.path`)
    else if (!byPath.has(anchorPath)) {
      warnings.push(`W: ${tag} 路径不在画布节点清单中（幻觉嫌疑）— "${anchorPath}"`)
    } else {
      const n = byPath.get(anchorPath)
      if (!p.node_anchor.text_hash) errors.push(`E: ${tag} 缺 node_anchor.text_hash`)
      else if (p.node_anchor.text_hash !== n.hash && !p.node_anchor.text_hash.startsWith('sha256:')) {
        warnings.push(`W: ${tag} 指纹与清单不一致 — 给 "${p.node_anchor.text_hash}"，期望 "${n.hash}"`)
      }
      if (n.isEntity && p.action === 'create_issue') {
        warnings.push(`W: ${tag} 对已落库实体重复 create_issue — "${anchorPath}"`)
      }
    }

    if (!ACTIONS.includes(p?.action)) errors.push(`E: ${tag} action 枚举外取值 — "${p?.action}"`)
    else dist.action[p.action] = (dist.action[p.action] ?? 0) + 1
    if (!SEM_ROLES.includes(p?.sem_role)) errors.push(`E: ${tag} sem_role 枚举外取值 — "${p?.sem_role}"`)
    else dist.sem_role[p.sem_role] = (dist.sem_role[p.sem_role] ?? 0) + 1

    if (typeof p?.title !== 'string' || p.title.length === 0) errors.push(`E: ${tag} 缺 title`)
    if (typeof p?.body_md !== 'string' || p.body_md.length === 0) errors.push(`E: ${tag} 缺 body_md`)
    if (typeof p?.confidence !== 'number' || p.confidence < 0 || p.confidence > 1) {
      errors.push(`E: ${tag} confidence 必须是 0-1 数值`)
    } else confSum += p.confidence
    if (typeof p?.rationale !== 'string' || p.rationale.length === 0) errors.push(`E: ${tag} 缺 rationale`)
  })

  const total = data.proposals.length
  return {
    errors,
    warnings,
    stats: {
      total,
      errors: errors.length,
      warnings: warnings.length,
      actionDist: dist.action,
      semRoleDist: dist.sem_role,
      confidenceAvg: total ? +(confSum / total).toFixed(3) : 0,
      skipRatio: total ? +(((dist.action.skip ?? 0) / total) * 100).toFixed(1) : 0,
    },
  }
}

const [name, file, ...rest] = process.argv.slice(2)
if (!name || !file) {
  console.log('用法: node scripts/b0-validate.mjs <画布名> <LLM回复文件> [--json]')
  process.exit(1)
}
const result = validate(name, readFileSync(file, 'utf8'))
if (rest.includes('--json')) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`\n=== ${name} · 提议集校验 ===`)
  console.log(`提议总数: ${result.stats.total}`)
  console.log(`E 级结构违规: ${result.stats.errors}`)
  console.log(`W 级内容告警: ${result.stats.warnings}`)
  console.log(`action 分布: ${JSON.stringify(result.stats.actionDist)}`)
  console.log(`sem_role 分布: ${JSON.stringify(result.stats.semRoleDist)}`)
  console.log(`confidence 均值: ${result.stats.confidenceAvg} · skip 占比: ${result.stats.skipRatio}%`)
  if (result.errors.length) {
    console.log('\n--- E 级（结构违规）---')
    result.errors.forEach((e) => console.log('  ' + e))
  }
  if (result.warnings.length) {
    console.log('\n--- W 级（内容告警）---')
    result.warnings.forEach((w) => console.log('  ' + w))
  }
}
