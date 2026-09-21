/**
 * SVG 矢量赋能（FA1-T5）：单色图标随主题变色 + 小图标内联自包含。
 *
 * 背景：此前 SVG 只是 `<image href=...>` 里的一张"死图"。浏览器把外部 SVG
 * 当作独立文档加载 —— 它**拿不到宿主文档的 currentColor**，于是深色/浅色主题下
 * 图标颜色永远不变，和旁边的文字各说各话。
 *
 * 解法：小 SVG（< 15KB）以内联 markup 渲染进主文档，此时 `currentColor` 生效，
 * 图标自动跟随 `style.color`（由主题令牌驱动）。
 *
 * 安全：内联 = 把用户提供的 SVG 源码插进 DOM，等价于执行 HTML。因此内联前
 * 必须过 `sanitizeInlineSvg()`（基于 DOMParser 的**元素/属性白名单**，不是正则替换）：
 * 移除 script / foreignObject / 事件属性 / javascript: URL / 外链引用。
 */
import { INLINE_SVG_LIMIT } from '../chrome/assetIcons.js';

/** 内联渲染的尺寸上限（字节）：超过则以 <image> 加载，不内联 */
export const SVG_INLINE_LIMIT = INLINE_SVG_LIMIT;

/** 允许保留的 SVG 元素（白名单；其余节点连同子树丢弃） */
const ALLOWED_TAGS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'lineargradient',
  'radialgradient',
  'stop',
  'clippath',
  'mask',
  'use',
  'symbol',
  'marker',
]);

/** 允许保留的属性（白名单；其余一律丢弃，事件属性天然被排除） */
const ALLOWED_ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'viewbox',
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'opacity',
  'transform',
  'points',
  'offset',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'font-size',
  'font-weight',
  'font-family',
  'text-anchor',
  'dominant-baseline',
  'preserveaspectratio',
  'gradientunits',
  'gradienttransform',
  'marker-start',
  'marker-mid',
  'marker-end',
  'id',
  'class',
]);

/** 危险 URL 前缀（href/src 等会发起请求或执行脚本） */
function isDangerousUrl(v: string): boolean {
  // 去空白：防 `java\nscript:` / `javascript :` 这类变形绕过前缀检查
  const s = v.toLowerCase().replace(/\s+/g, '');
  return s.startsWith('javascript:') || s.startsWith('data:text/html') || s.startsWith('vbscript:');
}

/**
 * 净化 SVG 源码：只留白名单元素与属性，其余丢弃。
 * @returns 可直接内联的安全 markup；解析失败或不是 SVG → null
 */
export function sanitizeInlineSvg(text: string): string | null {
  if (!looksLikeSvg(text)) return null;
  if (typeof DOMParser === 'undefined') return null; // 非 DOM 环境（node 测试）不内联
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (doc.querySelector('parsererror') !== null) return null;
  const root = doc.documentElement;
  if (root.localName.toLowerCase() !== 'svg') return null;
  walk(root);
  return root.outerHTML;
}

/** 递归剪枝：非白名单元素整体移除；白名单元素清掉非白名单/危险属性 */
function walk(el: Element): void {
  // 先复制一份：遍历中删子节点会打乱 live NodeList
  for (const child of Array.from(el.children)) {
    if (!ALLOWED_TAGS.has(child.localName.toLowerCase())) {
      child.remove();
      continue;
    }
    walk(child);
  }
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    if (!ALLOWED_ATTRS.has(name) || isDangerousUrl(attr.value)) el.removeAttribute(attr.name);
  }
}

/** 粗略判定：这是 SVG 源码而不是别的什么东西（净化前的廉价前置检查） */
export function looksLikeSvg(text: string): boolean {
  const t = text.trim().toLowerCase();
  return t.startsWith('<svg') || t.startsWith('<?xml');
}

/**
 * 是否单色图标（可安全染色）。
 *
 * 判定口径**保守**：出现 `currentColor`、或所有显式颜色都相同、或根本没有显式颜色
 * 才算单色。多色图标染色会把配色洗掉，宁可不染。
 */
export function isMonochromeSvg(text: string): boolean {
  if (text.includes('currentColor')) return true;
  const colors = new Set<string>();
  const re = /(?:fill|stroke|stop-color)="([^"]+)"/gi;
  for (const m of text.matchAll(re)) {
    const v = (m[1] ?? '').trim().toLowerCase();
    if (v === 'none' || v === 'transparent' || v.startsWith('url(')) continue;
    colors.add(v);
  }
  return colors.size <= 1;
}

/**
 * 把单色 SVG 的显式颜色换成 `currentColor`，使其跟随宿主 `style.color`。
 * 非单色图标原样返回（不清空配色）。
 */
export function tintSvgToCurrentColor(text: string): string {
  if (!isMonochromeSvg(text)) return text;
  return text.replace(
    /(\b(?:fill|stroke|stop-color)=")(?!none|transparent|url\()([^"]+)(")/gi,
    '$1currentColor$3',
  );
}

/** SVG 源码 → data URL（UTF-8，转义后可安全嵌进属性/URL 上下文） */
export function svgToDataUrl(text: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(text)}`;
}

/** data URL → SVG 源码；非 SVG data URL → null */
export function svgFromDataUrl(url: string): string | null {
  const m = /^data:image\/svg\+xml(?:;utf8)?,(.*)$/i.exec(url.trim());
  if (!m || m[1] === undefined) return null;
  return decodeURIComponent(m[1]);
}

/** 是否 data URL（内联自包含资产的标记） */
export function isDataUrl(url: string): boolean {
  return url.trim().toLowerCase().startsWith('data:');
}

/** 是否小到可以内联（大 SVG 走 <image> 加载，避免文档膨胀） */
export function isInlineableSvgText(text: string): boolean {
  return text.length <= SVG_INLINE_LIMIT;
}
