/**
 * 用户可见文案的**唯一事实源**（P0-C ①，acceptance §5.2）。
 * ══════════════════════════════════════════════════════════════════════
 * 要解决的问题（§5.2）：同一个结果在两处被写成两句不同的话。
 * 实测两例（本轮 grep 复核过行号）：
 *  - 「文件已不在磁盘上」：`hooks/useFileOpOrchestration.ts:80`（表）与
 *    `useFileOpController.ts:213`（兜底串）两套说法；
 *  - 「正在处理上一步操作」：`hooks/useFileOpOrchestration.ts:66`（表）与
 *    `hooks/useCurrentDocDeleteFlow.ts:114`（逐字复制）两处逐字重复。
 *
 * **本文件只回答一件事**：一个「结果标识」对应哪句用户可见文案。
 * 它**不**定义任何公共结果类型（那是 `packages/react/src/edit/fileOps.ts` 与
 * `packages/react/src/chrome/assetHost.ts` 的职责，本文件只 `import type`），
 * 也**不**持有任何判定逻辑——没有任何 `if` 依赖业务状态，只有「查表 / 插值」。
 * 依赖方向单向：apps/canvas → packages/react，包层不反向依赖本文件。
 *
 * 与 `packages/react/src/chrome/assetStoreCopy.ts`（P0-B 交付，**只读**）的分工：
 * 落点徽章 / 可携带性 / 会话级降级那套文案由该文件给出（已随 `@mindcanvas/react`
 * 再导出）。本文件**新增**资产侧缺口的部分：插入被拒、上传失败、写入后作用域已切换、
 * 同名副本。两域不许各说一半，因此资产的**每个**用户可见串都在这里查表得到。
 *
 * 纪律（逐条来自规格，勿在别处就地拼串）：
 *  1. `E-ABORT` / `same-name` / `cancelled` 的用户取消是**空串 = 静默**，
 *     调用方见空串必须**不渲染**（「没有反馈就是正确反馈」，P0-A 已定语义，保留）；
 *  2. 文案不得出现 `assetStoreCopy.ts` 的 `isForbiddenAssetCopy` 禁止表述
 *     （「换电脑也能用」等）——`notices-consistency.test.tsx` 用**既有守卫**正向扫全表；
 *  3. 穷尽性用**类型**钉死（`Record<FileOpErrorCode, string>` 等），漏一个键即编译失败。
 */
import {
  ASSET_PORTABILITY_COPY,
  ASSET_STORE_BADGE,
  formatAssetStoreDetail,
  formatAssetWriteNotice,
  isForbiddenAssetCopy,
} from '@mindcanvas/react';
import type { AssetStore, FileOpErrorCode } from '@mindcanvas/react';

/**
 * 键域**再导出**（`export type` 纯类型转发，零运行时字节，不新增第二份定义）。
 *
 * 为什么需要：本文件是文案的**唯一事实源**，而「表是否穷尽」只有在
 * 「表的类型」与「检查器的键域」是**同一个类型**时才是编译期事实。
 * 若在别处（如 `notices-consistency.test.tsx`）自己再写一份
 * `const CODES = [...] as const` 去对 `Record<FileOpErrorCode, string>` 查漏，
 * 那份清单就是**第三份**键域副本 —— 它是可变数据、不是类型，
 * 将来上游加第 9 个码时它不会报错，漏检会被静默吞掉（正是本文件要消灭的「两套说法」病）。
 * 由事实源再导出后，检查器只需 `satisfies readonly FileOpErrorCode[]`
 * 且用 `..._EXHAUSTIVE` 技巧让漏键变成**编译错误**，与生产表的钉法完全一致。
 */
export type { FileOpErrorCode } from '@mindcanvas/react';

// ─────────────────────────────────────────────────────────── P0-A：文件操作失败码

