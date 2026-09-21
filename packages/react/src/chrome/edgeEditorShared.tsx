/**
 * edgeEditorShared：边编辑浮窗共享层（数据纯函数 / 紧凑样式系统 / 小组件）。
 * 自 EdgeEditor.tsx 抽出（2026-09-12 债务腾挪 A-D1，纯搬迁、逻辑零变更）。
 * - 数据纯函数：collectNodeChoices（id + anchor）/ edges 数组操作（不可变）
 * - 紧凑样式（E7：264px、placeholder 代替标签行、单行化）+ DirToggle / RoutingSideToggle / StyleRow
 * 公开符号经 EdgeEditor.tsx 显式具名 re-export，既有 import 路径不变。
 */
import type { EditableNode, LinkDir } from '@mindcanvas/kernel';
import type { Note } from '@mindcanvas/kernel';
import { useTheme } from '../theme/ThemeContext.js';
import type { DocEdge, EdgeStyle } from '../render/freeEdges.js';
import { collectEntityOccurrences } from '../render/freeEdges.js';

/** rel 快捷模板（开放字符串；语义默认色由 relVisualOf 提供） */
export const REL_TEMPLATES: readonly string[] = ['blocks', 'causes', 'relates-to', 'duplicates'];

/** 树自然线关系标注（子节点 note.edge 对象；树方向天然 parent→child，无 dir） */
export interface TreeEdgeAnn {
  rel?: string;
  label?: string;
  note?: string;
  style?: EdgeStyle;
}

/** 节点候选（连线目标）：带会话内 id + 稳定锚 */
export interface NodeChoice {
  id: string;
  label: string;
  anchor: string;
}

function anchorName(n: EditableNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'entity' && n.ref) return `@${n.ref.kind}:${n.ref.id}`;
  return '';
}

/** 遍历树生成目标候选（根除外）
 *  E8：与 anchorOfNode 保持同一套消歧规则——同一实体多次出现时，第 2 次起锚加 `#N`，
 *  否则下拉里两个同名实体产出相同锚 → 建边后错锚到首个出现处。 */
export function collectNodeChoices(root: EditableNode): NodeChoice[] {
  const out: NodeChoice[] = [];
  // 与 anchorOfNode 同一套规则：先统计同名实体出现数，多次出现则全部带 #N
  const occurrences = collectEntityOccurrences(root);
  const walk = (n: EditableNode, path: string[]): void => {
    const name = anchorName(n);
    // 空名节点不占路径段但【仍须下钻】——与 anchorOfNode / 内核 effectiveChildren 三方对齐，
    // 否则清空某节点文字后其整棵子树从候选里消失
    const nextPath = name === '' ? path : [...path, name];
    if (name !== '' && nextPath.length > 1) {
      if (n.type === 'entity') {
        const list = occurrences.get(name);
        const anchor = list && list.length > 1 ? `${name}#${list.indexOf(n.id) + 1}` : name;
        out.push({ id: n.id, label: nextPath.join(' / '), anchor });
      } else {
        out.push({ id: n.id, label: nextPath.join(' / '), anchor: `node:${nextPath.join('/')}` });
      }
    }
    for (const c of n.children) walk(c, nextPath);
  };
  walk(root, []);
  return out;
}

/** edges 数组操作（root note.edges 原始数组；不可变） */
export function appendEdge(edges: unknown, edge: DocEdge): DocEdge[] {
  return [...(Array.isArray(edges) ? (edges as DocEdge[]) : []), edge];
}

export function patchEdgeAt(edges: unknown, index: number, patch: Partial<DocEdge>): DocEdge[] {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.map((e, i) => (i === index ? { ...e, ...patch } : e));
}

