// @vitest-environment jsdom
/**
 * P0-A ③：当前文档改名/移动的完整编排（acceptance §3 F1）。
 *
 * 判别核心 —— F1「可观察」逐条：
 *  ① 在途写入期间改名被**拒绝**（`busy-physical`）；尚无在途写入则立即授予；
 *  ③ 租约期间 Ctrl+S 不发起写入（在 file-op-lease.test 已钉；这里钉编排层的拒绝时机）；
 *  ④ 改名成功后**下一次**保存写**新路径**（目的地已重绑）—— R-01 的核心；
 *  ⑤ 新文件内容 = 改名**前**已落盘的内容（I-14 前置的意义）；
 *  ⑥ 内容未再变化时 dirty 清除；
 *  ⑦ 旧路径不再存在。
 *
 * 负控锚点（§3 F1「负控」②④）：
 *  - 移除 `rebindDestination` → 「后续保存不进新文件」必须转红；
 *  - 用「改名前不要求落盘」的实现 → 「新文件内容 = 改名时磁盘内容」必须转红。
 *
 * 夹具：真实 `DocumentSaveSession` + 真实编排 hook + 内存 Fake FS 宿主（实现 `*Safe` 面），
 * 不声称操作系统选择器或真实磁盘（那属 M 层，见回执的人工脚本）。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { useState } from 'react';
import type { FileOpOutcome, FsFileHandle, WorkspaceDir, WorkspaceFile } from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentSaveSession } from '../src/hooks/useDocumentSaveSession';
import {
  FILE_OP_REFUSAL_NOTICE,
  type SafeWorkspaceHost,
  useFileOpOrchestration,
} from '../src/hooks/useFileOpOrchestration';

// ---------------------------------------------------------------- 内存 Fake 工作区

interface Entry {
  name: string;
  content: string;
}

/**
 * 内存工作区：实现编排层需要的 `*Safe` 面。
 *
 * 关键可注入点（对应 §3 F1 的「故障注入」行）：
 *  - `renameDelayMs`：createWritable 延迟（模拟在途写入）；
 *  - `removeError`：删源抛错（制造 partial / busy 时序）。
 */
