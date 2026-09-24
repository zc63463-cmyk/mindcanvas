/**
 * 人工关联面板（P1-A rider-B · shared-contracts §1.2.8 / §168）。
 *
 * 入口挂在 `StorageBar` 的既有作用域区（「🟢 工作区已连接 · 📁 <名>」旁）——
 * 那是用户表达「这是哪个工作区」的地方，关联动作属于同一话题。
 *
 * 交互（三态，全部内联，零原生对话框 —— `no-native-dialogs.test.ts`）：
 *  ① 关闭：只显示入口按钮；
 *  ② 列表：列出 `readWorkspaceRegistry` 的条目（用户语言，不暴露 scopeId），
 *     每条一个「关联这条记录」按钮 + 取消；
 *  ③ 结果：成功/拒绝都落到 `onNotice`（`role="status"`），面板自身不留悬挂态。
 *
 * 读数四态各自有独立文案（`corrupt` / `unavailable` **不得**折叠成「空」）：
 * 「记录损坏」与「还没连过」给用户的下一步完全不同。
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { CHROME } from '@mindcanvas/react';
import type {
  RegistryMutate,
  RegistryReadResult,
  RegistryWriteResult,
} from '@mindcanvas/react';
import { btnBase, inlineBarStyle, rowBtn } from './fileManagerShared.js';
import {
  ASSOCIATION_COPY,
  associationRefusalOf,
  applyUserConfirmed,
  readoutOf,
  type AssociationCandidate,
  type AssociationReadout,
} from './workspaceAssociate.js';

/**
 * 面板需要的宿主面。
 *
 * 直接采用 `@mindcanvas/react` 的**既有**类型（`RegistryReadResult` /
 * `RegistryMutate` / `RegistryWriteResult`），不在这里再声明一套结构化类型 ——
 * 两套形状一旦漂开，`write` 侧就会绕过 `isRegistryRecord` 的契约校验
 * （§3.7 的边界：scopeIdentity 判定链零改动，写入必须经既有单事务实现）。
 */
export interface AssociationPort {
  /** 读注册表（四态；**永不抛**） */
  read: () => Promise<RegistryReadResult>;
  /** 单事务 RMW 写回（`handleStore.writeWorkspaceRegistry` 的既有实现） */
  write: (mutate: RegistryMutate) => Promise<RegistryWriteResult>;
}

export function AssociateWorkspacePanel({
  read,
  write,
  onNotice,
}: {
  read: AssociationPort['read'];
  write: AssociationPort['write'];
  onNotice: (msg: string) => void;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const [readout, setReadout] = useState<AssociationReadout | null>(null);

  /** 每次打开都**重新读**：注册表可能已被其他标签页改动（不能拿旧读数写回） */
  const refresh = useCallback(async (): Promise<void> => {
    const raw = await read();
    setReadout(readoutOf(raw));
  }, [read]);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // 名字避开 `confirm`（与原生对话框词形同形，会被 no-native-dialogs 守卫命中）
  const linkScope = useCallback(
    async (scopeId: string): Promise<void> => {
      const refusal = readout === null ? 'record-not-ok' : associationRefusalOf({ readout, scopeId });
      if (refusal !== null) {
        onNotice(ASSOCIATION_COPY[refusal]);
        if (refusal !== 'already-confirmed') await refresh();
        return;
      }
      const now = Date.now();
      /*
       * 写回走**单事务 RMW**（`writeWorkspaceRegistry`）：`mutate` 在事务内基于
       * 事务内读数计算，**不得**在其中 await 任何非 IDB 的 Promise（I-25）。
       * 读数不是 `ok` → 返回 `'unchanged'`（零写入）：corrupt 不得覆盖、
       * unavailable 不得臆测 —— 与契约 §1.2.4 的四态纪律一致。
       */
      const out = await write((prev) => {
        if (prev.kind !== 'ok') return 'unchanged';
        return applyUserConfirmed(prev.record, scopeId, now);
      });
      if (out.kind === 'ok') {
        onNotice(ASSOCIATION_COPY.confirmed);
        setOpen(false);
        return;
      }
      onNotice(ASSOCIATION_COPY['record-not-ok']);
      await refresh();
    },
    [readout, write, onNotice, refresh],
  );

  if (!open) {
    return (
      <button
        type="button"
        data-assoc-open
        style={btnBase}
        onClick={() => setOpen(true)}
        title={ASSOCIATION_COPY.intro}
      >
        关联…
      </button>
    );
  }

  return (
    <div
      data-assoc-panel
      style={{
        ...inlineBarStyle,
        display: 'block',
        border: `1px solid ${CHROME.panelBorderStrong}`,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{ASSOCIATION_COPY.title}</div>
      <div style={{ color: CHROME.textMuted, marginBottom: 6 }}>{ASSOCIATION_COPY.intro}</div>
      {readout === null ? (
        <div style={{ color: CHROME.textMuted }}>读取中…</div>
      ) : readout.kind === 'empty' ? (
        <div data-assoc-empty style={{ color: CHROME.textMuted }}>
          {ASSOCIATION_COPY.empty}
        </div>
      ) : readout.kind === 'corrupt' ? (
        <div data-assoc-corrupt style={{ color: CHROME.warn }}>
          {ASSOCIATION_COPY.corrupt}
        </div>
      ) : readout.kind === 'unavailable' ? (
        <div data-assoc-unavailable style={{ color: CHROME.warn }}>
          {ASSOCIATION_COPY.unavailable}
        </div>
      ) : (
        <div data-assoc-list>
          {readout.candidates.map((c) => (
            <AssocRow key={c.scopeId} candidate={c} onConfirm={() => void linkScope(c.scopeId)} />
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <button type="button" data-assoc-cancel style={btnBase} onClick={() => setOpen(false)}>
          {ASSOCIATION_COPY.cancel}
        </button>
      </div>
    </div>
  );
}

/** 一行候选：只显示**用户语言**（文件夹名 + 上次使用时间 + 是否当前），不暴露 scopeId */
function AssocRow({
  candidate,
  onConfirm,
}: {
  candidate: AssociationCandidate;
  onConfirm: () => void;
}): ReactElement {
  return (
    <div
      data-assoc-row
      data-assoc-scope={candidate.scopeId}
      data-assoc-state={candidate.state}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}
    >
      <span style={{ ...rowBtn, flex: 1, cursor: 'default' }}>
        <span>📁 {candidate.label}</span>
        {candidate.state === 'active' && (
          <span style={{ color: CHROME.neon }}>（当前使用中）</span>
        )}
      </span>
      <span style={{ opacity: 0.75, flex: 'none' }}>
        {candidate.lastSeenAt > 0
          ? new Date(candidate.lastSeenAt).toLocaleDateString('zh-CN')
          : '未记录时间'}
      </span>
      <button type="button" data-assoc-confirm style={btnBase} onClick={onConfirm}>
        {ASSOCIATION_COPY.confirm}
      </button>
    </div>
  );
}
