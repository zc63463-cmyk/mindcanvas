/**
 * AssetPanel —— 素材中心侧栏（右侧玻璃浮层）。
 *
 * FA1-T4 重构：从 230px 单列文本列表升级为 360px 现代素材抽屉：
 *  - **双视图**：网格（图标 48×48 / 图片 80×60 缩略卡） / 列表（沿用虚拟滚动，大图集友好）
 *  - **搜索**：顶部常驻 input，实时过滤名称与类型
 *  - **分类 Tabs**：全部 / ⭐ 常用 / 🎨 内置矢量图标 / 📁 本地上传
 *  - **插入语义**：顶部「插入为」三选一（节点图标 / 节点插图 / 子分支）——
 *    纠正此前「点击素材 = 无差别新建子节点」的反直觉逻辑
 *  - **上传**：底部虚线 Dropzone + 剪贴板 Paste（图片文件或 <svg> 纯文本均可入库）
 *
 * 向后兼容：`onInsert` 仍是主操作（点击卡片触发），未传 `onInsertAs` 的老调用方
 * 行为完全不变（= 插入为子分支）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHROME } from '../theme/tokens.js';
import { BUILTIN_ICONS, type BuiltinIcon } from './assetIcons.js';
import { AssetCard, AssetRow } from './assetViews.js';
import type { AssetInsertAction, AssetItem } from './assetTypes.js';

export type { AssetInsertAction, AssetItem } from './assetTypes.js';
export { searchBuiltinIcons, svgDataUrlWithColor } from './assetViews.js';

/** 语义顺序（UI 渲染次序的唯一事实源；Record 键序不可依赖） */
export const ASSET_ACTION_ORDER = [
  'icon',
  'media',
  'child',
] as const satisfies readonly AssetInsertAction[];

export const ASSET_ACTION_LABEL: Record<AssetInsertAction, string> = {
  icon: '节点图标',
  media: '节点插图',
  child: '子分支',
};

export interface AssetPanelProps {
  assets: AssetItem[];
  onInsert: (item: AssetItem) => void;
  onClose: () => void;
  /** 失效判定（P2）：宿主同步判定清单项不可加载 → warn 标识 + 禁止插入 */
  isMissing?: (item: AssetItem) => boolean;
  /** 缩略图 URL 解析（P3）：宿主 resolveAsset；缺省不渲染缩略图 */
  resolve?: (item: AssetItem) => string;
  /** 上传入口（P1-1）：上传按钮 / 面板拖拽 → 文件数组（宿主负责过滤 + uploadAsset） */
  onUpload?: (files: File[]) => void;
  /**
   * 三语义插入（FA1-T3）：宿主按 action 决定落到 note.icon / note.media / 新建子节点。
   * 缺省（老调用方）→ 一切点击都走 onInsert。
   */
  onInsertAs?: (item: AssetItem, action: AssetInsertAction) => void;
  /** 当前插入语义（受控；缺省内部维护，默认 'child'） */
  action?: AssetInsertAction;
  onActionChange?: (action: AssetInsertAction) => void;
  /** 剪贴板粘贴入库（FA1-T4）：收到图片文件；缺省不监听 paste */
  onPaste?: (files: File[]) => void;
  /**
   * 初始视图（FA1-T4）。默认 'list' 以保持既有调用方形态不变；
   * 产品壳（apps/canvas）传 'grid' 呈现现代网格。
   */
  defaultView?: 'grid' | 'list';
}

/** 虚拟滚动行高（px）：项 + 2px 间距（与渲染样式一致） */
const ROW_H = 30;
/** 可视区上下缓冲行数（防快速滚动闪白） */
const BUFFER = 6;
/** 面板宽度（FA1-T4：230 → 360） */
const PANEL_W = 360;
/** 收藏持久化 key */
const FAV_KEY = 'mindcanvas.assets.fav';

