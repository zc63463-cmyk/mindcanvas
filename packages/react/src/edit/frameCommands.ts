/**
 * 框编辑命令（FO-A3 · Batch A）：成框 / 拆框 / 改深度。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §4.1（成框）/ §4.2（框上操作）
 * / §4.5（同一撤销栈）。框不是新 `type`：只写 `note.frame` 元数据，子树仍挂 `children`
 * （全保真，设计 §0）。
 *
 * 与其余编辑命令同管线：一律经 `controller.updateNote`（TreeOp + OpHistory），
 * 因此成框 / 拆框 / 改深度**自动进同一撤销栈**，不额外记账。
 *
 * 校验纪律（设计 §8）：
 *  - 成框前 `canCreateFrame`（§3.3 嵌套：祖先大纲层内拒、挂载层允）；
 *  - `depth` 一律经 `clampFrameDepth` 收敛到 `[1, min(子树最大相对深度, 8)]`，
 *    非法值不落盘（`setFrame` 的 `invalid frame depth` 因此在本层不可达）。
 *
 * 返回值 `false` = 被拒 / 不适用（**未写盘**）；调用方（菜单/命令面板）自行决定提示方式，
 * 一期静默（B2 接步进器与 toast）。
 */
import {
  canCreateFrame,
  clampFrameDepth,
  frameOf,
  getNode,
  subtreeMaxRelativeDepth,
} from '@mindcanvas/kernel';
import type { EditorController } from './controller.js';

/** 成框（默认深度由调用方给；菜单一期固定 2，见设计 §4.1）。返回 false = 拒绝且未写盘。 */
export function createFrame(controller: EditorController, id: string, depth: number): boolean {
  const check = canCreateFrame(controller.root, id);
  if (!check.ok) return false;
  const node = getNode(controller.root, id);
  if (!node) return false;
  const d = clampFrameDepth(depth, subtreeMaxRelativeDepth(node));
  controller.updateNote(id, { frame: { version: 1, depth: d } });
  return true;
}

/** 拆框：删 `frame` 键（其它 note 字段不动）；非框 → false 且无操作。 */
export function removeFrame(controller: EditorController, id: string): boolean {
  const node = getNode(controller.root, id);
  if (!node || frameOf(node.note) === undefined) return false;
  controller.updateNote(id, { frame: undefined });
  return true;
}

/** 改深度：只改 `depth`（钳到子树高度与上限 8），不动 `children` 拓扑；非框 → false。 */
export function setFrameDepth(controller: EditorController, id: string, depth: number): boolean {
  const node = getNode(controller.root, id);
  if (!node || frameOf(node.note) === undefined) return false;
  const d = clampFrameDepth(depth, subtreeMaxRelativeDepth(node));
  controller.updateNote(id, { frame: { version: 1, depth: d } });
  return true;
}

/** 改深度气泡的范围（当前值 + 合法上界） */
export interface FrameDepthRange {
  /** 当前 `note.frame.depth` */
  current: number;
  /** 合法上界 = `min(8, 子树最大相对深度)`（与 `clampFrameDepth` 同源） */
  max: number;
}

/**
 * 改深度的**范围**（FO-UI1）：非框 / 不在树内 → `null`。
 *
 * `max` 不另写常量：`clampFrameDepth(极大值, 子树高度)` 的内部就是
 * `min(want, 子树高度, 8)` —— 传极大值即得设计上界，避免「8」在两处漂移。
 */
export function frameDepthRange(
  controller: EditorController,
  id: string,
): FrameDepthRange | null {
  const node = getNode(controller.root, id);
  const spec = frameOf(node?.note);
  if (node === null || spec === undefined) return null;
  return {
    current: spec.depth,
    max: clampFrameDepth(Number.MAX_SAFE_INTEGER, subtreeMaxRelativeDepth(node)),
  };
}

/*
 * 已退役：`requestFrameDepth` / `askDepth`（原生 `prompt` 询问深度）。
 * 为什么删：IDE 内嵌 webview 会**静默吞掉** prompt（apps/canvas/tests/no-native-dialogs.test.ts
 * 的守卫对象），表现为「菜单点了没反应、深度也改不了」。菜单现在只请求宿主浮层
 * （`FrameMenuActions.onRequestFrameDepth`），由宿主用画布内数值气泡收值后调 `setFrameDepth`
 * —— 同一 undo 栈、同一钳制纪律。
 */
