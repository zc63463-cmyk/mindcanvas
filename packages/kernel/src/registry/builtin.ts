/**
 * 内置默认 kind 注册（K1 接线）：协议层语法事实 → 运行时注册表种子。
 * 设计关系：协议层持有语法事实（REGISTERED_KINDS 参与 parseContent 的已知 kind 判定；
 * KIND_META 提供默认展示元信息），运行时 KindRegistry 是独立容器，插件可增删/覆盖。
 * registerBuiltinKinds 为显式种子（非自动注册），保持「空注册表 = 纯文本内核」语义不变。
 * 注：validateId 槽位暂不接线（解析期已由协议层直接使用；运行时侧如需 K5 镜子验收后再补）。
 */
import { KIND_META, REGISTERED_KINDS } from '../protocol/types.js';
import { type KindMeta, type KindRegistry } from './kind.js';

/** 将协议层 REGISTERED_KINDS + KIND_META（七类）以默认元信息注入运行时 KindRegistry */
export function registerBuiltinKinds(kinds: KindRegistry): void {
  for (const kind of REGISTERED_KINDS) {
    const meta = KIND_META[kind];
    if (meta) {
      kinds.register(kind, { label: meta.label, color: meta.color } satisfies KindMeta);
    }
  }
}
