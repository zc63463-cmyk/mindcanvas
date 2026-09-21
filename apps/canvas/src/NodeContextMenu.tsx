/**
 * 节点右键菜单（从 `MindmapStage` 抽出，T1 结构治理续）。
 *
 * 菜单项由 `contextMenuItemsFor` 生成，含四组动作：
 *   ① 通用（新建/编辑/层级/折叠/删除）
 *   ② 实体节点专属（改引用 → 开 picker；在关系图中显示 → 开面板）
 *   ③ 关系模式专属（连线到… → 以该节点为源新建自由边；E8 仅关系模式暴露）
 *   ④ 描述 / 笔记 / 中心（**T5 起与二级环共用**：闭包由宿主经 `nodeMenuBags.ts` 构建后注入）
 *
 * 为什么整块抽走：菜单项的构造与 `<ContextMenu>` 的渲染是同一件事，
 * 分开只会让主函数留着一堆 setState 回调。
 *
 * 不是什么：不含菜单项的渲染与键盘交互（`ContextMenu` 自己管）；
 * 也不含「与环共用」的三袋闭包（那部分在 `nodeMenuBags.ts`，菜单与环消费同一份）。
 */
import {
  contextMenuItemsFor,
  ContextMenu,
  readGrowDir,
  type CenterMenuActions,
  type EditorController,
  type SectionMenuActions,
  type SummaryMenuActions,
} from '@mindcanvas/react';
import { readLensMap } from '@mindcanvas/kernel';
import { nodeById } from './hooks/useEdgeActions.js';
import { applyLen, currentLenOf } from './lenEdit.js';

/** 侧面板标识（与 MindmapStage 的 panel 状态一致；null = 全部关闭） */
export type PanelId = 'search' | 'relation' | 'outline' | 'assets' | null;

/** 右键菜单状态：目标节点 + 屏幕坐标 */
export interface CtxMenuState {
  nodeId: string;
  x: number;
  y: number;
}

export interface NodeContextMenuProps {
  /** 当前右键目标（null = 未打开，由调用方决定是否渲染） */
  ctxMenu: CtxMenuState;
  controller: EditorController;
  /** 是否关系编辑模式（决定是否有「连线到…」入口） */
  relationMode: boolean;
  /**
   * T5：与二级环**共用**的动作袋（由 `MindmapStage` 构建一次）——
   * 菜单项与环席位调的是同一段闭包（单一动作源，防两处漂移）。
   * （描述 / 笔记的袋不再进菜单——T6 阶段 1 起由环席位承担。）
   */
  centerActions: CenterMenuActions;
  /** 打开实体 picker（改引用） */
  setPicker: (v: { nodeId: string; query: string; current: { kind: string; id: string } | null } | null) => void;
  /** 打开侧面板（'relation' 等） */
  setPanel: (v: PanelId) => void;
  /** 开始连线（以该节点为源） */
  setLinkDraft: (v: { sourceId: string; x: number; y: number } | null) => void;
  /** v1.8.1：「出线长度 › 自定义…」→ 宿主弹数值气泡（原生 prompt 已退役，裁决 M3） */
  onRequestLenCustom?: (id: string, x: number, y: number, current: number | null) => void;
  /**
   * FO-UI1：「改框深度…」→ 宿主弹数值步进气泡（带当前值与合法上界）。
   * 未注入 → 菜单不出现该项（原生 prompt 路径已退役）。
   */
  onRequestFrameDepth?: (id: string, x: number, y: number, current: number, max: number) => void;
  /** v1.5.0 Section 三态菜单动作（D1：Section ⇒ center；写入走 controller 事务通道） */
  sectionActions?: SectionMenuActions;
  /**
   * S2：摘要菜单动作（「创建摘要…」= 两跳交互的第一跳）。
   * 未注入 → 不出现该菜单项（与 frameActions / sectionActions 同款可选袋）。
   */
  summaryActions?: SummaryMenuActions;
  onClose: () => void;
}

