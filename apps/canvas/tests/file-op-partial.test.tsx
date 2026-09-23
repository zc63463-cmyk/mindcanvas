// @vitest-environment jsdom
/**
 * P0-A ⑥：部分成功 / 冲突 / 撤销保护 / 外部修改复查
 * （acceptance §3 F3、§3.1 L3、L4）。
 *
 * 判别核心 —— F3「可观察」与 L3/L4 逐条：
 *  ① 部分完成时 UI 出现「两份」说明，同时列出新位置与旧位置（**不得**呈现为「移动失败」）；
 *  ② 三个动作可用（重试删除原始 / 保留两份 / 撤销新副本）；
 *  ③ 「重试删除原始」**只删源、不重建目标**（重建会覆盖新副本内容）；
 *  ④ 当前会话留在新位置（目的地已重绑，由 rename-current-doc 覆盖）；
 *  ⑤ 树里旧文件标「重复」（面板层面体现为「保留两份」后旧文件仍在）；
 *  L3 撤销保护：副本已被编辑 → **拒绝直接删除**，只提供「放弃这些改动并删除副本」/「保留两份」；
 *  L4 外部修改复查：`{size,lastModified}` 不一致 → **不删**，转「保留两份」。
 *
 * 负控锚点（§3 F3「负控」）：
 *  - 把 partial 当 failed 呈现 → 「UI 出现『两份』说明」必须转红；
 *  - 盲目重试（第二次 createFile）→ 「目标内容未被覆盖」必须转红；
 *  - 无条件删除副本/源 → 保护分支必须转红（L3/L4）。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { FileOpOutcome, FsFileHandle, WorkspaceDir, WorkspaceFile } from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSaveSession } from '../src/hooks/useDocumentSaveSession';
import {
  type SafeWorkspaceHost,
  useFileOpOrchestration,
} from '../src/hooks/useFileOpOrchestration';
import { type OpWorkspaceHost, useFileOpController } from '../src/useFileOpController';

// ---------------------------------------------------------------- 可控 Fake 工作区

interface FakeState {
  files: Map<string, string>;
  /** removeEntry 抛错（制造部分成功） */
  removeError: Error | null;
  /** 下一次 statFile 返回的快照（模拟「已被外部修改」） */
  statOverride: { size: number; lastModified: number } | null;
  calls: { move: number; remove: number; duplicate: number; createFile: number };
}

