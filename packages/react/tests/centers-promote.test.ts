/**
 * C2：planPromoteCenter 直测（升格链守卫；计划 §1.3 空白补齐）。
 *
 * 升格 = 节点 note.cid（身份）+ root.note.centers（席面）的双写事务：
 * - is-root / not-found 守卫生效（结构化错误，不抛异常）；
 * - 无 cid → 两 op（节点 + root）且 next_cid bump；
 * - 有 cid → 一 op（仅 root）且 next_cid 不 bump（沿用、不重写节点 note）；
 * - pos 传入 → 坐标写入条目（拖拽落点直落）。
 */
import { describe, expect, it } from 'vitest';
import type { EditableNode } from '@mindcanvas/kernel';
import { planPromoteCenter } from '../src/render/centers.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

function fixture() {
  const root = t('总览', [t('工作', [t('项目A')])]);
  const work = root.children[0];
  if (work === undefined) throw new Error('fixture broken: 工作 missing');
  return { root, work };
}

describe('C2 planPromoteCenter 直测', () => {
  it('is-root：文档根不可升格（结构化拒绝）', () => {
    const { root } = fixture();
    const plan = planPromoteCenter(root, root.id);
    expect(plan).toMatchObject({ ok: false, error: { code: 'is-root' } });
  });

  it('not-found：目标不存在（结构化拒绝）', () => {
    const { root } = fixture();
    const plan = planPromoteCenter(root, 'no-such-node');
    expect(plan).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('无 cid：两 op（节点 + root）且 next_cid bump', () => {
    const { root, work } = fixture();
    const plan = planPromoteCenter(root, work.id, { dir: 'up' });
    if (!plan.ok) throw new Error(`red: plan rejected: ${plan.error.code}`);
    expect(plan.cid).toBe('c1');
    expect(plan.ops).toHaveLength(2);
    expect(plan.ops[0]).toMatchObject({
      type: 'update-node',
      id: work.id,
      patch: { note: { cid: 'c1' } },
    });
    expect(plan.ops[1]).toMatchObject({
      type: 'update-node',
      id: root.id,
      patch: {
        note: { next_cid: 2, centers: [{ at: 'node:总览/工作', dir: 'up', cid: 'c1' }] },
      },
    });
  });

  it('有 cid：一 op（仅 root）、不 bump、不重写节点 note', () => {
    const { root, work } = fixture();
    root.note = { next_cid: 7 };
    work.note = { cid: 'c3', status: 'doing' };
    const plan = planPromoteCenter(root, work.id, { dir: 'left' });
    if (!plan.ok) throw new Error(`red: plan rejected: ${plan.error.code}`);
    expect(plan.cid).toBe('c3');
    expect(plan.ops).toHaveLength(1);
    expect(plan.ops[0]).toMatchObject({
      type: 'update-node',
      id: root.id,
      patch: {
        note: { next_cid: 7, centers: [{ at: 'node:总览/工作', dir: 'left', cid: 'c3' }] },
      },
    });
  });

  it('pos 传入：坐标写入条目（拖拽落点直落）', () => {
    const { root, work } = fixture();
    const plan = planPromoteCenter(root, work.id, { pos: { x: 320, y: -40 } });
    if (!plan.ok) throw new Error(`red: plan rejected: ${plan.error.code}`);
    expect(plan.ops[1]).toMatchObject({
      patch: {
        note: { centers: [{ at: 'node:总览/工作', dir: 'right', cid: 'c1', x: 320, y: -40 }] },
      },
    });
  });
});
