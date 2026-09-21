/**
 * S2 · 摘要两跳交互的**生产状态机**（右键「创建摘要…」→ 画布点末成员 → 建摘要）。
 *
 * 为什么单独成 hook（R2/R3 修复）：
 * 1. **文档替换失效（R2）**：草稿的清理此前写死依赖 `controller` 对象身份，而切文档走
 *    `controller.reset(...)` **复用同一 controller**（`useDocumentSwitch.ts:89` +
 *    `controller.ts:475` 原地复位）→ 身份不变 ⇒ 清理 effect 永不触发 ⇒ 旧草稿吞掉
 *    新文档的第一次点击。本 hook 把复位信号改为**显式传参**（见 `draftResetToken`），
 *    由宿主按「文档替换」语义递增，而不是靠对象身份。
 * 2. **生产与测试消费同一份实现（R3）**：此前 `apps/canvas/tests/summary-two-hop.test.tsx`
 *    内联复刻了整条状态机（自述「逐字同序的首判链」），真实接线的回归无人守。
 *    状态机收敛到本文件后，`MindmapStage` 与测试 **import 同一个 hook**，复制体删除。
 *
 * 复位信号为什么不用「文件名 / source / dirty / controller 身份」（任务书约束）：
 * - 文件名：两份不同文档可以有同名（`未命名.mm.md` 可多次新建）；
 * - `source`：**同内容替换**（重新打开同一文件）时字符串相等 → 不改判据就会漏清；
 * - `dirty`：只是内容状态，切文档本身就带保存/放弃分支，与「换了哪棵树」无关；
 * - controller 身份：见上，切文档根本不换实例（R2 的成因）。
 * 因此用一个**单调递增的文档会话令牌**（`stageDocumentToken`，见 hooks/useDocumentToken.ts）：
 * 只有「文档被整体替换」这一件事才会推进它 —— 普通编辑、保存、另存为都不推进
 * （保存只回填 `savedSource` / `handle` / `saved` / `ts`，不改文档身份）。
 * 令牌变化 ⇒ 草稿必失效，**与两份文档内容是否相同无关**。
 *
 * 分层：本 hook 只碰**会话态**（草稿 + 提示文案）与命令层调用；选中/渲染由宿主负责。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createSummary, type EditorController } from '@mindcanvas/react';
import { nodeById } from './useEdgeActions.js';
import {
  classifySecondHop,
  SUMMARY_PICK_END_NOTICE,
} from '../summaryInteraction.js';

/** 摘要草稿 = 已登记的范围起点（只存 id：第二跳是「点画布节点」，不需要浮层锚点） */
export interface SummaryDraft {
  fromId: string;
}

export interface SummaryHopOptions {
  controller: EditorController;
  /** 命令提示通道（宿主的状态提升通道：StageInner 的 `setCommandNotice`） */
  setCommandNotice: (message: string | null) => void;
  /**
   * **文档替换令牌**：值变化 ⇒ 草稿立即失效（清草稿 + 清提示）。
   *
   * 语义 = 「当前这棵树被整体换过」。普通编辑 / 保存 / 另存为**不得**推进它
   * （见文件头「复位信号为什么不用…」）。
   */
  draftResetToken: number;
}

export interface SummaryHop {
  /** 草稿（渲染用：等待态提示 / 测试可读；判定一律走内部的同步 ref） */
  draft: SummaryDraft | null;
  /** 第一跳（菜单「创建摘要…」）：登记起点 + 引导文案 */
  start: (id: string) => void;
  /**
   * 第二跳：以草稿起点 + 本次点中的节点为范围建摘要。
   *
   * @returns true = 本次点击已被摘要流程消费（调用方据此跳过选择逻辑）；
   *          被拒时同样返回 true（提示已给、草稿保留），避免点击落进选择分支
   *          产生「看起来没反应但选中跳了」的错觉。
   */
  completeAt: (toId: string) => boolean;
  /** 点空白：与 Esc 同语义（未完成的交互 → 取消） */
  cancel: () => void;
  /** 草稿是否存在（**同步**真理源；同一事件循环内的第二次点击必须看到已消费） */
  hasDraft: () => boolean;
}

