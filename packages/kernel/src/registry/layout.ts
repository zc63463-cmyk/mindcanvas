import { Registry } from './registry.js';

/**
 * LayoutAlgorithm —— 布局算法契约（K2 移植布局引擎时的通用槽位）。
 * 输入输出形态尚待 K2/K5 定案，此处仅定最小外形。
 */
export interface LayoutAlgorithm<TInput = unknown, TOutput = unknown> {
  /** 算法名（注册 key） */
  readonly name: string;
  /** 布局计算：输入节点集合 → 输出位置 / 尺寸 */
  layout(input: TInput): TOutput;
}

/**
 * LayoutRegistry —— 布局算法注册表（接口即空实现）。
 * 注册 key 取算法名（algorithm.name）。
 */
export class LayoutRegistry<TInput = unknown, TOutput = unknown> extends Registry<
  LayoutAlgorithm<TInput, TOutput>
> {}
