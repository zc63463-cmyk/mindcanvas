// @vitest-environment jsdom
/**
 * P1-A rider-B：**人工关联面板**（`shared-contracts` §1.2.8 / §168）。
 * ══════════════════════════════════════════════════════════════════════
 * 要证明的四件事：
 *  ① 读数**四态分开**：`corrupt` / `unavailable` **不得**折叠成「空」
 *     （读不到 ≠ 没有记录；两者的下一步动作完全不同）；
 *  ② 写回走 `via: 'user-confirmed'`，且**只**加证据行（不改 scopeId、不新建身份）；
 *  ③ 幂等：同一目录已有 user-confirmed 证据 → 重复点击零副作用；
 *  ④ **不改 scopeIdentity 判定链**（§3.7）：本模块不参与 reuse/register/degrade/refuse。
 *
 * 面板的写入端口用替身注入（等价于 `writeWorkspaceRegistry` 的单事务 RMW 契约：
 * mutate 收到**事务内**读数、返回新记录或 `'unchanged'`）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  RegistryMutate,
  RegistryReadResult,
  RegistryWriteResult,
} from '@mindcanvas/react';
import { AssociateWorkspacePanel } from '../src/AssociateWorkspacePanel.js';
import {
  ASSOCIATION_COPY,
  applyUserConfirmed,
  associationRefusalOf,
  readoutOf,
  type AssociationReadout,
} from '../src/workspaceAssociate.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------- 替身

type AssocVia = 'isSameEntry' | 'user-confirmed' | 'session-only';

function entry(scopeId: string, label: string, via: AssocVia[] = ['session-only']) {
  return {
    scopeId,
    label,
    lastSeenAt: 1_700_000_000_000,
    state: 'active' as const,
    associations: via.map((v, i) => ({ at: 1_700_000_000_000 + i, via: v })),
    handle: { getDirectoryHandle: async () => ({}) },
  };
}

type ReadResult = RegistryReadResult;
type WriteResult = RegistryWriteResult;

function makePort(
  over: {
    read?: ReadResult;
    writeResult?: WriteResult;
  } = {},
): {
  writes: unknown[];
  port: { read: () => Promise<ReadResult>; write: (m: RegistryMutate) => Promise<WriteResult> };
} {
  const read: ReadResult =
    over.read ??
    {
      kind: 'ok',
      record: {
        v: 1,
        activeScopeId: 'ws:a',
        entries: [entry('ws:a', 'MyNotes')],
      },
    };
  const writes: unknown[] = [];
  return {
    writes,
    port: {
      read: async () => read,
      write: async (mutate: RegistryMutate) => {
        // 与生产单事务 RMW 同规：mutate 收到**读数**、返回新记录或 'unchanged'
        writes.push(mutate(read));
        return over.writeResult ?? { kind: 'ok', record: null };
      },
    },
  };
}

// ---------------------------------------------------------------- 纯函数层

describe('rider-B · 读数四态（不得折叠）', () => {
  it('ok → 候选清单（含 state 与证据）', () => {
    const out = readoutOf({
      kind: 'ok',
      record: { entries: [entry('ws:a', 'MyNotes', ['isSameEntry'])] },
    });
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') throw new Error('应为 ok');
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]?.label).toBe('MyNotes');
    expect(out.candidates[0]?.associations[0]?.via).toBe('isSameEntry');
  });

  it('★corrupt / unavailable **不**折算成 empty（三态各自独立）', () => {
    expect(readoutOf({ kind: 'empty' }).kind).toBe('empty');
    expect(readoutOf({ kind: 'corrupt' }).kind).toBe('corrupt');
    expect(readoutOf({ kind: 'unavailable' }).kind).toBe('unavailable');
  });

  it('校验：读数非 ok → record-not-ok（不写任何键）；找不到 → not-found', () => {
    expect(
      associationRefusalOf({ readout: { kind: 'corrupt' }, scopeId: 'ws:a' }),
    ).toBe('record-not-ok');
    expect(
      associationRefusalOf({ readout: { kind: 'unavailable' }, scopeId: 'ws:a' }),
    ).toBe('record-not-ok');
    const ok: AssociationReadout = {
      kind: 'ok',
      candidates: [
        { scopeId: 'ws:a', label: 'A', lastSeenAt: 1, state: 'active', associations: [] },
      ],
    };
    expect(associationRefusalOf({ readout: ok, scopeId: 'ws:zzz' })).toBe('not-found');
    expect(associationRefusalOf({ readout: ok, scopeId: 'ws:a' })).toBeNull();
  });

  it('★幂等：已有 user-confirmed 证据 → already-confirmed（零副作用）', () => {
    const ok: AssociationReadout = {
      kind: 'ok',
      candidates: [
        {
          scopeId: 'ws:a',
          label: 'A',
          lastSeenAt: 1,
          state: 'active',
          associations: [{ at: 1, via: 'user-confirmed' }],
        },
      ],
    };
    expect(associationRefusalOf({ readout: ok, scopeId: 'ws:a' })).toBe('already-confirmed');
  });

  it('★写回只追加证据行：scopeId 不变、不新建身份、旧条目转 dormant', () => {
    const rec = {
      v: 1 as const,
      activeScopeId: 'ws:b' as string | null,
      entries: [entry('ws:a', 'A'), entry('ws:b', 'B')],
    };
    const next = applyUserConfirmed(rec, 'ws:a', 999);
    // 身份**不变**（关联 ≠ 重新登记）
    expect(next.entries.map((e) => e.scopeId).sort()).toEqual(['ws:a', 'ws:b']);
    expect(next.activeScopeId).toBe('ws:a');
    const a = next.entries.find((e) => e.scopeId === 'ws:a');
    expect(a?.state).toBe('active');
    expect(a?.associations.at(-1)).toEqual({ at: 999, via: 'user-confirmed' });
    // 追加而非替换：原有证据保留
    expect(a?.associations[0]?.via).toBe('session-only');
    // 其余条目转 dormant（与 upsertEntry 同规的 active 唯一性）
    expect(next.entries.find((e) => e.scopeId === 'ws:b')?.state).toBe('dormant');
    // 句柄原样保留（不改身份就不该动句柄）
    expect(a?.handle).toBeDefined();
  });
});

// ---------------------------------------------------------------- 面板交互

describe('rider-B · 面板交互', () => {
  it('入口按钮 → 展开面板并列出条目（用户语言，不暴露 scopeId 字面量）', async () => {
    const { port } = makePort();
    const { container } = render(
      <AssociateWorkspacePanel read={port.read} write={port.write} onNotice={vi.fn()} />,
    );
    fireEvent.click(await waitFor(() => screen.getByText('关联…')));
    await waitFor(() => expect(container.querySelector('[data-assoc-row]')).not.toBeNull());
    const row = container.querySelector('[data-assoc-row]') as HTMLElement;
    expect(row.textContent).toContain('MyNotes');
    // UD-5：不向用户暴露内部标识（scopeId 只在 data 属性里，不进文案）
    expect(row.textContent).not.toContain('ws:');
    // 但身份确实挂在 DOM 上（几何/断言可定位），只是不给用户看
    expect(row.getAttribute('data-assoc-scope')).toBe('ws:a');
  });

  it('确认 → 写回 user-confirmed + 提示成功 + 面板收起', async () => {
    const { port, writes } = makePort();
    const onNotice = vi.fn();
    const { container } = render(
      <AssociateWorkspacePanel read={port.read} write={port.write} onNotice={onNotice} />,
    );
    fireEvent.click(await waitFor(() => screen.getByText('关联…')));
    await waitFor(() => expect(container.querySelector('[data-assoc-confirm]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-assoc-confirm]') as HTMLElement);
    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(ASSOCIATION_COPY.confirmed));
    await waitFor(() => expect(container.querySelector('[data-assoc-panel]')).toBeNull());
  });

  it('空库 → 显示「还没有任何工作区记录」，不显示列表', async () => {
    const { port } = makePort({ read: { kind: 'empty' } });
    const { container } = render(
      <AssociateWorkspacePanel read={port.read} write={port.write} onNotice={vi.fn()} />,
    );
    fireEvent.click(await waitFor(() => screen.getByText('关联…')));
    await waitFor(() => expect(container.querySelector('[data-assoc-empty]')).not.toBeNull());
    expect(container.querySelector('[data-assoc-list]')).toBeNull();
  });

  it('★损坏记录 → 说明「不会改写」，且没有任何写入', async () => {
    const { port, writes } = makePort({ read: { kind: 'corrupt' } });
    const { container } = render(
      <AssociateWorkspacePanel read={port.read} write={port.write} onNotice={vi.fn()} />,
    );
    fireEvent.click(await waitFor(() => screen.getByText('关联…')));
    await waitFor(() => expect(container.querySelector('[data-assoc-corrupt]')).not.toBeNull());
    const bar = container.querySelector('[data-assoc-corrupt]') as HTMLElement;
    expect(bar.textContent).toContain('不会改写');
    expect(writes).toHaveLength(0);
  });

  it('★不可用 → 独立文案（不与「空」合并），零写入', async () => {
    const { port, writes } = makePort({ read: { kind: 'unavailable' } });
    const { container } = render(
      <AssociateWorkspacePanel read={port.read} write={port.write} onNotice={vi.fn()} />,
    );
    fireEvent.click(await waitFor(() => screen.getByText('关联…')));
    await waitFor(() => expect(container.querySelector('[data-assoc-unavailable]')).not.toBeNull());
    expect(container.querySelector('[data-assoc-empty]')).toBeNull();
    expect(writes).toHaveLength(0);
  });

  it('写回失败 → 提示「未做任何改动」（不假装成功）', async () => {
    const { port } = makePort({ writeResult: { kind: 'failed', reason: 'unavailable' } });
    const onNotice = vi.fn();
    const { container } = render(
      <AssociateWorkspacePanel read={port.read} write={port.write} onNotice={onNotice} />,
    );
    fireEvent.click(await waitFor(() => screen.getByText('关联…')));
    await waitFor(() => expect(container.querySelector('[data-assoc-confirm]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-assoc-confirm]') as HTMLElement);
    await waitFor(() => expect(onNotice).toHaveBeenCalledWith(ASSOCIATION_COPY['record-not-ok']));
    expect(onNotice).not.toHaveBeenCalledWith(ASSOCIATION_COPY.confirmed);
  });

  it('取消 → 面板收起，零写入', async () => {
    const { port, writes } = makePort();
    const { container } = render(
      <AssociateWorkspacePanel read={port.read} write={port.write} onNotice={vi.fn()} />,
    );
    fireEvent.click(await waitFor(() => screen.getByText('关联…')));
    await waitFor(() => expect(container.querySelector('[data-assoc-cancel]')).not.toBeNull());
    fireEvent.click(container.querySelector('[data-assoc-cancel]') as HTMLElement);
    await waitFor(() => expect(container.querySelector('[data-assoc-panel]')).toBeNull());
    expect(writes).toHaveLength(0);
  });
});