export function useSummaryHop({
  controller,
  setCommandNotice,
  draftResetToken,
}: SummaryHopOptions): SummaryHop {
  const [draft, setDraftState] = useState<SummaryDraft | null>(null);
  /**
   * 草稿的**同步镜像**：`useState` 的更新要到下一次渲染才对闭包可见，同一事件循环内的
   * 第二次点击会读到旧值 → 重复建摘要。判定与消费一律走本 ref；状态仅供渲染。
   * 唯一写入口是下面的 `setDraft`（ref 与 state 同写），杜绝两者漂移。
   */
  const draftRef = useRef<SummaryDraft | null>(null);
  const setDraft = useCallback((next: SummaryDraft | null): void => {
    draftRef.current = next;
    setDraftState(next);
  }, []);

  /**
   * 文档替换 → 草稿失效。
   *
   * 首挂（令牌初值）只做**同步**清空，不触 state：挂载时草稿本就是 null，写 state 只会
   * 多一次渲染（且会打断首挂的其它 effect 批）。此后每次令牌变化都清 ref + state，
   * 同时清掉等待态提示（不把「点选范围末成员」留在新文档上）。
   */
  const lastTokenRef = useRef(draftResetToken);
  if (lastTokenRef.current !== draftResetToken) {
    lastTokenRef.current = draftResetToken;
    draftRef.current = null; // 同步真理源：本次渲染之后到达的点击不再看到旧草稿
  }
  // 令牌变化后的 state 收口：**渲染期直接派生**，不走 effect。
  //
  // 为什么不用 effect + deps：`draftResetToken` 已在渲染期被 `lastTokenRef` 消费掉，
  // 把它列进 deps 属**多余依赖**（useExhaustiveDependencies 告警）；而不列进 deps，
  // effect 就再也不会因令牌变化而重跑（deps 只剩两个稳定 setState）→ 失效。
  // 两者都错，所以这里用 React 官方的「渲染期派生 state」写法：令牌与上次派生的
  // 令牌不一致时同步 setState，React 会立刻重渲染且不会丢用户输入
  // （同一组件、无子树条件挂载差异）。
  const [derivedToken, setDerivedToken] = useState(draftResetToken);
  if (derivedToken !== draftResetToken) {
    setDerivedToken(draftResetToken);
    setDraft(null);
    setCommandNotice(null);
  }

  /** 卸载：不留在半途等待态（草稿是未完成的交互，不属于任何持久状态） */
  useEffect(() => () => setDraft(null), [setDraft]);

  const start = useCallback(
    (id: string): void => {
      setDraft({ fromId: id });
      setCommandNotice(SUMMARY_PICK_END_NOTICE);
    },
    [setDraft, setCommandNotice],
  );

  const cancel = useCallback((): void => {
    if (draftRef.current === null) return;
    setDraft(null);
    setCommandNotice(null);
  }, [setDraft, setCommandNotice]);

  const completeAt = useCallback(
    (toId: string): boolean => {
      const current = draftRef.current;
      if (current === null) return false;
      const fromId = current.fromId;
      // 先同步消费，再判合法性——被拒时按契约**恢复**草稿（保留等待态）
      draftRef.current = null;
      const hop = classifySecondHop(fromId, (id) => nodeById(controller.root, id) !== null);
      const keepDraft = (): void => {
        setDraft({ fromId });
      };
      if (hop.kind === 'start-gone') {
        // 起点已不在树中（被删 / 被换文档）：草稿作废，不留下指向幽灵节点的等待态
        setDraft(null);
        setCommandNotice(null);
        return true;
      }
      const res = createSummary(controller, fromId, toId);
      if (!res.ok) {
        // 跨父 / 根 / 倒序 / 端点为摘要节点：保留草稿，给出原因，等下一次合法点击
        keepDraft();
        setCommandNotice(`创建摘要未完成：${res.error.message}（${SUMMARY_PICK_END_NOTICE}）`);
        return true;
      }
      setDraft(null);
      setCommandNotice(null);
      // 创建完成 → 选中新摘要节点（与「新建子节点」同款：建完即选中）
      controller.select(res.summaryId);
      return true;
    },
    [controller, setCommandNotice, setDraft],
  );

  return {
    draft,
    start,
    completeAt,
    cancel,
    hasDraft: () => draftRef.current !== null,
  };
}