function makeFakeWorkspace(initial: Entry[]) {
  const files = new Map<string, string>(initial.map((e) => [e.name, e.content]));
  const calls = { rename: 0, move: 0, remove: 0, duplicate: 0, stat: 0 };
  let renameDelayMs = 0;
  let removeError: Error | null = null;

  const handleOf = (name: string): FsFileHandle =>
    ({ name, createWritable: async () => ({ write: async () => {}, close: async () => {} }) }) as FsFileHandle;

  const fileOf = (path: string): WorkspaceFile => ({
    kind: 'file',
    // `path` 是**相对工作区根的完整路径**（含目录），`name` 才是文件名 ——
    // 与真实 `DirectoryWorkspaceHost.createFile` 同口径（`joinPath(dirPath, finalName)`）。
    // 混用二者会让改名后的 relPath 丢掉目录部分，目的地就会重绑到错误位置。
    name: path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path,
    path,
    handle: handleOf(path),
    ts: 1,
    size: (files.get(path) ?? '').length,
  });

  const host: SafeWorkspaceHost & {
    scan(force?: boolean): Promise<unknown[]>;
    setDelay(ms: number): void;
    setRemoveError(e: Error | null): void;
    fileAt(path: string): WorkspaceFile;
    calls: typeof calls;
    files: Map<string, string>;
  } = {
    mounted: true,
    name: 'MyNotes',
    scopeId: 'ws:test',
    calls,
    files,
    scan: async (): Promise<unknown[]> =>
      [...files.keys()].map((p) =>
        p.includes('/')
          ? ({ kind: 'dir', name: p.slice(0, p.indexOf('/')), path: p.slice(0, p.indexOf('/')), children: [fileOf(p)], handle: {} } satisfies WorkspaceDir & { children: unknown[] })
          : fileOf(p),
      ),
    setDelay(ms: number) {
      renameDelayMs = ms;
    },
    setRemoveError(e: Error | null) {
      removeError = e;
    },
    fileAt(path: string): WorkspaceFile {
      return fileOf(path);
    },
    async renameFileSafe(file, newName): Promise<FileOpOutcome<WorkspaceFile>> {
      calls.rename += 1;
      if (renameDelayMs > 0) await new Promise((r) => setTimeout(r, renameDelayMs));
      // 源不在磁盘上 → 读取阶段失败（真实 host 的 `readFile` 会抛 E-NOT-FOUND）
      if (!files.has(file.path)) {
        return { kind: 'failed', stage: 'read', error: { code: 'E-NOT-FOUND', retryable: false } };
      }
      const text = files.get(file.path) ?? '';
      // 改名**保留所在目录**（真实 host 是 `joinPath(parentPath, finalName)`）；
      // 用裸 `newName` 会把嵌套文件挪到根目录 —— 那也是目的地的落点。
      const parent = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : '';
      const next = parent === '' ? newName : `${parent}/${newName}`;
      // 同名已存在 → 不覆盖（UI 走冲突三选）；这里保持原语语义
      if (files.has(next)) {
        return { kind: 'failed', stage: 'write', error: { code: 'E-EXISTS', retryable: true } };
      }
      files.set(next, text);
      if (removeError !== null) {
        calls.remove += 1;
        return { kind: 'partial', created: fileOf(next), sourceRetained: true, error: { code: 'E-PERMISSION', retryable: true } };
      }
      files.delete(file.path);
      return { kind: 'ok', value: fileOf(next) };
    },
    async moveFileSafe(file, targetDir): Promise<FileOpOutcome<WorkspaceFile>> {
      calls.move += 1;
      const text = files.get(file.path) ?? '';
      const next = targetDir === '' ? file.name : `${targetDir}/${file.name}`;
      files.set(next, text);
      if (removeError !== null) {
        calls.remove += 1;
        return { kind: 'partial', created: fileOf(next), sourceRetained: true, error: { code: 'E-PERMISSION', retryable: true } };
      }
      files.delete(file.path);
      return { kind: 'ok', value: fileOf(next) };
    },
    async removeFileSafe(file): Promise<FileOpOutcome<null>> {
      calls.remove += 1;
      if (removeError !== null) {
        return { kind: 'failed', stage: 'delete', error: { code: 'E-PERMISSION', retryable: true } };
      }
      files.delete(file.path);
      return { kind: 'ok', value: null };
    },
    async removeDirSafe(dir: WorkspaceDir): Promise<FileOpOutcome<null>> {
      calls.remove += 1;
      for (const key of [...files.keys()]) {
        if (key === dir.path || key.startsWith(`${dir.path}/`)) files.delete(key);
      }
      return { kind: 'ok', value: null };
    },
    async duplicateFileSafe(file): Promise<FileOpOutcome<WorkspaceFile>> {
      calls.duplicate += 1;
      const text = files.get(file.path) ?? '';
      const base = file.name.replace(/\.mm\.md$/, '');
      const copy = `${base} 副本.mm.md`;
      files.set(copy, text);
      return { kind: 'ok', value: fileOf(copy) };
    },
    async statFile(file) {
      calls.stat += 1;
      if (!files.has(file.path)) return null;
      return { size: (files.get(file.path) ?? '').length, lastModified: 1 };
    },
    async resolveCopyName(_dirPath, name) {
      return files.has(name) ? `${name.replace(/\.mm\.md$/, '')} 2.mm.md` : name;
    },
  };
  return host;
}

