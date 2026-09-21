/**
 * 边编辑浮窗 + 连线创建器（E7·紧凑化重设计）。
 * 设计原则（蒋指导反馈③）：264px 紧凑卡——placeholder 代替标签行、方向三态按钮、
 * 样式单行化、即时生效无保存按钮；from→to 一行弱化呈现。
 * - EdgeEditor：画布标注边（rel/dir/label/note/style/删除）
 * - TreeEdgeEditor：树自然线关系标注（note.edge 对象：rel 可选/label/note/style/清除）
 * - LinkCreator：新建连线（目标候选 + rel 模板 + dir + 样式）
 * 共享纯函数/样式/小组件已抽至 edgeEditorShared.tsx（A-D1）并在本文件显式 re-export；
 * collectNodeChoices / edge 数组纯函数：可测；写入统一经 updateNote（undo 继承）。
 */
import { useState } from 'react';
import type { LinkDir } from '@mindcanvas/kernel';
import { useTheme } from '../theme/ThemeContext.js';
import type { DocEdge, EdgeManual, EdgeStyle } from '../render/freeEdges.js';
import { inferBowSide } from '../render/edgeRouting.js';
import {
  clampPos,
  closeBtn,
  DirToggle,
  headRow,
  inputStyle,
  POP_WIDTH,
  popStyle,
  REL_TEMPLATES,
  RoutingSideToggle,
  StyleRow,
  type TreeEdgeAnn,
} from './edgeEditorShared.js';
import { EdgeAnchorPicker, type EdgeAnchorChoice } from './EdgeAnchorPicker.js';

export type { DocEdge, EdgeStyle } from '../render/freeEdges.js';
export type { NodeChoice, TreeEdgeAnn } from './edgeEditorShared.js';
export { LinkCreator } from './LinkCreator.js';
export {
  appendEdge,
  collectNodeChoices,
  EDGE_STYLE_PRESETS,
  edgesOf,
  findDuplicateEdge,
  mergeStyleAt,
  patchEdgeAt,
  REL_TEMPLATES,
  removeEdgeAt,
  RoutingSideToggle,
} from './edgeEditorShared.js';

