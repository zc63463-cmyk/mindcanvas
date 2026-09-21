/**
 * 资产引用解析（FA1-T3）：`kind:id` 文本 → 结构化资产引用。
 *
 * 与 `note.icon` 的用法绑定：图标值写成 `draw:assets/star.svg`，
 * 既要能被宿主 resolveAssetUrl 认出 kind，也要在缺 kind 前缀时按纯 id 处理。
 */
import { REGISTERED_KINDS } from '@mindcanvas/kernel';

export interface AssetRefLike {
  kind: string;
  id: string;
}

/**
 * 解析资产引用文本。
 * - `draw:assets/x.svg` → { kind:'draw', id:'assets/x.svg' }
 * - `assets/x.svg`      → { kind:'draw', id:'assets/x.svg' }（按扩展名推断 kind）
 * @returns 无法解析（空串 / 未知 kind）→ null
 */
export function assetIdOfRef(text: string): AssetRefLike | null {
  const t = text.trim();
  if (t === '') return null;
  const colon = t.indexOf(':');
  // 没有冒号 → 整体是资产 id，kind 按扩展名推断
  if (colon < 0) {
    const kind = kindByExt(t);
    return kind === null ? { kind: 'img', id: t } : { kind, id: t };
  }
  const kind = t.slice(0, colon);
  const id = t.slice(colon + 1);
  if (id === '') return null;
  // 已知 kind 直接用；非注册 kind（含 http(s) 协议前缀的情形）→ 当作纯 id 处理
  return (REGISTERED_KINDS as readonly string[]).includes(kind)
    ? { kind, id }
    : { kind: kindByExt(t) ?? 'img', id: t };
}

function kindByExt(id: string): string | null {
  const ext = id.toLowerCase().split('.').pop() ?? '';
  if (ext === 'svg') return 'draw';
  if (ext === 'png' || ext === 'jpg' || ext === 'jpeg' || ext === 'gif' || ext === 'webp') return 'img';
  return null;
}
