// @vitest-environment jsdom
/**
 * P0-A ⑤：删除当前文档的 F2 流程（acceptance §3 F2、file-management §4）。
 *
 * 判别核心 —— F2「可观察」逐条：
 *  ① 组合进行中 → 不弹模态、不执行删除，提示『输入法正在输入，请先结束输入』，
 *     组合结束后**自动续跑**；
 *  ② 草稿提交失败 → 保留草稿、中止删除、提示可修正（**不挂在 compositionend 上**）；
 *  ③ dirty → 三选（保存后删除 / 放弃修改并删除 / 取消）；
 *  ④ 取消 → 文档、草稿、目的地、树、面板**全部不变**；
 *  ⑤ 确认删除 → 关闭当前文档回空白态，**不残留**指向已删文件的 dirty 会话。
 *
 * 负控锚点（§3 F2「负控」）：
 *  - 用「先删再询问」的实现 → 「取消后文档仍可编辑且内容完整」必须转红；
 *  - 用「放弃修改后仍自动保存一次」的实现 → 「文件未被重建」必须转红。
 *
 * M 层声明：真实 IME 组合需要真实输入法，本机不具备条件。本文件用
 * `compositionstart`/`compositionend` 事件驱动**产品自身的组合状态通道**
 * （`draftFlush.ts` 的 document 级捕获监听）来验证流程分支 —— 这验证的是
 * 「组合期间产品怎么办」，**不声称**验证了真实输入法的候选串行为（那见回执的人工脚本）。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasActiveComposition } from '../src/draftFlush';
import {
  DELETE_NOTICE,
  type DeleteTarget,
  useCurrentDocDeleteFlow,
} from '../src/hooks/useCurrentDocDeleteFlow';
import type { CurrentDocOpResult, FileOpRefusal } from '../src/hooks/useFileOpOrchestration';

/** 结束真实组合态（`draftFlush` 的模块级状态在用例之间不会自动复位） */
function endComposition(): void {
  document.dispatchEvent(new Event('compositionend', { bubbles: true }));
}
function startComposition(): void {
  document.dispatchEvent(new Event('compositionstart', { bubbles: true }));
}

interface Harness {
  flow: () => ReturnType<typeof useCurrentDocDeleteFlow>;
  state: {
    dirty: boolean;
    saving: boolean;
    flush: 'ok' | 'composing' | 'failed';
    saveSucceeds: boolean;
    leaseRefused: FileOpRefusal | null;
  };
  calls: {
    deleted: number;
    saved: number;
    closed: number;
    suppressed: number;
    notices: string[];
  };
  /** 目标（可自定义 perform 的结果） */
  target(overrides?: Partial<DeleteTarget> & { outcome?: CurrentDocOpResult<null> }): DeleteTarget;
}

function harness(): Harness {
  const state: Harness['state'] = {
    dirty: false,
    saving: false,
    flush: 'ok',
    saveSucceeds: true,
    leaseRefused: null,
  };
  const calls: Harness['calls'] = { deleted: 0, saved: 0, closed: 0, suppressed: 0, notices: [] };
  const view = renderHook(() =>
    useCurrentDocDeleteFlow({
      acquireLease: () =>
        state.leaseRefused === null ? { ok: true, release: () => {} } : { ok: false, reason: state.leaseRefused },
      flushEdits: () => state.flush,
      isDirty: () => state.dirty,
      isSaving: () => state.saving,
      saveNow: async () => {
        calls.saved += 1;
        return state.saveSucceeds;
      },
      suppressPendingAuto: () => {
        calls.suppressed += 1;
      },
      onClosed: () => {
        calls.closed += 1;
      },
      onNotice: (msg) => calls.notices.push(msg),
    }),
  );
  return {
    flow: () => view.result.current,
    state,
    calls,
    target(overrides): DeleteTarget {
      return {
        name: '架构.mm.md',
        isCurrent: true,
        isDir: false,
        perform: async () => {
          calls.deleted += 1;
          return overrides?.outcome ?? { kind: 'done', value: null, relPath: '' };
        },
        ...overrides,
      } as DeleteTarget;
    },
  };
}

beforeEach(() => {
  // 组合态是模块级全局：每个用例前复位，避免跨用例污染
  endComposition();
});
afterEach(() => {
  cleanup();
  endComposition();
  vi.restoreAllMocks();
});