/** EdgeEditor：画布标注边编辑（紧凑卡，即时生效） */
export function EdgeEditor({
  edge,
  x,
  y,
  currentD,
  currentBowSide,
  onChange,
  onStyle,
  onInvalidate,
  onRestore,
  onDelete,
  onClose,
  choices,
  onReattach,
  onDirChange,
  forcedSideFallback,
  onReverse,
}: {
  edge: {
    key: string;
    index: number;
    rel: string;
    dir: LinkDir;
    from: string;
    to: string;
    label?: string;
    note?: string;
    style?: EdgeStyle;
    invalidAt?: string;
    /** 绕行侧（对标 markvault routingSide）；undefined = 自动 */
    routingSide?: 'left' | 'right';
    /** R3-1：人工锁定几何（存在 = routingSide/Opp 静默失效 → 显式禁用） */
    manual?: EdgeManual;
    /** R6-S2：属性（只读呈现：计数 + 最多 2 行 `k = v` + title 全量；不提供编辑） */
    attrs?: Record<string, unknown>;
  };
  x: number;
  y: number;
  /**
   * 当前这条边**实际渲染**的路径 d（由 FreeEdgeLayer 经 MapView 透传）。
   * Opp 按钮用它推断 auto 模式下算法实际选了哪一侧，才能精确翻到另一侧。
   */
  currentD?: string;
  /**
   * R5-1 补：鼓向的**首选来源** = 路由折线顶点推出的侧（宿主经 `RouteResult.points` 计算）。
   * 与 currentD 的区别：d 可能含折线跳桥（其抬升会被读成鼓向），顶点不含桥 ——
   * 「直线 + 跳线」必须判 'auto'（落 right 兜底），否则 Opp 会按跳线方向翻转（R5-1 形态漂移）。
   * 缺省（旧调用方）→ 回落 currentD 字符串解析，行为不变。
   */
  currentBowSide?: 'left' | 'right' | 'auto';
  onChange: (patch: Partial<DocEdge>) => void;
  onStyle: (patch: EdgeStyle) => void;
  onDelete: () => void;
  onInvalidate: () => void;
  onRestore: () => void;
  onClose: () => void;
  /** R2-1：重挂候选（缺省不注入 = 不显示重挂入口，向后兼容） */
  choices?: readonly EdgeAnchorChoice[];
  /** R2-1：重挂回调——写路径归宿主（useEdgeActions.reattachEdge 唯一写路径） */
  onReattach?: (side: 'from' | 'to', anchor: string) => void;
  /**
   * R3-3：方向切换回调（宿主 setEdgeDir——manual/routingSide 保形交换/翻转）。
   * 缺省回落 onChange({dir})，向后兼容。
   */
  onDirChange?: (dir: LinkDir) => void;
  /** R3-4：指定侧无解 → 已回退直连（由宿主经 RouteResult.forcedSideFallback 透传） */
  forcedSideFallback?: boolean;
  /** R4-2：反向（数据层反转；缺省不注入 = 不渲染按钮，向后兼容） */
  onReverse?: () => void;
}) {
  const { token } = useTheme();
  const invalidated = edge.invalidAt !== undefined;
  // R6-S2b：attrs 只读行（计数 + 最多 2 行；值 String(v) 单行省略，title 给全量）
  const attrEntries = edge.attrs !== undefined ? Object.entries(edge.attrs) : [];
  // Opp 一键反向：
  //   · routingSide 已设 → 翻转到另一侧（'left'↔'right'）
  //   · auto（未设）→ 推断当前鼓向再翻到另一侧：**首选 currentBowSide**（宿主由
  //     路由折线顶点算出——跳线桥不进判定）；缺省回落 currentD 字符串解析
  //     （由上层把 FreeEdgeLayer 的真实路由结果透传而来，兼容旧调用方与既有测试）。
  //   · 极端兜底：拿不到 currentD 或路径是直线（推断为 auto）→ 落到 'right'，
  //     之后再点即正常 toggle（与既有行为一致，不会卡死）。
  // R3-1：manual 锁定期间 routingSide/Opp 对渲染**永远不生效**（manual 优先于
  // routeAesthetic 的 forceSide）——此前可点但静默无效；现显式禁用 + flipSide 早退双保险。
  const manualLocked = edge.manual !== undefined;
  const MANUAL_LOCKED_TITLE = '已锁定手工几何（manual）——双击 bend 恢复自动后方可设置绕行侧';
  const flipSide = () => {
    if (manualLocked) return;
    const inferred =
      edge.routingSide ?? currentBowSide ?? (currentD ? inferBowSide(currentD) : 'auto');
    // R3-2：'auto' 兜底仍落 right，但给行内提示（不再静默）
    setAutoHint(inferred === 'auto');
    const opp: 'left' | 'right' = inferred === 'right' ? 'left' : 'right';
    onChange({ routingSide: opp });
  };
  // R2-1：重挂入口 → 候选选择器（嵌在浮窗内；选择结果交宿主唯一写路径）
  const [reattachSide, setReattachSide] = useState<'from' | 'to' | null>(null);
  // R3-2：Opp 的 'auto' 兜底提示（当前路径无法判向时显示）
  const [autoHint, setAutoHint] = useState(false);
  const showFallbackHint = forcedSideFallback === true;
  return (
    <div
      data-edge-editor
      style={{ ...popStyle(), ...clampPos(x, y, POP_WIDTH, 250), color: token.color.text }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={headRow}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.color.selection }}>
          编辑连线
        </span>
        {invalidated && (
          <span data-edge-invalidated style={{ fontSize: 10.5, color: token.color.textMuted }}>
            已失效 {edge.invalidAt!.slice(0, 10)}
          </span>
        )}
        <span
          style={{
            fontSize: 10.5,
            opacity: 0.55,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            direction: 'rtl',
          }}
        >
          {edge.from} → {edge.to}
        </span>
        {onReattach !== undefined && (
          <>
            <span
              data-reattach-from
              title="重挂源锚"
              onClick={() => setReattachSide('from')}
              style={{ fontSize: 10.5, color: token.color.textMuted, cursor: 'pointer', flex: 'none' }}
            >
              重挂源
            </span>
            <span
              data-reattach-to
              title="重挂目标锚"
              onClick={() => setReattachSide('to')}
              style={{ fontSize: 10.5, color: token.color.textMuted, cursor: 'pointer', flex: 'none' }}
            >
              重挂靶
            </span>
          </>
        )}
        <span data-edge-editor-close onClick={onClose} style={closeBtn}>
          ×
        </span>
      </div>
      {reattachSide !== null && onReattach !== undefined && (
        <EdgeAnchorPicker
          choices={choices ?? []}
          excludeAnchor={reattachSide === 'from' ? edge.to : edge.from}
          onPick={(anchor) => {
            onReattach(reattachSide, anchor);
            setReattachSide(null);
          }}
          onClose={() => setReattachSide(null)}
        />
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input
          data-edge-rel
          list="rel-templates"
          placeholder="关系类型"
          title="关系类型"
          value={edge.rel}
          onChange={(e) => onChange({ rel: e.target.value })}
          style={inputStyle}
        />
        <DirToggle
          value={edge.dir}
          onChange={(d) => {
            if (onDirChange !== undefined) onDirChange(d);
            else onChange({ dir: d });
          }}
        />
        <RoutingSideToggle
          value={edge.routingSide}
          onChange={(v) => {
            if (manualLocked) return;
            onChange({ routingSide: v });
          }}
          disabled={manualLocked}
          disabledTitle={MANUAL_LOCKED_TITLE}
        />
        {onReverse !== undefined && (
          <button
            data-edge-reverse
            onClick={onReverse}
            title="反向：交换两端（数据层反转，dir 不变）"
            style={{
              ...inputStyle,
              cursor: 'pointer',
              color: token.color.textMuted,
              padding: '0 8px',
              fontSize: 11,
            }}
          >
            ⇄ 反向
          </button>
        )}
        <button
          data-edge-opp
          disabled={manualLocked}
          aria-disabled={manualLocked || undefined}
          onClick={flipSide}
          title={
            manualLocked
              ? MANUAL_LOCKED_TITLE
              : 'Opp 一键反向：routingSide 已设则翻转，未设则从当前鼓向推断后翻到另一边'
          }
          style={{
            ...inputStyle,
            cursor: manualLocked ? 'not-allowed' : 'pointer',
            color: token.color.textMuted,
            padding: '0 8px',
            fontSize: 11,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          ⇆ Opp
        </button>
      </div>
      {autoHint && (
        <div
          data-edge-auto-hint
          style={{ fontSize: 10.5, color: token.color.textMuted, marginBottom: 6 }}
        >
          无法从当前路径判断鼓向——已按「右」处理
        </div>
      )}
      {showFallbackHint && (
        <div
          data-edge-fallback-hint
          style={{
            fontSize: 10.5,
            color: 'var(--mc-warning, #BA7517)',
            marginBottom: 6,
          }}
        >
          指定侧不可行：已回退直连（可试另一侧）
        </div>
      )}
      <datalist id="rel-templates">
        {REL_TEMPLATES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-edge-label
          placeholder="标签"
          value={edge.label ?? ''}
          onChange={(e) => onChange({ label: e.target.value || undefined })}
          style={inputStyle}
        />
        <input
          data-edge-note
          placeholder="备注"
          value={edge.note ?? ''}
          onChange={(e) => onChange({ note: e.target.value || undefined })}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <StyleRow style={edge.style ?? {}} onStyle={onStyle} />
      </div>
      {attrEntries.length > 0 && (
        <div data-edge-attrs style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10.5, color: token.color.textMuted, marginBottom: 2 }}>
            属性 {attrEntries.length} 项
          </div>
          {attrEntries.slice(0, 2).map(([k, v]) => {
            const line = `${k} = ${String(v)}`;
            return (
              <div
                key={k}
                data-edge-attr-row
                title={line}
                style={{
                  fontSize: 10.5,
                  color: token.color.textMuted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {line}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        {invalidated ? (
          <button
            data-edge-restore
            onClick={onRestore}
            style={{
              ...inputStyle,
              cursor: 'pointer',
              color: token.color.selection,
              borderColor: token.color.selection,
              flex: 1,
              fontSize: 11,
            }}
          >
            ↻ 恢复关系
          </button>
        ) : (
          <button
            data-edge-invalidate
            onClick={onInvalidate}
            style={{ ...inputStyle, cursor: 'pointer', fontSize: 11, opacity: 0.85, flex: 1 }}
          >
            失效（可恢复）
          </button>
        )}
        <button
          data-edge-delete
          onClick={onDelete}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            color: token.color.warn,
            borderColor: 'transparent',
            fontSize: 11,
            opacity: 0.85,
            flex: 1,
          }}
        >
          删除
        </button>
      </div>
    </div>
  );
}

/** TreeEdgeEditor：树自然线关系标注（note.edge 对象；rel 可选=无类型树边注脚） */
export function TreeEdgeEditor({
  childId,
  ann,
  viaLabel,
  x,
  y,
  onChange,
  onClose,
  onCut,
}: {
  childId: string;
  /** 结构化标注（note.edge）；null = 尚未标注（label 空白起步） */
  ann: TreeEdgeAnn | null;
  /** 旧版 via 字符串标签（兼容显示） */
  viaLabel: string;
  x: number;
  y: number;
  onChange: (ann: TreeEdgeAnn | undefined) => void;
  onClose: () => void;
  /** A5（G2）：切断并独立——B 子树移为文档根直接分支 + detached；缺省不显示（外部命令未接入时） */
  onCut?: (childId: string) => void;
}) {
  const { token } = useTheme();
  const [rel, setRel] = useState(ann?.rel ?? '');
  const [label, setLabel] = useState(ann?.label ?? viaLabel);
  const [note, setNote] = useState(ann?.note ?? '');
  const [style, setStyle] = useState<EdgeStyle>(ann?.style ?? {});
  const commit = (next: TreeEdgeAnn | undefined): void => {
    onChange(next);
    onClose();
  };
  const buildAnn = (): TreeEdgeAnn | undefined => {
    const out: TreeEdgeAnn = {};
    if (rel.trim()) out.rel = rel.trim();
    if (label.trim()) out.label = label.trim();
    if (note.trim()) out.note = note.trim();
    if (style.color) out.style = { ...out.style, color: style.color };
    if (style.dashed !== undefined) out.style = { ...out.style, dashed: style.dashed };
    if (style.width !== undefined) out.style = { ...out.style, width: style.width };
    if (out.style && Object.keys(out.style).length === 0) delete out.style;
    return Object.keys(out).length > 0 ? out : undefined;
  };
  return (
    <div
      data-tree-edge-editor
      data-tree-edge-child={childId}
      style={{ ...popStyle(), ...clampPos(x, y, POP_WIDTH, 230), color: token.color.text }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={headRow}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.color.selection }}>
          编辑连线内容
        </span>
        <span style={{ flex: 1 }} />
        <span data-tree-edge-editor-close onClick={onClose} style={closeBtn}>
          ×
        </span>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-tree-edge-rel
          list="rel-templates-tree"
          placeholder="关系类型（可选）"
          value={rel}
          onChange={(e) => setRel(e.target.value)}
          style={inputStyle}
        />
        <datalist id="rel-templates-tree">
          {REL_TEMPLATES.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-tree-edge-label
          placeholder="标签"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
        />
        <input
          data-tree-edge-note
          placeholder="备注"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <StyleRow style={style} onStyle={(patch) => setStyle((s) => ({ ...s, ...patch }))} />
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          data-tree-edge-save
          onClick={() => commit(buildAnn())}
          style={{
            ...inputStyle,
            cursor: 'pointer',
            color: token.color.selection,
            borderColor: token.color.selection,
            flex: 1,
          }}
        >
          保存
        </button>
        <button
          data-tree-edge-clear
          onClick={() => commit(undefined)}
          style={{ ...inputStyle, cursor: 'pointer', flex: 1 }}
        >
          清除
        </button>
      </div>
      {onCut && (
        <div style={{ marginTop: 6 }}>
          <button
            data-tree-edge-cut
            onClick={() => {
              onCut(childId);
              onClose();
            }}
            style={{
              ...inputStyle,
              width: '100%',
              cursor: 'pointer',
              color: '#e24b4a',
              borderColor: '#e24b4a',
            }}
            title="切断该父子树边：子分支移为文档根直接分支并独立摆放（可撤销）"
          >
            ✂ 切断并独立
          </button>
        </div>
      )}
    </div>
  );
}

/** LinkCreator：新建连线（源 = 右键节点；目标从候选选，rel 模板 + dir + 可选 label/note/样式） */
