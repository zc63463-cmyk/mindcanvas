/**
 * 节点图标解析（FA1-T3 / T5）：`note.icon` 的值 → 可渲染来源。
 *
 * 三种取值形态，优先级从高到低：
 *  1. `data:image/svg+xml,...` —— 内联自包含图标（内置图标 / <15KB 上传），
 *     解码后内联渲染，`currentColor` 生效 → 随主题变色；
 *  2. `draw:assets/x.svg` / `img:assets/x.png` —— 资产引用，走宿主 resolveAssetUrl
 *     （上传资产的 objectURL 只有宿主知道），回落 baseUrl + id；
 *  3. `assets/x.svg` —— 无 kind 前缀的资产 id，直接 baseUrl + id。
 *
 * 为什么内联优先：`<image>` 加载的外部 SVG 是独立文档，拿不到宿主 currentColor，
 * 深色主题下会是一块永远不变的死色。
 */
import { assetIdOfRef } from './assetRef.js';
import { isDataUrl, isInlineableSvgText, svgFromDataUrl } from './svgTint.js';

/** 图标渲染来源：二选一（互斥），都为 null 表示不渲染 */
export interface IconSource {
  /** 内联 SVG 源码（已判定可内联；渲染侧仍需 sanitize） */
  inline: string | null;
  /** <image> 加载地址 */
  href: string | null;
}

export interface IconResolver {
  resolveAssetUrl?: (ref: { kind: string; id: string }) => string | undefined;
  assetBaseUrl?: string;
}

export function resolveNodeIcon(icon: string | null | undefined, r: IconResolver): IconSource | null {
  if (typeof icon !== 'string' || icon.trim() === '') return null;

  // 1) 内联自包含（data URL）
  if (isDataUrl(icon)) {
    const text = svgFromDataUrl(icon);
    if (text !== null && isInlineableSvgText(text)) return { inline: text, href: null };
    // 非 SVG 的 data URL（图片）/ 超长 SVG → 交给 <image>
    return { inline: null, href: icon };
  }

  // 2) / 3) 资产引用
  const ref = assetIdOfRef(icon);
  if (ref === null) return { inline: null, href: icon };
  const href = r.resolveAssetUrl?.(ref) ?? (r.assetBaseUrl ? r.assetBaseUrl + ref.id : null);
  return href === null || href === undefined ? null : { inline: null, href };
}
