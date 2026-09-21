/**
 * 内置默认布局注册（K2 接线）：六布局种入 K0 LayoutRegistry。
 * 关系：参考源 layouts.ts 持有布局算法事实（getLayout 注册表），
 * 运行时 LayoutRegistry 为独立容器（插件可增删/覆盖）；registerBuiltinLayouts 显式种子（非自动注册）。
 */
import type { EditableNode } from '../tree/treeOps.js';
import { getLayout, type LayoutKind } from './layouts.js';
import type { LayoutResult, MeasureFn } from './mindmap.js';
import type { LayoutRegistry } from '../registry/layout.js';

/** 布局算法统一输入（包装 LayoutFunc 的三参） */
export interface LayoutInput {
  root: EditableNode;
  measure: MeasureFn;
  collapsedIds: Set<string>;
}

/** 六种内置布局 kind（对齐 layouts.ts 注册表） */
export const BUILTIN_LAYOUT_KINDS: LayoutKind[] = [
  'mindmap',
  'org',
  'timeline',
  'fishbone',
  'logic-right',
  'logic-left',
];

/** 将参考源六布局以 LayoutAlgorithm 形态种入运行时 LayoutRegistry */
export function registerBuiltinLayouts(layouts: LayoutRegistry<LayoutInput, LayoutResult>): void {
  for (const kind of BUILTIN_LAYOUT_KINDS) {
    const fn = getLayout(kind);
    layouts.register(kind, {
      name: kind,
      layout: (input) => fn(input.root, input.measure, input.collapsedIds),
    });
  }
}
