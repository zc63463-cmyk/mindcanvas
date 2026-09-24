/**
 * 「改为归档」的**编排接线**（P1-A ⑥）—— 从 `FileManager.tsx` 拆出。
 *
 * 为什么单独一层（派单书 §3.1/§3.2）：
 *  - 归档 = `moveFileSafe(src → _归档/<name>)`，**复用** P0-A 的互斥域与三选面板，
 *    不新增存储概念、不新写平行编排器；
 *  - 两个入口（删除确认条旁的次要动作 + 右键菜单）必须调**同一个函数**
 *    （`request`），差别只在该入口传进来的节点；
 *  - 落点移动**只有一条路**：`moveToDir`（内部经 `dropIntoRouted` 做
 *    「当前文档 → 租约编排 / 其余 → 既有移动」的既有分流 —— 判定只此一处，
 *    本层不再重复同一判定，避免两处规则迟早分叉）。
 *
 * 目录创建：`moveFileSafe` 内部经 `dirAt(root, path, /* create *\/ true)` 建目录，
 * 因此 `_归档/` 不存在时会被创建（无需本层额外探测）。
 */
import { useCallback } from 'react';
import {
  readWorkspaceRegistry,
  writeWorkspaceRegistry,
  type RegistryMutate,
  type RegistryWriteResult,
} from '@mindcanvas/react';
import { ARCHIVE_COPY, archiveRefusalOf, archiveTargetDir } from './fileArchive.js';
import type { ArchiveRefusal } from './fileArchive.js';
import type { TreeNode } from './fileTreeModel.js';

export interface ArchiveWiring {
  /** 归档入口（两个 UI 入口共用；返回是否真的发起了移动） */
  request: (node: TreeNode) => boolean;
  /** 该节点此刻能否归档（UI 据此禁用/隐藏动作，不猜） */
  canArchive: (node: TreeNode) => boolean;
}

export function useFileArchive(input: {
  /** 工作区是否挂载（未挂载 → 归档不可用，文案说明） */
  useWorkspace: boolean;
  /** 非当前文档的移动落点（内部经 `dropIntoRouted` 分流当前文档走租约编排） */
  moveToDir: (node: TreeNode, targetDirPath: string) => void;
  /** 提示出口（拒绝理由 / 空操作说明） */
  onNotice: (msg: string) => void;
}): ArchiveWiring {
  const { useWorkspace, moveToDir, onNotice } = input;

  const canArchive = useCallback(
    (node: TreeNode): boolean =>
      archiveRefusalOf({
        relPath: node.type === 'doc' ? node.fullPath : null,
        mounted: useWorkspace,
        isDir: node.type === 'dir',
      }) === null,
    [useWorkspace],
  );

  const request = useCallback(
    (node: TreeNode): boolean => {
      const refusal: ArchiveRefusal | null = archiveRefusalOf({
        relPath: node.type === 'doc' ? node.fullPath : null,
        mounted: useWorkspace,
        isDir: node.type === 'dir',
      });
      if (refusal !== null) {
        // 空操作与故障分开说：文案表里各有一句，不合并成「归档失败」
        onNotice(ARCHIVE_COPY[refusal]);
        return false;
      }
      // 当前文档的分流在 `dropIntoRouted`（唯一路由点）；归档后即离开决策器重绑目的地
      moveToDir(node, archiveTargetDir(node.fullPath));
      return true;
    },
    [useWorkspace, moveToDir, onNotice],
  );

  return { request, canArchive };
}

/** 归档动作的文案（转出，供 UI 渲染按钮标签，避免在组件里就地拼串） */
export const ARCHIVE_ACTION_COPY: (typeof ARCHIVE_COPY)['confirm'] = ARCHIVE_COPY.confirm;

/**
 * rider-B：人工关联面板的**宿主接线**（`shared-contracts` §1.2.8）。
 *
 * 单独一个 hook 而不是内联在 `FileManager.tsx` 的 JSX 里（`bigFiles` 预算）：
 * 它要包一层 `writeWorkspaceRegistry` 的 `legacy` 意图（关联**不**动裸句柄键 ——
 * 那是 `pick/restore/detach` 的职责），这个包装是语义，不是渲染细节。
 *
 * **不改 scopeIdentity 判定链**（派单书 §3.7）：本 hook 只在用户显式动作后写回，
 * 不参与 `applyIdentity` 的 reuse/register/degrade/refuse 判定。
 */
export function associationPort(): {
  read: typeof readWorkspaceRegistry;
  write: (mutate: RegistryMutate) => Promise<RegistryWriteResult>;
} {
  return {
    read: readWorkspaceRegistry,
    // `legacy: 'unchanged'`：关联只追加证据行，不写也不删裸句柄键。
    // 传 `'write'` 会绕开 I-23 的单一路径（裸键只能由身份解析入口维护）。
    write: (mutate) => writeWorkspaceRegistry(mutate, { kind: 'unchanged' }),
  };
}
