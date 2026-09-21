/**
 * 实体候选宿主（N1：跨文档复用）。
 * M1 的 picker 候选 = 当前文档 entities（内存态，刷新即失、跨文档不复用）——
 * 本 store 把「用过的实体引用」落到 localStorage，打开/保存文档时登记，
 * 于是同一 issue 在多张导图里可被反复选到（真实使用的硬需求）。
 * 纯本地实现；宿主可换（Forgejo / 远端实体源）实现同一接口。
 */
export interface EntityRecord {
  kind: string;
  id: string;
  title: string;
  /** 最近使用时间（LRU 裁剪依据） */
  usedAt: number;
  /** 引用过它的文档名（去重） */
  docs: string[];
}

/** 实体宿主契约（可换实现：Forgejo / 远端实体源） */
export interface EntityHost {
  list(): EntityRecord[];
  remember(refs: readonly { kind: string; id: string; title?: string | null }[], doc: string): void;
  remove(kind: string, id: string): void;
  search(q: string): EntityRecord[];
}

const KEY = 'mindcanvas.entities.v1';
/** 上限（LRU 裁剪；localStorage 满/禁用静默） */
export const ENTITY_STORE_MAX = 200;

/** kind:id 键 */
export function entityKeyOf(kind: string, id: string): string {
  return `${kind}:${id}`;
}

/**
 * 合并登记（两实现共用）：同 ref 更新 usedAt/docs/标题（真标题优先），新 ref 插入；
 * 严格递增时钟（Date.now() 同毫秒多次登记排序不稳定 → max(now, maxUsed+1)）。
 */
function mergeInto(
  existing: EntityRecord[],
  refs: readonly { kind: string; id: string; title?: string | null }[],
  doc: string,
): EntityRecord[] {
  const byKey = new Map<string, EntityRecord>();
  for (const r of existing) byKey.set(entityKeyOf(r.kind, r.id), r);
  let maxUsed = 0;
  for (const r of byKey.values()) if (r.usedAt > maxUsed) maxUsed = r.usedAt;
  let clock = Math.max(Date.now(), maxUsed + 1);
  for (const r of refs) {
    const key = entityKeyOf(r.kind, r.id);
    const prev = byKey.get(key);
    const incoming = r.title && r.title !== r.id ? r.title : null;
    const usedAt = clock++;
    if (prev) {
      byKey.set(key, {
        ...prev,
        title: incoming ?? prev.title,
        usedAt,
        docs: prev.docs.includes(doc) ? prev.docs : [...prev.docs, doc],
      });
    } else {
      byKey.set(key, { kind: r.kind, id: r.id, title: incoming ?? r.id, usedAt, docs: [doc] });
    }
  }
  return [...byKey.values()].sort((a, b) => b.usedAt - a.usedAt);
}

/** 本地实体宿主：localStorage + LRU */
export class LocalEntityStore implements EntityHost {
  list(): EntityRecord[] {
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? (JSON.parse(raw) as EntityRecord[]) : [];
      return [...arr].sort((a, b) => b.usedAt - a.usedAt);
    } catch {
      return [];
    }
  }

  remember(
    refs: readonly { kind: string; id: string; title?: string | null }[],
    doc: string,
  ): void {
    if (refs.length === 0) return;
    this.#save(mergeInto(this.list(), refs, doc).slice(0, ENTITY_STORE_MAX));
  }

  remove(kind: string, id: string): void {
    const key = entityKeyOf(kind, id);
    this.#save(this.list().filter((r) => entityKeyOf(r.kind, r.id) !== key));
  }

  search(q: string): EntityRecord[] {
    const s = q.trim().toLowerCase();
    if (s === '') return this.list();
    return this.list().filter(
      (r) =>
        r.kind.toLowerCase().includes(s) ||
        r.id.toLowerCase().includes(s) ||
        r.title.toLowerCase().includes(s),
    );
  }

  #save(list: EntityRecord[]): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      // 存储满/禁用 → 静默（不影响主流程）
    }
  }
}

/**
 * HTTP 实体宿主（R3：B 线接缝）—— 同步缓存 + 异步刷新。
 * list() 是同步接口（缓存语义），HTTP 异步 → refresh() 拉取入缓存；
 * remember/remove 本地立即生效（乐观）+ 远端 fire-and-forget（失败静默，下次对账重建）。
 * B 线 sidecar 上线后：换 baseUrl 即接入，画布侧零改动（GET/POST/DELETE /entities）。
 */
export class HttpEntityHost implements EntityHost {
  private cache: EntityRecord[] = [];

  constructor(
    private baseUrl: string,
    private doc: string = '',
    private fetchImpl: typeof fetch = fetch,
  ) {}

  list(): EntityRecord[] {
    return [...this.cache];
  }

  /** 从远端拉取实体清单入缓存（调用方负责时机，如打开文档后） */
  async refresh(): Promise<void> {
    const res = await this.fetchImpl(`${this.baseUrl}/entities`);
    if (!res.ok) throw new Error(`entity fetch failed: ${res.status}`);
    this.cache = (await res.json()) as EntityRecord[];
  }

  remember(
    refs: readonly { kind: string; id: string; title?: string | null }[],
    doc: string,
  ): void {
    if (refs.length === 0) return;
    this.cache = mergeInto(this.cache, refs, doc);
    void this.fetchImpl(`${this.baseUrl}/entities`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refs, doc }),
    }).catch(() => undefined);
  }

  remove(kind: string, id: string): void {
    const key = entityKeyOf(kind, id);
    this.cache = this.cache.filter((r) => entityKeyOf(r.kind, r.id) !== key);
    void this.fetchImpl(`${this.baseUrl}/entities/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  }

  search(q: string): EntityRecord[] {
    const s = q.trim().toLowerCase();
    if (s === '') return this.list();
    return this.cache.filter(
      (r) =>
        r.kind.toLowerCase().includes(s) ||
        r.id.toLowerCase().includes(s) ||
        r.title.toLowerCase().includes(s),
    );
  }
}
