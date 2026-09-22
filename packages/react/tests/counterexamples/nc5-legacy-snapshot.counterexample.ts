/**
 * NC-5 入口 2：**调用方旧快照逻辑反例**（常态必红，绝不进默认 `vitest run`）。
 *
 * ★不接生产模块的中性化：这里用的是**同一正常实现** + **旧调用方写法**——
 * 演示「旧接口写法本身会丢更新」（调用方在事务外读、预先构造整份记录，
 * 让 mutate 忽略事务内最新 prev）。只由 `test:counterexamples` 显式运行。
 *
 * 保留 `expectThreeUpdates` 原样：与入口 1 / 入口 3 共用**同一正确 oracle**
 * （三条更新全在 + 记录合法 + 唯一 active + 其余 dormant）。
 */
import { expect, it } from 'vitest';
import { installMemoryIndexedDB, resetFixture } from '../helpers/memoryIdb.js';
import {
  emptyRec,
  expectThreeUpdates,
  legalAppend,
  loadTwoInstances,
  makeBarrier,
} from '../helpers/registryConcurrency.js';

// ★G0 勘误：入口 2/3 在 node 环境运行，加载实例前必须安装 v3 内存 IDB 夹具
// （否则会以 `indexedDB is not defined` 之类**环境错误**收场；环境错误不算负控命中）。
installMemoryIndexedDB();
resetFixture();

it('NC-5 反例：旧调用方用事务外旧快照构造 → 必然丢一条更新（常态 AssertionError）', async () => {
  const { A, B } = await loadTwoInstances();
  await A.writeWorkspaceRegistry(() => legalAppend(emptyRec(), 'ws:a', 1), { kind: 'unchanged' });

  const barrier = makeBarrier(2);
  /** 复刻旧接口语义：先在事务外读、构造好整份记录，再只做写入（mutate 忽略事务内最新 prev） */
  const outOfTxAdd = (h: typeof A) => async (id: string): Promise<void> => {
    const prev = await h.readWorkspaceRegistry(); // ← 事务外读（旧快照）
    await barrier(); // ← 受控交错：两侧都读完再写
    const next = legalAppend(prev.kind === 'ok' ? prev.record : emptyRec(), id, 9);
    await h.writeWorkspaceRegistry(() => next, { kind: 'unchanged' }); // ← 已构造好，只写
  };

  await Promise.all([outOfTxAdd(A)('ws:b'), outOfTxAdd(B)('ws:c')]);

  const got = await A.readWorkspaceRegistry();
  expect(got.kind).toBe('ok');
  if (got.kind !== 'ok') throw new Error('unreachable');
  expectThreeUpdates(got.record); // ★ 与入口 1 **同一期望**：这里因缺一条更新而 AssertionError
});
