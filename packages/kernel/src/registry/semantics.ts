import { Registry } from './registry.js';

/**
 * SemRoleMapping —— SemRole → action 落库映射（实体中心接入模型的词汇层）。
 * 例：{ role: 'task', action: 'create_issue' }。词汇表随语义层次独立版本化（spec §5.5 双层定义）。
 */
export interface SemRoleMapping {
  /** 语义角色（SemRole，如 task / milestone / question / risk / decision / context / idea） */
  role: string;
  /** 落库动作（action 枚举，如 create_issue / create_milestone / add_comment / link_issues / skip） */
  action: string;
  /** 可选说明（/schema 素材） */
  description?: string;
}

/**
 * SemanticsRegistry —— SemRole / action 落库映射注册表（接口即空实现）。
 * 注册 key 取语义角色名（mapping.role）。
 */
export class SemanticsRegistry extends Registry<SemRoleMapping> {}