/** 编排 hook 的挂载夹具：真实 session + 真实 orchestration + 可控 doc 状态 */
function mountOrchestration(host: SafeWorkspaceHost, overrides?: {
  durable?: boolean;
  current?: boolean;
  dirty?: boolean;
}) {
  const session = new DocumentSaveSession({ readContent: () => null });
  const notices: string[] = [];
  const rebound: string[] = [];
  let afterRelease = 0;
  const state = {
    durable: overrides?.durable ?? true,
    current: overrides?.current ?? true,
    dirty: overrides?.dirty ?? false,
  };
  const view = renderHook(() => {
    const [, setTick] = useState(0);
    void setTick;
    return useFileOpOrchestration({
      session,
      host,
      readDoc: () => ({ ...state }),
      // 注意：本回调**不**自己重绑目的地 —— 重绑是编排层（`useFileOpOrchestration.finish`）
      // 的职责。生产接线里 Stage 只在这里同步 `doc.handle` 与 `workspacePath`（三落点中的两个），
      // 会话目的地那一路由编排层直接调用 `session.rebindDestination`。
      // 这样「目的地是否真的换到新路径」才是被实现保护的事实（NC3 的可转红点）。
      onRebound: (file) => {
        rebound.push(file.path);
      },
      onAfterRelease: () => {
        afterRelease += 1;
      },
      onNotice: (msg) => notices.push(msg),
    });
  });
  return {
    view,
    session,
    notices,
    rebound,
    state,
    afterReleaseCount: () => afterRelease,
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

describe('F1 · 当前文档改名编排', () => {
  it('① 无在途写入 → 租约立即授予，改名成功且旧路径不再存在', async () => {
    const host = makeFakeWorkspace([{ name: '研发/架构.mm.md', content: '# 架构正文' }]);
    const h = mountOrchestration(host);
    const result = await h.view.result.current.renameCurrent(host.fileAt('研发/架构.mm.md'), '架构设计.mm.md');
    expect(result.kind).toBe('done');
    expect(result.kind === 'done' ? result.relPath : null).toBe('研发/架构设计.mm.md');
    // ⑦ 旧路径不再存在
    expect(host.files.has('研发/架构.mm.md')).toBe(false);
    expect(host.files.has('研发/架构设计.mm.md')).toBe(true);
  });

  it('★④ 改名后目的地重绑到新路径（R-01 核心）', async () => {
    const host = makeFakeWorkspace([{ name: '架构.mm.md', content: '# 正文' }]);
    const h = mountOrchestration(host);
    await h.view.result.current.renameCurrent(host.fileAt('架构.mm.md'), '架构设计.mm.md');
    expect(h.rebound).toEqual(['架构设计.mm.md']);
    // 目的地已换：后续保存不会写回旧名字
    const info = h.session.getDestinationInfo();
    expect(info.relPath).toBe('架构设计.mm.md');
    expect(info.name).toBe('架构设计.mm.md');
    expect(h.session.getDestination()?.name).toBe('架构设计.mm.md');
  });

  it('★F1 负控①：目的地**必须**由编排层重绑（不是靠 Stage 顺手做的）', async () => {
    // 这条是本负控的可转红点：把编排层 `finish` 里的 `session.rebindDestination`
    // 去掉后，下面的断言必须失败（旧实现 R-01 = 目的地仍指旧句柄）。
    // 关键：夹具的 `onRebound` **不**自己重绑 —— 那样断言就只能观察到夹具行为，
    // 实现被中性化也不会转红（第一轮 NC3 实测 exit 0 就是这个原因）。
    const host = makeFakeWorkspace([{ name: '架构.mm.md', content: '# 正文' }]);
    const h = mountOrchestration(host);
    await h.view.result.current.renameCurrent(host.fileAt('架构.mm.md'), '架构设计.mm.md');
    // 会话目的地已换：后续保存不会写回旧名字
    const info = h.session.getDestinationInfo();
    expect(info.kind).toBe('disk');
    expect(info.relPath).toBe('架构设计.mm.md');
    expect(info.name).toBe('架构设计.mm.md');
    expect(h.session.getDestination()?.name).toBe('架构设计.mm.md');
  });

  it('★⑤ 新文件内容 = 改名时的磁盘内容（I-14 前置的意义）', async () => {
    const host = makeFakeWorkspace([{ name: '架构.mm.md', content: '# 已落盘的旧内容' }]);
    const h = mountOrchestration(host);
    await h.view.result.current.renameCurrent(host.fileAt('架构.mm.md'), '新名.mm.md');
    // rename 复制的是磁盘快照，故新文件内容 = 改名前的磁盘内容
    expect(host.files.get('新名.mm.md')).toBe('# 已落盘的旧内容');
  });

  it('★I-14 前置：未落盘（durable=false）→ 拒绝，零 I/O', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host, { durable: false });
    const result = await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    expect(result.kind).toBe('refused');
    expect(result.kind === 'refused' ? result.reason : null).toBe('not-durable');
    expect(host.calls.rename).toBe(0); // 零 I/O
    expect(h.notices).toContain(FILE_OP_REFUSAL_NOTICE['not-durable']);
  });

  it('★I-14 前置：磁盘是旧快照（current=false）→ 同样拒绝', async () => {
    // 「saved 但内容又变过」= 磁盘上是旧快照；此时改名会把旧内容带到新文件
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# 旧快照' }]);
    const h = mountOrchestration(host, { current: false });
    const result = await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    expect(result.kind === 'refused' ? result.reason : null).toBe('not-durable');
    expect(host.calls.rename).toBe(0);
  });

  it('★① 在途物理写 → busy-physical 拒绝（文案精确，零 I/O）', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host);
    // 制造在途物理写（用真实 session 的 submit）
    const gate = (() => {
      let resolve!: (v: { result: 'fs'; handle: FsFileHandle }) => void;
      const promise = new Promise<{ result: 'fs'; handle: FsFileHandle }>((ok) => {
        resolve = ok;
      });
      return { promise, resolve };
    })();
    const pending = h.session.submit({
      intent: 'auto',
      capture: () => ({ source: '# x', content: {} }),
      write: () => gate.promise,
      commit: () => {},
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(h.session.physicalWritesInFlight).toBe(1);

    const result = await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    expect(result.kind === 'refused' ? result.reason : null).toBe('busy-physical');
    expect(h.notices).toContain(FILE_OP_REFUSAL_NOTICE['busy-physical']);
    expect(host.calls.rename).toBe(0); // 零副作用

    await act(async () => {
      gate.resolve({ result: 'fs', handle: { name: 'a.mm.md' } as FsFileHandle });
      await pending;
    });
  });

  it('★已有租约 → busy-lease 拒绝', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host);
    h.session.beginExclusiveOp('delete', { scopeId: 'ws:test', relPath: 'a.mm.md' });
    const result = await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    expect(result.kind === 'refused' ? result.reason : null).toBe('busy-lease');
    expect(h.notices).toContain(FILE_OP_REFUSAL_NOTICE['busy-lease']);
    expect(host.calls.rename).toBe(0);
  });

  it('租约在操作结束后被释放（不泄漏互斥）', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host);
    const ok = await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    expect(ok.kind).toBe('done');
    expect(h.session.leaseIdOf()).toBeNull();
    // 可再次取租约（没有泄漏）
    expect(h.session.beginExclusiveOp('rename').kind).toBe('granted');
  });

  it('失败路径也释放租约（不把互斥留在原地）', async () => {
    const host = makeFakeWorkspace([]); // 源不存在 → lookup 返回 null
    const h = mountOrchestration(host);
    // 源不在文件表里 → 读取阶段 E-NOT-FOUND（与真实 host 的 readFile 抛错同口径）
    const result = await h.view.result.current.renameCurrent(host.fileAt('不存在.mm.md'), 'b.mm.md');
    expect(result.kind).toBe('failed');
    expect(result.kind === 'failed' ? result.code : null).toBe('E-NOT-FOUND');
    expect(h.session.leaseIdOf()).toBeNull();
  });

  it('仅大小写差异 → 拒绝（不静默加序号）', async () => {
    const host = makeFakeWorkspace([{ name: 'Note.mm.md', content: '# n' }]);
    const h = mountOrchestration(host);
    const result = await h.view.result.current.renameCurrent(host.fileAt('Note.mm.md'), 'note.mm.md');
    expect(result.kind === 'refused' ? result.reason : null).toBe('case-only');
    expect(host.calls.rename).toBe(0);
    expect(h.notices[0]).toBe(FILE_OP_REFUSAL_NOTICE['case-only']);
  });

  it('与源同名 → 零 I/O 静默取消（不打扰用户）', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host);
    const result = await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'a.mm.md');
    expect(result.kind === 'refused' ? result.reason : null).toBe('same-name');
    expect(host.calls.rename).toBe(0);
    expect(h.notices).toHaveLength(0); // 静默：不弹任何东西
  });

  it('非法名（空 / 含分隔符）→ 拒绝并提示', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host);
    expect(
      (await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), '   ')).kind === 'refused',
    ).toBe(true);
    expect(
      (await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'x/y.mm.md')).kind === 'refused',
    ).toBe(true);
    expect(host.calls.rename).toBe(0);
    expect(h.notices).toContain(FILE_OP_REFUSAL_NOTICE['invalid-name']);
  });

  it('⑥⑦ 改名成功后若仍 dirty → 释放后补写一次（内容不丢）', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host, { dirty: true });
    await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    // 租约期间编辑过 → 释放后补写（写新目的地）
    expect(h.afterReleaseCount()).toBe(1);
  });

  it('改名成功后不 dirty → 不补写（避免无谓写入）', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host, { dirty: false });
    await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    expect(h.afterReleaseCount()).toBe(0);
  });

  it('★host 未挂载 → 拒绝且零 I/O', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    (host as { mounted: boolean }).mounted = false;
    const h = mountOrchestration(host);
    const result = await h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    expect(result.kind === 'refused' ? result.reason : null).toBe('host-unmounted');
    expect(host.calls.rename).toBe(0);
  });
});

