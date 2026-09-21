/**
 * T2 · sections 锚解析三态 + W-SECTION-DANGLING 诊断（v1.5.0 Phase 1）。
 *
 * 关键断言：
 * - cid 锚写入优先：改名后 cid root 仍 well-formed（身份稳定），node: root 变 dangling
 * - dangling/stale 只产出诊断，元数据保留（D3：绝不静默删除）
 * -  cid 索引一次预建多条复用（性能形态，不靠重复全树扫描）
 */
import { describe, expect, it } from 'vitest';
import {
  W_SECTION_DANGLING,
  collectSectionDiagnostics,
  resolveSections,
} from '../src/registry/section-anchor.js';
import type { EditableNode } from '../src/tree/treeOps.js';

/** 固定树：总览 → [工作(cid=c-work, 子 任务A), 生活]；sections 挂根 note */
function makeTree(workName = '工作'): EditableNode {
  return {
    id: 'root',
    type: 'text',
    text: '总览',
    note: {
      sections: [
        { id: 'sec_cid', title: 'CID 锚', color: 'blue', root: 'cid:c-work' },
        { id: 'sec_path', title: '路径锚', root: `node:总览/${workName}` },
        { id: 'sec_lost', title: '失效锚', root: 'cid:c-ghost' },
        { id: 'sec_amb', title: '歧义锚', root: 'node:总览/同名' },
        { id: 'sec_bad', title: '非法锚', root: '没有冒号的锚' },
      ],
    },
    children: [
      {
        id: 'p',
        type: 'text',
        text: workName,
        note: { cid: 'c-work' },
        children: [{ id: 'c', type: 'text', text: '任务A', children: [] }],
      },
      { id: 'q', type: 'text', text: '生活', children: [] },
      { id: 'd1', type: 'text', text: '同名', children: [] },
      { id: 'd2', type: 'text', text: '同名', children: [] },
    ],
  };
}

describe('T2 · resolveSections 三态解析', () => {
  it('cid 锚与 node: 路径锚均 well-formed，rootId 指向同一节点', () => {
    const rs = resolveSections(makeTree());
    const byId = new Map(rs.map((r) => [r.spec.id, r]));
    expect(byId.get('sec_cid')).toMatchObject({ state: 'well-formed', rootId: 'p' });
    expect(byId.get('sec_path')).toMatchObject({ state: 'well-formed', rootId: 'p' });
  });

  it('cid 未命中 → dangling(cid-not-found)；同名歧义 → stale；无冒号 → stale(unparsable)', () => {
    const rs = resolveSections(makeTree());
    const byId = new Map(rs.map((r) => [r.spec.id, r]));
    expect(byId.get('sec_lost')).toMatchObject({ state: 'dangling', reason: 'cid-not-found' });
    expect(byId.get('sec_lost')!.rootId).toBeUndefined();
    expect(byId.get('sec_amb')).toMatchObject({ state: 'stale' });
    expect(byId.get('sec_bad')).toMatchObject({ state: 'stale', reason: 'unparsable-anchor' });
  });

  it('无 sections → 空清单（零开销短路）', () => {
    const bare: EditableNode = { id: 'r', type: 'text', text: '孤根', children: [] };
    expect(resolveSections(bare)).toEqual([]);
  });

  it('改名场景：cid root 仍 well-formed（身份稳定）；node: root 退化为 dangling', () => {
    const renamed = makeTree('职场'); // 工作 → 职场，id 与 cid 不变
    // 锚文本保持改名前原样（真实场景：文档里的锚不会随节点改名自动更新）
    const secs = renamed.note?.sections;
    if (Array.isArray(secs) && typeof secs[1] === 'object' && secs[1] !== null) {
      (secs[1] as { root: string }).root = 'node:总览/工作';
    }
    const rs = resolveSections(renamed);
    const byId = new Map(rs.map((r) => [r.spec.id, r]));
    expect(byId.get('sec_cid')).toMatchObject({ state: 'well-formed', rootId: 'p' });
    expect(byId.get('sec_path')).toMatchObject({ state: 'dangling' });
  });
});

describe('T2 · W-SECTION-DANGLING 诊断', () => {
  it('非 well-formed 逐条产出诊断；well-formed 不产出；措辞区分 dangling/stale', () => {
    const rs = resolveSections(makeTree());
    const diags = collectSectionDiagnostics(rs);
    // sec_lost(dangling) + sec_amb(stale) + sec_bad(stale) = 3 条
    expect(diags).toHaveLength(3);
    expect(diags.every((d) => d.code === W_SECTION_DANGLING)).toBe(true);
    const lost = diags.find((d) => d.sectionId === 'sec_lost')!;
    expect(lost.message).toContain('失效锚');
    expect(lost.message).toContain('失效');
    const amb = diags.find((d) => d.sectionId === 'sec_amb')!;
    expect(amb.message).toContain('歧义');
  });

  it('全部 well-formed → 零诊断', () => {
    const tree = makeTree();
    tree.note = {
      sections: [{ id: 'sec_ok', root: 'cid:c-work' }],
    };
    expect(collectSectionDiagnostics(resolveSections(tree))).toEqual([]);
  });
});
