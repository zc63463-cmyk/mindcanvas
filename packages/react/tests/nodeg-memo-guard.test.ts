/**
 * NodeG 生产 memo 守卫（批次 B · B-P8，复核追加）
 * ══════════════════════════════════════════════════════════════════════
 * 为什么需要这条：`tests/mapview-pan-memo.test.tsx` 的 `vi.mock` 工厂在计数包装外
 * **自己又包了一层 `memo(Counted)`**，所以它只守护「props 引用稳定」，
 * **守护不到生产侧 memo 是否存在**——复核的阴性对照证实：临时摘掉
 * `NodeG.tsx` 的 `export const NodeG = memo(NodeGImpl)` 后，pan-memo 用例**仍全绿**
 * （将来 memo 被摘 → pan 期静默退回每节点每帧重渲染，无人报警）。
 *
 * 本文件**不含 vi.mock**：直接 import 生产导出的 `NodeG`，断言它是 memo 组件。
 *
 * 阴性对照步骤（改动 `NodeG.tsx` 时必做，两跑一恢复）：
 *   ① 临时把 `export const NodeG = memo(NodeGImpl)` 改成 `export const NodeG = NodeGImpl;`
 *   ② 跑本文件 → **必须变红**（typeof 为 function / `$$typeof` 非 react.memo）
 *   ③ 恢复原状 → 复跑变绿，且 `git diff` 无残留
 */
import { expect, it } from 'vitest';
import { NodeG } from '../src/render/NodeG.js';

const REACT_MEMO = Symbol.for('react.memo');

it('生产导出的 NodeG 是 memo 组件（pan 期零重渲染的前提）', () => {
  expect(typeof NodeG, 'NodeG 应被 memo() 包裹（对象形态）；裸函数组件 = memo 被摘除').toBe('object');
  expect(
    Reflect.get(NodeG, '$$typeof'),
    'NodeG 缺少 react.memo 标记——生产侧 memo 被摘除，pan 期会退回逐帧重渲染',
  ).toBe(REACT_MEMO);
});
