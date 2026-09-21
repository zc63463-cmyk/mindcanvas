import { Registry } from './registry.js';

/**
 * kind 元信息（语法校验 + 展示）：kind 注册时挂载。
 * - validateId：kind 级 id 语法校验器；缺省时该 kind 不做 id 校验（未知 kind 原样透传，W-UNKNOWN-KIND）
 * - color / label：展示元信息，供角标 / 显示（对齐参考源 KIND_META 形态）
 */
export interface KindMeta {
  /** 显示名 */
  label: string;
  /** 类型色（hex） */
  color: string;
  /** 可选的 kind 级 id 语法校验；未提供则不校验 */
  validateId?: (id: string) => boolean;
}

/**
 * KindRegistry —— kind 注册表（接口即空实现）。
 * 新实体种类（如 `session` / `task`）零内核改动注册：语法校验 + 元信息（镜子 3 压力点）。
 */
export class KindRegistry extends Registry<KindMeta> {}
