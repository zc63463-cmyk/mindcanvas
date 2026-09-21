/**
 * 文档生命周期契约（apps 内部共用；不进入任何包的公开导出面）。
 *
 * 是什么：
 * - `SaveIntent` / `SaveCompletion`：保存请求的意图与**可判别**结果。调用方（含包 2 的
 *   离开保护）据 `downloaded` 与 `current=false` 判定「是否真的落盘 / 是否还能安全离开」；
 * - `DocumentLeavePort`：离开当前文档前的最小端口（`flushEdits` 与 App 离开登记属包 2，
 *   本包先落地 `isSaving` / `waitForIdle` / `save` 的实现基础）；
 * - 拒绝写入的文案常量（同步守卫 / 写入忙）。
 *
 * 不是什么：
 * - 不含具体保存实现（见 `hooks/useDocumentSaveSession.ts` 的会话与写入调度）；
 * - 不改 `.mm.md` / `.mc.canvas.json` 格式，不持久化任何内部保存序号。
 */

/** 保存意图：自动 / 手动 / 另存为。另存为不会被普通保存吞掉。 */
export type SaveIntent = 'auto' | 'manual' | 'save-as';

/**
 * 保存结果。
 *
 * - `saved` / `downloaded` 带 `current`：**本次调用结束时**会话与内容是否仍与写出的快照一致。
 *   `current=true` 仅代表「此刻已落盘的是屏幕内容」，调用者真正离开前仍须重新读
 *   `isDirty` / `isSaving`，不能把一次结果当成永久有效。
 * - `downloaded` 与 `saved` 必须可区分：仅触发下载**不代表**文件已持久化确认。
 * - `failed` **只表示写盘未成功或写盘结果未确认**（写入异常 / 写盘前捕获失败）。
 *   此时 `commit` 不会执行 → 文档状态（含 dirty）保持原样，调用方不得清脏、不得当作已保存。
 * - 写盘成功但**附属记录**（最近列表 `remember` / 句柄回填）失败 **不降级为 `failed`**：
 *   磁盘事实成立 → 仍返回 `saved` / `downloaded`，附属失败经独立的附属警告通知
 *   （`SAVE_METADATA_WARNING` / `onSaveWarning`）暴露，避免「结果说失败、dirty 已清、
 *   提示说未标记已保存」三者矛盾（复核 R4-B）。
 * - `cancelled`（用户取消对话框）/ `blocked`（同步守卫或写入忙，任务未开始）/
 *   `stale`（会话已替换或任务被合并取消）均**不改变**任何文档状态。
 */
export type SaveCompletion =
  | { kind: 'saved'; current: boolean }
  | { kind: 'downloaded'; current: boolean }
  | { kind: 'cancelled' | 'blocked' | 'failed' | 'stale' };

/**
 * 离开当前文档前的最小端口（包 2 消费；实现由各 Stage 提供）。
 *
 * 纪律：`save()` 的完成不等于可以离开 —— 调用者必须重新读取 `isDirty()` / `isSaving()`。
 * `waitForIdle()` 只等**当前会话**已开始的 I/O，不自动发起新的文件选择器。
 *
 * 语义边界：被替换会话（切文档/新建/打开/最近/演示/卸载）已发出的物理 I/O 无法撤回，
 * 不阻塞本端口的等待与判断，且其完成不会回填任何状态 —— 不能把 `waitForIdle()` 当作
 * 「磁盘上已无未结束写入」。
 */
/**
 * `flushEdits()` 的**可判别**结果（MG-R4-B）：
 *
 * - `'ok'`：可以继续判定脏/写入（有草稿也已提交成功，或本来就没有待提交内容）；
 * - `'composing'`：输入法组合未结束 —— **暂缓**离开（保留编辑焦点，等 `compositionend` 自动续跑）；
 * - `'failed'`：草稿提交**抛错/校验失败** —— 保留草稿、目标零执行，给出可修正后重试的提示；
 *   这类失败与 IME 无关，**不得**挂在 `compositionend` 上等一个永远不会到来的事件。
 *
 * 兼容：布尔返回值按旧语义归一化（`true` → `'ok'`，`false` → `'composing'`）。
 */
