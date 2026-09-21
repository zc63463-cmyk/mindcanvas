/**
 * 实体引用（@issue/@pr/…）的选取动作（从 `MindmapStage` 抽出，T1 结构治理续）。
 *
 * 语义：选中即登记 —— ① 写回节点的实体引用 ② 补进本地实体表（状态占位）
 * ③ 记入实体库（候选跨文档复用）④ 关闭 picker ⑤ 选中该节点。
 * `ref === null` = 清除引用（只做 ①，不登记）。
 *
 * 为什么抽出来：这段逻辑有 5 个副作用、约 20 行，夹在 40 行的 picker JSX 里，
 * 读代码时要在「挑候选」和「写回」两种意图之间来回跳。
 *
 * 不是什么：不含候选列表的计算（entityCandidates）与 picker 的开关状态，
 * 那些留在调用方 —— 本 hook 只负责「选完之后做什么」。
 */
import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Entity } from '@mindcanvas/kernel';
import type {
  EditorController,
  EntityRef,
  LocalEntityStore,
} from '@mindcanvas/react';

export interface EntityPickDeps {
  controller: EditorController;
  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;
  entityHost: LocalEntityStore;
  /** 当前文档名（实体登记时记录来源） */
  docName: string;
  /** 关闭 picker 并把焦点还给节点 */
  onDone: (nodeId: string) => void;
}

export function useEntityPick({
  controller,
  setEntities,
  entityHost,
  docName,
  onDone,
}: EntityPickDeps): (nodeId: string, ref: EntityRef | null) => void {
  return useCallback(
    (nodeId: string, ref: EntityRef | null): void => {
      if (ref === null) {
        controller.setEntityRef(nodeId, null);
      } else {
        controller.setEntityRef(nodeId, ref);
        const key = `${ref.kind}:${ref.id}`;
        setEntities((prev) =>
          prev.has(key)
            ? prev
            : new Map(prev).set(key, {
                kind: ref.kind,
                id: ref.id,
                title: ref.id,
                status: 'ready',
                ref: null,
              }),
        );
        // N1：选中即登记（候选跨文档复用）
        entityHost.remember([{ kind: ref.kind, id: ref.id, title: ref.id }], docName);
      }
      onDone(nodeId);
    },
    [controller, setEntities, entityHost, docName, onDone],
  );
}
