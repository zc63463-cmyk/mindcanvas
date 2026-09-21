/**
 * registry 模块入口：六注册表接口 + 空实现聚合 + 内置默认 kind 种子。
 * 空注册表时内核照常工作（渐进增强架构「纯文本版」= kernel + [] 组合）。
 */
export * from './registry.js';
export * from './kind.js';
export * from './note-key.js';
export * from './note-anchor.js';
export * from './renderer.js';
export * from './layout.js';
export * from './semantics.js';
export * from './channel.js';
export * from './builtin.js';

import { KindRegistry } from './kind.js';
import { NoteKeyRegistry } from './note-key.js';
import { RendererRegistry } from './renderer.js';
import { LayoutRegistry } from './layout.js';
import { SemanticsRegistry } from './semantics.js';
import { ChannelRegistry } from './channel.js';

/**
 * 内核六注册表聚合（KernelRegistries）。
 * 创建即空实现 —— 无插件配置时内核照常工作（入口即组合点：app = kernel + [plugins]）。
 */
export interface KernelRegistries {
  /** kind 注册表（语法校验 + 元信息） */
  kinds: KindRegistry;
  /** 笔记块透传键语义处理器注册表 */
  noteKeys: NoteKeyRegistry;
  /** 渲染策略注册表（泛型槽位，react 侧注入） */
  renderers: RendererRegistry<unknown>;
  /** 布局算法注册表 */
  layouts: LayoutRegistry<unknown, unknown>;
  /** SemRole / action 落库映射注册表 */
  semantics: SemanticsRegistry;
  /** 外部接入通道注册表 */
  channels: ChannelRegistry;
}

/** 创建六注册表聚合（全部为空实现，开箱即用） */
export function createKernelRegistries(): KernelRegistries {
  return {
    kinds: new KindRegistry(),
    noteKeys: new NoteKeyRegistry(),
    renderers: new RendererRegistry(),
    layouts: new LayoutRegistry(),
    semantics: new SemanticsRegistry(),
    channels: new ChannelRegistry(),
  };
}
