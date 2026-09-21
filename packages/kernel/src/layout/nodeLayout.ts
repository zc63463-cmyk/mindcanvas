/**
 * 节点显示度量：测量（布局引擎）与渲染（NodeG）共用的唯一事实源。
 * 保证"盒子按行数撑高、文本按行渲染"两侧数据一致——换行显示的核心。
 */
import { KIND_FALLBACK_COLOR, KIND_META, refKey } from '../protocol/types.js';
import { safeHref } from '../protocol/uri.js';
import type { Entity } from '../protocol/types.js';
import type { EditableNode } from '../tree/treeOps.js';
import { wrapText } from './wrap.js';
import { inlineWidth, tokenizeInline } from './inline.js';
import type { InlineToken } from './inline.js';

export const LINE_H = 16;
export const TITLE_MAX_ENTITY = 200;
export const TITLE_MAX_TEXT = 260;
export const TITLE_MAX_IMAGE = 240;
const PAD_X = 12;
const MIN_H = 34;
/** 资产预览区高度（@img/@draw 专属）：布局必须为其预留，否则图片被压进文本高度的条带 */
const ASSET_H = 96;
/** 资产区与文本区的垂直间隙 */
const ASSET_GAP = 8;
/** 可预览的资产 kind（与 NodeG 的渲染判定同源；新增资产 kind 需同步此处） */
const ASSET_KINDS: readonly string[] = ['img', 'draw'];
/**
 * 节点图标（FA1-T3）：`note.icon` 指定的素材渲染在标题左侧。
 * 布局必须同步预留宽度，否则图标会压在文字上（与 assetH 同一类图文重叠问题）。
 */
export const NODE_ICON_SIZE = 18;
/** 图标与标题文字的间隙 */
export const NODE_ICON_GAP = 6;
/** 带插图的节点最小宽度（窄盒子里塞不下图，宁可撑宽） */
const ASSET_MIN_W = 72;

export interface DisplayMetrics {
  w: number;
  h: number;
  /** 标题行（换行后） */
  lines: string[];
  /** 每行的行内富文本 token（渲染用；未闭合按纯文本） */
  tokens: InlineToken[][];
  /** 最长行宽度 */
  lineW: number;
  /** 标题区起点 x */
  contentX: number;
  kindLabel: string | null;
  kindColor: string;
  warn: boolean;
  badgeText: string | null;
  badgeW: number;
  badgeX: number;
  entityUrl: string | null;
  hasNote: boolean;
  /**
   * 资产预览区高度（仅 @img/@draw 实体 > 0；其余节点为 0）。
   * 渲染侧据此把图片区与文本区垂直分离——布局与渲染共用同一数值，防止图文重叠。
   * （1.0.1 新增可选字段：符合 ADR-0004「minor 可加不可改」）
   */
  assetH?: number;
  /**
   * 节点图标（FA1-T3）：`note.icon` 的值（素材 id / data URL）；无图标为 null。
   * 与 assetH 不同——图标**不与文字争高度**，只占标题左侧一块方形。
   */
  icon?: string | null;
  /** 图标占位宽度（图标 + 间隙）；无图标为 0。渲染侧据此反推图标 x = contentX - iconW */
  iconW?: number;
  /**
   * 内联插图（FA1-T3）：`note.media` 的值（素材 id / data URL）。
   * 与 `icon` 的分工：icon 是标题左侧的小方块，media 是标题**上方**的卡片式插图，
   * 需要像实体资产那样预留 assetH（否则图片压文字）。
   */
  media?: string | null;
}

/**
 * 读取节点图标（`note.icon`）。
 *
 * 只认非空字符串：note 是带索引签名的开放结构，写回时可能残留 null/对象，
 * 一律窄化后再用——避免把 `icon: {..}` 之类的脏数据当 URL 渲染。
 */
export function nodeIcon(node: { note?: unknown }): string | null {
  return noteString(node, 'icon');
}

/** 读取节点内联插图（`note.media`） */
export function nodeMedia(node: { note?: unknown }): string | null {
  return noteString(node, 'media');
}

function noteString(node: { note?: unknown }, key: string): string | null {
  const note = node.note;
  if (typeof note !== 'object' || note === null) return null;
  const v = Reflect.get(note, key);
  return typeof v === 'string' && v !== '' ? v : null;
}

/** 行宽：普通字体度量与 token 加权度量取大（防富文本加宽溢出节点盒） */
function lineWidthOf(line: string, measure: (s: string) => number): number {
  return Math.max(measure(line), inlineWidth(tokenizeInline(line), measure));
}

/**
 * displayMetrics 的引用键缓存：text/image 节点不依赖 entities，node 对象引用
 * 在不可变更新下保持不变 → WeakMap 命中即精确失效（无需 TTL）；entity 节点
 * 依赖 entities 动态标题，始终直算不落缓存。
 */