type TabId = 'upload' | 'fav' | 'builtin' | 'all';
/**
 * 分类 Tabs。
 *
 * 默认落在「📁 本地上传」而非「全部」：内置图标有 28 个，混进默认视图会把
 * 用户自己的素材挤到后面（也更难在测试里断言宿主资产行为）。想看内置图标点对应 Tab。
 */
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'upload', label: '📁 本地上传' },
  { id: 'fav', label: '⭐ 常用' },
  { id: 'builtin', label: '🎨 内置图标' },
  { id: 'all', label: '全部' },
];

/** 内置图标 → 面板资产项（与上传资产同构，便于统一检索/插入） */
export const BUILTIN_ASSET_ITEMS: readonly AssetItem[] = BUILTIN_ICONS.map((i: BuiltinIcon) => ({
  kind: 'draw' as const,
  id: `builtin:${i.id}`,
  name: i.name,
  type: 'svg',
  source: 'builtin' as const,
  svg: i.svg,
}));

function loadFavs(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw === null) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === 'string'));
  } catch {
    return new Set();
  }
}

function saveFavs(favs: Set<string>): void {
  try {
    localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
  } catch {
    // 配额/隐私模式：收藏是增强，失败不影响主流程
  }
}

export function AssetPanel({
  assets,
  onInsert,
  onClose,
  isMissing,
  resolve,
  onUpload,
  onInsertAs,
  action: actionProp,
  onActionChange,
  onPaste,
  defaultView = 'list',
}: AssetPanelProps) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [range, setRange] = useState({ start: 0, end: 30 });
  const viewHRef = useRef(400);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<TabId>('upload');
  const [view, setView] = useState<'grid' | 'list'>(defaultView);
  const [innerAction, setInnerAction] = useState<AssetInsertAction>('child');
  const [favs, setFavs] = useState<Set<string>>(loadFavs);
  const action = actionProp ?? innerAction;

  const setAction = (next: AssetInsertAction): void => {
    if (onActionChange) onActionChange(next);
    else setInnerAction(next);
  };

  /** 内置图标 + 宿主资产并集（宿主资产按 id 去重在前） */
  const allItems = useMemo(() => {
    const merged = [...assets, ...BUILTIN_ASSET_ITEMS];
    const seen = new Set<string>();
    return merged.filter((a) => {
      const k = `${a.kind}:${a.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }, [assets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byTab =
      tab === 'fav'
        ? allItems.filter((a) => favs.has(`${a.kind}:${a.id}`))
        : tab === 'builtin'
          ? allItems.filter((a) => a.source === 'builtin')
          : tab === 'upload'
            ? allItems.filter((a) => a.source !== 'builtin')
            : allItems;
    if (q === '') return byTab;
    return byTab.filter(
      (a) => a.name.toLowerCase().includes(q) || a.type.toLowerCase().includes(q) || a.id.toLowerCase().includes(q),
    );
  }, [allItems, tab, query, favs]);

  // 收藏优先：常用视图里星标项排前面
  const ordered = useMemo(() => {
    if (tab !== 'all' && tab !== 'fav') return filtered;
    return [...filtered].sort((a, b) => {
      const fa = favs.has(`${a.kind}:${a.id}`) ? 0 : 1;
      const fb = favs.has(`${b.kind}:${b.id}`) ? 0 : 1;
      return fa - fb;
    });
  }, [filtered, tab, favs]);

  // 虚拟区间：按滚动位置裁剪（列表视图专用；网格视图直接全渲染，量级可控）
  useEffect(() => {
    if (view !== 'list') return;
    const el = scrollerRef.current;
    if (!el) return;
    const update = (): void => {
      const viewH = el.clientHeight || viewHRef.current;
      viewHRef.current = viewH;
      const start = Math.max(0, Math.floor(el.scrollTop / ROW_H) - BUFFER);
      const end = Math.min(ordered.length, Math.ceil((el.scrollTop + viewH) / ROW_H) + BUFFER);
      setRange({ start, end });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    return () => el.removeEventListener('scroll', update);
  }, [ordered.length, view]);

  // FA1-T4 剪贴板入库：复制的图片文件 / <svg>...</svg> 纯文本都能直接进图库
  useEffect(() => {
    if (!onPaste) return;
    const onPasteEvent = (e: ClipboardEvent): void => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        onPaste(files);
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim().toLowerCase().startsWith('<svg')) return;
      e.preventDefault();
      const file = new File([text], `pasted-${Date.now()}.svg`, { type: 'image/svg+xml' });
      onPaste([file]);
    };
    window.addEventListener('paste', onPasteEvent);
    return () => window.removeEventListener('paste', onPasteEvent);
  }, [onPaste]);

  const toggleFav = (key: string): void => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      saveFavs(next);
      return next;
    });
  };

  const insert = (item: AssetItem): void => {
    if (onInsertAs) onInsertAs(item, action);
    else onInsert(item);
  };

  return (
    <div
      data-asset-panel
      style={{
        position: 'absolute',
        right: 18,
        top: 76,
        width: PANEL_W,
        maxHeight: '68vh',
        display: 'flex',
        flexDirection: 'column',
        background: CHROME.panelBg,
        border: `1px solid ${CHROME.panelBorder}`,
        borderRadius: CHROME.radius,
        boxShadow: CHROME.shadow,
        backdropFilter: 'blur(14px) saturate(1.3)',
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        padding: 10,
        zIndex: 4,
      }}
      // P1-1 面板拖拽上传：dragover 阻止默认以允许 drop；drop 透传文件列表
      onDragOver={(e) => {
        if (!onUpload || !e.dataTransfer?.types.includes('Files')) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!onUpload) return;
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length === 0) return;
        e.preventDefault();
        onUpload(files);
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 4px 8px', flex: 'none' }}>
        <span style={{ color: CHROME.neon, fontWeight: 600, fontSize: CHROME.fontSize }}>素材中心</span>
        <span style={{ flex: 1 }} />
        <ViewToggle view={view} onChange={setView} />
        <span
          data-asset-close
          onClick={onClose}
          style={{ color: CHROME.textMuted, cursor: 'pointer', fontSize: CHROME.fontSize }}
        >
          ×
        </span>
      </div>

      {/* 搜索：名称 / 类型 / id 实时过滤 */}
      <input
        data-asset-search
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="搜索素材名称或类型…"
        style={{
          flex: 'none',
          marginBottom: 8,
          padding: '5px 8px',
          borderRadius: 8,
          border: `1px solid ${CHROME.panelBorder}`,
          background: CHROME.panelBgStrong,
          color: CHROME.text,
          fontFamily: CHROME.fontFamily,
          fontSize: CHROME.fontSizeSmall,
          outline: 'none',
        }}
      />

      {/* 分类 Tabs */}
      <div style={{ display: 'flex', gap: 4, flex: 'none', marginBottom: 8, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <Tab key={t.id} active={tab === t.id} label={t.label} onClick={() => setTab(t.id)} />
        ))}
      </div>

      {/* 插入语义：三选一（纠正「点击素材 = 必成子节点」） */}
      {onInsertAs && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flex: 'none',
            marginBottom: 8,
            fontSize: CHROME.fontSizeSmall,
            color: CHROME.textMuted,
          }}
        >
          <span>插入为</span>
          {ASSET_ACTION_ORDER.map((a) => (
            <span
              key={a}
              data-asset-action={a}
              data-active={action === a || undefined}
              onClick={() => setAction(a)}
              style={{
                cursor: 'pointer',
                padding: '2px 8px',
                borderRadius: 999,
                border: `1px solid ${action === a ? CHROME.neon : CHROME.panelBorder}`,
                background: action === a ? CHROME.neonSoft : 'transparent',
                color: action === a ? CHROME.neon : CHROME.textMuted,
              }}
            >
              {ASSET_ACTION_LABEL[a]}
            </span>
          ))}
        </div>
      )}

      {ordered.length === 0 ? (
        <div style={{ color: CHROME.textMuted, fontSize: CHROME.fontSizeSmall, padding: '10px 6px' }}>
          {query !== ''
            ? `没有匹配「${query}」的素材。`
            : tab === 'fav'
              ? '还没有常用素材 —— 移到卡片上点 ★ 收藏。'
              : onUpload
                ? '暂无素材。拖文件到下方热区，或点击上传。'
                : '暂无素材。'}
        </div>
      ) : view === 'grid' ? (
        <div
          data-asset-grid
          style={{ overflowY: 'auto', flex: 1, display: 'flex', flexWrap: 'wrap', gap: 8, alignContent: 'flex-start' }}
        >
          {ordered.map((a) => (
            <AssetCard
              key={`${a.kind}:${a.id}`}
              item={a}
              resolve={resolve}
              missing={isMissing?.(a) ?? false}
              fav={favs.has(`${a.kind}:${a.id}`)}
              onToggleFav={() => toggleFav(`${a.kind}:${a.id}`)}
              onInsert={() => insert(a)}
            />
          ))}
        </div>
      ) : (
        <div ref={scrollerRef} data-asset-scroller style={{ overflowY: 'auto', flex: 1 }}>
          <div style={{ height: ordered.length * ROW_H, position: 'relative' }}>
            {ordered.slice(range.start, range.end).map((a, i) => (
              <AssetRow
                key={`${a.kind}:${a.id}`}
                item={a}
                resolve={resolve}
                top={(range.start + i) * ROW_H}
                rowHeight={ROW_H}
                missing={isMissing?.(a) ?? false}
                onInsert={() => insert(a)}
              />
            ))}
          </div>
        </div>
      )}

      {/* 现代上传热区（Dropzone） */}
      {onUpload && (
        <div
          data-asset-dropzone
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            if (!e.dataTransfer?.types.includes('Files')) return;
            e.preventDefault();
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length === 0) return;
            e.preventDefault();
            onUpload(files);
          }}
          style={{
            flex: 'none',
            marginTop: 8,
            padding: '10px 8px',
            borderRadius: 10,
            border: `1px dashed ${CHROME.panelBorderStrong}`,
            color: CHROME.textMuted,
            fontSize: CHROME.fontSizeSmall,
            textAlign: 'center',
            cursor: 'pointer',
          }}
        >
          拖拽 SVG / 图片到此处，或点击上传
        </div>
      )}

      {/* P1-1 隐藏 file input：上传按钮的唯一数据源；change 后清空 value 以支持重复选同一文件 */}
      {onUpload && (
        <>
          <span data-asset-upload style={{ display: 'none' }} onClick={() => fileInputRef.current?.click()} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,.svg"
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              if (files.length > 0) onUpload(files);
              e.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
}

function Tab({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <span
      data-asset-tab
      data-active={active || undefined}
      onClick={onClick}
      style={{
        cursor: 'pointer',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: CHROME.fontSizeSmall,
        border: `1px solid ${active ? CHROME.neon : CHROME.panelBorder}`,
        background: active ? CHROME.neonSoft : 'transparent',
        color: active ? CHROME.neon : CHROME.textMuted,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
}

function ViewToggle({ view, onChange }: { view: 'grid' | 'list'; onChange: (v: 'grid' | 'list') => void }) {
  return (
    <span style={{ display: 'flex', gap: 2 }}>
      {(['grid', 'list'] as const).map((v) => (
        <span
          key={v}
          data-asset-view={v}
          data-active={view === v || undefined}
          onClick={() => onChange(v)}
          title={v === 'grid' ? '网格视图' : '列表视图'}
          style={{
            cursor: 'pointer',
            fontSize: CHROME.fontSizeSmall,
            padding: '1px 6px',
            borderRadius: 6,
            border: `1px solid ${view === v ? CHROME.neon : CHROME.panelBorder}`,
            color: view === v ? CHROME.neon : CHROME.textMuted,
          }}
        >
          {v === 'grid' ? '▦' : '☰'}
        </span>
      ))}
    </span>
  );
}
