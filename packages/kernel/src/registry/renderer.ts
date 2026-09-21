import { Registry } from './registry.js';

/**
 * RendererRegistry —— 节点渲染策略注册表（泛型槽位）。
 * headless kernel 不依赖 react：渲染器具体类型由 packages/react 侧注入，
 * 内核只负责按 kind / node 类型存取不透明策略对象。
 *
 * @typeParam TRenderer 渲染策略类型（由注入方定义，如 React 组件或渲染描述对象）
 */
export class RendererRegistry<TRenderer = unknown> extends Registry<TRenderer> {}
