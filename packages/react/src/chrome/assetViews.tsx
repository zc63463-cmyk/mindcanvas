/**
 * 素材面板的展示层组件（FA1-T3 · 从 AssetPanel.tsx 拆出）。
 *
 * 拆分动因：AssetPanel.tsx 一度逼近 900 行，其中「卡片 / 列表行 / data URL 编码」
 * 是与面板状态完全无关的**纯展示与纯函数**部分，留在原地只增加阅读成本。
 * 面板主组件只负责状态与虚拟滚动，视觉细节归此处。
 */
import { useMemo, useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import { matchBuiltinIcons, type BuiltinIcon } from './assetIcons.js';
import type { AssetItem } from './assetTypes.js';

/** 网格卡片：图标 48×48 居中矢量；图片 80×60 保宽高比缩略 */
export function AssetCard({
  item,
  resolve,
  missing,
  fav,
  onToggleFav,
  onInsert,
}: {
  item: AssetItem;
  resolve?: (item: AssetItem) => string;
  missing: boolean;
  fav: boolean;
  onToggleFav: () => void;
  onInsert: () => void;
}) {
  const isIcon = item.type === 'svg' || item.kind === 'draw';
  const [failed, setFailed] = useState(false);
  const src = useMemo(() => {
    if (item.svg) return svgDataUrlWithColor(item.svg, CHROME.text);
    return resolve?.(item) ?? null;
  }, [item, resolve]);

  return (
    <div
      data-asset-item
      data-missing={missing || undefined}
      onClick={() => {
        if (missing) return; // 失效项禁止插入
        onInsert();
      }}
      title={item.name}
      style={{
        width: 80,
        borderRadius: 10,
        border: `1px solid ${CHROME.panelBorder}`,
        background: CHROME.panelBgStrong,
        padding: 6,
        cursor: missing ? 'not-allowed' : 'pointer',
        opacity: missing ? 0.55 : 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        position: 'relative',
      }}
    >
      <span
        data-asset-fav={fav ? 'true' : 'false'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFav();
        }}
        style={{
          position: 'absolute',
          top: 3,
          right: 5,
          fontSize: 10,
          color: fav ? CHROME.neon : CHROME.textMuted,
        }}
      >
        {fav ? '★' : '☆'}
      </span>
      {src !== null && !failed ? (
        <img
          src={src}
          alt={item.name}
          width={isIcon ? 48 : 68}
          height={isIcon ? 48 : 48}
          style={{ objectFit: 'contain', display: 'block' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span
          style={{
            width: 48,
            height: 48,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: missing ? CHROME.warn : CHROME.neon,
            fontSize: 16,
          }}
        >
          {missing ? '✕' : isIcon ? '◆' : '🖼'}
        </span>
      )}
      <span
        style={{
          fontSize: CHROME.fontSizeSmall,
          color: missing ? CHROME.warn : CHROME.textMuted,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.name}
        {missing ? '（失效）' : ''}
      </span>
    </div>
  );
}

/** 列表行（沿用固定行高，配合虚拟滚动） */
export function AssetRow({
  item,
  resolve,
  top,
  rowHeight,
  missing,
  onInsert,
}: {
  item: AssetItem;
  resolve?: (item: AssetItem) => string;
  top: number;
  rowHeight: number;
  missing: boolean;
  onInsert: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = item.svg ? svgDataUrlWithColor(item.svg, CHROME.text) : (resolve?.(item) ?? null);
  return (
    <div
      data-asset-item
      data-missing={missing || undefined}
      onClick={() => {
        if (missing) return;
        onInsert();
      }}
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        height: rowHeight - 2,
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '0 6px',
        borderRadius: 6,
        cursor: missing ? 'not-allowed' : 'pointer',
        opacity: missing ? 0.55 : 1,
      }}
    >
      {src !== null && !failed ? (
        <img
          src={src}
          alt={item.name}
          width={22}
          height={22}
          style={{ objectFit: 'contain', flex: 'none', display: 'block' }}
          onError={() => setFailed(true)}
        />
      ) : (
        <span style={{ width: 22, flex: 'none', textAlign: 'center', color: CHROME.neon }}>◆</span>
      )}
      <span
        style={{
          fontSize: CHROME.fontSizeSmall,
          color: missing ? CHROME.warn : item.kind === 'img' ? CHROME.neon : CHROME.textMuted,
          fontWeight: 600,
          width: 34,
          flex: 'none',
        }}
      >
        {item.source === 'builtin' ? '内置' : item.kind}
      </span>
      <span
        style={{
          fontSize: CHROME.fontSizeSmall,
          color: missing ? CHROME.warn : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          flex: 1,
        }}
      >
        {item.name}
        {missing ? '（失效）' : ''}
      </span>
    </div>
  );
}

/**
 * 内置图标 → 面板可用的 data URL。
 *
 * 内置图标用 `currentColor`，但 `<img>` 里的 SVG 是独立文档、拿不到宿主 color，
 * currentColor 会解析成默认黑 → 深色面板上完全看不见。因此这里把 currentColor
 * 替换成面板文字色；写进 note.icon 时仍保留 currentColor 版本（渲染层内联后随主题变色）。
 */
export function svgDataUrlWithColor(svg: string, color: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/currentColor/g, color))}`;
}

/** 内置图标按关键字命中（供宿主构造「内置图标」Tab 的候选项） */
export function searchBuiltinIcons(query: string): readonly BuiltinIcon[] {
  return matchBuiltinIcons(query);
}