/**
 * 八个失败码 → 用户可见文案（`FileOpErrorCode` 的穷尽映射）。
 *
 * 为什么必须**逐码**而不是一句「操作失败」：八个码各自对应不同的恢复路径
 * （`fileOps.ts:22-24` 的原话：`E-NOT-FOUND` 该「刷新树」，`E-PERMISSION` 该「重新授权」，
 * 合并会让 UI 给不出正确恢复路径）。漏一个码 → `Record` 少键 → 编译失败。
 *
 * `E-ABORT` 不是故障（`fileOps.ts:41`）：文案是「操作已取消。」，
 * 需要完全静默的调用点（如上传流）自行判 `kind` 后再查表，本表不代它决定。
 *
 * 文案字节取自 P0-A 既有的 `FILE_OP_FAIL_NOTICE`（`useFileOpOrchestration.ts:79-88`），
 * **未改一字**：`rename-current-doc.test.tsx` 等既有断言依赖它。
 *
 * P0-C ② 起，**依赖方向反过来了**：`FILE_OP_FAIL_NOTICE` 现在从本表取字节
 * （`useFileOpOrchestration.ts` 里改为 `...FILE_OP_FAIL_COPY`），本文件才是源。
 * 因此这里的每一条都不得再改动 —— 改了会同时移动 P0-A 的既有断言目标。
 */
export const FILE_OP_FAIL_COPY: Record<FileOpErrorCode, string> = {
  'E-PERMISSION': '没有写入权限：请重新授权后重试。',
  'E-NOT-FOUND': '文件已不在磁盘上（可能被外部改名或删除），列表已刷新。',
  'E-EXISTS': '目标位置已有同名文件。',
  'E-QUOTA': '磁盘空间不足，无法完成这次操作。',
  'E-UNAVAILABLE': '当前浏览器或这份目录句柄不支持这个操作。',
  'E-ABORT': '操作已取消。',
  'E-IO': '读写磁盘失败，请重试。',
  /**
   * 未归类错误的文案。
   *
   * P0-C ② 前这里在仓内有**两份字面量**：本表 + `useFileOpOrchestration.ts:92`
   * `failNoticeOf` 的兜底串 `?? '操作失败，请重试。'`（与 `:87` 的 `E-UNKNOWN`
   * 一字不差）。现在 `failNoticeOf` 改为 `FILE_OP_FAIL_COPY['E-UNKNOWN']`，
   * 本处即唯一事实源 —— 改这一句就同时改掉兜底行为，不会再出现「改了一处漏了另一处」。
   */
  'E-UNKNOWN': '操作失败，请重试。',
};

// ─────────────────────────────────────────────────────── P0-A：文件操作被拒理由

/**
 * 八个拒绝理由（`useFileOpOrchestration.ts:53-64` 的 `FileOpRefusal`）。
 *
 * 与 `FileOpErrorCode` 分开：拒绝是「还没开始做就被挡回」，失败是「做了但没成功」，
 * 恢复路径完全不同（`not-durable` 该「先保存」，`busy-lease` 该「等一等」）。
 */
export type FileOpRefusalReason =
  | 'busy-lease'
  | 'busy-physical'
  | 'session-replaced'
  | 'not-durable'
  | 'invalid-name'
  | 'case-only'
  | 'same-name'
  | 'host-unmounted';

/**
 * 拒绝理由 → 文案（穷尽映射）。
 *
 * `same-name` = 用户没改名 → **空串 = 静默**，调用方不得把空串渲染成空气泡。
 * 文案字节取自 `useFileOpOrchestration.ts:65-76` 的 `FILE_OP_REFUSAL_NOTICE`，
 * **未改一字**。P0-C ② 起依赖方向同样反过来：那里改为 `...FILE_OP_REFUSAL_COPY`
 * （且仍保留 `FileOpRefusal` 类型），`rename-current-doc.test.tsx:275,310,325,355,377`
 * 的断言因此继续指向**同一批字节**。
 */
export const FILE_OP_REFUSAL_COPY: Record<FileOpRefusalReason, string> = {
  'busy-lease': '正在处理上一步操作，请稍候再试（本次未做任何改动）。',
  'busy-physical': '上一份写入还没有结束，请稍后重试（本次未做任何改动）。',
  'session-replaced': '这份文档已经被替换，操作已取消（本次未做任何改动）。',
  'not-durable': '这份文档还没有保存到磁盘（或内容又变过），先保存一次再改名或移动。',
  'invalid-name': '名字不能为空，也不能包含 / \\ 等字符。',
  'case-only':
    '浏览器的文件接口没有原地改名能力；在大小写不敏感的磁盘上，这两个名字会被视为同一个文件。请改用其他名称，或用系统文件管理器改名。',
  'same-name': '',
  'host-unmounted': '工作区未挂载，无法操作磁盘文件。',
};

