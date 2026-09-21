/**
 * 边（free edge）相关的三块浮层（从 `MindmapStage` 抽出，T1 结构治理续）：
 *
 *   ① 树自然线关系标注（E7，右键树边弹出）
 *   ② 连线创建器（E5，拖拽连线的目标候选 + rel/dir/样式）
 *   ③ 边编辑浮窗（E5，rel/dir/label/note/样式 + 失效标记）
 *
 * 三者与 `useEdgeActions` 是同一件事的两半：hook 管数据与选中态，本组件管交互。
 * 合在一起抽走后，`MindmapStage` 只保留一个 `<EdgeDraftLayer ... />`。
 *
 * 不是什么：不含边的图形路由与渲染（`FreeEdgeLayer`），那些在 `packages/react`。
 */
import { useEffect, useState } from 'react';
import type { EditorController } from '@mindcanvas/react';
import {
  anchorOfNode,
  EdgeEditor,
  edgesOf,
  findDuplicateEdge,
  LinkCreator,
  mergeStyleAt,
  patchEdgeAt,
  removeEdgeAt,
  TreeEdgeEditor,
  type DocEdge,
  type EdgeStyle,
  type TreeEdgeAnn,
} from '@mindcanvas/react';
const CHROME_BG = 'rgba(22,24,29,0.92)';

import {
  ContextMenu,
  defaultRelationSchema,
  EdgeAnchorPicker,
  edgeContextItems,
  type FreeEdge,
} from '@mindcanvas/react';
import type { EdgeActions } from './hooks/useEdgeActions.js';
import { nodeById } from './hooks/useEdgeActions.js';

/** R4-1：边右键菜单状态（edge + 指针屏幕坐标；由 Stage 持有并经 props 传入） */
export interface EdgeContextMenuState {
  edge: FreeEdge;
  x: number;
  y: number;
}

export interface EdgeDraftLayerProps {
  controller: EditorController;
  edgeActions: EdgeActions;
  /** 树边标注：正在编辑的树边（null = 未打开） */
  treeEdgeEdit: { childId: string; x: number; y: number } | null;
  /** 连线创建器：拖拽起点（null = 未打开） */
  linkDraft: { sourceId: string; x: number; y: number } | null;
  onCloseTreeEdge: () => void;
  onCloseLinkDraft: () => void;
  /** A5（G2）：切断并独立（子端 id）——命令编排由 Stage 负责 */
  onCutTreeEdge?: (childId: string) => void;
  /** R4-1：边右键菜单状态（Stage 持有；null = 关闭） */
  edgeMenu?: EdgeContextMenuState | null;
  onCloseEdgeMenu?: () => void;
  /** R4-2：提示通道（commandNotice）——反向未注册 rel 等一次可见提示 */
  onNotice?: (message: string) => void;
}

