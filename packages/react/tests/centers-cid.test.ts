/**
 * cid 身份层 react 侧测试（集成人补——原实现 agent 未覆盖 react 层）：
 * - assignCid：next_cid 单调 bump / 数字串容错 / 不可变
 * - ensureNodeCid：已有沿用不 bump / 无则分配写节点 note
 * - collectCenters：cid 优先于 at（at 失效仍命中）、dup cid first-wins + 诊断、
 *   无 cid 旧数据走 at（回归兼容）、cid 锚未命中 → dangling
 */
import { describe, expect, it } from 'vitest';
import { makeTextNode, type Note } from '@mindcanvas/kernel';
import { assignCid, collectCenters, ensureNodeCid } from '../src/render/centers.js';

describe('assignCid：next_cid 单调分配', () => {
  it('缺省从 c1 起；bump 到 2；原 note 不可变', () => {
    const before: Note = { status: 'x' };
    const r = assignCid(before);
    expect(r.cid).toBe('c1');
    expect(r.note.next_cid).toBe(2);
    expect(before.next_cid).toBeUndefined();
    expect(r.note.status).toBe('x');
  });
  it('数字串计数器容错（.mm.md 往返后 "7"）', () => {
    const r = assignCid({ next_cid: '7' } as unknown as Note);
    expect(r.cid).toBe('c7');
    expect(r.note.next_cid).toBe(8);
  });
  it('连续分配不复用', () => {
    const r1 = assignCid(undefined);
    const r2 = assignCid(r1.note);
    expect(r1.cid).toBe('c1');
    expect(r2.cid).toBe('c2');
  });
});

describe('ensureNodeCid：沿用与分配', () => {
  it('节点已有 cid → 沿用且不 bump next_cid', () => {
    const r = ensureNodeCid({ next_cid: 5 }, { cid: 'c3' });
    expect(r.cid).toBe('c3');
    expect(r.allocated).toBe(false);
    expect(r.rootNote.next_cid).toBe(5);
  });
  it('节点无 cid → 分配并写入节点 note + bump', () => {
    const r = ensureNodeCid({ next_cid: 5 }, undefined);
    expect(r.cid).toBe('c5');
    expect(r.allocated).toBe(true);
    expect(r.nodeNote.cid).toBe('c5');
    expect(r.rootNote.next_cid).toBe(6);
  });
});

describe('collectCenters：cid 优先与 dup 诊断', () => {
  function fixture() {
    const root = makeTextNode('根', [makeTextNode('工作'), makeTextNode('生活')]);
    const work = root.children[0]!;
    work.note = { cid: 'c7' };
    return { root, work };
  }

  it('★ cid 优先于 at：at 故意失效，cid 命中仍 well-formed', () => {
    const { root, work } = fixture();
    root.note = {
      centers: [{ cid: 'c7', at: 'node:根/已被改名的旧标题', dir: 'left' }],
    };
    const [c] = collectCenters(root);
    expect(c!.nodeId).toBe(work.id);
    expect(c!.state).toBe('well-formed');
    expect(c!.cid).toBe('c7');
    expect(c!.dir).toBe('left');
  });

  it('重复 cid → first-wins，重复条目丢弃并在首个上记诊断', () => {
    const { root } = fixture();
    root.note = {
      centers: [
        { cid: 'c7', dir: 'left' },
        { cid: 'c7', dir: 'down' },
      ],
    };
    const centers = collectCenters(root);
    expect(centers).toHaveLength(1);
    expect(centers[0]!.dir).toBe('left');
    expect(centers[0]!.diagnostics?.some((d) => d.code === 'dup-cid')).toBe(true);
  });

  it('cid 锚未命中任何节点 → dangling（不崩、不误绑）', () => {
    const { root } = fixture();
    root.note = { centers: [{ cid: 'c99' }] };
    const [c] = collectCenters(root);
    expect(c!.nodeId).toBeNull();
    expect(c!.state).toBe('dangling');
  });

  it('无 cid 旧数据走 at 路径解析（回归兼容）', () => {
    const { root, work } = fixture();
    work.note = undefined; // 旧数据：节点上也没有 cid
    root.note = { centers: [{ at: 'node:根/工作', dir: 'right' }] };
    const [c] = collectCenters(root);
    expect(c!.nodeId).toBe(work.id);
    expect(c!.state).toBe('well-formed');
    expect(c!.cid).toBeUndefined();
  });
});
