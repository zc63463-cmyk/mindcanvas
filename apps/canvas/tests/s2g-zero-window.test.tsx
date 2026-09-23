// @vitest-environment jsdom
/**
 * P0-FIX-R1 R1-3：S2G 零窗口（`applyDoc` 的同步事实）。
 *
 * **缺陷**：`performApplyDoc` 里只做 `setDoc(next)`，而「`controller.reset` 新树 +
 * `syncedSourceRef` 置位」留在 `useDocumentSwitch` 的**被动 effect** 里。effect 在
 * commit 之后才跑，于是「打开文档 → 立刻编辑 → Ctrl+S」存在一个 effect 未提交的窗口，
 * 整次保存被 `saveGuard.canWriteDoc` 拦掉（真实浏览器 5 次跑 4 次命中）。
 *
 * **判别纪律**（本文件的核心）：断言必须在 `applyDoc` 返回的**同一时刻**成立，
 * 且**不 flush 任何 effect**。用 `renderHook` 而不额外 `act(async () => {})`，
 * 就是「不等待任何 effect 提交」——若把 reset/置位挪回被动 effect，本文件立即转红
 * （负控 NC-R1-3 的锚点）。
 *
 * 三条并列断言分别拦一类假修（派单 §4「诱惑性错法」）：
 *  - 只前移置位不 reset → 「树已来自 next.source」转红（旧树会被写进新目的地）；
 *  - 只 reset 不置位    → 「守卫放行」转红（窗口仍在，保存继续被拦）；
 *  - 只按 source 判据   → 同内容替换（(n)）转红（source 逐字相同，effect 不重跑）。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { makeTextNode } from '@mindcanvas/kernel';
import {
  EditorController,
  type DocumentHost,
  type FsFileHandle,
  type MindDoc,
  type SaveOutcome,
} from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentActions } from '../src/hooks/useDocumentActions';
import { useDocumentSaveSession } from '../src/hooks/useDocumentSaveSession';
import { canWriteDoc } from '../src/hooks/saveGuard';

const HANDLE = { name: 'a.mm.md' } as FsFileHandle;

/** 可控延迟宿主（本文件不需要真实写入，只需 `save` 可调用） */
function makeHost() {
  const save = vi.fn(
    (): Promise<SaveOutcome> => Promise.resolve({ result: 'fs' as const, handle: HANDLE }),
  );
  return { docHost: { remember: vi.fn(), save } as unknown as DocumentHost, save };
}

function makeDoc(over: Partial<MindDoc> = {}): MindDoc {
  return { id: 'a.mm.md', name: 'a.mm.md', source: '# 甲\n- 旧\n', saved: true, ts: 0, ...over };
}

/**
 * 夹具：真实 `EditorController` + 真实保存会话 + 真实 `useDocumentActions`。
 * `syncedSourceRef` 初值与首棵树同步（模拟控制器创建处的写点①）。
 */