/** 样式补丁（style 内层合并；patch 中显式 undefined = 清除该属性，全空 → 移除 style 键） */
export function mergeStyleAt(edges: unknown, index: number, style: EdgeStyle): DocEdge[] {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.map((e, i) => {
    if (i !== index) return e;
    const nextStyle: EdgeStyle = { ...(e.style ?? {}) };
    // 遍历 patch 键：显式 undefined = 清除（区分「未提供」与「清除」——否则默认按钮/取消虚线失效）
    for (const [k, v] of Object.entries(style)) {
      if (v === undefined) delete (nextStyle as Record<string, unknown>)[k];
      else (nextStyle as Record<string, unknown>)[k] = v;
    }
    const rest: DocEdge = { ...e };
    if (Object.keys(nextStyle).length === 0) delete rest.style;
    else rest.style = nextStyle;
    return rest;
  });
}

/** 查重：同 from+to+rel 的边已存在 → 返回其 index（防重叠双线） */
export function findDuplicateEdge(
  edges: unknown,
  edge: Pick<DocEdge, 'from' | 'to' | 'rel'>,
): number {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.findIndex((e) => e.from === edge.from && e.to === edge.to && e.rel === edge.rel);
}

export function removeEdgeAt(edges: unknown, index: number): DocEdge[] {
  const arr = Array.isArray(edges) ? (edges as DocEdge[]) : [];
  return arr.filter((_, i) => i !== index);
}

/** 从 note 中取 edges 原始数组 */
export function edgesOf(note: Note | undefined): DocEdge[] {
  const raw = note?.edges;
  return Array.isArray(raw) ? (raw as DocEdge[]) : [];
}

// ---------- 紧凑样式系统（E7：264px、placeholder 代替标签行、单行化） ----------

export const POP_WIDTH = 264;

export const popStyle = () => ({
  position: 'fixed' as const,
  width: POP_WIDTH,
  background: 'rgba(22,24,29,0.92)',
  border: '1px solid rgba(128,128,128,0.35)',
  borderRadius: 10,
  boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
  backdropFilter: 'blur(14px) saturate(1.3)',
  padding: 10,
  zIndex: 40,
  fontFamily: 'inherit',
});

export const inputStyle = {
  width: '100%',
  boxSizing: 'border-box' as const,
  padding: '4px 7px',
  borderRadius: 6,
  border: '1px solid rgba(128,128,128,0.3)',
  background: 'transparent',
  color: 'inherit',
  fontSize: 12,
} as const;

export const headRow = { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 } as const;
export const closeBtn = { cursor: 'pointer', opacity: 0.6, fontSize: 14, lineHeight: 1 } as const;