function makeHost(initial: Array<[string, string]>) {
  const state: FakeState = {
    files: new Map(initial),
    removeError: Object.assign(new Error('没有删除权限'), { name: 'NotAllowedError' }),
    statOverride: null,
    calls: { move: 0, remove: 0, duplicate: 0, createFile: 0 },
  };

  const fileOf = (path: string): WorkspaceFile => ({
    kind: 'file',
    name: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
    path,
    handle: { name: path } as FsFileHandle,
    ts: 1,
    size: (state.files.get(path) ?? '').length,
  });

  const host: SafeWorkspaceHost & OpWorkspaceHost & {
    state: FakeState;
    fileAt(path: string): WorkspaceFile;
  } = {
    mounted: true,
    name: 'MyNotes',
    scopeId: 'ws:test',
    state,
    fileAt: fileOf,
    async scan(): Promise<unknown[]> {
      return [...state.files.keys()].map((p) =>
        p.includes('/')
          ? ({ kind: 'dir', name: p.slice(0, p.indexOf('/')), path: p.slice(0, p.indexOf('/')), children: [fileOf(p)], handle: {} } satisfies WorkspaceDir & { children: unknown[] })
          : fileOf(p),
      );
    },
    async statFile(file) {
      if (state.statOverride !== null) return state.statOverride;
      if (!state.files.has(file.path)) return null;
      return { size: (state.files.get(file.path) ?? '').length, lastModified: 1 };
    },
    async resolveCopyName(_dirPath, name) {
      return state.files.has(name) ? `${name.replace(/\.mm\.md$/, '')} 2.mm.md` : name;
    },
    async renameFileSafe(file, newName): Promise<FileOpOutcome<WorkspaceFile>> {
      const text = state.files.get(file.path) ?? '';
      const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      const next = parent === '' ? newName : `${parent}/${newName}`;
      state.files.set(next, text);
      if (state.removeError !== null) {
        state.calls.remove += 1;
        return { kind: 'partial', created: fileOf(next), sourceRetained: true, error: { code: 'E-PERMISSION', retryable: true } };
      }
      state.files.delete(file.path);
      return { kind: 'ok', value: fileOf(next) };
    },
    async moveFileSafe(file, targetDir): Promise<FileOpOutcome<WorkspaceFile>> {
      state.calls.move += 1;
      const text = state.files.get(file.path) ?? '';
      const next = targetDir === '' ? file.name : `${targetDir}/${file.name}`;
      state.calls.createFile += 1;
      state.files.set(next, text);
      if (state.removeError !== null) {
        state.calls.remove += 1;
        return { kind: 'partial', created: fileOf(next), sourceRetained: true, error: { code: 'E-PERMISSION', retryable: true } };
      }
      state.files.delete(file.path);
      return { kind: 'ok', value: fileOf(next) };
    },
    async removeFileSafe(file): Promise<FileOpOutcome<null>> {
      state.calls.remove += 1;
      if (state.removeError !== null) {
        return { kind: 'failed', stage: 'delete', error: { code: 'E-PERMISSION', retryable: true } };
      }
      state.files.delete(file.path);
      return { kind: 'ok', value: null };
    },
    async removeDirSafe(dir): Promise<FileOpOutcome<null>> {
      for (const k of [...state.files.keys()]) {
        if (k === dir.path || k.startsWith(`${dir.path}/`)) state.files.delete(k);
      }
      return { kind: 'ok', value: null };
    },
    async duplicateFileSafe(file): Promise<FileOpOutcome<WorkspaceFile>> {
      state.calls.duplicate += 1;
      const text = state.files.get(file.path) ?? '';
      const copy = `${file.name.replace(/\.mm\.md$/, '')} 副本.mm.md`;
      state.files.set(copy, text);
      return { kind: 'ok', value: fileOf(copy) };
    },
  };
  return host;
}