export function EdgeDraftLayer({
  controller,
  edgeActions,
  treeEdgeEdit,
  linkDraft,
  onCloseTreeEdge,
  onCloseLinkDraft,
  onCutTreeEdge,
  edgeMenu = null,
  onCloseEdgeMenu,
  onNotice,
}: EdgeDraftLayerProps) {
  // 取局部 const：TS 无法对 obj.prop 跨表达式收窄类型，不取局部变量守卫生效不了
  const selEdgeOpen = edgeActions.selEdge;
  // R4-1：重挂的临时目标（菜单项触发 → EdgeAnchorPicker 选锚 → reattachEdge）
  const [reattachTarget, setReattachTarget] = useState<{ index: number; side: 'from' | 'to' } | null>(
    null,
  );
  // R4-5：批量条打开时 Esc 清空集合
  const multiCount = edgeActions.edgeMultiSel.length;
  useEffect(() => {
    if (multiCount === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') edgeActions.clearEdgeMulti();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [multiCount, edgeActions]);

  return (
    <>
      {/* ① 树自然线关系标注（note.edge 结构化对象；仅右键树边弹出） */}
      {treeEdgeEdit && (
        <TreeEdgeEditor
          childId={treeEdgeEdit.childId}
          ann={(() => {
            const n = nodeById(controller.root, treeEdgeEdit.childId);
            const e = n?.note?.edge;
            return e && typeof e === 'object' ? (e as TreeEdgeAnn) : null;
          })()}
          viaLabel={(() => {
            const n = nodeById(controller.root, treeEdgeEdit.childId);
            return typeof n?.note?.via === 'string' ? (n.note.via as string) : '';
          })()}
          x={treeEdgeEdit.x}
          y={treeEdgeEdit.y}
          onChange={(ann) =>
            controller.updateNote(treeEdgeEdit.childId, ann ? { edge: ann } : { edge: undefined })
          }
          onCut={onCutTreeEdge}
          onClose={onCloseTreeEdge}
        />
      )}

      {/* ② 连线创建器（确认 → root note.edges 追加，经 update-node 可撤销） */}
      {linkDraft && (
        <LinkCreator
          choices={edgeActions.nodeChoices}
          x={linkDraft.x}
          y={linkDraft.y}
          onCreate={(edge: DocEdge) => {
            const from =
              edgeActions.anchorById.get(linkDraft.sourceId) ??
              anchorOfNode(controller.root, linkDraft.sourceId) ??
              '';
            onCloseLinkDraft();
            if (!from) return;
            const info = edgeActions.connectEdge(from, edge.to, edge.rel, linkDraft.x, linkDraft.y);
            if (info.skippedInvalid > 0) {
              onNotice?.(
                `已存在 ${info.skippedInvalid} 条同名失效边——已新建，原失效边保留`,
              );
            }
            // 创建器携带的 dir/label/note/style 需落到（可能已存在的）边上
            const cur = edgesOf(controller.root.note);
            const idx = findDuplicateEdge(cur, { from, to: edge.to, rel: edge.rel });
            const extras: Partial<DocEdge> = {};
            if (edge.dir) extras.dir = edge.dir;
            if (edge.label) extras.label = edge.label;
            if (edge.note) extras.note = edge.note;
            if (edge.style) extras.style = edge.style;
            if (Object.keys(extras).length > 0 && idx >= 0) {
              edgeActions.writeEdges(patchEdgeAt(cur, idx, extras));
            }
          }}
          onClose={onCloseLinkDraft}
        />
      )}

      {/* ③ 边编辑浮窗（rel/dir/label/note + 样式即时落 root.note.edges；删除可撤销） */}
      {edgeActions.edgeSel && selEdgeOpen && (
        <EdgeEditor
          edge={{
            key: selEdgeOpen.key,
            index: selEdgeOpen.index,
            rel: selEdgeOpen.rel,
            dir: selEdgeOpen.dir,
            from: selEdgeOpen.from,
            to: selEdgeOpen.to,
            ...(selEdgeOpen.label !== undefined ? { label: selEdgeOpen.label } : {}),
            ...(selEdgeOpen.note !== undefined ? { note: selEdgeOpen.note } : {}),
            ...(selEdgeOpen.style !== undefined ? { style: selEdgeOpen.style } : {}),
            ...(selEdgeOpen.invalidAt !== undefined ? { invalidAt: selEdgeOpen.invalidAt } : {}),
            ...(selEdgeOpen.routingSide !== undefined
              ? { routingSide: selEdgeOpen.routingSide }
              : {}),
            ...(selEdgeOpen.manual !== undefined ? { manual: selEdgeOpen.manual } : {}),
            // R6-S2：attrs 透传到只读属性区（面板/画布消费同一 FreeEdge 引用，不克隆）
            ...(selEdgeOpen.attrs !== undefined ? { attrs: selEdgeOpen.attrs } : {}),
          }}
          x={edgeActions.edgeSel.x}
          y={edgeActions.edgeSel.y}
          currentD={edgeActions.selEdgeCurrentD}
          currentBowSide={edgeActions.selEdgeBowSide}
          choices={edgeActions.nodeChoices}
          onReattach={(side, anchor) => {
            edgeActions.reattachEdge(selEdgeOpen.index, side, anchor);
          }}
          onDirChange={(d) => {
            edgeActions.setEdgeDir(selEdgeOpen.index, d);
          }}
          onReverse={() => {
            const info = edgeActions.reverseEdge(selEdgeOpen.index);
            if (info.message !== undefined) onNotice?.(info.message);
          }}
          forcedSideFallback={edgeActions.selEdgeForcedSideFallback}
          // Issue #3 / forceSide：routingSide 经 patch 写回（含 undefined = 恢复自动）
          onChange={(patch: Partial<DocEdge>) => {
            edgeActions.writeEdges(
              patchEdgeAt(edgesOf(controller.root.note), selEdgeOpen.index, patch),
            );
          }}
          onStyle={(patch: EdgeStyle) => {
            edgeActions.writeEdges(
              mergeStyleAt(edgesOf(controller.root.note), selEdgeOpen.index, patch),
            );
          }}
          onInvalidate={() => {
            const info = edgeActions.setEdgeInvalid(selEdgeOpen.index, true);
            if (info.cascaded > 0) onNotice?.(`已同步 ${info.cascaded} 条反向关系`);
          }}
          onRestore={() => {
            const info = edgeActions.setEdgeInvalid(selEdgeOpen.index, false);
            if (info.cascaded > 0) onNotice?.(`已同步 ${info.cascaded} 条反向关系`);
          }}
          onDelete={() => {
            edgeActions.writeEdges(removeEdgeAt(edgesOf(controller.root.note), selEdgeOpen.index));
            edgeActions.setEdgeSel(null);
          }}
          onClose={() => edgeActions.setEdgeSel(null)}
        />
      )}
      {/* R4-1：边右键菜单（数据 edgeContextItems；动作走 useEdgeActions 唯一写路径） */}
      {edgeMenu !== null && (() => {
        const index = Number(edgeMenu.edge.key.slice(1));
        const cfg = defaultRelationSchema.getConfig(edgeMenu.edge.rel);
        const items = edgeContextItems(
          {
            key: edgeMenu.edge.key,
            rel: edgeMenu.edge.rel,
            dir: edgeMenu.edge.dir,
            ...(edgeMenu.edge.invalidAt !== undefined
              ? { invalidAt: edgeMenu.edge.invalidAt }
              : {}),
            hasManual: edgeMenu.edge.manual !== undefined,
            sourceResolved: edgeMenu.edge.sourceId !== null,
            targetResolved: edgeMenu.edge.targetId !== null,
            relRegistered: cfg !== undefined,
            relSymmetric: cfg?.isSymmetric === true,
          },
          {
            onEdit: onCloseEdgeMenu,
            onReattach: (side) => {
              setReattachTarget({ index, side });
              onCloseEdgeMenu?.();
            },
            onReverse: () => {
              const info = edgeActions.reverseEdge(index);
              if (info.message !== undefined) onNotice?.(info.message);
              onCloseEdgeMenu?.();
            },
            onDuplicate: () => {
              edgeActions.duplicateEdge(index);
              onCloseEdgeMenu?.();
            },
            onToggleInvalid: () => {
              const info = edgeActions.setEdgeInvalid(
                index,
                edgeMenu.edge.invalidAt === undefined,
              );
              if (info.cascaded > 0) onNotice?.(`已同步 ${info.cascaded} 条反向关系`);
              onCloseEdgeMenu?.();
            },
            onDelete: () => {
              edgeActions.deleteEdge(index);
              onCloseEdgeMenu?.();
            },
          },
        );
        return <ContextMenu x={edgeMenu.x} y={edgeMenu.y} items={items} onClose={() => onCloseEdgeMenu?.()} />;
      })()}
      {reattachTarget !== null && (
        <EdgeAnchorPicker
          choices={edgeActions.nodeChoices}
          onPick={(anchor) => {
            edgeActions.reattachEdge(reattachTarget.index, reattachTarget.side, anchor);
            setReattachTarget(null);
          }}
          onClose={() => setReattachTarget(null)}
        />
      )}
      {/* R4-5：批量条（≥2 条多选时出现；失效跳过已失效并提示；删除一次 undo 全回滚） */}
      {multiCount >= 2 && (
        <div
          data-edge-multi-bar
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 48,
            transform: 'translateX(-50%)',
            zIndex: 30,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 12px',
            borderRadius: 8,
            background: CHROME_BG,
            border: '1px solid rgba(128,128,128,0.35)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            fontSize: 12,
            color: '#ddd',
          }}
        >
          <span style={{ fontWeight: 600 }}>{multiCount} 条</span>
          <button
            data-edge-multi-action
            onClick={() => {
              const skipped = edgeActions.batchInvalidate();
              if (skipped > 0) onNotice?.(`已跳过 ${skipped} 条已失效`);
            }}
            style={{ background: 'transparent', border: 'none', color: '#ddd', cursor: 'pointer' }}
          >
            失效
          </button>
          <button
            data-edge-multi-action
            onClick={() => {
              edgeActions.batchRestore();
            }}
            style={{ background: 'transparent', border: 'none', color: '#ddd', cursor: 'pointer' }}
          >
            恢复
          </button>
          <button
            data-edge-multi-action
            onClick={() => {
              edgeActions.batchDelete();
            }}
            style={{ background: 'transparent', border: 'none', color: '#e24b4a', cursor: 'pointer' }}
          >
            删除
          </button>
        </div>
      )}
    </>
  );
}
