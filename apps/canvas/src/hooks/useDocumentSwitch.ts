/**
 * 文档切换 hook —— B1 逻辑从 `MindmapStage.tsx` 抽出（纯搬迁，动作与依赖逐字保留）。
 *
 * 语义（原 effect，MindmapStage.tsx:371-395）：
 * - `doc.source` 变化 = 真正的文档切换 → controller.reset（清 history/折叠/选中）
 *   + 实体表重建 + 收起 QA 展开 + 适配视图（fit）。
 * - 首挂**同源**（controller 已按当前树创建）跳过其后 4 个动作（MapView 初始 fit 已处理，
 *   避免重复动画）；首挂**不同源**（启动页出口这类「StageContent 挂载前改 `doc`」的路径）
 *   → 补做切换动作（S2F 修复）。但**首挂仍要**把文档内实体引用登记进候选宿主（跨文档复用）。
 * - S2G：本 hook 同时是同步标记 `syncedSourceRef` 的两个写点（首挂同源跳过 / reset 后置位），
 *   供保存侧守卫（`saveGuard.ts`）判定写盘安全性。
 *
 * 依赖纪律（E 批判别）：**保存路径不得改写 `doc.source`**（见
 * docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md）——deps 严格锁在 `doc.source`：
 * 不得改用对象身份（`doc`）或把 `savedSource`/`ts`/`handle` 放进 deps，
 * 否则保存路径的写回（E 批起只动 savedSource）会误触发文档重建。
 */
import { useEffect, useRef } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { EditableNode, Entity, EntityRef } from '@mindcanvas/kernel';
import type { EditorController, EntityHost, MapViewApi, MindDoc } from '@mindcanvas/react';
import { buildEntities } from '@mindcanvas/react';

export interface DocumentSwitchOptions {
  doc: MindDoc;
  editable: EditableNode | null;
  refs: EntityRef[];
  entities: Map<string, Entity>;
  entityHost: EntityHost;
  /** 引用标题表（buildEntities 的第二入参；apps 层为 GATEWAY_TITLES） */
  gatewayTitles: Record<string, { title: string; status?: string }>;
  controllerRef: RefObject<EditorController | null>;
  /** S2G：同步标记（写点：首挂同源跳过 / reset 后置位；供保存侧守卫读） */
  syncedSourceRef: RefObject<string | null>;
  setEntities: Dispatch<SetStateAction<Map<string, Entity>>>;
  setExpandedQaId: Dispatch<SetStateAction<string | null>>;
  apiRef: RefObject<MapViewApi | null>;
}

export function useDocumentSwitch({
  doc,
  editable,
  refs,
  entities,
  entityHost,
  gatewayTitles,
  controllerRef,
  syncedSourceRef,
  setEntities,
  setExpandedQaId,
  apiRef,
}: DocumentSwitchOptions): void {
  // B1 文档切换：新 source → controller.reset（清 history/折叠/选中）+ 实体表重建 + 展开收起 + 适配视图
  // 首挂**同源**跳过（controller 已按当前树创建 + MapView 初始 fit 已处理；避免重复动画）；
  // 首挂不同源（启动页出口：StageContent 挂载前 doc 已换）→ 补做切换（S2F）
  const firstDocEffectRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 纯搬迁段——deps 刻意保持 [doc.source]（原 eslint-disable 注释），行为由 useDocumentSwitch.test 判别
  useEffect(() => {
    if (!editable) return;
    const isFirst = firstDocEffectRef.current;
    firstDocEffectRef.current = false;
    // N1：文档内实体引用登记进候选宿主（首挂与切换都登记 → 跨文档可复用）
    entityHost.remember(
      refs
        .filter((r) => r.kind !== 'img' && r.kind !== 'draw')
        .map((r) => ({
          kind: r.kind,
          id: r.id,
          title: entities.get(`${r.kind}:${r.id}`)?.title ?? null,
        })),
      doc.name,
    );
    // 首挂且同源才跳过（S2F 状态判据）；不同源补做切换
    if (isFirst && controllerRef.current?.root === editable) {
      syncedSourceRef.current = doc.source; // S2G 写点②：跳过 = 树本就同源，置位（幂等）
      return;
    }
    controllerRef.current?.reset(editable);
    syncedSourceRef.current = doc.source; // S2G 写点③：reset 后树 = 该文档 → 置位
    setEntities(buildEntities(refs, gatewayTitles));
    setExpandedQaId(null);
    apiRef.current?.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.source]);
}
