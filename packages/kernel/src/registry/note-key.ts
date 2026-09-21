import { Registry } from './registry.js';

/**
 * NoteKeyHandler —— 笔记块透传键的语义处理器。
 * `.mm.md` 笔记块中的未知键依协议透传；注册处理器后可赋予其语义（links / groups / ai_role，镜子 2 压力点）。
 *
 * links / groups 的处理契约（K5 已精化，见 note-anchor.ts）：
 * - links：`[{ rel, to }]`，to 为节点锚 `node:根/分支/节点名` 或实体锚 `kind:id`
 * - groups：`[{ id, label, sem_role, members }]`，members 为锚数组（圈定组成员）
 * - 锚定解析状态三态：well-formed / dangling / stale（spec §5.5「锚定与失联规则」）
 * - 解析由 kernel 纯函数判定（resolveLinks / resolveGroups），语义处理器仅登记语义描述
 */
export interface NoteKeyHandler {
  /** 处理器描述（/schema 语义注册表自动生成素材） */
  description?: string;
  /** 解析：把透传的原始 YAML 值转为结构化语义（如 links → resolveLinks 结果） */
  parse?(value: unknown): unknown;
  /** 序列化：结构化语义转回透传值 */
  serialize?(value: unknown): unknown;
}

/**
 * NoteKeyRegistry —— 笔记块透传键语义处理器注册表（接口即空实现）。
 */
export class NoteKeyRegistry extends Registry<NoteKeyHandler> {}
