/**
 * EntityGraphPanel —— 实体关系图谱面板（F1：导图↔关系图联动的视图侧）。
 * 左：实体列表（kind 徽章 + 标题 + 引用数）；右：径向关系图（中心 = 选中实体，周围 = 引用它的导图节点）。
 * 双向导航：点引用节点 → onFocusNode（画布 focusNode+选中）；activeRefKey（画布选中实体）→ 列表高亮。
 * 数据源 collectEntityRelations（公共 API，主仓 RelationGraph 同源）。
 */
import { useState } from 'react';
import { refKey, type AnchorResolutionState, type EntityRef } from '@mindcanvas/kernel';
import { CHROME } from '../theme/tokens.js';
import { radialLayout, type EntityRelation } from './entityGraph.js';
import { EdgeAnchorPicker, type EdgeAnchorChoice } from './EdgeAnchorPicker.js';

export interface EntityGraphPanelProps {
  relations: EntityRelation[];
  /** 画布选中实体节点的 refKey → 列表高亮联动 */
  activeRefKey?: string | null;
  onFocusNode: (nodeId: string) => void;
  onClose: () => void;
  /** E4：canvas 自由边清单（root.note.edges 解析结果；ADR-0008 数据面①——非 note.links）。
   *  缺省 = 不显示连线区，向后兼容 */
  edges?: readonly EdgeListItem[];
  /** R2-3：重挂候选（缺省不注入 = 行内无动作按钮，向后兼容） */
  choices?: readonly EdgeAnchorChoice[];
  /** R2-3：行内重挂回调（key = `e${index}`；写路径归宿主 useEdgeActions.reattachEdge） */
  onReattachEdge?: (key: string, side: 'from' | 'to', anchor: string) => void;
  /** R2-3：行内删除回调（写路径归宿主 writeEdges + removeEdgeAt） */
  onDeleteEdge?: (key: string) => void;
  /**
   * R6-S1b：畸形项行（原始数组下标，如 `[3]`）。由宿主从 `edgeHealthOf(root).problems`
   * 过滤 `malformed` 派生——**面板不自己扫原始数组**（判定口径单一来源）；缺省 = 不渲染
   * 畸形区（向后兼容）。删除经既有 `onDeleteEdge`（key 沿用 `e${index}` 位置键约定）。
   */
  malformedRows?: readonly number[];
}

/** 语义边行（面板哑渲染；文本解析由上层完成） */
export interface EdgeListItem {
  key: string;
  rel: string;
  dir: 'fwd' | 'back' | 'both';
  sourceId: string;
  sourceText: string;
  targetId: string | null;
  targetText: string;
  /** E6.1：软失效/来源标记（行尾呈现） */
  invalidAt?: string;
  source?: string;
  /** R0-3：锚定三态（未传 = 旧调用方，全部按正常区处理） */
  state?: AnchorResolutionState;
  /** R2-3：两端原始锚文本（重挂 picker 排除另一端防自关联；缺省不排） */
  from?: string;
  to?: string;
}

/** 边状态分区（R0-3）：每区标题带计数；空区不渲染。
 *  同一行可同时悬空 + 失效 → invalidAt 是更强病理，分区优先级最高。 */
interface EdgeGroup {
  id: 'ok' | 'dangling' | 'stale' | 'invalid';
  title: string;
  items: EdgeListItem[];
}

function groupEdges(edges: readonly EdgeListItem[]): EdgeGroup[] {
  const ok: EdgeListItem[] = [];
  const dangling: EdgeListItem[] = [];
  const stale: EdgeListItem[] = [];
  const invalid: EdgeListItem[] = [];
  for (const e of edges) {
    if (e.invalidAt !== undefined) invalid.push(e);
    else if (e.state === 'dangling') dangling.push(e);
    else if (e.state === 'stale') stale.push(e);
    else ok.push(e);
  }
  const groups: EdgeGroup[] = [
    { id: 'ok', title: '正常', items: ok },
    { id: 'dangling', title: '悬空', items: dangling },
    { id: 'stale', title: '陈旧', items: stale },
    { id: 'invalid', title: '已失效', items: invalid },
  ];
  return groups.filter((g) => g.items.length > 0);
}