export function cachedMetrics(
  cache: WeakMap<EditableNode, DisplayMetrics>,
  node: EditableNode,
  entities: Map<string, Entity>,
  measure: (s: string) => number,
): DisplayMetrics {
  if (node.type !== 'entity') {
    const hit = cache.get(node);
    if (hit) return hit;
    const m = displayMetrics(node, entities, measure);
    cache.set(node, m);
    return m;
  }
  return displayMetrics(node, entities, measure);
}

export function displayMetrics(
  node: EditableNode,
  entities: Map<string, Entity>,
  measure: (s: string) => number,
): DisplayMetrics {
  if (node.type === 'entity' && node.ref) {
    const ent = entities.get(refKey(node.ref));
    const warn = ent === undefined || ent.status === 'unresolved';
    const title = ent?.title ?? `${node.ref.kind}:${node.ref.id}`;
    const kindLabel = `@${node.ref.kind}`;
    const kindColor = KIND_META[node.ref.kind]?.color ?? KIND_FALLBACK_COLOR;
    const kindW = measure(kindLabel) + 10;
    const lines = wrapText(title, TITLE_MAX_ENTITY, measure);
    const tokens = lines.map((l) => tokenizeInline(l));
    const lineW = Math.max(...lines.map((l) => lineWidthOf(l, measure)));
    const warnW = warn ? 16 : 0;
    const badgeText = ent?.status && ent.status !== 'unresolved' ? ent.status : null;
    const badgeW = badgeText !== null ? measure(badgeText) + 14 : 0;
    const entityUrl = safeHref(ent?.ref ?? null);
    const hasNote = Boolean(node.note);
    const noteIcon = nodeIcon(node);
    const noteIconW = noteIcon !== null ? NODE_ICON_SIZE + NODE_ICON_GAP : 0;
    const iconW = (entityUrl !== null ? 13 : 0) + (hasNote ? 15 : 0);
    const contentX = PAD_X + kindW + 6 + noteIconW;
    const w = Math.ceil(
      contentX +
        warnW +
        lineW +
        (badgeW > 0 ? badgeW + 8 : 0) +
        (iconW > 0 ? iconW + 6 : 0) +
        PAD_X,
    );
    // 资产节点（@img/@draw）：布局必须为预览区预留高度，否则渲染时图片只能挤进文本高度的条带并与文字重叠
    const assetH = ASSET_KINDS.includes(node.ref.kind) ? ASSET_H : 0;
    const textH = lines.length * LINE_H + 12;
    const h = Math.max(MIN_H, textH + (assetH > 0 ? assetH + ASSET_GAP : 0));
    return {
      w,
      h,
      lines,
      tokens,
      lineW,
      contentX,
      kindLabel,
      kindColor,
      warn,
      badgeText,
      badgeW,
      badgeX: contentX + warnW + lineW + 6,
      entityUrl,
      hasNote,
      assetH,
      icon: noteIcon,
      iconW: noteIconW,
    };
  }
  if (node.type === 'image') {
    const lines = wrapText(`🖼 ${node.url ?? ''}`, TITLE_MAX_IMAGE, measure);
    const tokens = lines.map((l) => tokenizeInline(l));
    const lineW = Math.max(...lines.map((l) => lineWidthOf(l, measure)));
    const w = Math.ceil(PAD_X + lineW + PAD_X);
    const h = Math.max(MIN_H, lines.length * LINE_H + 12);
    return {
      w,
      h,
      lines,
      tokens,
      lineW,
      contentX: PAD_X,
      kindLabel: null,
      kindColor: KIND_FALLBACK_COLOR,
      warn: false,
      badgeText: null,
      badgeW: 0,
      badgeX: 0,
      entityUrl: null,
      hasNote: Boolean(node.note),
    };
  }
  const lines = wrapText(node.text ?? '', TITLE_MAX_TEXT, measure);
  const tokens = lines.map((l) => tokenizeInline(l));
  const lineW = Math.max(...lines.map((l) => lineWidthOf(l, measure)));
  const hasNote = Boolean(node.note);
  const icon = nodeIcon(node);
  const iconW = icon !== null ? NODE_ICON_SIZE + NODE_ICON_GAP : 0;
  const media = nodeMedia(node);
  // 内联插图与实体资产同口径：预留 ASSET_H，否则图片被压进文字条带
  const assetH = media !== null ? ASSET_H : 0;
  const w = Math.ceil(
    Math.max(
      44 + (assetH > 0 ? ASSET_MIN_W : 0),
      PAD_X + iconW + lineW + (hasNote ? 17 : 0) + PAD_X,
    ),
  );
  const h = Math.max(MIN_H, lines.length * LINE_H + 12 + (assetH > 0 ? assetH + ASSET_GAP : 0));
  return {
    w,
    h,
    lines,
    tokens,
    lineW,
    contentX: PAD_X + iconW,
    kindLabel: null,
    kindColor: KIND_FALLBACK_COLOR,
    warn: false,
    badgeText: null,
    badgeW: 0,
    badgeX: 0,
    entityUrl: null,
    hasNote,
    icon,
    iconW,
    media,
    assetH,
  };
}