// ──────────────────────────────────────────────── 当前文档删除流（与上表同一批键）

/**
 * 删除当前文档流程的用户可见提示（`hooks/useCurrentDocDeleteFlow.ts` 消费）。
 *
 * 为什么单独一组：该流程的 `busyLease` / `busyPhysical` 与 `FILE_OP_REFUSAL_COPY`
 * 的 `busy-lease` / `busy-physical` 是**同一件事**（都被同一条租约挡住），
 * 此前逐字复制成两份（`useCurrentDocDeleteFlow.ts:114-115` 与
 * `useFileOpOrchestration.ts:66-67`）。这里让两者取同一处字节：
 * `DELETE_FLOW_COPY` 的两个键由 `FILE_OP_REFUSAL_COPY` **求值得到**，
 * 重复从此不可能再分叉。
 *
 * `cancelled` 空串 = 静默（用户主动取消，不是故障）。
 */
export const DELETE_FLOW_COPY = {
  composing: '正在输入中，稍等片刻再删除。',
  draftFailed: '草稿保存失败：为免丢失内容，这次删除已取消。',
  busyLease: FILE_OP_REFUSAL_COPY['busy-lease'],
  busyPhysical: FILE_OP_REFUSAL_COPY['busy-physical'],
  cancelled: '',
} as const;

export type DeleteFlowReason = keyof typeof DELETE_FLOW_COPY;

// ───────────────────────────────────────────────── P0-B：资产侧（本轮补齐的部分）

/**
 * 插入归一化被拒的理由（`assetInsert.ts:45` 的 `NormalizeResult.refused.reason`）。
 */
export type AssetInsertRefusalReason = 'no-workspace' | 'unsupported-format' | 'write-failed';

/**
 * 三条拒绝理由 → 文案。
 *
 * 三条的**恢复路径不同**（`asset-library.md` §4.9 / I-10 规则 3），不得合并成
 * 一句「插入失败」：`no-workspace` 该去「打开文件夹」，`unsupported-format` 同路
 * 但要点明「这张图不能内联」，`write-failed` 才是可重试的故障。
 * 文案字节取自迁移前的 `MindmapStage.tsx:186-194`（`refusedNoticeOf`），**未改一字**。
 *
 * 第三个出口 `'inline-impossible'` 也是**归位**、不是新造：它来自
 * `SidePanels.tsx:34-35` 的 `REFUSED_NO_WORKSPACE`（原文「这张图片需要先打开
 * 一个文件夹作为工作区，才能插入到文档里。」）。那条路径是 `inlineRefIdOf` 的
 * 自包含兜底：**没有注入归一化器**时（测试 / 老调用方）无 svg 源码可用 → 拒绝。
 * 它此前**绕过**本表，以「已成形文案」形式经 `onInsertRefused` 直塞提示位
 * （P0-C ② 修掉的第二条通道）。归位后：
 *  - 键由 `refusedNoticeOf` / `inlineRefIdOf` 传，文案仍在本表一处；
 *  - **字节一字未改**（既有侧栏用例若断言该句，断言照样成立）。
 */
export type AssetInsertRefusalCode = AssetInsertRefusalReason | 'inline-impossible';

export const ASSET_INSERT_REFUSAL_COPY: Record<AssetInsertRefusalCode, string> = {
  'no-workspace': '先打开一个文件夹作为工作区，才能把这张图片插入文档。',
  'unsupported-format': '这张图片不能内联进文档；先打开一个文件夹作为工作区再插入。',
  'write-failed': '图片没能写入工作区，插入已取消（文档未改动）。',
  'inline-impossible': '这张图片需要先打开一个文件夹作为工作区，才能插入到文档里。',
};

