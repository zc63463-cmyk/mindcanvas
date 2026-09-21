/**
 * 出线长度编辑（v1.8.1 菜单梳理）：菜单预设项与「自定义…」数值气泡**共用同一写入实现**。
 * 写 `lens.up` + `lens.down`（与拖共享梁同通道），并同步 `len` 兼容旧读取；null = 恢复缺省。
 * 单条 undo：全部经 `controller.updateNote`。
 */
import { readLensMap, readLinkLen } from '@mindcanvas/kernel';
import type { EditorController } from '@mindcanvas/react';
import { nodeById } from './hooks/useEdgeActions.js';

/** 当前生效的出线长度（up 组缺省：lens.up ?? len；null = 缺省） */
export function currentLenOf(controller: EditorController, id: string): number | null {
  const note = nodeById(controller.root, id)?.note;
  return readLensMap(note)?.up ?? readLinkLen(note);
}

/** 写入 / 清除出线长度（null = 恢复缺省；经 updateNote 单条 undo） */
export function applyLen(controller: EditorController, id: string, len: number | null): void {
  const note = nodeById(controller.root, id)?.note;
  const lens = { ...(readLensMap(note) ?? {}) };
  if (len === null) {
    delete lens.up;
    delete lens.down;
    controller.updateNote(id, {
      len: undefined,
      lens: Object.keys(lens).length > 0 ? lens : undefined,
    });
    return;
  }
  lens.up = len;
  lens.down = len;
  controller.updateNote(id, { lens, len });
}