function makeHarness() {
  const first = makeDoc();
  const controller = new EditorController(makeTextNode('旧'));
  const { docHost, save } = makeHost();
  const syncedSourceRef: { current: string | null } = { current: first.source };
  const initial = first;
  const view = renderHook(() => {
    const [doc, setDoc] = useState(initial);
    const session = useDocumentSaveSession({ readContent: () => controller.root });
    const actions = useDocumentActions({
      controller,
      docHost,
      doc,
      setDoc,
      fileInputRef: { current: null },
      autoSaveTimer: { current: null },
      session: session.session,
      syncedSourceRef,
    });
    return { doc, actions, session: session.session };
  });
  return { view, controller, syncedSourceRef, save };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('R1-3(m)：applyDoc 返回 true 的同一时刻，三条事实同时成立（不 flush 任何 effect）', () => {
  it('syncedSourceRef 已置位 + canWriteDoc 放行 + controller.root 已来自 next.source', async () => {
    const { view, controller, syncedSourceRef } = makeHarness();
    const next = makeDoc({
      id: 'b.mm.md',
      name: 'b.mm.md',
      source: '# 乙\n- 新\n',
      handle: { name: 'b.mm.md' } as FsFileHandle,
    });

    // act 只包裹 applyDoc 这一次状态更新；不额外 flush（不跑 passive effect）
    let applied = false;
    await act(async () => {
      applied = await view.result.current.actions.applyDoc(next);
    });
    expect(applied).toBe(true);

    // ① 同步标记已置位（旧实现在此处为 null → 保存必被拦）
    expect(syncedSourceRef.current).toBe(next.source);
    // ② 守卫放行（这是「窗口归零」的可判定形式）
    expect(canWriteDoc(syncedSourceRef.current, next.source)).toBe(true);
    // ③ 树已属于新文档：序列化文本以新内容开头，且**没有旧节点残留**
    const text = controller.serialize().replace(/\\n/g, '\n');
    expect(text.startsWith('# 乙')).toBe(true);
    expect(text).not.toContain('旧');
  });

  it('判别性：首棵树的内容不得残留（只前移置位、不 reset 的假修在此转红）', async () => {
    const { view, controller } = makeHarness();
    // 首棵树标记为「旧」，新文档标记为「新」
    expect(controller.serialize()).toContain('旧');

    await act(async () => {
      await view.result.current.actions.applyDoc(makeDoc({ source: '# 全新\n' }));
    });

    const text = controller.serialize().replace(/\\n/g, '\n');
    expect(text).toContain('全新');
    expect(text).not.toContain('旧');
  });
});

describe('R1-3(n)：同内容替换（source 逐字相同）后树同样属于新文档', () => {
  it('source 不变但换了文档 → 树被换成新解析的树，旧草稿不残留', async () => {
    const { view, controller, syncedSourceRef } = makeHarness();
    const same = '# 甲\n- 旧\n'; // 与初始 source **逐字相同**

    // 先在旧树上做一次编辑，制造「旧草稿」
    act(() => {
      controller.updateText(controller.root.id, '改过的旧内容');
    });
    expect(controller.serialize()).toContain('改过的旧内容');

    // 用**同 source** 替换文档：靠 `doc.source` 判据的实现在这里不会重跑 effect
    await act(async () => {
      await view.result.current.actions.applyDoc(makeDoc({ id: 'c.mm.md', source: same }));
    });

    // 树必须回到该 source 的解析结果 —— 编辑草稿不得活到新文档上
    expect(controller.serialize()).not.toContain('改过的旧内容');
    expect(controller.serialize()).toContain('旧');
    // 同步标记仍与新 source 一致
    expect(syncedSourceRef.current).toBe(same);
  });
});

describe('R1-3：解析失败时 fail-closed（不置位，守卫继续拦）', () => {
  it('next.source 解析不出树 → syncedSourceRef 置 null，canWriteDoc 为 false', async () => {
    const { view, syncedSourceRef } = makeHarness();
    // 空 source 在协议层解析不出树（`buildEditable` 的 editable 为 null）
    await act(async () => {
      await view.result.current.actions.applyDoc(makeDoc({ id: 'empty.mm.md', source: '' }));
    });
    // 树没能换 → 宁可拒写，也不让旧内容写进新文件
    expect(syncedSourceRef.current).toBeNull();
    expect(canWriteDoc(syncedSourceRef.current, '')).toBe(false);
  });
});

describe('R1-3：不依赖 effect 提交（无 flush 与有 flush 结果一致）', () => {
  it('applyDoc 后立即检视 与 再 flush 一轮后的结论一致（幂等，无二次重置）', async () => {
    const { view, controller, syncedSourceRef } = makeHarness();
    const next = makeDoc({ id: 'd.mm.md', source: '# 丙\n- 三\n' });

    await act(async () => {
      await view.result.current.actions.applyDoc(next);
    });
    const immediate = {
      synced: syncedSourceRef.current,
      text: controller.serialize(),
      root: controller.root,
    };

    // 再 flush 一轮 passive effect（真实 app 里 useDocumentSwitch 的视图 effect 会跑）
    await act(async () => {
      await Promise.resolve();
    });

    expect(syncedSourceRef.current).toBe(immediate.synced);
    expect(controller.serialize()).toBe(immediate.text);
    // 同一个根引用：视图 effect 不得再 reset 一遍（那会把用户的选择/折叠态清掉）
    expect(controller.root).toBe(immediate.root);
  });
});