/**
 * 插入被拒 reason → 文案（唯一查表入口）。
 *
 * 为什么要有函数而不是让调用方自己 `COPY[reason]`：`unsupported-format`
 * 与 `write-failed` 的文案此前只在 `MindmapStage.refusedNoticeOf` 里可达，
 * 而那条路径的 `reason` 运行时类型是 `string`（来自 `onInsertRefused` 的回传）。
 * 收口成一个显式窄化函数，既让调用点不必各自写 `if` 分支（分支语义照旧），
 * 又保证「未知 reason 不得静默变成空气泡」—— 兜到 `'no-workspace'`
 * （迁移前 `inlineRefIdOf` 的默认拒绝就是这条，语义一致）。
 */
export function insertRefusalNotice(reason: AssetInsertRefusalCode | string): string {
  if (reason === 'unsupported-format') return ASSET_INSERT_REFUSAL_COPY['unsupported-format'];
  if (reason === 'write-failed') return ASSET_INSERT_REFUSAL_COPY['write-failed'];
  if (reason === 'inline-impossible') return ASSET_INSERT_REFUSAL_COPY['inline-impossible'];
  return ASSET_INSERT_REFUSAL_COPY['no-workspace'];
}

/**
 * 上传被拒/失败 → 文案（`assetHost.ts:189-195` 的 `AssetWriteResult`）。
 *
 * 三态分开（**不得**按 `failed` 呈现 `session-only` / `unconfirmed`）：
 *  - `written`：真的落到某处了 → 复用 P0-B 的 `formatAssetWriteNotice`
 *    （它按 store 给四分支，且带「换浏览器会丢」这类失效条件，§4.3 纪律）；
 *  - `session-only`：写入**没进持久存储**（原因在 `AssetSessionReason`）→
 *    由调用方给出该原因的中文说明；
 *  - `failed`：按 P0-A 的八码查 `FILE_OP_FAIL_COPY` —— 这就是「两域同一张表」
 *    的接口：`E-ABORT`（用户在系统选择器里取消）**静默**，其余给失败文案。
 *
 * 迁移前这里是 `MindmapStage.tsx:1291` 的一句 `'上传失败，请重试。'`：
 * 把 `E-PERMISSION`/`E-QUOTA`/`E-ABORT` 全说成同一句，用户看不出该「重新授权」
 * 还是「清理空间」，也把用户取消说成了失败（I-10 / §4.3 要求分开）。
 */
export function uploadFailureNotice(code: FileOpErrorCode): string {
  // 用户取消不是故障：静默（空串）—— 调用方见空串不渲染。
  if (code === 'E-ABORT') return '';
  // 判空码后 `code` 由 `FileOpErrorCode` 收窄为其余七码；查表与表本身的键域同一。
  return FILE_OP_FAIL_COPY[code];
}

/**
 * 全部失败码（顺序即 `FILE_OP_FAIL_COPY` 的书写顺序）。
 *
 * **签名里的 `satisfies` 是本文件穷尽性的第二重钉法**（第一重是 `Record` 类型）：
 * 少写一个码 → `MissingProperties`；多写一个不在域里的码 → `ExcessProperty`；
 * 两条都是**编译错误**，不是运行时断言。
 *
 * 为什么还要这张表：`Record<FileOpErrorCode, string>` 只能拦住「生产表漏键」，
 * 拦不住「测试用一个手抄的码表去遍历」——那样漏检会静默通过。而这里的
 * `readonly FileOpErrorCode[]` **不是** `as const` 元组字面量类型，
 * `satisfies` 不会把它收窄成实际元素，于是测试可以用
 * `fileOpErrorCodesExhaustive: Record<FileOpErrorCode, true>` 反查
 * （见 `notices-consistency.test.tsx`）：将来上游加第 9 个码时，测试与生产表
 * **同时**编译失败，不会「测试绿着但漏检」。
 *
 * 上游事实源是 `packages/react/src/edit/fileOps.ts:87` 的 `FILE_OP_ERROR_CODES`
 * （带 `satisfies readonly FileOpErrorCode[]`）—— 那张表**经包层再导出**后
 * `file-ops.test.ts` 对它做等值断言；本表是**应用侧**的同族检查器，
 * 只用于「文案表是否齐」，不改动、不复制那份上游定义。
 */