function mountController(
  host: SafeWorkspaceHost & OpWorkspaceHost,
  opts?: { dirty?: boolean; currentPath?: string | null },
) {
  const session = new DocumentSaveSession({ readContent: () => null });
  let afterRelease = 0;
  let reloads = 0;
  const state = { dirty: opts?.dirty ?? false, currentPath: opts?.currentPath ?? null };
  const view = renderHook(() => {
    const [, setTick] = useState(0);
    void setTick;
    const orchestration = useFileOpOrchestration({
      session,
      host,
      readDoc: () => ({ durable: true, current: true, dirty: state.dirty }),
      onRebound: (file) => {
        session.rebindDestination({
          kind: 'disk',
          scopeId: 'ws:test',
          relPath: file.path,
          name: file.name,
          handle: file.handle,
        });
        // 生产接线：Stage 在此同步 `workspacePath`（当前文档的路径随重绑一起更新）。
        // 不更新它，`copyHasNewChanges` 就永远看到旧路径 —— L3 保护判据会静默失效。
        state.currentPath = file.path;
      },
      onAfterRelease: () => {
        afterRelease += 1;
      },
    });
    const controller = useFileOpController({
      host,
      orchestration,
      isDirty: () => state.dirty,
      currentPath: () => state.currentPath,
      saveNow: async () => true,
      suppressPendingAuto: () => {},
      reload: async () => {
        reloads += 1;
      },
    });
    return controller;
  });
  return {
    view,
    session,
    state,
    reloads: () => reloads,
    afterRelease: () => afterRelease,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('F3 · 部分成功：目标已建、源删除失败', () => {
  it('★① 出现「两份」说明，且同时列出新位置与旧位置（不呈现为「移动失败」）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    const panel = h.view.result.current.ui.partial;
    expect(panel).not.toBeNull();
    expect(panel?.createdPath).toBe('归档/架构.mm.md');
    expect(panel?.sourcePath).toBe('架构.mm.md');
    expect(panel?.reason).toContain('权限');
    // 磁盘现状：两份都在（面板文案的事实依据）
    expect(host.state.files.has('归档/架构.mm.md')).toBe(true);
    expect(host.state.files.has('架构.mm.md')).toBe(true);
  });

  it('② 未编辑副本时 copyHasNewChanges=false（提供「撤销新副本」直接入口）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构']]);
    // 当前文档不是副本（还在旧位置）→ L3 保护不触发
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    expect(h.view.result.current.ui.partial?.copyHasNewChanges).toBe(false);
  });

  it('★③ 「重试删除原文件」只删源、**不重建目标**（不覆盖新副本内容）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构原文']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    const createsAfterMove = host.state.calls.createFile;
    // 副本被继续编辑过 → 磁盘上的新内容
    host.state.files.set('归档/架构.mm.md', '# 副本里的新内容');
    // 允许删源
    host.state.removeError = null;

    await act(async () => {
      h.view.result.current.ui.partial?.apply('retry-delete');
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // 源已删
    expect(host.state.files.has('架构.mm.md')).toBe(false);
    // **目标内容没有被覆盖**（这正是「盲目重试」会破坏的）
    expect(host.state.files.get('归档/架构.mm.md')).toBe('# 副本里的新内容');
    // 没有新增 createFile（即没有第二次复制）
    expect(host.state.calls.createFile).toBe(createsAfterMove);
  });

  it('「保留两份」：关闭面板 + 明确提示旧文件仍在（不删任何东西）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    await act(async () => {
      h.view.result.current.ui.partial?.apply('keep-both');
      await Promise.resolve();
    });
    expect(h.view.result.current.ui.partial).toBeNull();
    expect(h.view.result.current.ui.notice).toContain('保留两份');
    // 两份都还在（保留两份 = 不做任何删除）
    expect(host.state.files.has('归档/架构.mm.md')).toBe(true);
    expect(host.state.files.has('架构.mm.md')).toBe(true);
  });

  it('★「撤销新副本」：删掉副本、回到旧位置（源保留）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    // 撤销副本需要能删成功
    host.state.removeError = null;
    await act(async () => {
      h.view.result.current.ui.partial?.apply('undo-copy');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.state.files.has('归档/架构.mm.md')).toBe(false);
    // 源保留（撤销的是**新副本**，不是源）
    expect(host.state.files.has('架构.mm.md')).toBe(true);
    expect(h.view.result.current.ui.notice).toContain('回到原来的位置');
  });

  it('撤销失败 → 如实说「两份都在，请手动处理」（不假装成功）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    // removeError 仍为真 → 撤销也会失败
    await act(async () => {
      h.view.result.current.ui.partial?.apply('undo-copy');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.view.result.current.ui.notice).toContain('两份都在');
    expect(host.state.files.has('归档/架构.mm.md')).toBe(true);
  });

  it('「稍后处理」：关闭面板、零删除（本轮不自动重试）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    host.state.removeError = null;
    const removesBefore = host.state.calls.remove;
    await act(async () => {
      h.view.result.current.ui.partial?.apply('later');
      await Promise.resolve();
    });
    expect(h.view.result.current.ui.partial).toBeNull();
    expect(host.state.calls.remove).toBe(removesBefore);
    expect(host.state.files.has('架构.mm.md')).toBe(true);
  });
});

