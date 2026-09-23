/**
 * 保存目的地与操作租约的**类型**（P0-A · contracts §4.3 / §3.5、§3.6）。
 *
 * 为什么单独一层：`useDocumentSaveSession` 持有实现，`useDocumentActions` / `useAutoSave` /
 * 文件面板都要读这些类型。把类型放这里，实现与消费方都不必互相 import
 * （避免 `hooks/` 内部出现环）。
 *
 * 不是什么：不含实现（实现在 `useDocumentSaveSession.ts` 的 `DocumentSaveSession`）。
 */
import type { FsFileHandle } from '@mindcanvas/react';

/**
 * 保存目的地（I-20：**只有一个存储位**）。
 *
 * 三种形态的判别意义：
 *  - `disk`：有真实磁盘句柄，可静默写回（Ctrl+S 不弹对话框）；
 *  - `browser`：兼容模式（localStorage 文档库），句柄可后续补挂；
 *  - `none`：新建未保存 / 下载兜底 —— **不满足「已落盘」**，故改名/移动必须拒绝它
 *    （§3.5.4：`downloaded` 不构成持久化确认）。
 *
 * 纪律：`setDestination` / `getDestination` / `rebindDestination` / `getDestinationInfo`
 * 全部读写**同一个字段**；不得让「新方法与旧字段」各存一份（I-20 的反面就是本包要修的 R-01）。
 */
export type SaveDestination =
  | { kind: 'disk'; scopeId: string; relPath: string; name: string; handle: FsFileHandle }
  | { kind: 'browser'; docId: string }
  | { kind: 'none' };

/** 操作租约的意图（contracts §3.5.2；`archive` 供 P1-A 复用同一互斥域） */
export type FileOpIntent = 'rename' | 'move' | 'delete' | 'duplicate' | 'archive' | 'relink';

/**
 * `beginExclusiveOp` 的结果（contracts §3.5.2）。
 *
 * 两种拒绝**必须可区分**：
 *  - `busy-lease`：已有文件操作在跑 → 文案「正在处理上一步操作」；
 *  - `busy-physical`：有**物理写**在跑（含被替换会话的）→ 文案「上一份写入还没有结束」。
 *
 * 合并两者会让用户在「磁盘还在写」时收到「正在处理上一步操作」，
 * 而实际上一步操作根本不存在 —— 用户无法理解该等什么。
 */
export type OpLeaseResult =
  | { kind: 'granted'; leaseId: number; opSeq: number }
  | { kind: 'refused'; reason: 'busy-lease' | 'busy-physical' | 'session-replaced' };

/** 目的地信息（供 UI 显示「保存到哪里」；与 `getDestination()` 描述同一事实） */
export interface DestinationInfo {
  kind: SaveDestination['kind'];
  /** 磁盘模式下的相对路径；其余为 null */
  relPath: string | null;
  /** 显示名（文件名）；其余为 null */
  name: string | null;
  /** 是否具备「已落盘且可静默写回」的持久条件（改名/移动的 I-14 前置） */
  durable: boolean;
}

/** 目的地 → UI 信息（纯函数；唯一事实源纪律要求它与 `SaveDestination` 同源推导） */
export function destinationInfoOf(destination: SaveDestination): DestinationInfo {
  if (destination.kind === 'disk') {
    return {
      kind: 'disk',
      relPath: destination.relPath,
      name: destination.name,
      // disk 且有句柄 = 可静默写回；`none` 与 `browser` 都不满足 I-14 的「已落盘」
      durable: true,
    };
  }
  return { kind: destination.kind, relPath: null, name: null, durable: false };
}
