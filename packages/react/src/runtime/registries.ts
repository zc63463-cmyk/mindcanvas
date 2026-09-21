/**
 * 六注册表 react 侧实装（T3 · 微内核插件面）。
 * - kinds：内置七类（registerBuiltinKinds，K1 种子）
 * - noteKeys：透传键语义（links / groups / qa——spec §5.5 存储三件套 + R15）
 * - layouts：六布局（registerBuiltinLayouts）
 * - renderers：泛型槽位，react 侧注入「kind 角标渲染描述」（NodeG 消费的语义色/名）
 * - semantics / channels：空实现（纯内核三规则 ②：空注册表内核照常工作）
 */
import {
  createKernelRegistries,
  KIND_META,
  REGISTERED_KINDS,
  registerBuiltinKinds,
  registerBuiltinLayouts,
  type KernelRegistries,
  type NoteKeyHandler,
} from '@mindcanvas/kernel';

/** 渲染策略（react 侧注入 renderers 槽位的类型）：kind 角标渲染描述 */
export interface KindBadgeRenderer {
  label: string;
  color: string;
}

/** note 透传键语义种子（spec §5.5：links/groups/qa） */
const BUILTIN_NOTE_KEYS: Record<string, NoteKeyHandler> = {
  links: { description: '结构化关系连线（rel/to 锚定）' },
  groups: { description: '选框圈定（根笔记内，全图属性）' },
  qa: { description: '快速注释（R15：珊瑚便签卡）' },
};

/** 内置 kind 角标渲染器种子（NodeG 语义色同源 KIND_META） */
function builtinBadgeRenderers(): Array<[string, KindBadgeRenderer]> {
  return REGISTERED_KINDS.map((k) => [
    k,
    { label: KIND_META[k]?.label ?? k, color: KIND_META[k]?.color ?? '#888780' },
  ]);
}

/**
 * 创建六注册表聚合（react 侧实装：内核空实现 + 内置种子）。
 * 纯文本版构建即消费本工厂 + 零插件 —— 无插件配置可运行（渐进增强）。
 */
export function createReactRegistries(): KernelRegistries {
  const regs = createKernelRegistries();
  registerBuiltinKinds(regs.kinds);
  for (const [key, handler] of Object.entries(BUILTIN_NOTE_KEYS)) {
    regs.noteKeys.register(key, handler);
  }
  registerBuiltinLayouts(regs.layouts as never); // 泛型槽位形状待 K5 镜子验收统一（T3 先用断言收敛）
  for (const [kind, renderer] of builtinBadgeRenderers()) {
    regs.renderers.register(kind, renderer);
  }
  return regs;
}