export function NodeContextMenu({
  ctxMenu,
  controller,
  relationMode,
  centerActions,
  setPicker,
  setPanel,
  setLinkDraft,
  onRequestLenCustom,
  onRequestFrameDepth,
  sectionActions,
  summaryActions,
  onClose,
}: NodeContextMenuProps) {
  return (
    <ContextMenu
      x={ctxMenu.x}
      y={ctxMenu.y}
      items={contextMenuItemsFor(
        controller,
        ctxMenu.nodeId,
        {
          // N2：实体节点专属动作（改引用 → 开 picker；在关系图中显示 → 开面板）
          onEditRef: (id) => {
            const n = nodeById(controller.root, id);
            setPicker({
              nodeId: id,
              query: n?.text ?? '',
              current: n?.ref ? { kind: n.ref.kind, id: n.ref.id } : null,
            });
          },
          onShowInGraph: () => setPanel('relation'),
        },
        relationMode
          ? {
              // E3：连线到…（以该节点为源新建自由边）；E8：仅关系模式提供该入口
              onStartLink: (id) => setLinkDraft({ sourceId: id, x: ctxMenu.x, y: ctxMenu.y }),
            }
          : undefined,
        // 中心：T5 起与二级环**共用**同一闭包（`nodeMenuBags.ts` 构建，宿主传入）；
        // 描述 / 笔记入口自 T6 起移出菜单（环席位承担），故不再传袋
        centerActions,
        // D3′：生长方向（note.dir 语义意图；updateNote 合并写——
        // dir: undefined 删键 = 恢复继承；OpHistory 天然覆盖 undo）
        {
          explicitDirOf: (id) => readGrowDir(nodeById(controller.root, id)?.note, id),
          onSetGrowDir: (id, dir) => {
            controller.updateNote(id, { dir: dir ?? undefined });
          },
          // v1.7.1：出线长度菜单与拖梁同通道——写 `lens.up/lens.down`（拖梁写 lens[dir]）。
          // 此前菜单写 `len`：lens[dir] 优先级更高，**拖过梁后菜单就失效**（实测反馈）。
          // v1.8.1：写入逻辑抽 `lenEdit.ts`（与数值气泡共用单一实现）。
          lenOf: (id) => currentLenOf(controller, id),
          onSetLen: (id, len) => applyLen(controller, id, len),
          // v1.8.1：自定义值走宿主数值气泡（裁决 M3）
          onRequestLenCustom: (id) => {
            onRequestLenCustom?.(id, ctxMenu.x, ctxMenu.y, currentLenOf(controller, id));
          },
          // v1.7.1：lens.left/right 残留复位（拖过梁又取消枢纽后间距会留着——lens 读取与 hub 无关）
          lenSidesOf: (id) => {
            const lens = readLensMap(nodeById(controller.root, id)?.note);
            if (!lens) return null;
            const out: { left?: number; right?: number } = {};
            if (lens.left !== undefined) out.left = lens.left;
            if (lens.right !== undefined) out.right = lens.right;
            return out;
          },
          onClearLenSides: (id) => {
            const note = nodeById(controller.root, id)?.note;
            const lens = { ...(readLensMap(note) ?? {}) };
            delete lens.left;
            delete lens.right;
            controller.updateNote(id, {
              lens: Object.keys(lens).length > 0 ? lens : undefined,
            });
          },
        },
        // v1.5.0 Section 三态入口（D1：Section ⇒ center，故依赖中心块提供 isCenter）
        sectionActions,
        // FO-UI1：框动作（「改框深度…」收值交宿主气泡；未注入 → 不出现该项）。
        // 坐标在此补（菜单知道自己的位置）；current/max 由命令层 frameDepthRange 算。
        onRequestFrameDepth === undefined
          ? undefined
          : {
              onRequestFrameDepth: (id, current, max) => {
                onRequestFrameDepth(id, ctxMenu.x, ctxMenu.y, current, max);
              },
            },
        // S2：摘要（「创建摘要…」）——与「连线到…」并列于结构区。
        // 这里只发起第一跳；末成员由用户在画布上点选（onNodeClick 首判）。
        summaryActions,
      )}
      onClose={onClose}
    />
  );
}
