/**
 * 摘要括线渲染层（S4）。
 *
 * 挂载：MapView 变换 `<g>` 内、**SectionLayer 之后、tree-links 之前**
 * —— 与既有层序契约
 * （`sections → tree-links → free-edges → nodes → edge-labels → ghosts → drag`）一致：
 * 括线是「树线的延伸」，须在节点卡之下，否则会盖住节点卡边框与文本。
 *
 * Canvas 模式（useCanvas）不经过本 SVG 分支 → 自动降级不渲染。
 * **本包不宣称 Canvas 括线已支持** —— 与 SectionLayer 同一既有边界。
 *
 * 交互：
 * - 括线本身**不参与命中**（`pointerEvents="none"`）：命中与选择逻辑零改动，
 *   节点卡仍是唯一命中面（任务书 §三.8「不改变节点、边、选择和命中逻辑」）。
 * - 选中摘要节点 → 其成员高亮（扩边/加粗由 `selected` 派生，不改布局数据）。
 * - 选中成员 → 其所属摘要括线高亮（反向状态显示；同样零数据写入）。
 */
import {
  SUMMARY_BRACKET_GAP,
  SUMMARY_STEM_GAP,
} from '@mindcanvas/kernel';
import type { TokenSet } from '../theme/types.js';
import type { SummaryView } from './summaryFrames.js';

export interface SummaryLayerProps {
  views: readonly SummaryView[];
  /** 主题令牌（线色/线宽口径；与树线同源） */
  token: TokenSet;
  /** 当前选中的节点 id（摘要或成员均可） */
  selectedId?: string | null;
}

/** 括线线宽（世界单位）：与树线同档（token.lineStyle.width） */
const BRACKET_WIDTH_SCALE = 1.6;

export function SummaryLayer({ views, token, selectedId }: SummaryLayerProps) {
  if (views.length === 0) return null;
  const baseStroke = token.color.linkStroke;
  const accent = token.color.selection;
  const baseWidth = token.lineStyle.width * BRACKET_WIDTH_SCALE;
  return (
    <g data-layer="summaries">
      {views.map((v) => {
        const selected = selectedId !== null && selectedId !== undefined && isRelated(v, selectedId);
        const stroke = selected ? accent : baseStroke;
        const width = selected ? baseWidth * 1.5 : baseWidth;
        return (
          <g
            key={v.summaryId}
            data-summary-id={v.summaryId}
            data-summary-side={v.side === -1 ? 'left' : 'right'}
            data-summary-member-count={v.memberIds.length}
          >
            {/* 括线：方括号，与成员带上下沿齐平 */}
            <path
              data-summary-bracket={v.summaryId}
              d={v.bracketPath}
              fill="none"
              stroke={stroke}
              strokeWidth={width}
              strokeLinecap="round"
              strokeLinejoin="round"
              pointerEvents="none"
              opacity={selected ? 1 : 0.85}
            />
            {/* stem：括线中点 → 摘要盒外缘 */}
            <path
              data-summary-stem={v.summaryId}
              d={`M ${v.stemX1} ${v.stemY1} L ${v.stemX2} ${v.stemY2}`}
              fill="none"
              stroke={stroke}
              strokeWidth={width}
              strokeLinecap="round"
              pointerEvents="none"
              opacity={selected ? 1 : 0.85}
            />
            {/* 成员高亮：选中摘要或其成员时，成员带上显示一条淡色指示带。
                纯视觉叠加，零布局/数据写入（§三.9/§三.10）。 */}
            {selected && (
              <rect
                data-summary-highlight={v.summaryId}
                x={v.memberBand.x}
                y={v.memberBand.y}
                width={v.memberBand.w}
                height={v.memberBand.h}
                rx={6}
                fill={accent}
                opacity={0.08}
                pointerEvents="none"
              />
            )}
          </g>
        );
      })}
    </g>
  );
}

/** 选中项是否与该摘要相关（选中摘要本身，或其任一成员）。 */
function isRelated(v: SummaryView, selectedId: string): boolean {
  return selectedId === v.summaryId || v.memberIds.includes(selectedId);
}

/** 常量再导出（导出层与测试共用同一口径；避免从 kernel 二次 import 时漂移） */
export const SUMMARY_BRACKET_GAP_PX = SUMMARY_BRACKET_GAP;
export const SUMMARY_STEM_GAP_PX = SUMMARY_STEM_GAP;
