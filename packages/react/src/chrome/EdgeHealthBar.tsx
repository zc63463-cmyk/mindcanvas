/**
 * EdgeHealthBar（R0-2 → R2-2 → R6-S1a）：边健康度诊断条（R0「观测先行」的呈现端）。
 *
 * 消费 edgeHealthOf 的计数与病例明细：仅当 problems 非空时渲染；样式沿用
 * MindmapStage 中心诊断条的琥珀令牌（数据健康语义，按 R0-A1 不并入 allDiags
 * 的「解析失败」语义）。位置（bottom）由宿主传入——MindmapStage 在中心诊断条
 * 可见时抬升本条避让。
 * R2-2 可发现性闭环：注入 onOpen 后条可点击（pointerEvents auto + cursor
 * pointer，点击区域仅条体本身）→ 宿主打开关系面板；缺省（未接线的旧调用方）
 * 保持 pointerEvents none 非阻塞。
 * R6-S1a 标题口径：括号内 = **互斥主分类**（healthBreakdown，每项只归一档、
 * 总数 = 各项之和），仅非零类目出现（零类目省略防一行过长）；不在此内联判定。
 */
import { healthBreakdown, type EdgeHealth, type EdgeHealthItem } from '../render/edgeHealth.js';

/** 病例 → 单行状态标签（多标记时取最需用户处理的一个；noBox 与悬空/陈旧同因不单列） */
function labelOf(p: EdgeHealthItem): string {
  if (p.malformed) return '原始项非法';
  if (p.state === 'dangling') return '悬空';
  if (p.state === 'stale') return '陈旧';
  if (p.invalid) return '已失效';
  if (p.selfAnchor) return '自关联';
  if (p.duplicateOf !== undefined) return `与第 ${p.duplicateOf + 1} 条重复`;
  if (p.unknownRel) return '未知关系';
  return '正常';
}

/** R6-S1a：标题类目文案（**口径序**：悬空 / 陈旧 / 失效 / 原始项非法 / 自关联 / 重复 /
 *  未知关系；仅非零类目入选——类目判定与优先级在 render/edgeHealth.ts，不在此复刻） */
function breakdownParts(health: EdgeHealth): string[] {
  const b = healthBreakdown(health);
  const parts: string[] = [];
  if (b.dangling > 0) parts.push(`悬空 ${b.dangling}`);
  if (b.stale > 0) parts.push(`陈旧 ${b.stale}`);
  if (b.invalid > 0) parts.push(`失效 ${b.invalid}`);
  if (b.malformed > 0) parts.push(`原始项非法 ${b.malformed}`);
  if (b.selfAnchor > 0) parts.push(`自关联 ${b.selfAnchor}`);
  if (b.duplicate > 0) parts.push(`重复 ${b.duplicate}`);
  if (b.unknownRel > 0) parts.push(`未知关系 ${b.unknownRel}`);
  return parts;
}

export function EdgeHealthBar({
  health,
  bottom,
  onOpen,
}: {
  health: EdgeHealth;
  bottom: number;
  /** R2-2：点击打开关系面板（缺省 = 保持非阻塞，向后兼容） */
  onOpen?: () => void;
}) {
  if (health.problems.length === 0) return null;
  const parts = breakdownParts(health);
  // 全零类目不出现 → 括号区仅在存在非零类目时拼接（problems 非空时恒真，防御式写法）
  const title =
    parts.length > 0
      ? `⚠ 关系线诊断：${health.problems.length} 条（${parts.join(' / ')}）`
      : `⚠ 关系线诊断：${health.problems.length} 条`;
  const interactive = onOpen !== undefined;
  return (
    <div
      data-edge-health-bar
      onClick={onOpen}
      title={interactive ? '点击打开关系面板修复' : undefined}
      style={{
        position: 'absolute',
        left: 16,
        bottom,
        maxWidth: 420,
        padding: '8px 12px',
        borderRadius: 'var(--mc-radius, 8px)',
        background: 'rgba(186, 117, 23, 0.12)',
        border: '1px solid rgba(186, 117, 23, 0.45)',
        color: 'var(--mc-warning, #BA7517)',
        fontFamily: 'inherit',
        fontSize: 12,
        lineHeight: 1.6,
        pointerEvents: interactive ? 'auto' : 'none',
        cursor: interactive ? 'pointer' : undefined,
        userSelect: 'none',
      }}
    >
      <div style={{ fontWeight: 600 }}>{title}</div>
      {health.problems.slice(0, 3).map((p) => (
        <div key={p.index} data-edge-health-detail style={{ wordBreak: 'break-word' }}>
          ·{' '}
          {p.malformed
            ? `第 ${p.index + 1} 条：原始项非法`
            : `${p.from} → ${p.to}：${labelOf(p)}`}
        </div>
      ))}
      {health.problems.length > 3 && <div>… 其余 {health.problems.length - 3} 条略</div>}
    </div>
  );
}
