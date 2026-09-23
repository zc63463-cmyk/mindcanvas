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
import type { DocumentSaveSession } from './useDocumentSaveSession.js';

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
  /**
   * SAVE-LIFECYCLE：保存会话（可选）。`doc.source` 变化（= 显式文档替换）时兜底推进会话
   * 令牌 —— 主入口是 `applyDoc` 的同步推进；此处覆盖不经 applyDoc 的替换路径。
   */
  session?: DocumentSaveSession;
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
  session,
  setEntities,
  setExpandedQaId,
  apiRef,
}: DocumentSwitchOptions): void {
  // B1 文档切换：新 source → 实体表重建 + 展开收起 + 适配视图（**视图职责**）
  // 首挂**同源**跳过（controller 已按当前树创建 + MapView 初始 fit 已处理；避免重复动画）；
  // 首挂不同源（启动页出口：StageContent 挂载前 doc 已换）→ 补做切换（S2F）
  //
  // ── P0-FIX-R1 R1-3：树重置与 S2G 置位已**移出**本 effect ──────────────────
  //
  // 本 effect 是被动 effect（commit 后才跑），而「打开 → 立刻编辑 → Ctrl+S」的保存
  // 决策发生在它之前 —— 把 `controller.reset` 与 `syncedSourceRef` 留在这里，就等于
  // 承认存在一个「树已换、守卫还认为没换」的窗口，整次保存被拦（真机 5 次 4 拦）。
  //
  // 现在两件事都在 `performApplyDoc` 内**同步**完成（parse → reset → 置位，同事务），
  // 那里是文档替换的唯一定义性入口。本 effect 只留表现层：实体表重建、收起展开态、
  // 视图适配；以及**兜底**推进保存会话令牌（覆盖不经 applyDoc 的替换路径，如启动页出口）。
  //
  // 首挂不同源（S2F 路径）仍在此补做：那条路径的 `doc` 是在 StageContent 挂载前改的，
  // controller 按**旧**树创建 → 这里必须把它换成新树。R1-3 的同步 reset 走的是
  // applyDoc，覆盖不到「挂载前就换好」的情形，故保留这条补做分支（它同时置位 synced，
  // 与 applyDoc 的置位同值、幂等）。
  const firstDocEffectRef = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 纯搬迁段——deps 刻意保持 [doc.source]（原 eslint-disable 注释），行为由 useDocumentSwitch.test 判别
  useEffect(() => {
    const isFirst = firstDocEffectRef.current;
    firstDocEffectRef.current = false;
    // SAVE-LIFECYCLE 兜底：source 变化 = 文档被替换 → 推进保存会话令牌并同步换目的地
    // （幂等：主入口已推进）。放在 editable 早退之前 —— 解析失败也不能让旧会话的迟到回调
    // 回填新文档。
    if (!isFirst) session?.beginDocument(doc.handle);
    if (!editable) return;
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
    // 首挂且同源才**整体跳过**（S2F 状态判据：controller 已按当前树创建 + MapView
    // 初始 fit 已处理，四个动作都不该做）。
    if (isFirst && controllerRef.current?.root === editable) {
      syncedSourceRef.current = doc.source; // S2G 写点②：跳过 = 树本就同源，置位（幂等）
      return;
    }
    // 真正的切换（或首挂不同源的补做）：树若还不是新的就换掉。
    //
    // R1-3：`performApplyDoc` 已在替换的同事务里同步 reset 过 —— 那种情况下
    // `root === editable` 成立，这里**不重复** reset（幂等，也避免把刚清干净的
    // history/折叠态再清一遍）。而「挂载前就换好 doc」的 S2F 路径 root 仍是旧树，
    // 这里必须补做 —— 这条分支就是它存在的理由。
    if (controllerRef.current?.root !== editable) {
      controllerRef.current?.reset(editable);
    }
    syncedSourceRef.current = doc.source; // S2G 写点③：树 = 该文档 → 置位（幂等）
    setEntities(buildEntities(refs, gatewayTitles));
    setExpandedQaId(null);
    apiRef.current?.fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.source]);
}
