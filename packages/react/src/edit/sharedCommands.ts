/**
 * ② 二级环与右键菜单**共用的轻命令**（v1.8.2）
 * ══════════════════════════════════════════════════════════════════════
 * 单一动作源：环席位与菜单项调用的必须是同一段实现，避免两处漂移
 * （先例：`lenEdit.ts` 为「出线长度预设 / 自定义气泡」共用单一写入）。
 *
 * 本文件不 import `contextMenuItems.ts` / `subRingItems.ts` 的运行时值 → 无循环依赖
 * （后者会 re-export 前者，反向 import 会成环）。
 */
import { findNode, getNode, type EditableNode } from '@mindcanvas/kernel';
import { inferChildDir } from '../render/growDir.js';
import type { EditorController } from './controller.js';

/** 复制节点文本到剪贴板（菜单「复制节点文本」+ 环剪贴板席的退化态共用） */
export function copyNodeTextToClipboard(root: EditableNode, id: string): void {
  const t = getNode(root, id)?.text;
  if (t) void navigator.clipboard?.writeText(t);
}

/**
 * 新建同级节点（新建 → 选中 → 进入编辑）。
 * 菜单「常用 › 新建同级节点」与环第 1 席同源；方向推断与 Tab/Enter 生长一致
 * （`inferChildDir(父级)` = 兄弟多数 → 父方向 → 继承，同 G6′ 触发一致性）。
 */
export function addSiblingOf(controller: EditorController, id: string): void {
  const loc = findNode(controller.root, id);
  const d = loc ? inferChildDir(loc.parent) : null;
  const sid = controller.addSibling(id, undefined, d ? { dir: d } : undefined);
  if (sid !== null) {
    controller.select(sid);
    controller.startEdit(sid);
  }
}