export type FlushOutcome = 'ok' | 'composing' | 'failed';

/**
 * 端口实际可返回的形状：`FlushOutcome` 或**旧式布尔**（`true` → `'ok'`，`false` → `'composing'`）。
 * 组合分支沿用既有布尔契约（返回 `false`），提交失败用新字面量 `'failed'` 区分。
 */
export type FlushResult = FlushOutcome | boolean;

export interface DocumentLeavePort {
  /**
   * 将输入框中尚未提交的文本提交到模型（沿既有 blur/commit 通道 + 编辑会话通道）。
   *
   * 返回 `false` / `'composing'` / `'failed'` 时调用方**不得**继续离开
   * （组合未结束 → 暂缓等 `compositionend`；提交失败 → 保留草稿，让用户修正后重试）。
   */
  flushEdits(): FlushResult;
  isDirty(): boolean;
  isSaving(): boolean;
  /** 等已开始 I/O 完成；不自动开始一个新的文件选择器。 */
  waitForIdle(): Promise<void>;
  save(): Promise<SaveCompletion>;
  /**
   * 可选：用户选择「放弃修改并离开」时，停止**排定新的**自动保存（不影响已开始的 I/O）。
   * 缺省 = 无自动保存（自由画布）。
   */
  suppressPendingAuto?: () => void;
}

/** 离开决策的三选项（确认框按钮顺序：保存并继续 / 放弃修改 / 取消）。 */
export type LeaveChoice = 'save' | 'discard' | 'cancel';

/**
 * 离开决策器（包 2：App 注入给 Stage；Stage 内的文档替换与 App 的模式切换共用）。
 *
 * - 返回 `true` = 目标动作已执行；`false` = 用户取消 / 保存未证实成功 / 会话失效 / 未就绪。
 * - 同一时刻只允许一个活动请求：后续请求直接返回 `false`，不覆盖 resolver 与目标
 *   （连续点击不同入口不会产生悬挂 Promise，也不会执行错目标）。
 * - 目标动作执行前会重新核验会话、dirty、saving —— 一次 `saved/current=true` 不是永久通行证。
 */
export type RequestLeave = (perform: () => void | Promise<void>) => Promise<boolean>;

/** 写入忙（会话内已有任务在跑）而拒绝启动新的选择器/写入时的通知文案。 */
export const SAVE_BUSY_NOTICE = '正在保存上一份改动，请稍后重试（本次未发起新的写入）。';

/**
 * 实际写入失败的通知文案（当前会话）。
 *
 * 与「取消」「过期」区分：取消是用户主动（静默）；过期属于旧会话（不得打扰当前文档）。
 * 此文案仅用于**写盘未成功/未确认**（`SaveCompletion.failed`）：commit 未执行 → dirty 保持，
 * 且不自动重试（下一次编辑或手动保存再试）。
 */
export const SAVE_FAILED_NOTICE = '保存失败：写入未完成或未确认，改动仍保留在本地（未标记已保存）。';

/**
 * 附属记录失败（写盘已成功）的通知文案。
 *
 * 用于 `remember`（最近列表）或句柄回填等**附属**步骤失败：磁盘上已是新内容，
 * 结果仍为 `saved` / `downloaded`，dirty 按内容归属正常处理 —— 不能显示「写入未完成」
 * 或「未标记已保存」（复核 R4-B）。
 */
export const SAVE_METADATA_WARNING =
  '已写入文件；但最近记录/句柄回填失败（附属步骤未完成，不影响本次落盘内容）。';

/**
 * 附属记录失败 + **下载兜底**分支的通知文案。
 *
 * 必须与 `SAVE_METADATA_WARNING` 分开：下载只确认「已触发下载」，不确认用户文件已落盘
 * （第三轮复核口径）。措辞不声称文件已经保存。
 */
export const SAVE_METADATA_WARNING_DOWNLOAD =
  '已发起下载；但最近记录/句柄回填失败（下载不代表文件已落盘，请确认文件已保存）。';
