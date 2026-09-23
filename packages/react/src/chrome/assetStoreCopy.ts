/**
 * 落点与可携带性徽章文案（P0-B ⑦，契约 `asset-library.md` §2.3 + `shared-contracts.md` §1.7）。
 *
 * **要解决的问题**：初版只有一个 `persisted` 字段，界面因此把「写入成功」说成
 * 「换机器还在」（I-12 明令禁止）。这里把三个正交维度分别陈述：
 *  1. **落点**（`AssetStore`）：写到哪了 —— 「📁 本工作区」/「💾 浏览器」/「🎨 内置」；
 *  2. **可携带性**（`AssetPortability`）：能不能随文档带走 —— 「📦 随文件夹」/「🔒 仅此浏览器」/「✈ 自包含」；
 *  3. **本地持久性**（`AssetDurability`）：刷新后还在不在 —— 会话级项显式说「没有写入持久存储」。
 *
 * **禁止的表述**（§2.3 末段，逐条由 `isForbiddenAssetCopy` 守卫）：
 * 「已保存，换电脑也能用」「单文件即可携带图片」等。
 */
import { durabilityOfStore, portabilityOfStore, type AssetStore } from './assetHost.js';

/** 一个落点的全部呈现文本 */
export interface AssetStoreCopy {
  /** 落点徽章（卡片角标） */
  badge: string;
  /** 可携带性徽章 */
  portabilityBadge: string;
  /** 悬停/详情说明 */
  detail: string;
}

/** 落点徽章（`asset-library.md` §2.3 第三列表原文） */
export const ASSET_STORE_BADGE: Record<AssetStore | 'session', string> = {
  'workspace-assets': '📁 本工作区',
  'browser-idb': '💾 浏览器',
  builtin: '🎨 内置',
  session: '⚠ 仅本次会话',
};

/** 可携带性徽章（§2.3 第三列） */
export const ASSET_PORTABILITY_COPY: Record<'folder-relative' | 'browser-local' | 'self-contained', string> = {
  'folder-relative': '📦 随文件夹',
  'browser-local': '🔒 仅此浏览器',
  'self-contained': '✈ 自包含',
};

/**
 * 落点 + 可携带性 → 详情文案。
 *
 * `workspaceName` 由调用方给出（应用层知道当前工作区名；包层不知道）。
 * 未知时回落「工作区」，**不得**编造名字。
 */
export function formatAssetStoreDetail(
  store: AssetStore | null,
  workspaceName?: string,
): string {
  const ws = workspaceName !== undefined && workspaceName !== '' ? workspaceName : '工作区';
  if (store === 'workspace-assets') {
    return `保存在 ${ws}/assets/ 里。把整个文件夹拷走仍可用；只拷文档不带文件夹会显示为缺失。`;
  }
  if (store === 'browser-idb') {
    return '保存在此浏览器的本地素材库。换浏览器、清站点数据、或浏览器在存储压力下清理时都会丢失，文档里的引用会显示为失效。';
  }
  if (store === 'builtin') return '应用自带的矢量图标，任何环境都可用。';
  return '未能写入持久存储。现在能用，刷新后消失。';
}

/** 落点 + 可携带性徽章对（会话级无 `store`，单独一行） */
export function badgesFor(store: AssetStore | null): { badge: string; portability: string } {
  if (store === null) {
    return { badge: ASSET_STORE_BADGE.session, portability: '—' };
  }
  return {
    badge: ASSET_STORE_BADGE[store],
    portability: ASSET_PORTABILITY_COPY[portabilityOfStore(store)],
  };
}

/**
 * 上传结果 → 用户可见提示（`asset-library.md` §4.3 的三种状态）。
 *
 * 纪律（§4.3「关键纪律」）：
 *  - 只有 `written` 才允许出现「已保存」，且它**只说明这次写入成功**，不说明可携带；
 *  - `browser-idb` 的成功提示**必须同时**给出失效条件；
 *  - `session-only` 必须显式说「没有写入持久存储」；
 *  - 任何一条都不得把「写入成功」读成「可携带」。
 */
export function formatAssetWriteNotice(store: AssetStore | null, workspaceName?: string): string {
  const ws = workspaceName !== undefined && workspaceName !== '' ? workspaceName : '工作区';
  if (store === 'workspace-assets') {
    return `已保存到 ${ws}/assets/。把整个文件夹拷走仍可用（只拷文档不带文件夹会显示为缺失）。`;
  }
  if (store === 'browser-idb') {
    return '已保存到浏览器素材库（这台机器、这个浏览器）。换浏览器、清理浏览器数据、或浏览器在存储压力下清理时都会丢失；文档里指向它的引用会显示为缺失。跨机器使用时请把它保存到工作区。';
  }
  if (store === 'builtin') return '已作为文本写入文档，单文件拷走也能显示。';
  return '图片已可用，但没有写入持久存储。刷新后这条记录会消失；文档里会显示为缺失。';
}

/** 本地持久性 → 一句如实陈述（与可携带性分开，见 §1.7） */
export function formatDurability(store: AssetStore | null, workspaceName?: string): string {
  const ws = workspaceName !== undefined && workspaceName !== '' ? workspaceName : '工作区';
  const d = durabilityOfStore(store);
  if (d === 'filesystem') return `存在磁盘上（${ws}/assets/）。本机持久。`;
  if (d === 'browser-storage') return '存在这台机器的浏览器里。清站点数据会失。';
  return '只在本次会话可用，刷新后消失。';
}

/**
 * **禁止的表述**守卫（§1.7 允许/禁止文案表的机械可查版）。
 *
 * 存在的理由：文案散落在徽章、悬停、提示条三处，「不出现某句话」不能靠人眼复核。
 * 任何新增文案都应先过这里；`asset-panel.test.tsx` 会对全部导出文案做一次扫描。
 */
const FORBIDDEN_PATTERNS = [
  /换电脑也能用/,
  /换机器(也|还)?在/,
  /到哪都能用/,
  /单文件(即可)?携带/,
  /单文件.{0,6}可携带/,
  /已保存[，,]\s*可携带/,
] as const;

export function isForbiddenAssetCopy(text: string): boolean {
  return FORBIDDEN_PATTERNS.some((re) => re.test(text));
}
