/**
 * 资产写入记账（P0-B ①，契约 §4.5.4 + 不变量 I-22）。
 *
 * **要解决的问题**：上传的磁盘写入是**已经发生**的事实，但结果返回时作用域可能已经切换。
 * 旧实现只有组件级 `alive` 标志（`MindmapStage.tsx:908-916`），切换后一律丢弃 ——
 * 于是「切回原工作区时看到一份自己不知道哪来的文件」，或者「以为上传失败而重复上传」。
 *
 * **I-22**：`epoch` 变化只允许丢弃 **UI 回填**；写入一旦发生就已经在磁盘/IDB 上留下文件，
 * 必须**记账**（`unconfirmed: true`，属于**捕获时**的 `scopeId`），
 * 下次该作用域挂载时由 `listAssets` 重新发现并**清除标记**。
 *
 * 本模块只管这笔账（纯数据结构 + 纯函数），不碰 I/O：
 * 「重新发现」的动作由调用方在 `listAssets` 之后调 `confirmDiscovered`。
 */
import type { AssetStore, AssetScopeMark } from './assetHost.js';

/**
 * 写入记账条目（契约 §4.5.4，勘误 E-1 后名为 `AssetWriteEntry`）。
 *
 * 注意与**索引层**的 `AssetIndexEntry`（§4.7）区分：本形状是写入侧的一次事实记录，
 * 含 `store`/`portability`/`bytes`/`lastSeenAt`；索引层那条是持久化的资产条目。
 */
export interface AssetWriteEntry {
  assetKey: string;
  scopeId: string;
  kind: 'img' | 'draw';
  name: string;
  relPath: string | null;
  store: AssetStore;
  bytes: number | null;
  lastSeenAt: number;
  /** 写入完成但未在当前作用域确认（epoch 已变）；下次该作用域挂载时由 listAssets 清除 */
  unconfirmed?: true;
}

/** 可持久化的账本形状（`localStorage`；与 P0-D 的索引层分开，避免抢索引写入口） */
export interface AssetLedgerData {
  entries: AssetWriteEntry[];
}

const STORE_KEY = 'mindcanvas.assetwrite.v1';

/** 读取结果四态（与 P0-0 注册表读取同规：**空**与**损坏/不可用**必须分开） */
export type LedgerReadResult =
  | { kind: 'ok'; data: AssetLedgerData }
  | { kind: 'empty' }
  | { kind: 'unavailable' };

/**
 * 资产写入账本。
 *
 * 内存态是**唯一事实源**（写入即时可见）；`persist()` 是尽力而为的镜像
 * （配额/隐私模式下失败不影响主流程 —— 与既有 `saveFavs` 同规）。
 */
export class AssetWriteLedger {
  private entries: AssetWriteEntry[] = [];
  private store: { getItem(k: string): string | null; setItem(k: string, v: string): void } | null;

  constructor(store: AssetWriteLedger['store'] = defaultStore()) {
    this.store = store;
    this.entries = readEntries(store);
  }

  /** 全部条目（副本；调用方不得就地改） */
  all(): AssetWriteEntry[] {
    return this.entries.map((e) => ({ ...e }));
  }

  /** 某作用域下**未确认**的条目（UI 不展示它们，但诊断与记账要看得见） */
  unconfirmedOf(scopeId: string): AssetWriteEntry[] {
    return this.entries.filter((e) => e.scopeId === scopeId && e.unconfirmed === true);
  }

  /** 某作用域的全部条目 */
  entriesOf(scopeId: string): AssetWriteEntry[] {
    return this.entries.filter((e) => e.scopeId === scopeId);
  }

  /**
   * 记一笔写入。`mark` 必须是**捕获时**的作用域（调用方在写盘前捕获）。
   *
   * `confirmed` 由调用方判断：写入返回后调 `isCurrent(mark)` ——
   * 仍当前 → 已确认；已切换 → 标 `unconfirmed`（**仍然记账**，I-22）。
   */
  record(
    entry: Omit<AssetWriteEntry, 'lastSeenAt' | 'unconfirmed'> & { lastSeenAt?: number },
    confirmed: boolean,
  ): AssetWriteEntry {
    const next: AssetWriteEntry = {
      ...entry,
      lastSeenAt: entry.lastSeenAt ?? Date.now(),
    };
    if (!confirmed) next.unconfirmed = true;
    // 同一 `(scopeId, assetKey)` 只留一条：重复上传同一路径是「更新」而非新增
    this.entries = [
      ...this.entries.filter((e) => !(e.scopeId === next.scopeId && e.assetKey === next.assetKey)),
      next,
    ];
    this.persist();
    return { ...next };
  }

