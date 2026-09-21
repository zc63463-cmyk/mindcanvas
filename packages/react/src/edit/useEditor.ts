/**
 * useEditor —— 编辑器 controller 的 React 接入（T1）。
 * useSyncExternalStore：controller 变更（编辑/选中/折叠/undo/redo）→ epoch+1 → 本组件重渲，
 * 渲染时直接读 controller 字段（root/selectedId/collapsed/dirty…）即最新。
 * 组件只读状态，一切写操作经 controller 方法（走 TreeOp）。
 */
import { useSyncExternalStore } from 'react';
import type { EditorController } from './controller.js';

export function useEditor(controller: EditorController): EditorController {
  useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return controller;
}
