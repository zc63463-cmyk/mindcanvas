/**
 * 节点动作袋（右键菜单与**二级环**同一闭包）
 * ══════════════════════════════════════════════════════════════════════
 * T5 画布接线时从 `NodeContextMenu.tsx` 抽出：环席位与菜单项若各建一套闭包，
 * 「改的不是同一段实现」会随版本漂移——T5 验收明确要求**同一闭包**。
 *
 * 只抽**与位置无关**的三个袋（描述 / 笔记 / 中心：只依赖节点与文档事实）；
 * 依赖菜单坐标的袋（实体 picker、连线、生长方向的「自定义长度气泡」）留在 `NodeContextMenu`。
 *
 * 事实读取与行为与抽取前**逐行一致**（纯搬运，无改写）。
 *
 * C1（2026-09-13）：中心袋的 `onPromote` 由「upsertCenter + updateNote」双轨统一到
 * `planPromoteCenter + applyTransaction`（与「设为 Section」共用唯一写路径）——
 * 升格开始分配/沿用 cid、单批 ops 一次 undo、root 守卫与失败通道随 plan 生效。
 */
import { pathOfNode } from '@mindcanvas/kernel';
import {
  anchorOfNode,
  collectCenters,
  planAttachIsland,
  planPromoteCenter,
  removeCenter,
  summarizeReferenceDiagnostics,
  upsertCenter,
  type CenterMenuActions,
  type DescMenuActions,
  type EditorController,
  type NoteMenuActions,
  type SummaryMenuActions,
} from '@mindcanvas/react';

/** 宿主回调（形状与 `NodeContextMenu` 的 props 一致） */
export interface NodeBagHost {
  /** 进入描述编辑（盒内） */
  setDescEditingId: (id: string) => void;
  /** 打开固定笔记（盒下）；传**索引路径**（文档重解析会重建 id，路径才稳定） */
  setPinnedNotePath: (path: number[], editing?: boolean) => void;
  /** A5：接回/事务失败的告警回调（命令层结构化拒绝 → 用户可见提示） */
  onAttachError?: (message: string) => void;
  /**
   * PROMOTE-SEED-1：升格落点取点（升格前布局盒中心），由产品壳注入布局事实。
   * 未命中（折叠隐藏 / 未入 layout）返回 undefined → **不传 pos**（禁止回落 (0,0)，
   * 走既有 center_pos 吸附或自动排布）。
   */
  layoutPosOf?: (id: string) => { x: number; y: number } | undefined;
  /**
   * S2：以某节点为摘要范围起点，进入**两跳等待态**（第一跳）。
   * 置 `summaryDraft` 并提示「点选范围末成员（需同一父级；Esc 取消）」——
   * 第二跳由 `MindmapStage` 的 `onNodeClick` 首判完成（与 E7 Shift 两连跳同族）。
   */
  onStartSummary?: (id: string) => void;
}

/** v1.3.0 幕布描述入口：与 Shift+Enter 同一动作 */
export function makeDescActions(host: NodeBagHost): DescMenuActions {
  return { onStart: (id) => host.setDescEditingId(id) };
}

/**
 * S2 摘要入口（「创建摘要…」）：只做**第一跳**——登记范围起点并进入等待态。
 *
 * 第二跳（点选末成员后真正建节点）不在菜单里：那是 `MindmapStage.onNodeClick`
 * 首判的职责（与 E7 Shift 两连跳同族，计划 S-A4 明确不用 LinkCreator 候选面板）。
 */
export function makeSummaryActions(host: NodeBagHost): SummaryMenuActions {
  return { onStartSummary: (id) => host.onStartSummary?.(id) };
}

/** note 笔记入口：固定展示并进入编辑（与描述是不同内容） */
export function makeNoteActions(controller: EditorController, host: NodeBagHost): NoteMenuActions {
  return { onStart: (id) => host.setPinnedNotePath(pathOfNode(controller.root, id) ?? [], true) };
}

