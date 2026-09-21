/**
 * 未提交草稿的 flush（MODE-GUARD Task 2；MG-R4 起含编辑会话通道）。
 *
 * 是什么：
 * - 沿各编辑控件**既有的 blur → commit 通道**提交「输入框里但模型还没有」的文本：
 *   对当前获得焦点的表单控件调用 `blur()`，由控件自己决定提交值（不读 DOM value、
 *   不猜校验规则、不绕过业务校验）。
 * - 再问一遍**登记会话**（`@mindcanvas/react` 的 draftSessions）：把草稿放在组件状态里、
 *   DOM 无控件可 blur 的编辑器（例：`NoteBackEditor` 预览态）也能被提交 —— 只按
 *   `document.activeElement` 推断「没有草稿」会漏掉这类内容（MG-R4 复核缺口）。
 * - 输入法组合（IME）未结束时**拒绝提交**：此时框里的文字是未确认的候选串，blur 会把它
 *   当成正文提交（等于截断正在组合的文字）。返回 false 让调用方暂缓离开并提示。
 *
 * 不是什么：
 * - 不存草稿、不做草稿恢复（本包只保证离开路径不静默丢弃内容）；
 * - 不处理非输入控件的 UI 状态（选中/滚动/面板开合不属文档内容）。
 *
 * 组合状态用 document 级 capture 监听跟踪（compositionstart/end 不一定冒泡到具体节点；
 * 捕获阶段可稳定拿到）。监听**在模块加载时安装**，不做惰性预热：
 * 惰性安装会漏掉「用户先开始组合、随后才第一次请求离开」的冷启动时序 ——
 * start 事件发生在安装之前 → `flushActiveDraft()` 误判为可提交 → 候选串被当正文 blur 提交。
 */
import { commitDraftSessions, hasPendingDraftSession } from '@mindcanvas/react';

let composing = false;
let tracking = false;
/** 组合结束回调（决策器用它把「因组合而未执行的请求」自动续上） */
const compositionEndListeners = new Set<() => void>();

function trackComposition(): void {
  if (tracking || typeof document === 'undefined') return;
  tracking = true;
  document.addEventListener(
    'compositionstart',
    () => {
      composing = true;
    },
    true,
  );
  document.addEventListener(
    'compositionend',
    () => {
      composing = false;
      for (const listener of [...compositionEndListeners]) listener();
    },
    true,
  );
}

// 模块初始化即安装：第一个组合事件不会漏。
trackComposition();

/** 当前是否有未结束的输入法组合（测试与守卫共用） */
export function hasActiveComposition(): boolean {
  trackComposition();
  return composing;
}

/** 订阅「组合结束」；返回解绑（决策器暂缓请求时用，请求结束必须解绑） */
export function subscribeCompositionEnd(listener: () => void): () => void {
  trackComposition();
  compositionEndListeners.add(listener);
  return () => {
    compositionEndListeners.delete(listener);
  };
}

/** 当前聚焦的编辑控件（测试与守卫共用）；非表单控件 / 无焦点 → null */
export function activeDraftElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return null;
  if (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el.isContentEditable
  ) {
    return el;
  }
  return null;
}

/**
 * 提交当前聚焦控件的草稿。
 *
 * @returns `'ok'` = 可继续判断 dirty/离开；`false` = 组合未结束（暂缓，沿用既有布尔契约）；
 *          `'failed'` = 提交抛错（**本次不得离开**，保留草稿让用户修正后重试）。
 */
export function flushActiveDraft(): 'ok' | false | 'failed' {
  if (hasActiveComposition()) return false;
  const el = activeDraftElement();
  if (el !== null) {
    // 走控件自身的 blur → commit 通道（React 的 onBlur 同步派发）。
    // 提交回调抛错 = 草稿没进模型：如实回报 'failed'，不能当成「没有草稿」放行。
    try {
      el.blur();
    } catch {
      return 'failed';
    }
  }
  // 再看登记会话：预览态 / 隐藏态草稿在 DOM 里没有可 blur 的控件（MG-R4）。
  // 会话提交失败同样不得被吞掉（MG-R4-B）。
  if (commitDraftSessions() === 'failed') return 'failed';
  return 'ok';
}

/**
 * 是否存在「已聚焦但有未提交内容」的编辑控件（beforeunload 条件之一）。
 *
 * 多行控件在本应用里都是内容编辑器（描述 / 备注 / 备注正文 / 批注 / 自由画布面），
 * 单行控件用数据标记区分（节点标题、框内行等）——避免把搜索框也算成草稿。
 */
export function hasPendingDraft(): boolean {
  // 编辑会话优先：预览态 / 隐藏态草稿不在 DOM 焦点里，但确实没提交（MG-R4）
  if (hasPendingDraftSession()) return true;
  const el = activeDraftElement();
  if (el === null) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  return (
    el.hasAttribute('data-overlay-editor') ||
    el.hasAttribute('data-fc-editor') ||
    el.hasAttribute('data-note-md-input') ||
    el.hasAttribute('data-gcp-input-editing') ||
    el.hasAttribute('data-gcp-input-adding')
  );
}