describe('F1 · 当前文档移动编排', () => {
  it('移动成功后目的地重绑到新目录路径', async () => {
    const host = makeFakeWorkspace([{ name: '架构.mm.md', content: '# 架构' }]);
    const h = mountOrchestration(host);
    const file = {
      kind: 'file' as const,
      name: '架构.mm.md',
      path: '架构.mm.md',
      handle: { name: '架构.mm.md' } as FsFileHandle,
      ts: 1,
      size: 4,
    };
    const result = await h.view.result.current.moveCurrent(file, '归档');
    expect(result.kind).toBe('done');
    expect(h.rebound).toEqual(['归档/架构.mm.md']);
    expect(h.session.getDestinationInfo().relPath).toBe('归档/架构.mm.md');
    expect(host.files.has('架构.mm.md')).toBe(false);
    expect(host.files.get('归档/架构.mm.md')).toBe('# 架构');
  });

  it('移动同样受 I-14 前置约束', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host, { durable: false });
    const file = {
      kind: 'file' as const,
      name: 'a.mm.md',
      path: 'a.mm.md',
      handle: { name: 'a.mm.md' } as FsFileHandle,
      ts: 1,
      size: 3,
    };
    const result = await h.view.result.current.moveCurrent(file, '归档');
    expect(result.kind === 'refused' ? result.reason : null).toBe('not-durable');
    expect(host.calls.move).toBe(0);
  });

  it('移动到同一目录 → 零操作（不制造无用副本）', async () => {
    const host = makeFakeWorkspace([{ name: '归档/a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host);
    const file = {
      kind: 'file' as const,
      name: 'a.mm.md',
      path: '归档/a.mm.md',
      handle: { name: 'a.mm.md' } as FsFileHandle,
      ts: 1,
      size: 3,
    };
    const result = await h.view.result.current.moveCurrent(file, '归档');
    expect(result.kind).toBe('refused');
    expect(host.calls.move).toBe(0);
  });
});

describe('★F1 · 会话被替换后的迟到回调（L2 第②条）', () => {
  it('host 操作期间切文档 → 归属复核失败，零重绑（不写旧文档也不写新文档）', async () => {
    const host = makeFakeWorkspace([{ name: 'a.mm.md', content: '# a' }]);
    const h = mountOrchestration(host);
    host.setDelay(50);
    const pending = h.view.result.current.renameCurrent(host.fileAt('a.mm.md'), 'b.mm.md');
    // 操作在途时替换会话（模拟用户切到另一篇文档）
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      h.session.beginDocument({ name: 'other.mm.md' } as FsFileHandle);
      await vi.advanceTimersByTimeAsync(100);
    });
    const result = await pending;
    expect(result.kind).toBe('refused');
    expect(result.kind === 'refused' ? result.reason : null).toBe('session-replaced');
    // 零重绑：目的地没有被旧操作的迟到回调改写
    expect(h.rebound).toHaveLength(0);
  });
});
