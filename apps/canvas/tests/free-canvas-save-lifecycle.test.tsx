/**
 * 自由画布保存生命周期（SAVE-LIFECYCLE）：`useFreeCanvasDocument` 的判别性回归。
 *
 * 覆盖：
 * 1) 写入等待期间继续编辑 → 完成不清脏；再次保存写最新模型后才清脏；
 * 2) 写入中替换文档（新建/打开/最近/演示）→ 旧会话迟到完成不得清掉新会话的 dirty、
 *    也不得刷「已保存」提示；
 * 3) 句柄失效 → 下载兜底结果与文件写回可判别（`downloaded` ≠ `saved`）；
 * 4) 写入抛错 → dirty 保持 + 失败提示 + saving 回落（无未处理 rejection）。
 *
 * 用真实 `LocalCanvasDocHost` + 可闸门句柄（写入「已开始未完成」窗口可控），
 * 不用 UI 交互（UI 链路见 free-canvas-stage.test.tsx）。
 */
import { act, cleanup, renderHook } from '@testing-library/react';
import { createEmptyDocument } from '@mindcanvas/free-canvas';
import type { FsFileHandle, SaveOutcome } from '@mindcanvas/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalCanvasDocHost } from '../src/canvasDocHost';
import { SAVE_METADATA_WARNING, type SaveCompletion } from '../src/documentLifecycle';
import { useFreeCanvasDocument } from '../src/hooks/useFreeCanvasDocument';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}