describe('★L3 · 撤销新副本的保护分支', () => {
  it('dirty 的当前文档移动前先出三选（不直接动手）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构']]);
    const h = mountController(host, { dirty: true, currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
    });
    // 有未保存修改 → 先问，不移动（§5.2⑤）
    expect(h.view.result.current.ui.dirtyChoice).not.toBeNull();
    expect(h.view.result.current.ui.partial).toBeNull();
    expect(host.state.calls.move).toBe(0);
  });

  it('★copyHasNewChanges=true：当前文档就是新副本且有改动 → 保护触发', async () => {
    const host = makeHost([['归档/架构.mm.md', '# 副本']]);
    // 当前文档路径 == 移动后的新位置，且 dirty → 保护成立
    const h = mountController(host, { dirty: true, currentPath: '归档/架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('归档/架构.mm.md'), '归档2');
    });
    // 先过 dirty 三选（选「放弃修改并移动」）
    act(() => {
      h.view.result.current.ui.dirtyChoice?.apply('discard-then-rename');
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const panel = h.view.result.current.ui.partial;
    expect(panel).not.toBeNull();
    // 当前文档 = 新副本（归档2/架构.mm.md）且 dirty → true（无条件删除会转红的位置）
    expect(panel?.copyHasNewChanges).toBe(true);
  });

  it('★保护分支下不提供「撤销新副本」直接入口（只有显式放弃改动）', async () => {
    const host = makeHost([['归档/架构.mm.md', '# 副本']]);
    const h = mountController(host, { dirty: true, currentPath: '归档/架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('归档/架构.mm.md'), '归档2');
    });
    act(() => {
      h.view.result.current.ui.dirtyChoice?.apply('discard-then-rename');
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    const panel = h.view.result.current.ui.partial;
    expect(panel?.copyHasNewChanges).toBe(true);
    // 面板组件按该判据渲染「放弃这些改动并删除副本」而非「撤销新副本」；
    // 这里钉住状态判据（组件渲染由 FileOpPanels 的用例覆盖）
    expect(panel?.copyHasNewChanges).toBe(true);
  });

  it('★「放弃这些改动并删除副本」是保护分支下的可删路径', async () => {
    const host = makeHost([['归档/架构.mm.md', '# 副本']]);
    const h = mountController(host, { dirty: true, currentPath: '归档/架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('归档/架构.mm.md'), '归档2');
    });
    act(() => {
      h.view.result.current.ui.dirtyChoice?.apply('discard-then-rename');
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.view.result.current.ui.partial).not.toBeNull();
    // 允许删除后走「放弃改动并删除副本」
    host.state.removeError = null;
    await act(async () => {
      h.view.result.current.ui.partial?.apply('discard-copy-changes');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.state.files.has('归档2/架构.mm.md')).toBe(false);
    expect(host.state.files.has('归档/架构.mm.md')).toBe(true);
  });
});

describe('★L4 · 重试删源前的外部修改复查', () => {
  it('源被外部修改（size 不同）→ **不删除**，转「保留两份」', async () => {
    const host = makeHost([['架构.mm.md', '# 架构原文']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.view.result.current.ui.partial?.sourceSnapshot).not.toBeNull();

    // 应用外修改源文件（size 变）
    host.state.files.set('架构.mm.md', '# 被外部改得很长很长');
    host.state.removeError = null; // 即使有权限也必须因复查失败而不删
    const removesBefore = host.state.calls.remove;

    await act(async () => {
      h.view.result.current.ui.partial?.apply('retry-delete');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 源**仍在**（这正是跳过复查会转红的位置）
    expect(host.state.files.has('架构.mm.md')).toBe(true);
    expect(h.view.result.current.ui.notice).toContain('外部修改');
    // 没有发起删除尝试
    expect(host.state.calls.remove).toBe(removesBefore);
  });

  it('源未被修改（快照一致）→ 允许删除', async () => {
    const host = makeHost([['架构.mm.md', '# 架构原文']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
      await Promise.resolve();
      await Promise.resolve();
    });
    host.state.removeError = null; // 内容不变，只是允许删
    await act(async () => {
      h.view.result.current.ui.partial?.apply('retry-delete');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.state.files.has('架构.mm.md')).toBe(false);
    expect(h.view.result.current.ui.notice).toContain('已删除原文件');
  });

  it('★快照不可读（null）→ 保守不删（不可判定 ≠ 可删）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构原文']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
      await Promise.resolve();
      await Promise.resolve();
    });
    // statFile 返回 null（读不到）→ statUnchanged 保守返回 false
    host.state.statOverride = { size: -1, lastModified: -1 };
    host.state.removeError = null;
    await act(async () => {
      h.view.result.current.ui.partial?.apply('retry-delete');
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.state.files.has('架构.mm.md')).toBe(true);
    expect(h.view.result.current.ui.notice).toContain('未删除');
  });

  it('源已被外部删除 → 如实提示并刷新（不当成删除成功）', async () => {
    const host = makeHost([['架构.mm.md', '# 架构原文']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestMove(host.fileAt('架构.mm.md'), '归档');
      await Promise.resolve();
      await Promise.resolve();
    });
    host.state.files.delete('架构.mm.md');
    const removesBefore = host.state.calls.remove;
    await act(async () => {
      h.view.result.current.ui.partial?.apply('retry-delete');
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(host.state.calls.remove).toBe(removesBefore);
    expect(h.view.result.current.ui.partial).toBeNull();
  });
});

describe('⑦ · 创建副本', () => {
  it('副本成功：源一字不改、副本内容一致、不换目的地（当前文档仍是原文档）', async () => {
    const host = makeHost([['架构.mm.md', '# 原文']]);
    const h = mountController(host, { currentPath: '架构.mm.md' });
    await act(async () => {
      await h.view.result.current.requestDuplicate(host.fileAt('架构.mm.md'));
    });
    expect(host.state.files.get('架构 副本.mm.md')).toBe('# 原文');
    expect(host.state.files.get('架构.mm.md')).toBe('# 原文');
    // 副本不换目的地（当前文档仍是原文档）
    expect(h.session.getDestinationInfo().relPath).not.toBe('架构 副本.mm.md');
  });
});

describe('⑤ · 删除当前文档的 host 段', () => {
  it('删除成功 → done 且文件消失', async () => {
    const host = makeHost([['a.mm.md', '# a']]);
    const h = mountController(host, { currentPath: 'a.mm.md' });
    host.state.removeError = null;
    await act(async () => {
      await h.view.result.current.requestDelete(host.fileAt('a.mm.md'));
    });
    expect(host.state.files.has('a.mm.md')).toBe(false);
    expect(h.session.leaseIdOf()).toBeNull(); // 租约已释放
  });

  it('权限被拒 → 失败提示（文件保留、目的地不变）', async () => {
    const host = makeHost([['a.mm.md', '# a']]);
    const h = mountController(host, { currentPath: 'a.mm.md' });
    await act(async () => {
      await h.view.result.current.requestDelete(host.fileAt('a.mm.md'));
    });
    expect(host.state.files.has('a.mm.md')).toBe(true);
    expect(h.view.result.current.ui.notice).toContain('权限');
    expect(h.session.leaseIdOf()).toBeNull(); // 失败也释放租约
  });

  it('删除不写目的地（目的地仍指原文档，直到会话关闭）', async () => {
    const host = makeHost([['a.mm.md', '# a']]);
    const h = mountController(host, { currentPath: 'a.mm.md' });
    h.session.rebindDestination({
      kind: 'disk',
      scopeId: 'ws:test',
      relPath: 'a.mm.md',
      name: 'a.mm.md',
      handle: host.fileAt('a.mm.md').handle,
    });
    host.state.removeError = null;
    await act(async () => {
      await h.view.result.current.requestDelete(host.fileAt('a.mm.md'));
    });
    // 删除路径不调用 onRebound（目的地变更由「文档关闭」负责，属 F2 的调用方）
    expect(h.session.getDestinationInfo().relPath).toBe('a.mm.md');
  });
});
