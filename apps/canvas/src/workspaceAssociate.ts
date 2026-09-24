/**
 * 人工关联工作区的**纯逻辑**（P1-A rider-B · shared-contracts §1.2.8）。
 * ══════════════════════════════════════════════════════════════════════
 * 要解决的问题（契约原文）：`isSameEntry` 缺失或比较失败时，本次会话只能是
 * `disk-session('unassociated')` —— 目录可用但**身份不持久**，每次重选文件夹。
 * 最终目标是**人工关联**：用户显式确认后复用某个 `scopeId`，`via: 'user-confirmed'`，
 * 此后该目录获得稳定身份。
 *
 * 本模块只做两件**纯**的事（可单测、零 I/O）：
 *  ① 把 `readWorkspaceRegistry()` 的四态读数翻译成**用户能看懂的候选清单**；
 *  ② 校验一次关联请求是否合法（`scopeId` 在当前读数里存在、变更会不会破坏
 *     注册表不变量）—— 合法性判据必须与 `isRegistryRecord` **同一套**，
 *     否则人工写入会绕过契约校验（正是 `scopeId` 判定链不得改动的边界，§3.7）。
 *
 * **不改 scopeIdentity 判定链**（派单书 §3.7）：本模块不参与 `applyIdentity`
 * 的 `reuse/register/degrade/refuse` 判定，只在**用户显式动作**之后写回。
 *
 * 写回本身走 `writeWorkspaceRegistry` 的**单事务 RMW**（`handleStore.ts`）：
 * 本模块给出 `mutate` 函数，事务与并发保护由既有实现承担（不新写第二套写入）。
 */

/** 注册表条目的**呈现面**（不暴露句柄：它是不可序列化的内部对象，见 UD-5 索引不外露） */
export interface AssociationCandidate {
  scopeId: string;
  label: string;
  lastSeenAt: number;
  state: 'active' | 'dormant';
  associations: ReadonlyArray<{ at: number; via: string }>;
}

/** 读数 → 候选清单的结果（四态各自有用户语言，不折叠成「空」） */
export type AssociationReadout =
  | { kind: 'ok'; candidates: AssociationCandidate[] }
  | { kind: 'empty' }
  | { kind: 'corrupt' }
  | { kind: 'unavailable' };

/**
 * 读数 → 候选清单。
 *
 * `corrupt` / `unavailable` **不得**折叠成 `empty`（契约 R2 的既有四态纪律）：
 * 「注册表损坏」与「还没连过任何目录」给用户的下一步动作完全不同
 * （前者不能自动修复、不能覆盖；后者是「先打开一个文件夹」）。
 */
export function readoutOf(
  read:
    | { kind: 'ok'; record: { entries: ReadonlyArray<RegistryEntryShape> } }
    | { kind: 'empty' }
    | { kind: 'corrupt' }
    | { kind: 'unavailable' },
): AssociationReadout {
  if (read.kind !== 'ok') return { kind: read.kind };
  return {
    kind: 'ok',
    candidates: read.record.entries.map((e) => ({
      scopeId: e.scopeId,
      label: e.label,
      lastSeenAt: e.lastSeenAt,
      state: e.state,
      associations: e.associations,
    })),
  };
}

/** 注册表条目的最小形状（结构化类型；`WorkspaceRegistryEntry` 天然满足） */
export interface RegistryEntryShape {
  scopeId: string;
  label: string;
  lastSeenAt: number;
  state: 'active' | 'dormant';
  associations: ReadonlyArray<{ at: number; via: string }>;
}

/** 关联请求被拒的理由 */
export type AssociationRefusal =
  | 'not-found' // 该 scopeId 不在当前读数里（可能是另一标签页刚改过）
  | 'already-confirmed' // 已经有一条 user-confirmed 证据 → 重复点击，零副作用
  | 'record-not-ok'; // 读数不是 `ok`：不写任何键（corrupt 不得覆盖、unavailable 不得臆测）

/** 关联前的校验（纯函数；返回 null = 可以写回） */
export function associationRefusalOf(input: {
  readout: AssociationReadout;
  scopeId: string;
}): AssociationRefusal | null {
  if (input.readout.kind !== 'ok') return 'record-not-ok';
  const hit = input.readout.candidates.find((c) => c.scopeId === input.scopeId);
  if (hit === undefined) return 'not-found';
  // 同一目录已有 user-confirmed 证据 → 幂等（不重复追加证据行）
  if (hit.associations.some((a) => a.via === 'user-confirmed')) return 'already-confirmed';
  return null;
}

/**
 * 写回时追加的**证据行**（`via: 'user-confirmed'`，契约 §1.2.8 的唯一合法值）。
 *
 * 为什么不复用 `upsertEntry`：那是**登记新身份**的路径（把旧条目全转 dormant、
 * 换 active）。人工关联改的是**既有条目**：目录句柄没变、身份没变，
 * 只在它的 `associations` 上追加一行证据，并把它置为 active
 * （用户明确说了「当前这个目录就是它」）。
 * 复用 `upsertEntry` 会生成新 `scopeId` —— 那就不是「关联」而是「重新登记」了。
 */
export function applyUserConfirmed<
  V extends number,
  E extends RegistryEntryShape & { handle: unknown },
>(
  record: { v: V; activeScopeId: string | null; entries: ReadonlyArray<E> },
  scopeId: string,
  now: number,
): { v: V; activeScopeId: string; entries: E[] } {
  // 只改三条既有字段（state / lastSeenAt / associations），其余字段（含句柄）
  // 原样保留 —— 句柄类型因此随 `E` 泛型走，写回时仍满足 `WorkspaceRegistryEntry`。
  const entries: E[] = record.entries.map((e) =>
    e.scopeId === scopeId
      ? {
          ...e,
          state: 'active' as const,
          lastSeenAt: now,
          associations: [...e.associations, { at: now, via: 'user-confirmed' as const }],
        }
      : { ...e, state: 'dormant' as const },
  );
  return { v: record.v, activeScopeId: scopeId, entries };
}

// ─────────────────────────────────────────────────────────── 用户可见文案

/**
 * 关联面板的用户语言（唯一事实源）。
 *
 * 纪律（UD-5：索引层不向用户暴露）：文案里不得出现 `scopeId` 字面量、
 * 「索引」「作用域」等内部概念 —— 用户看到的是「文件夹」。
 */
export const ASSOCIATION_COPY = {
  title: '关联到已有工作区记录',
  intro: '如果这个文件夹以前用过，可以从下面选一条记录关联，之后就不必每次重新选择。',
  empty: '还没有任何工作区记录。先打开一个文件夹开始使用即可。',
  corrupt: '工作区记录已损坏，这次无法读取；为避免覆盖，应用不会改写它。',
  unavailable: '读取工作区记录失败（浏览器存储不可用）。',
  confirmed: '已关联；这个文件夹的身份已记录，下次会自动恢复。',
  'already-confirmed': '这个文件夹已经关联过了。',
  'not-found': '这条记录已不存在（可能被其他标签页改动），请重新打开面板。',
  'record-not-ok': '当前无法读取工作区记录，未做任何改动。',
  cancel: '取消',
  confirm: '关联这条记录',
} as const;

/** 关联结果的用户文案（拒绝 → 对应句；成功 → `confirmed`） */
export function associationNoticeOf(refusal: AssociationRefusal): string {
  return ASSOCIATION_COPY[refusal];
}
