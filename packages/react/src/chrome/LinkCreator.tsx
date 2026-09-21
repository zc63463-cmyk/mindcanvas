/**
 * LinkCreator（E5/E7）：新建连线浮窗（目标候选 + rel 模板 + dir + 样式）。
 *
 * R3-6 机械拆分：原与 EdgeEditor/TreeEdgeEditor 同文件（EdgeEditor.tsx 破 600 行
 * bigFiles 上限），按组件边界抽出——纯搬运零逻辑改动；公开出口经 EdgeEditor.tsx
 * re-export 保持既有 import 路径不变（index.ts 亦然）。
 */
import { useMemo, useState } from 'react';
import type { LinkDir } from '@mindcanvas/kernel';
import { useTheme } from '../theme/ThemeContext.js';
import type { DocEdge, EdgeStyle } from '../render/freeEdges.js';
import {
  clampPos,
  closeBtn,
  DirToggle,
  headRow,
  inputStyle,
  popStyle,
  StyleRow,
  type NodeChoice,
} from './edgeEditorShared.js';
import { defaultRelationSchema } from './relationSchema.js';

export function LinkCreator({
  choices,
  x,
  y,
  onCreate,
  onClose,
}: {
  choices: readonly NodeChoice[];
  x: number;
  y: number;
  onCreate: (edge: DocEdge) => void;
  onClose: () => void;
}) {
  const { token } = useTheme();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<NodeChoice | null>(null);
  const [rel, setRel] = useState('relates-to');
  const [dir, setDir] = useState<LinkDir>('fwd');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [style, setStyle] = useState<EdgeStyle>({});
  const filtered = useMemo(
    () =>
      (query.trim() === '' ? choices : choices.filter((c) => c.label.includes(query.trim()))).slice(
        0,
        40,
      ),
    [choices, query],
  );
  const canCreate = picked !== null && rel.trim() !== '';
  return (
    <div
      data-link-creator
      style={{ ...popStyle(), width: 300, ...clampPos(x, y, 300, 400), color: token.color.text }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div style={headRow}>
        <span style={{ fontSize: 12, fontWeight: 600, color: token.color.selection }}>连线到…</span>
        <span style={{ flex: 1 }} />
        <span data-link-creator-close onClick={onClose} style={closeBtn}>
          ×
        </span>
      </div>
      {!picked && (
        <>
          <input
            autoFocus
            data-link-query
            value={query}
            placeholder="搜索节点 / 实体…"
            onChange={(e) => setQuery(e.target.value)}
            style={{ ...inputStyle, marginBottom: 6 }}
          />
          <div data-link-choices style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 8 }}>
            {filtered.map((c) => (
              <div
                key={c.anchor}
                data-link-choice
                onClick={() => setPicked(c)}
                style={{
                  padding: '4px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 12,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {c.label}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ fontSize: 11, opacity: 0.6, padding: 4 }}>无候选</div>
            )}
          </div>
        </>
      )}
      {picked && (
        <div
          data-link-target
          style={{
            marginBottom: 6,
            padding: '4px 6px',
            borderRadius: 6,
            border: '1px solid rgba(128,128,128,0.3)',
            fontSize: 12,
          }}
        >
          {picked.label}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
        <input
          data-link-rel
          list="rel-templates-creator"
          placeholder="关系类型"
          value={rel}
          onChange={(e) => setRel(e.target.value)}
          style={inputStyle}
        />
        <datalist id="rel-templates-creator">
          {defaultRelationSchema.activeOptions().map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </datalist>
        <DirToggle value={dir} onChange={setDir} />
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
        <input
          data-link-label
          placeholder="标签"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          style={inputStyle}
        />
        <input
          data-link-note
          placeholder="备注"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={inputStyle}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <StyleRow style={style} onStyle={(patch) => setStyle((s) => ({ ...s, ...patch }))} />
      </div>
      <button
        data-link-create
        disabled={!canCreate}
        onClick={() => {
          if (!picked) return;
          onCreate({
            from: '',
            to: picked.anchor,
            rel: rel.trim(),
            ...(dir !== 'fwd' ? { dir } : {}),
            ...(label.trim() !== '' ? { label: label.trim() } : {}),
            ...(note.trim() !== '' ? { note: note.trim() } : {}),
            ...(style.color || style.dashed || style.width !== undefined ? { style } : {}),
          });
        }}
        style={{
          ...inputStyle,
          cursor: canCreate ? 'pointer' : 'not-allowed',
          opacity: canCreate ? 1 : 0.45,
          color: token.color.selection,
          borderColor: token.color.selection,
        }}
      >
        创建连线
      </button>
    </div>
  );
}