/** G6′ 中心升格/降格 + G2 接回 + G3 父级连接 + C3 编号复制（坐标写 root.note.centers，节点保持纯净） */
export function makeCenterActions(
  controller: EditorController,
  docName: string,
  host: NodeBagHost,
): CenterMenuActions {
  return {
    isCenter: (id) => {
      const at = anchorOfNode(controller.root, id);
      if (!at) return false;
      return collectCenters(controller.root).some((c) => c.at === at);
    },
    // G3：跨岛父级连接显示状态（缺省 hide）
    parentLinkOf: (id) => {
      const at = anchorOfNode(controller.root, id);
      if (!at) return 'hide';
      return collectCenters(controller.root).find((c) => c.at === at)?.parentLink ?? 'hide';
    },
    onToggleParentLink: (id, next) => {
      const at = anchorOfNode(controller.root, id);
      if (!at) return;
      const nextNote = upsertCenter(controller.root.note, at, { parentLink: next });
      controller.updateNote(controller.root.id, {
        centers: nextNote.centers ?? undefined,
      });
    },
    // G2（A5）：切断独立标记与接回（成环/深度校验在命令层，失败经 onAttachError 上报）
    isDetached: (id) => {
      const at = anchorOfNode(controller.root, id);
      if (!at) return false;
      return collectCenters(controller.root).find((c) => c.at === at)?.detached ?? false;
    },
    onAttach: (id, targetParentId) => {
      const plan = planAttachIsland(controller.root, id, targetParentId);
      if (!plan.ok) {
        host.onAttachError?.(plan.error.message);
        return;
      }
      // R0-4：迁移诊断不再被吞——「本来就是坏」的引用保留原值时给用户可见提示（不阻断）
      const diag = summarizeReferenceDiagnostics(plan.diagnostics);
      if (diag !== null) host.onAttachError?.(diag);
      const result = controller.applyTransaction(plan.ops);
      if (!result.ok) host.onAttachError?.(result.error.message);
    },
    // C1：升格写路径统一——菜单/环同一入口，与「设为 Section」共用 planPromoteCenter
    // （分配/沿用 cid、坐标历史吸附、单批 ops 一次 undo、失败经 onAttachError 上报）。
    // 口径变更：at 不可解析（如空文本节点）时由 plan 兜底 `cid:` 锚继续升格，不再静默不动作。
    // PROMOTE-SEED-1：落点 = 升格前布局盒中心（与切断同口径，防蹦到森林自动槽）；
    // 无盒（undefined）→ 不传 pos：走 upsertCenter 既有「历史吸附 / 自动排布」。
    onPromote: (id, dir) => {
      const pos = host.layoutPosOf?.(id);
      const plan = planPromoteCenter(controller.root, id, {
        dir,
        ...(pos !== undefined ? { pos } : {}),
      });
      if (!plan.ok) {
        host.onAttachError?.(plan.error.message);
        return;
      }
      const result = controller.applyTransaction(plan.ops);
      if (!result.ok) host.onAttachError?.(result.error.message);
    },
    onDemote: (id) => {
      const at = anchorOfNode(controller.root, id);
      if (!at) return;
      const before = controller.root.note;
      const next = removeCenter(before, at);
      // C2：未命中（非中心 / 无此 at 条目）→ 真 no-op——不写空 note、不置脏
      // （removeCenter 未命中时 centers 引用原样返回，与传入相同即证明没删到东西）
      if (next.centers === before?.centers) return;
      const centers = next.centers as unknown[] | undefined;
      const history = next.center_pos as unknown[] | undefined;
      controller.updateNote(controller.root.id, {
        // 清空后连键一起删（undefined 键被 updateNote 清除），避免留 centers: []
        centers: centers && centers.length > 0 ? centers : undefined,
        center_pos: history && history.length > 0 ? history : undefined,
      });
    },
    // C3：中心 cid 查询与复制（格式「文档名#cid」——跨文件时代天然兼容 doc+cid 寻址）
    cidOf: (id) => collectCenters(controller.root).find((c) => c.nodeId === id)?.cid,
    onCopyCid: (id) => {
      const cid = collectCenters(controller.root).find((c) => c.nodeId === id)?.cid;
      if (!cid) return;
      void navigator.clipboard?.writeText(`${docName}#${cid}`);
    },
  };
}