/** 可闸门句柄：close() 等到用例 resolve 才算写完（模拟慢盘） */
function makeGatedHandle(name = 'a.mc.canvas.json') {
  const writes: string[] = [];
  const gates: Array<ReturnType<typeof deferred<void>>> = [];
  const handle = {
    name,
    createWritable: async () => ({
      write: async (data: string | Blob) => {
        writes.push(typeof data === 'string' ? data : '<blob>');
      },
      close: async () => {
        const gate = deferred<void>();
        gates.push(gate);
        await gate.promise;
      },
    }),
  } as unknown as FsFileHandle;
  return { handle, writes, gates };
}

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('useFreeCanvasDocument · 保存完成归属', () => {
  it('写入期间继续编辑：完成不清脏；再次保存写最新模型后才清脏', async () => {
    const { handle, writes, gates } = makeGatedHandle();
    const host = new LocalCanvasDocHost();
    const { result } = renderHook(() =>
      useFreeCanvasDocument({ host, initialName: 'a.mc.canvas.json' }),
    );

    act(() => {
      result.current.applyModel(createEmptyDocument('模型 A'), 'a.mc.canvas.json', handle);
    });
    act(() => {
      result.current.updateModel(createEmptyDocument('模型 B'));
    });
    expect(result.current.dirty).toBe(true);

    await act(async () => {
      void result.current.save();
      await flush();
    });
    expect(gates).toHaveLength(1);
    expect(writes[0]).toContain('模型 B');

    // 写入等待期间继续编辑 → C
    act(() => {
      result.current.updateModel(createEmptyDocument('模型 C'));
    });
    await act(async () => {
      gates[0]?.resolve();
      await flush();
    });
    expect(result.current.dirty).toBe(true);

    // 再保存：写的是 C；写完才清脏
    await act(async () => {
      void result.current.save();
      await flush();
    });
    await act(async () => {
      gates[1]?.resolve();
      await flush();
    });
    expect(writes[1]).toContain('模型 C');
    expect(result.current.dirty).toBe(false);
  });

  it('写入中替换文档：旧会话迟到完成不得清掉新会话的 dirty / 覆盖提示', async () => {
    const { handle, gates } = makeGatedHandle();
    const host = new LocalCanvasDocHost();
    const { result } = renderHook(() =>
      useFreeCanvasDocument({ host, initialName: 'old.mc.canvas.json' }),
    );

    act(() => {
      result.current.applyModel(createEmptyDocument('旧文档'), 'old.mc.canvas.json', handle);
    });
    act(() => {
      result.current.updateModel(createEmptyDocument('旧文档编辑'));
    });
    await act(async () => {
      void result.current.save();
      await flush();
    });
    expect(gates).toHaveLength(1);

    // 显式文档替换（打开/新建/最近/演示 → applyModel）：旧会话作废
    act(() => {
      result.current.applyModel(createEmptyDocument('新文档'), 'new.mc.canvas.json', handle);
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.name).toBe('new.mc.canvas.json');

    // 新文档继续编辑 → 脏；旧写入此刻才完成
    act(() => {
      result.current.updateModel(createEmptyDocument('新文档编辑'));
    });
    const noticeBefore = result.current.notice;
    await act(async () => {
      gates[0]?.resolve();
      await flush();
    });

    expect(result.current.dirty).toBe(true);
    expect(result.current.notice).toBe(noticeBefore);
  });

  it('句柄失效 → 下载兜底：结果可判别为 downloaded（不等于 saved）', async () => {
    vi.stubGlobal('URL', {
      createObjectURL: () => 'blob:stub',
      revokeObjectURL: () => {},
    });
    const broken = {
      name: 'b.mc.canvas.json',
      createWritable: async () => {
        throw new Error('handle-revoked');
      },
    } as unknown as FsFileHandle;
    const host = new LocalCanvasDocHost();
    const { result } = renderHook(() =>
      useFreeCanvasDocument({ host, initialName: 'b.mc.canvas.json' }),
    );

    act(() => {
      result.current.applyModel(createEmptyDocument('下载兜底模型'), 'b.mc.canvas.json', broken);
    });
    act(() => {
      result.current.updateModel(createEmptyDocument('下载兜底模型（编辑）'));
    });

    let completion: SaveCompletion | null = null;
    await act(async () => {
      completion = await result.current.save();
    });
    expect(completion).not.toBeNull();
    expect((completion as SaveCompletion | null)?.kind).toBe('downloaded');
    expect(result.current.notice).toContain('已下载 JSON');
    expect(result.current.dirty).toBe(false);
  });

  it('替换文档后旧请求失败 → stale：不覆盖新文档提示、不清新文档 dirty（复核 R2）', async () => {
    const gate = deferred<SaveOutcome>();
    const host = { save: () => gate.promise, remember: vi.fn() } as unknown as LocalCanvasDocHost;
    const { result } = renderHook(() =>
      useFreeCanvasDocument({ host, initialName: 'old.mc.canvas.json' }),
    );

    act(() => {
      result.current.updateModel(createEmptyDocument('旧文档编辑'));
    });
    let completion: Promise<SaveCompletion> | null = null;
    act(() => {
      completion = result.current.save();
    });

    // 显式替换文档 + 新文档提示 + 新文档继续编辑
    act(() => {
      result.current.applyModel(createEmptyDocument('新文档'), 'new.mc.canvas.json');
      result.current.setNotice('新文档提示');
    });
    act(() => {
      result.current.updateModel(createEmptyDocument('新文档编辑'));
    });

    await act(async () => {
      gate.reject(new Error('late disk failure'));
      await completion;
    });

    expect(await completion).toEqual({ kind: 'stale' });
    expect(result.current.notice).toBe('新文档提示');
    expect(result.current.dirty).toBe(true);
  });

  it('waitForIdle / isSaving（包 2 交接）：等当前会话写入；替换后不计旧物理 I/O', async () => {
    const { handle, gates } = makeGatedHandle();
    const host = new LocalCanvasDocHost();
    const { result } = renderHook(() =>
      useFreeCanvasDocument({ host, initialName: 'a.mc.canvas.json' }),
    );

    act(() => {
      result.current.applyModel(createEmptyDocument('模型'), 'a.mc.canvas.json', handle);
    });
    act(() => {
      result.current.updateModel(createEmptyDocument('模型（编辑）'));
    });
    await act(async () => {
      void result.current.save();
      await flush();
    });
    expect(result.current.isSaving()).toBe(true);

    let idle = false;
    const waiting = result.current.waitForIdle().then(() => {
      idle = true;
    });
    await act(async () => {
      await flush();
    });
    expect(idle).toBe(false);

    await act(async () => {
      gates[0]?.resolve();
      await flush();
    });
    await waiting;
    expect(idle).toBe(true);
    expect(result.current.isSaving()).toBe(false);

    // 失效会话语义：替换文档后当前会话立即 idle —— 旧物理 I/O 仍在跑但不阻塞离开判断
    act(() => {
      result.current.updateModel(createEmptyDocument('第二次编辑'));
    });
    await act(async () => {
      void result.current.save();
      await flush();
    });
    expect(result.current.isSaving()).toBe(true);
    act(() => {
      result.current.applyModel(createEmptyDocument('替换后'), 'b.mc.canvas.json', handle);
    });
    expect(result.current.isSaving()).toBe(false);
    await act(async () => {
      await result.current.waitForIdle(); // 立即 resolve
    });
    await act(async () => {
      gates[1]?.resolve();
      await flush();
    });
  });

  it('附属记录失败（remember 抛错）：仍为 saved、dirty 清、提示为附属警告（复核 R4-B）', async () => {
    const { handle, gates } = makeGatedHandle();
    const host = new LocalCanvasDocHost();
    const rememberSpy = vi.spyOn(host, 'remember').mockImplementation((): void => {
      throw new Error('recent-canvas-metadata-failed');
    });
    const { result } = renderHook(() =>
      useFreeCanvasDocument({ host, initialName: 'a.mc.canvas.json' }),
    );

    act(() => {
      result.current.applyModel(createEmptyDocument('模型'), 'a.mc.canvas.json', handle);
    });
    act(() => {
      result.current.updateModel(createEmptyDocument('模型（编辑）'));
    });

    let completion: SaveCompletion | null = null;
    await act(async () => {
      const pending = result.current.save();
      await flush();
      gates[0]?.resolve();
      completion = await pending;
    });

    // 写盘成功 → 结果不降级；dirty 按内容归属正常清除；提示为附属警告
    expect(completion).toEqual({ kind: 'saved', current: true });
    expect(result.current.dirty).toBe(false);
    expect(result.current.notice).toBe(SAVE_METADATA_WARNING);

    rememberSpy.mockRestore();
  });

  it('写入抛错 → 失败提示 + dirty 保持 + saving 回落', async () => {
    const host = {
      save: async () => {
        throw new Error('disk-full');
      },
    } as unknown as LocalCanvasDocHost;
    const { result } = renderHook(() =>
      useFreeCanvasDocument({ host, initialName: 'c.mc.canvas.json' }),
    );
    const savingLog: boolean[] = [];
    act(() => {
      result.current.applyModel(createEmptyDocument('模型'), 'c.mc.canvas.json');
    });
    act(() => {
      result.current.updateModel(createEmptyDocument('模型（编辑）'));
    });
    expect(result.current.saving).toBe(false);
    act(() => {
      void result.current.save();
    });
    savingLog.push(result.current.saving);

    await act(async () => {
      await flush();
    });
    expect(result.current.notice).toBe('保存失败');
    expect(result.current.dirty).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(savingLog).toEqual([true]);
  });
});