const GRAPH_SIZE = 200;
const GRAPH_RADIUS = 66;

export function EntityGraphPanel({
  relations,
  activeRefKey,
  onFocusNode,
  onClose,
  edges,
  choices,
  onReattachEdge,
  onDeleteEdge,
  malformedRows,
}: EntityGraphPanelProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // R2-3：当前重挂目标（key + 端）；非 null 时渲染候选选择器
  const [reattach, setReattach] = useState<{ key: string; side: 'from' | 'to' } | null>(null);
  const selected = relations.find((r) => refKey(r.ref) === selectedKey) ?? null;

  return (
    <div
      data-relation-panel
      style={{
        position: 'absolute',
        right: 18,
        top: 76,
        width: 430,
        maxHeight: '62vh',
        display: 'flex',
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(14px) saturate(1.3)',
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        zIndex: 4,
        overflow: 'hidden',
      }}
    >
      {/* 实体列表（左） */}
      <div
        style={{
          width: 200,
          borderRight: `1px solid ${CHROME.panelBorder}`,
          overflowY: 'auto',
          padding: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px 8px' }}>
          <span style={{ color: CHROME.neon, fontWeight: 600, fontSize: CHROME.fontSize }}>
            关系
          </span>
          <span style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall }}>
            {(edges?.length ?? 0) + relations.length}
          </span>
          <span style={{ flex: 1 }} />
          <span
            data-relation-close
            onClick={onClose}
            style={{ color: CHROME.textMuted, cursor: 'pointer', fontSize: CHROME.fontSize }}
          >
            ×
          </span>
        </div>
        {/* E4：语义边区（连线一等公民——R0-3 按状态分区：正常/悬空/陈旧/已失效，
            每区标题带计数；源锚未解析的行不再触发 onFocusNode('') 静默 no-op）。
            R6-S1b：畸形项（collectFreeEdges 静默丢弃）补上席位——宿主经 malformedRows
            传入下标，可定位可删除（口径单一来源 = edgeHealthOf.problems）。 */}
        {((edges !== undefined && edges.length > 0) ||
          (malformedRows !== undefined && malformedRows.length > 0)) && (
          <div data-edge-section style={{ marginBottom: 8 }}>
            <div
              style={{
                color: CHROME.textMuted,
                fontSize: CHROME.fontSizeSmall,
                padding: '2px 4px 4px',
              }}
            >
              连线 {(edges?.length ?? 0) + (malformedRows?.length ?? 0)}
            </div>
            {edges !== undefined && edges.length > 0 && groupEdges(edges).map((group) => (
              <div key={group.id} data-edge-group={group.id}>
                <div
                  style={{
                    color: group.id === 'ok' ? CHROME.textMuted : CHROME.warn,
                    fontSize: CHROME.fontSizeSmall,
                    padding: '2px 4px',
                  }}
                >
                  {group.title} {group.items.length}
                </div>
                {group.items.map((e) => {
                  // 源锚未解析（sourceId === ''）→ 聚焦必然 no-op：呈禁用态而非静默吞点击
                  const unresolved = e.sourceId === '';
                  return (
                    <div
                      key={e.key}
                      data-edge-item={e.rel}
                      data-edge-invalidated={e.invalidAt !== undefined || undefined}
                      onClick={unresolved ? undefined : () => onFocusNode(e.sourceId)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 6px',
                        borderRadius: 6,
                        cursor: unresolved ? 'default' : 'pointer',
                        opacity: e.invalidAt !== undefined || unresolved ? 0.5 : 1,
                      }}
                    >
                      <span
                        style={{
                          fontSize: CHROME.fontSizeSmall,
                          color: CHROME.neon,
                          fontWeight: 600,
                          flex: 'none',
                        }}
                      >
                        {e.rel}
                      </span>
                      <span
                        style={{
                          fontSize: CHROME.fontSizeSmall,
                          flex: 1,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          color: CHROME.text,
                        }}
                      >
                        {e.sourceText} {e.dir === 'back' ? '←' : '→'} {e.targetText}
                      </span>
                      {e.source === 'inferred' && (
                        <span
                          style={{
                            fontSize: CHROME.fontSizeSmall,
                            color: CHROME.textMuted,
                            flex: 'none',
                          }}
                        >
                          🤖
                        </span>
                      )}
                      {unresolved && (
                        <span
                          style={{
                            fontSize: CHROME.fontSizeSmall,
                            color: CHROME.warn,
                            flex: 'none',
                          }}
                        >
                          源锚未解析
                        </span>
                      )}
                      {e.invalidAt !== undefined && (
                        <span
                          style={{
                            fontSize: CHROME.fontSizeSmall,
                            color: CHROME.textMuted,
                            flex: 'none',
                          }}
                        >
                          已失效
                        </span>
                      )}
                      {onReattachEdge !== undefined &&
                       (e.sourceId === '' || e.targetId === null) && (
                        <span
                          data-edge-reattach={e.key}
                          title={
                            e.sourceId === '' && e.targetId !== null
                              ? '重挂源锚（源锚未解析）'
                              : e.sourceId !== '' && e.targetId === null
                                ? '重挂目标锚（目标未解析）'
                                : '两端均未解析——先修源锚（重挂源）'
                          }
                          onClick={(ev) => {
                            ev.stopPropagation(); // 不触发行聚焦
                            setReattach({
                              key: e.key,
                              // 端选择：源锚未解析 → from；否则目标未解析 → to；两端都坏 → from 优先
                              side: e.sourceId === '' ? 'from' : 'to',
                            });
                          }}
                          style={{
                            fontSize: CHROME.fontSizeSmall,
                            color: CHROME.warn,
                            cursor: 'pointer',
                            flex: 'none',
                          }}
                        >
                          重挂
                        </span>
                      )}
                      {onDeleteEdge !== undefined && (
                        <span
                          data-edge-delete={e.key}
                          title="删除这条连线"
                          onClick={(ev) => {
                            ev.stopPropagation(); // 不触发行聚焦
                            onDeleteEdge(e.key);
                          }}
                          style={{
                            fontSize: CHROME.fontSizeSmall,
                            color: CHROME.textMuted,
                            cursor: 'pointer',
                            flex: 'none',
                          }}
                        >
                          删
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {/* R6-S1b：畸形项组——被 collectFreeEdges 静默丢弃的原始项在面板的席位 */}
            {malformedRows !== undefined && malformedRows.length > 0 && (
              <div data-edge-group="malformed">
                <div
                  style={{
                    color: CHROME.warn,
                    fontSize: CHROME.fontSizeSmall,
                    padding: '2px 4px',
                  }}
                >
                  原始项非法 {malformedRows.length}
                </div>
                {malformedRows.map((idx) => (
                  <div
                    key={`e${idx}`}
                    data-edge-malformed={`e${idx}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 6px',
                      borderRadius: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: CHROME.fontSizeSmall,
                        flex: 1,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: CHROME.warn,
                      }}
                    >
                      第 {idx + 1} 条 · 原始项非法
                    </span>
                    {onDeleteEdge !== undefined && (
                      <span
                        data-edge-delete={`e${idx}`}
                        title="删除这条非法条目（原始数组位置：不可解析项）"
                        onClick={(ev) => {
                          ev.stopPropagation(); // 不触发相邻行聚焦
                          onDeleteEdge(`e${idx}`);
                        }}
                        style={{
                          fontSize: CHROME.fontSizeSmall,
                          color: CHROME.textMuted,
                          cursor: 'pointer',
                          flex: 'none',
                        }}
                      >
                        删
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* 实体区（星型图降级为下钻视图：点实体条目才在右侧展开星图） */}
        {relations.length > 0 && (
          <div
            style={{
              color: CHROME.textMuted,
              fontSize: CHROME.fontSizeSmall,
              padding: '2px 4px 4px',
            }}
          >
            实体 {relations.length}
          </div>
        )}
        {relations.length === 0 &&
        (edges === undefined || edges.length === 0) &&
        (malformedRows === undefined || malformedRows.length === 0) ? (
          <div
            style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall, padding: '8px 4px' }}
          >
            暂无实体引用。用 @issue:@doc:@img 引用后这里会出现关系图。
          </div>
        ) : relations.length === 0 ? null : (
          relations.map((r) => {
            const key = refKey(r.ref);
            const active = key === activeRefKey;
            return (
              <div
                key={key}
                data-entity-item
                data-active={active || undefined}
                onClick={() => setSelectedKey(key)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '4px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: key === selectedKey ? CHROME.panelBorder : undefined,
                }}
              >
                <span
                  style={{
                    fontSize: CHROME.fontSizeSmall,
                    color: active
                      ? CHROME.neon
                      : r.kind === 'img' || r.kind === 'draw'
                        ? CHROME.neon
                        : CHROME.textMuted,
                    fontWeight: 600,
                    width: 30,
                    flex: 'none',
                  }}
                >
                  @{r.kind}
                </span>
                <span
                  style={{
                    fontSize: CHROME.fontSizeSmall,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    color: active ? CHROME.neon : CHROME.text,
                  }}
                >
                  {r.title}
                </span>
                <span style={{ fontSize: CHROME.fontSizeSmall, color: CHROME.textMuted }}>
                  {r.refNodes.length}
                </span>
              </div>
            );
          })
        )}
      </div>
      {/* R2-3：重挂候选选择器（fixed 遮罩；排除当前另一端锚防自关联） */}
      {reattach !== null && onReattachEdge !== undefined && (
        <EdgeAnchorPicker
          choices={choices ?? []}
          excludeAnchor={
            (() => {
              const item = edges?.find((x) => x.key === reattach.key);
              if (item === undefined) return undefined;
              return reattach.side === 'from' ? item.to : item.from;
            })()
          }
          onPick={(anchor) => {
            onReattachEdge(reattach.key, reattach.side, anchor);
            setReattach(null);
          }}
          onClose={() => setReattach(null)}
        />
      )}
      {/* 径向关系图（右） */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
        }}
      >
        {selected === null ? (
          <div
            style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall, textAlign: 'center' }}
          >
            点左侧实体条目
            <br />
            查看引用星图（下钻视图）
          </div>
        ) : (
          <svg width={GRAPH_SIZE} height={GRAPH_SIZE} data-relation-graph>
            {(() => {
              const cx = GRAPH_SIZE / 2;
              const cy = GRAPH_SIZE / 2;
              const pts = radialLayout(selected.refNodes.length, GRAPH_RADIUS);
              return (
                <g>
                  {/* 连线：中心实体 → 引用节点 */}
                  {pts.map((p, i) => (
                    <line
                      key={i}
                      x1={cx}
                      y1={cy}
                      x2={cx + p.x}
                      y2={cy + p.y}
                      stroke={CHROME.panelBorder}
                      strokeWidth={1.2}
                    />
                  ))}
                  {/* 中心实体 */}
                  <g data-entity-center>
                    <circle cx={cx} cy={cy} r={20} fill={CHROME.panelBorder} />
                    <text
                      x={cx}
                      y={cy}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={8}
                      fill={CHROME.neon}
                      style={{ maxWidth: 34 }}
                    >
                      {truncate(selected.title, 8)}
                    </text>
                  </g>
                  {/* 引用节点（点击 → 画布定位） */}
                  {selected.refNodes.map((rn, i) => (
                    <g
                      key={rn.nodeId}
                      data-ref-node
                      onClick={() => onFocusNode(rn.nodeId)}
                      style={{ cursor: 'pointer' }}
                    >
                      <circle
                        cx={cx + pts[i]!.x}
                        cy={cy + pts[i]!.y}
                        r={7}
                        fill={CHROME.text}
                        opacity={0.9}
                      />
                      <text
                        x={cx + pts[i]!.x}
                        y={cy + pts[i]!.y + 16}
                        textAnchor="middle"
                        fontSize={8}
                        fill={CHROME.textMuted}
                      >
                        {truncate(rn.text, 9)}
                      </text>
                    </g>
                  ))}
                </g>
              );
            })()}
          </svg>
        )}
      </div>
    </div>
  );
}

/** 截断显示文本 */
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export type { EntityRef };