export const FILE_OP_ERROR_CODES_EXHAUSTIVE = [
  'E-PERMISSION',
  'E-NOT-FOUND',
  'E-EXISTS',
  'E-QUOTA',
  'E-UNAVAILABLE',
  'E-ABORT',
  'E-IO',
  'E-UNKNOWN',
] satisfies readonly FileOpErrorCode[];

/**
 * 会话级降级原因 → 文案（`assetHost.ts:180` 的 `AssetSessionReason`，穷尽映射）。
 *
 * 四个原因都要说「**没有**写入持久存储」（§4.3 纪律：不许把「能用」说成「已保存」），
 * 但句法不同：不给工作区 / 目录拿不到 / 浏览器库开不了 / 用户拒了。
 */
export const ASSET_SESSION_REASON_COPY: Record<
  | 'idb-failed'
  | 'fs-unavailable'
  | 'no-workspace'
  | 'declined',
  string
> = {
  'idb-failed': '浏览器的本地素材库打不开，这次图片只放在会话里：没有写入持久存储，刷新后消失。',
  'fs-unavailable': '当前环境的文件接口不可用，这次图片只放在会话里：没有写入持久存储，刷新后消失。',
  'no-workspace': '没有打开文件夹作为工作区，这次图片只放在会话里：没有写入持久存储，刷新后消失。',
  declined: '你选择了不写入磁盘，这次图片只放在会话里：没有写入持久存储，刷新后消失。',
};

/**
 * 写入已完成、但作用域已切换（契约 §4.5.4 规则 4 的原句）。
 *
 * 这条**不是**「写入失败」：字节确实落盘了，缺的只是本次 UI 回填
 * （丢回填 ≠ 撤销写入，`asset-library.md` §6.2 的反例）。
 * 迁移前是 `MindmapStage.tsx:169-170` 的 `UNCONFIRMED_WRITE_NOTICE`，**未改一字**。
 */
export const UNCONFIRMED_WRITE_NOTICE =
  '图片已写入原文件夹的 assets/，但工作区已切换；切回后可在素材库看到。';

/**
 * 同名冲突「保留两份」产生副本 → 文案（`MindmapStage.tsx:3002` 迁移）。
 *
 * 必须给出 `refId`：用户要在文档里对得上「哪一份是新的」。
 */
export function assetDuplicateCopyNotice(refId: string): string {
  return `已在工作区 assets/ 保存了一份副本（${refId}）。`;
}

// ────────────────────────────────────────────────────────── 落点文案：键 → 键映射

/**
 * 落点徽章 / 可携带性 / 写入提示的键 → 文案（**只做键到文案的转发**）。
 *
 * 键与文案的事实源仍是只读的 `assetStoreCopy.ts`（经 `@mindcanvas/react` 再导出），
 * 这里不再写第二份字节。存在的理由是让「资产侧文案也走 assetNotices」这句话
 * 在代码里可查：应用层拿 `assetCoreCopy` 取用，而不是各文件各自 `import` 包层。
 */
export const ASSET_CORE_COPY = {
  /** 落点徽章（`ASSET_STORE_BADGE`，含 `session` 键 = 未落盘） */
  badge: ASSET_STORE_BADGE,
  /** 可携带性徽章（`ASSET_PORTABILITY_COPY`） */
  portability: ASSET_PORTABILITY_COPY,
  /** 写入成功提示（按 store 四分支，带失效条件） */
  writeNotice: formatAssetWriteNotice,
  /** 落点详情（悬停说明） */
  storeDetail: formatAssetStoreDetail,
  /** §1.7 禁止表述守卫（正向锚点，P0-C 不另写一套） */
  isForbidden: isForbiddenAssetCopy,
} as const;

/** 应用层查落点徽章（`session` = `store === null`：未落盘） */
export function assetBadgeOf(store: AssetStore | null): string {
  return ASSET_STORE_BADGE[store === null ? 'session' : store];
}