  /**
   * 该作用域挂载后**重新发现**：清除这些 `assetKey` 的 `unconfirmed` 标记。
   *
   * 语义与契约 §4.5.4 规则 3 一致：`listAssets` 重新看到文件 → 确认它确实属于本作用域。
   * 未在 `discovered` 里的条目**保持未确认**（不得整批清空 —— 那等于假设「没看到就是还在」）。
   */
  confirmDiscovered(scopeId: string, discovered: readonly string[]): number {
    const seen = new Set(discovered);
    let cleared = 0;
    this.entries = this.entries.map((e) => {
      if (e.scopeId !== scopeId || e.unconfirmed !== true) return e;
      if (!seen.has(e.assetKey)) return e;
      cleared += 1;
      const rest: AssetWriteEntry = { ...e };
      delete rest.unconfirmed;
      return rest;
    });
    if (cleared > 0) this.persist();
    return cleared;
  }

  /** 开发诊断线（不打扰用户；契约 §4.5.4 规则 2 要求「写一条开发诊断」） */
  diagnosticLines(scopeId: string): string[] {
    return this.unconfirmedOf(scopeId).map(
      (e) => `资产 ${e.assetKey} 已写入但未在当前作用域确认（scope=${e.scopeId}）`,
    );
  }

  private persist(): void {
    if (this.store === null) return;
    try {
      this.store.setItem(STORE_KEY, JSON.stringify({ entries: this.entries }));
    } catch {
      // 配额/隐私模式：账本是增强，失败不影响主流程（与 saveFavs 同规）
    }
  }
}

/**
 * 从「已切换 / 未切换」推出 `confirmed`（I-22 的判据）。
 *
 * 刻意独立成纯函数：这条判据是负控「专项二」要中性化的那块守卫，
 * 放成函数就只有一个地方可以改，负控才能精确命中。
 */
export function isWriteConfirmed(captured: AssetScopeMark, current: AssetScopeMark): boolean {
  return captured.scopeKey === current.scopeKey && captured.epoch === current.epoch;
}

/** 默认存储（无 localStorage → null，账本退化为内存态；不抛） */
function defaultStore(): AssetWriteLedger['store'] {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

function readEntries(store: AssetWriteLedger['store']): AssetWriteEntry[] {
  if (store === null) return [];
  try {
    const raw = store.getItem(STORE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return [];
    const entries: unknown = Reflect.get(parsed, 'entries');
    if (!Array.isArray(entries)) return [];
    return entries.filter(isWriteEntry);
  } catch {
    return [];
  }
}

/** 条目窄化（容忍未知字段 / 拒绝缺字段；与 P0-D 的 `normalizeAssetEntry` 同规） */
function isWriteEntry(v: unknown): v is AssetWriteEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e: Record<string, unknown> = { ...v };
  return (
    typeof e.assetKey === 'string' &&
    typeof e.scopeId === 'string' &&
    (e.kind === 'img' || e.kind === 'draw') &&
    typeof e.name === 'string' &&
    (e.relPath === null || typeof e.relPath === 'string') &&
    typeof e.store === 'string' &&
    typeof e.lastSeenAt === 'number'
  );
}

/** 读取账本（供需要「空 vs 不可用」区分的调用方；`AssetWriteLedger` 内部已容错） */
export function readAssetLedger(store: AssetWriteLedger['store'] = defaultStore()): LedgerReadResult {
  if (store === null) return { kind: 'unavailable' };
  let raw: string | null;
  try {
    raw = store.getItem(STORE_KEY);
  } catch {
    return { kind: 'unavailable' };
  }
  if (raw === null) return { kind: 'empty' };
  const entries = readEntries(store);
  return { kind: 'ok', data: { entries } };
}
