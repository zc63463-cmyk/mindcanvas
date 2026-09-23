/**
 * 索引层的支撑纯函数（从 `docIndex.ts` 抽出）。
 *
 * 为什么单独一层：`docIndex.ts` 已逼近代码预算的 `bigFiles` 红线（600 行）。
 * 这三个函数与索引状态无关（默认存储、`ephemeral` 剥离、血统 id 生成），
 * 且都是纯的 —— 抽出后主文件只留状态机与写路径。
 */
import type { DocIndexEntry, IndexStore } from './docIndexCore.js';

/** 默认存储 = localStorage（不可用时会自然抛错，由调用方的 try 收口） */
export function defaultIndexStore(): IndexStore {
  return {
    get: (key) => localStorage.getItem(key),
    set: (key, value) => localStorage.setItem(key, value),
  };
}

/** 剥掉 `ephemeral` 标记（作用域持久时用；`ephemeral` 只对 disk-session 有意义） */
export function stripEphemeral(e: DocIndexEntry): DocIndexEntry {
  if (e.ephemeral !== true) return e;
  const { ephemeral: _drop, ...rest } = e;
  return rest;
}

/**
 * 生成血统 id。优先 `crypto.randomUUID`，缺失或抛错时回退到时间戳 + 随机串
 * （jsdom 等环境不得成为硬依赖）。
 */
export function defaultLineageId(): string {
  const c = globalThis.crypto;
  try {
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // 源抛错同样走回退
  }
  return `lin-${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/** `relocateDoc` 的入参（保持与 `DocIndex.registerDoc` 一致的形状） */
export interface RelocateInput {
  /** 旧身份（改名/移动**前**的 `docKey`） */
  fromDocKey: string;
  /** 新身份（新路径拼出的 `docKey`） */
  docKey: string;
  relPath: string | null;
  name: string;
  scopeId: string;
  persisted: boolean;
  sourceRef: DocIndexEntry['sourceRef'];
}

export interface RelocateResult {
  /** 旧条目是否存在（false → 调用方应退化为首次登记） */
  moved: boolean;
  /** 搬迁后的完整条目数组（仅 `moved` 为真时有意义） */
  docs: DocIndexEntry[];
}

/**
 * 改名/移动时把条目的**身份**搬到新键（纯函数）。
 *
 * 为什么需要（F5）：`docKey` 是 `ws:<scopeId>::<relPath>`，路径一变键就变。
 * 若只按新键 `registerDoc`，新路径会被当成**从没见过的文档**建条目 ——
 * 收藏（记在旧 `docKey` 上）就此失联、「最近」断成两条历史。
 * `lineageId` 不参与键计算，所以必须**显式搬运**：
 *   - `starred` / `lineageId` / 时间戳从旧条目继承；
 *   - 旧 `docKey` 与旧 `relPath` 追加进 `legacyKeys` —— 降级投影据此把旧键认领给新身份。
 *     这是**本应用自己完成的重绑**，不是凭同名猜测（§6.2.1 的证据规则不变）；
 *   - 旧条目在同一次写里移除，不留孤儿；
 *   - 新键已存在时保留既有条目的收藏位（不覆盖用户的选择）。
 */
export function relocateEntries(
  docs: readonly DocIndexEntry[],
  input: RelocateInput,
  opts: { makeLineageId: () => string; now: () => number },
): RelocateResult {
  const previous = docs.find((e) => e.docKey === input.fromDocKey);
  if (previous === undefined) return { moved: false, docs: [...docs] };
  const existingTarget = docs.find((e) => e.docKey === input.docKey);
  const legacyKeys = appendUnique(
    appendUnique(previous.legacyKeys, input.fromDocKey),
    previous.relPath ?? input.fromDocKey,
  );
  const carried: DocIndexEntry = {
    ...previous,
    docKey: input.docKey,
    scopeId: input.scopeId,
    relPath: input.relPath,
    name: input.name,
    sourceRef: input.sourceRef,
    legacyKeys,
    starred: existingTarget?.starred === true ? true : previous.starred,
  };
  // `lineageId` 由旧条目带入（上面 `...previous` 已含）；`now`/`makeLineageId` 仅用于
  // 「旧条目没有血统」的兼容场景（早期数据可能缺该字段）。
  if (carried.lineageId === undefined || carried.lineageId === '') {
    carried.lineageId = opts.makeLineageId();
  }
  void opts.now;
  const normalized = input.persisted ? stripEphemeral(carried) : { ...carried, ephemeral: true as const };
  return {
    moved: true,
    docs: [
      ...docs.filter((e) => e.docKey !== input.fromDocKey && e.docKey !== input.docKey),
      normalized,
    ],
  };
}

/** 去重追加（保持插入顺序） */
function appendUnique(list: readonly string[], value: string): string[] {
  return list.includes(value) ? [...list] : [...list, value];
}

// ============================================================ F3 未消解 partial 源键（DS-10 §3）

/**
 * 索引层的**读写存储端口**（生产 = localStorage；测试可注入故障）。
 * 与 `docIndexCore.IndexStore` 同形——这里独立声明是为了让本模块
 * （以及消费它的投影）不必反向依赖 core 的类型面。
 */
export interface PartialResolutionStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

/**
 * 未消解的 partial 源键存放的键。
 *
 * 与 `DOC_INDEX_KEY` 同为**索引键**（不是旧库键）——故投影**不**重写它、
 * N-1 回读校验也不必为它加单独口径；它是「编排层已知事实」的持久化，
 * 而不是降级视图的一部分。
 */
export const PARTIAL_SOURCES_KEY = 'mindcanvas.docindex.partial-sources';

/** 读出全部未消解的 partial 源键（读不出/损坏 → 空，不猜） */
export function unresolvedPartialSources(storage: PartialResolutionStore): string[] {
  try {
    const raw = storage.get(PARTIAL_SOURCES_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** 登记一个未消解的 partial 源键（幂等；形态 = 旧库行的 `id`，即 `relPath`） */
export function notePartialSource(storage: PartialResolutionStore, key: string): void {
  const cur = unresolvedPartialSources(storage);
  if (cur.includes(key)) return;
  try {
    storage.set(PARTIAL_SOURCES_KEY, JSON.stringify([...cur, key]));
  } catch {
    // 写失败 → 退化为「未登记」。方向如实记：不登记则投影不为它保留代表，
    // 但也不误删磁盘数据（(b') 只回收旧库行，不动磁盘）。
  }
}

/** 消解一个 partial 源键（消费者处理完那一对文件后调用） */
export function clearPartialSource(storage: PartialResolutionStore, key: string): void {
  const cur = unresolvedPartialSources(storage);
  if (!cur.includes(key)) return;
  try {
    storage.set(
      PARTIAL_SOURCES_KEY,
      JSON.stringify(cur.filter((k) => k !== key)),
    );
  } catch {
    // 同上：写失败则保持「未消解」，偏向保留代表。
  }
}