describe('F2 · ⓪ 租约拒绝（零副作用）', () => {
  it('busy-physical → 提示且不进入任何后续分支、不删除', async () => {
    const h = harness();
    h.state.leaseRefused = 'busy-physical';
    await act(async () => {
      await h.flow().request(h.target());
    });
    expect(h.flow().pending?.kind).toBe('refused');
    expect(h.calls.notices).toContain(DELETE_NOTICE.busyPhysical);
    expect(h.calls.deleted).toBe(0);
  });

  it('busy-lease → 提示「正在处理上一步操作」，零副作用', async () => {
    const h = harness();
    h.state.leaseRefused = 'busy-lease';
    await act(async () => {
      await h.flow().request(h.target());
    });
    expect(h.flow().pending?.kind).toBe('refused');
    expect(h.calls.notices).toContain(DELETE_NOTICE.busyLease);
    expect(h.calls.deleted).toBe(0);
  });
});

describe('★F2 · ① 组合输入（IME）', () => {
  it('组合进行中 → 不弹模态（confirm 不出现）、不删除，提示先结束输入', async () => {
    const h = harness();
    startComposition();
    h.state.flush = 'composing';
    await act(async () => {
      await h.flow().request(h.target());
    });
    // 关键：**不是** confirm / dirty 三选 —— 是暂缓提示
    expect(h.flow().pending?.kind).toBe('composing');
    expect(h.calls.deleted).toBe(0);
    expect(h.calls.notices).toContain(DELETE_NOTICE.composing);
  });

  it('★组合结束后**自动续跑**：不脏 → 直接出确认条（用户不必再点一次）', async () => {
    const h = harness();
    h.state.flush = 'composing';
    await act(async () => {
      await h.flow().request(h.target());
    });
    expect(h.flow().pending?.kind).toBe('composing');

    // 结束组合（真实产品里由输入法触发）→ 自动续跑
    h.state.flush = 'ok';
    await act(async () => {
      startComposition();
      endComposition();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.flow().pending?.kind).toBe('confirm');
    expect(h.calls.deleted).toBe(0); // 只是到了确认条，还没删
  });

  it('★组合结束后若 dirty → 续跑到三选（不是直接删）', async () => {
    const h = harness();
    h.state.flush = 'composing';
    await act(async () => {
      await h.flow().request(h.target());
    });
    h.state.flush = 'ok';
    h.state.dirty = true;
    await act(async () => {
      endComposition();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.flow().pending?.kind).toBe('dirty');
    expect(h.calls.deleted).toBe(0);
  });

  it('组合暂缓不会因为「看了别的节点」而丢目标（组合结束仍续跑）', async () => {
    const h = harness();
    h.state.flush = 'composing';
    const first = h.target({ name: 'a.mm.md' });
    await act(async () => {
      await h.flow().request(first);
    });
    h.state.flush = 'ok';
    await act(async () => {
      endComposition();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.flow().pending).toMatchObject({ kind: 'confirm', name: 'a.mm.md' });
  });
});

describe('★F2 · ② 草稿提交失败', () => {
  it('flush=failed → 中止删除、提示可修正，且**不**等待 compositionend', async () => {
    const h = harness();
    h.state.flush = 'failed';
    await act(async () => {
      await h.flow().request(h.target());
    });
    expect(h.flow().pending?.kind).toBe('draft-failed');
    expect(h.calls.deleted).toBe(0);
    expect(h.calls.notices).toContain(DELETE_NOTICE.draftFailed);

    // 关键：草稿失败与 IME 无关 —— 即使随后有 compositionend 也不得续跑执行删除
    await act(async () => {
      endComposition();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.flow().pending?.kind).toBe('draft-failed');
    expect(h.calls.deleted).toBe(0);
  });
});

describe('F2 · ③ dirty 三选', () => {
  it('dirty → 出三选（不直接删）', async () => {
    const h = harness();
    h.state.dirty = true;
    await act(async () => {
      await h.flow().request(h.target());
    });
    expect(h.flow().pending).toMatchObject({ kind: 'dirty', name: '架构.mm.md', isCurrent: true });
    expect(h.calls.deleted).toBe(0);
  });

  it('不脏 → 直接到确认条（不多问一次）', async () => {
    const h = harness();
    await act(async () => {
      await h.flow().request(h.target());
    });
    expect(h.flow().pending?.kind).toBe('confirm');
    expect(h.calls.deleted).toBe(0); // 确认条本身不执行删除
  });

  it('「保存后删除」：先保存成功 → 才删', async () => {
    const h = harness();
    h.state.dirty = true;
    await act(async () => {
      await h.flow().request(h.target());
    });
    await act(async () => {
      h.flow().choose('save-then-delete');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.calls.saved).toBe(1);
    expect(h.calls.deleted).toBe(1);
  });

  it('★「保存后删除」但保存失败 → **不删**（可重试）', async () => {
    const h = harness();
    h.state.dirty = true;
    h.state.saveSucceeds = false;
    await act(async () => {
      await h.flow().request(h.target());
    });
    await act(async () => {
      h.flow().choose('save-then-delete');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.calls.saved).toBe(1);
    expect(h.calls.deleted).toBe(0); // 保存没成功就不删
  });

  it('★「放弃修改并删除」：抑制自动保存（防「放弃后又自动保存一次」）', async () => {
    const h = harness();
    h.state.dirty = true;
    await act(async () => {
      await h.flow().request(h.target());
    });
    await act(async () => {
      h.flow().choose('discard-then-delete');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.calls.suppressed).toBe(1);
    expect(h.calls.deleted).toBe(1);
    // 「放弃修改」分支**不得**走保存（否则文件会被重建 —— F2 负控第 2 条）
    expect(h.calls.saved).toBe(0);
  });

  it('「放弃修改并删除」不触发 saveNow（文件不会被重建）', async () => {
    const h = harness();
    h.state.dirty = true;
    await act(async () => {
      await h.flow().request(h.target());
    });
    const savedBefore = h.calls.saved;
    await act(async () => {
      h.flow().choose('discard-then-delete');
      await Promise.resolve();
    });
    expect(h.calls.saved).toBe(savedBefore);
  });
});

describe('★F2 · ④ 取消（零副作用）', () => {
  it('取消 → 不删除、不关闭、不保存、抑制计数为 0', async () => {
    const h = harness();
    h.state.dirty = true;
    await act(async () => {
      await h.flow().request(h.target());
    });
    await act(async () => {
      h.flow().choose('cancel');
      await Promise.resolve();
    });
    expect(h.flow().pending).toBeNull();
    expect(h.calls.deleted).toBe(0);
    expect(h.calls.closed).toBe(0);
    expect(h.calls.saved).toBe(0);
    expect(h.calls.suppressed).toBe(0);
  });

  it('★取消必须发生在删除**之前**（先删再询问的反例会在这里转红）', async () => {
    const h = harness();
    h.state.dirty = true;
    await act(async () => {
      await h.flow().request(h.target());
    });
    // 到三选为止，删除函数一次都没被调用 —— 「文档仍可编辑且内容完整」的事实基础
    expect(h.calls.deleted).toBe(0);
    h.flow().choose('cancel');
    expect(h.calls.deleted).toBe(0);
  });

  it('确认条取消同样零副作用', async () => {
    const h = harness();
    await act(async () => {
      await h.flow().request(h.target());
    });
    expect(h.flow().pending?.kind).toBe('confirm');
    await act(async () => {
      h.flow().choose('cancel');
    });
    expect(h.calls.deleted).toBe(0);
    expect(h.flow().pending).toBeNull();
  });
});

describe('★F2 · ⑤ 确认删除后的收尾', () => {
  it('确认 → 执行删除 + 关闭当前文档（回空白态）', async () => {
    const h = harness();
    await act(async () => {
      await h.flow().request(h.target());
    });
    await act(async () => {
      h.flow().choose('confirm');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.calls.deleted).toBe(1);
    expect(h.calls.closed).toBe(1);
    expect(h.flow().pending).toBeNull();
  });

  it('★删除失败 → **不关闭**当前文档（保留文档与目的地，可重试）', async () => {
    const h = harness();
    const target = h.target({
      outcome: {
        kind: 'failed',
        stage: 'permission',
        code: 'E-PERMISSION',
        retryable: true,
        notice: '没有写入权限：请重新授权后重试。',
      },
    });
    await act(async () => {
      await h.flow().request(target);
    });
    await act(async () => {
      h.flow().choose('confirm');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.calls.deleted).toBe(1); // 尝试过
    expect(h.calls.closed).toBe(0); // 但**没有**关闭（关键：失败不得留下「已关闭」假象）
    expect(h.calls.notices).toContain('没有写入权限：请重新授权后重试。');
  });

  it('删除非当前文档 → 不关闭当前文档（onClosed 只给当前文档）', async () => {
    const h = harness();
    await act(async () => {
      await h.flow().request(h.target({ isCurrent: false }));
    });
    await act(async () => {
      h.flow().choose('confirm');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.calls.deleted).toBe(1);
    expect(h.calls.closed).toBe(0);
  });

  it('目录删除：确认条带 isDir（文案区分「及其全部内容」）', async () => {
    const h = harness();
    await act(async () => {
      await h.flow().request(h.target({ name: '归档', isDir: true, isCurrent: false }));
    });
    expect(h.flow().pending).toMatchObject({ kind: 'confirm', isDir: true, name: '归档' });
  });
});

describe('组合状态守卫接线（不自造 IME 语义）', () => {
  it('hasActiveComposition 反映真实组合事件（产品自身的通道）', () => {
    expect(hasActiveComposition()).toBe(false);
    startComposition();
    expect(hasActiveComposition()).toBe(true);
    endComposition();
    expect(hasActiveComposition()).toBe(false);
  });
});