/** 方向三态按钮（→ ← ↔；替代 select——一眼可读） */
export function DirToggle({ value, onChange }: { value: LinkDir; onChange: (d: LinkDir) => void }) {
  const { token } = useTheme();
  const opts: Array<{ v: LinkDir; t: string; title: string }> = [
    { v: 'fwd', t: '→', title: '源 → 目标' },
    { v: 'back', t: '←', title: '目标 → 源' },
    { v: 'both', t: '↔', title: '双向' },
  ];
  return (
    <div data-dir-toggle style={{ display: 'flex', gap: 2, flex: 'none' }}>
      {opts.map((o) => (
        <button
          key={o.v}
          data-dir-opt={o.v}
          title={o.title}
          onClick={() => onChange(o.v)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border:
              '1px solid ' + (value === o.v ? token.color.selection : 'rgba(128,128,128,0.3)'),
            background: 'transparent',
            color: value === o.v ? token.color.selection : 'inherit',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

/**
 * 绕行侧三态切换：自动 / 绕左 / 绕右（对标 markvault-js routingSide）。
 *
 * 与 manual（精确几何锁定）的区别：routingSide 只定**方向**，曲率仍由算法在该侧内择优。
 * 未指定（auto）时由美学评分自动决定。
 */
export function RoutingSideToggle({
  value,
  onChange,
  disabled,
  disabledTitle,
}: {
  value?: 'left' | 'right';
  onChange: (v: 'left' | 'right' | undefined) => void;
  /** R3-1：manual 锁定期间禁用（静默 no-op 的显式化） */
  disabled?: boolean;
  /** R3-1：禁用态 tooltip（指引恢复入口） */
  disabledTitle?: string;
}) {
  const { token } = useTheme();
  const opts: Array<{ v: 'left' | 'right' | undefined; t: string; title: string }> = [
    { v: undefined, t: 'A', title: '自动（由美学评分决定绕行侧）' },
    { v: 'left', t: '↰', title: '绕左' },
    { v: 'right', t: '↱', title: '绕右' },
  ];
  return (
    <div data-routing-side-toggle style={{ display: 'flex', gap: 2, flex: 'none' }}>
      {opts.map((o) => (
        <button
          key={o.v ?? 'auto'}
          data-routing-side-opt={o.v ?? 'auto'}
          disabled={disabled}
          aria-disabled={disabled || undefined}
          title={disabled === true && disabledTitle !== undefined ? disabledTitle : o.title}
          onClick={() => onChange(o.v)}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border:
              '1px solid ' + (value === o.v ? token.color.selection : 'rgba(128,128,128,0.3)'),
            background: 'transparent',
            color: value === o.v ? token.color.selection : 'inherit',
            cursor: disabled ? 'not-allowed' : 'pointer',
            opacity: disabled ? 0.45 : 1,
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}

/** 样式单行：默认 + 色板 + 虚线 + 粗细（E7 单行化） */
export function StyleRow({
  style,
  onStyle,
}: {
  style: EdgeStyle;
  onStyle: (patch: EdgeStyle) => void;
}) {
  const presets = EDGE_STYLE_PRESETS;
  return (
    <div data-edge-style style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        data-style-default
        title="默认（跟随关系类型语义色）"
        onClick={() => onStyle({ color: undefined })}
        style={{
          ...inputStyle,
          width: 'auto',
          cursor: 'pointer',
          padding: '2px 6px',
          fontSize: 11,
          opacity: style.color ? 0.6 : 1,
        }}
      >
        默认
      </button>
      {presets.map((p) => (
        <button
          key={p.color}
          data-style-color={p.color}
          title={p.label}
          onClick={() => onStyle({ color: p.color })}
          style={{
            width: 15,
            height: 15,
            borderRadius: '50%',
            border: style.color === p.color ? '2px solid #fff' : '1px solid rgba(128,128,128,0.4)',
            background: p.color,
            cursor: 'pointer',
            padding: 0,
            flex: 'none',
          }}
        />
      ))}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          fontSize: 11,
          cursor: 'pointer',
          marginLeft: 2,
        }}
      >
        <input
          type="checkbox"
          data-style-dashed
          checked={style.dashed ?? false}
          onChange={(e) => onStyle({ dashed: e.target.checked || undefined })}
        />
        虚线
      </label>
      <select
        data-style-width
        value={style.width ?? ''}
        onChange={(e) =>
          onStyle({ width: e.target.value === '' ? undefined : Number(e.target.value) })
        }
        style={{ ...inputStyle, width: 58, cursor: 'pointer', padding: '2px 4px', fontSize: 11 }}
      >
        <option value="">粗细</option>
        <option value={1}>细</option>
        <option value={2}>中</option>
        <option value={3}>粗</option>
      </select>
    </div>
  );
}

/** 预设样式色板（跨主题醒目色） */
export const EDGE_STYLE_PRESETS: readonly { label: string; color: string }[] = [
  { label: '红', color: '#e24b4a' },
  { label: '琥珀', color: '#ef9f27' },
  { label: '绿', color: '#10b981' },
  { label: '青', color: '#0891b2' },
  { label: '蓝', color: '#378add' },
  { label: '紫', color: '#7f77dd' },
];

export function clampPos(x: number, y: number, w: number, h: number): { left: number; top: number } {
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - w - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - h - 8)),
  };
}
