/**
 * 锚引用迁移（plan 工作包 A2，design §5）纯函数测试：
 * - T17：改名/移动中心及其祖先节点时，centers.at / center_pos.at / edges 两端 /
 *   links[].to / groups[].members 的路径锚同步迁移（nodeId 稳定 → 新文本路径 → 回解析验证）
 * - T18：同名歧义拒绝提交（整批拒绝）、旧 dangling 保留 + 诊断、实体锚不被动
 * 全部输入输出为纯数据；before/after 由 applyOp 生成（同一会话 nodeId 稳定）。
 */
import { describe, expect, it } from 'vitest';
import { applyOp } from '../src/tree/tree-op.js';
import {
  planReferenceMigration,
  type AnchorRef,
} from '../src/registry/anchor-migrate.js';
import { resolveLinkAnchor } from '../src/registry/note-anchor.js';
import type { EditableNode } from '../src/tree/treeOps.js';

/** 固定树：总览 → [工作(任务A), 生活]，note 上挂 centers/center_pos/edges/groups，p 上挂 links */
function makeTree(): EditableNode {
  return {
    id: 'root',
    type: 'text',
    text: '总览',
    note: {
      centers: [{ at: 'node:总览/工作/任务A', x: 10, y: 20 }],
      center_pos: [{ at: 'node:总览/工作/任务A', x: 99, y: 98 }],
      edges: [{ from: 'node:总览/工作', to: 'node:总览/生活', source: 'manual' }],
      groups: [{ id: 'g1', members: ['node:总览/工作'] }],
    },
    children: [
      {
        id: 'p',
        type: 'text',
        text: '工作',
        note: { links: [{ rel: 'relates-to', to: 'node:总览/生活' }] },
        children: [{ id: 'c', type: 'text', text: '任务A', children: [] }],
      },
      { id: 'q', type: 'text', text: '生活', children: [] },
    ],
  };
}

/** T17 标准受影响锚清单（调用方从 note 键展开；field 定位串透传） */
function t17Refs(): AnchorRef[] {
  return [
    { noteKey: 'root', field: 'centers[0].at', anchor: 'node:总览/工作/任务A' },
    { noteKey: 'root', field: 'center_pos[0].at', anchor: 'node:总览/工作/任务A' },
    { noteKey: 'root', field: 'edges[0].from', anchor: 'node:总览/工作' },
    { noteKey: 'root', field: 'edges[0].to', anchor: 'node:总览/生活' },
    { noteKey: 'p', field: 'links[0].to', anchor: 'node:总览/生活' },
    { noteKey: 'root', field: 'groups[g1].members[0]', anchor: 'node:总览/工作' },
  ];
}

describe('T17：改名/移动时锚引用同步迁移', () => {
  it('改名中心祖先节点：centers.at / center_pos.at / edges.from / groups.members 迁移；未动锚不进 updates', () => {
    const before = makeTree();
    const after = applyOp(before, { type: 'update-node', id: 'p', patch: { text: '工作2' } });
    const plan = planReferenceMigration(before, after, t17Refs());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byField = new Map(plan.updates.map((u) => [u.field, u]));
    expect(byField.get('centers[0].at')).toEqual({
      noteKey: 'root',
      field: 'centers[0].at',
      from: 'node:总览/工作/任务A',
      to: 'node:总览/工作2/任务A',
    });
    expect(byField.get('center_pos[0].at')?.to).toBe('node:总览/工作2/任务A');
    expect(byField.get('edges[0].from')?.to).toBe('node:总览/工作2');
    expect(byField.get('groups[g1].members[0]')?.to).toBe('node:总览/工作2');
    // 未受影响锚（生活）不出现在 updates
    expect(byField.has('edges[0].to')).toBe(false);
    expect(byField.has('links[0].to')).toBe(false);
    // 新锚在 after 上回解析：well-formed 且指向同一 nodeId（端到端验证）
    const res = resolveLinkAnchor(after, { kind: 'node', target: '总览/工作2/任务A' });
    expect(res.state).toBe('well-formed');
    expect(res.nodeId).toBe('c');
  });

  it('移动整棵分支（中心及其祖先一起动）：路径整体迁移到新父链', () => {
    const before = makeTree();
    const after = applyOp(before, {
      type: 'move-node',
      id: 'p',
      targetParentId: 'q',
      index: 0,
    });
    const plan = planReferenceMigration(before, after, t17Refs());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byField = new Map(plan.updates.map((u) => [u.field, u]));
    expect(byField.get('centers[0].at')?.to).toBe('node:总览/生活/工作/任务A');
    expect(byField.get('center_pos[0].at')?.to).toBe('node:总览/生活/工作/任务A');
    expect(byField.get('edges[0].from')?.to).toBe('node:总览/生活/工作');
    expect(byField.get('groups[g1].members[0]')?.to).toBe('node:总览/生活/工作');
    const res = resolveLinkAnchor(after, { kind: 'node', target: '总览/生活/工作/任务A' });
    expect(res.state).toBe('well-formed');
    expect(res.nodeId).toBe('c');
  });

  it('改名中心自身：centers.at / center_pos.at 迁移到新名', () => {
    const before = makeTree();
    const after = applyOp(before, { type: 'update-node', id: 'c', patch: { text: '任务B' } });
    const plan = planReferenceMigration(before, after, t17Refs());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const byField = new Map(plan.updates.map((u) => [u.field, u]));
    expect(byField.get('centers[0].at')?.to).toBe('node:总览/工作/任务B');
    expect(byField.get('center_pos[0].at')?.to).toBe('node:总览/工作/任务B');
  });
});

describe('T18：歧义拒绝 / dangling 保留 / 实体锚不动', () => {
  it('T18a：本次操作新增同名歧义 → 结构化冲突，整批拒绝', () => {
    const before = makeTree();
    const after = applyOp(before, {
      type: 'add-child',
      parentId: 'p',
      child: { id: 'dupe', type: 'text', text: '任务A', children: [] },
    });
    const plan = planReferenceMigration(before, after, t17Refs());
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    // centers.at 与 center_pos.at 是两条同锚引用，各报一条冲突
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.conflicts[0]).toEqual(
      expect.objectContaining({
        code: 'anchor-ambiguous-path',
        noteKey: 'root',
        field: 'centers[0].at',
        anchor: 'node:总览/工作/任务A',
        nodeId: 'c',
      }),
    );
    expect(plan.conflicts[1]).toEqual(
      expect.objectContaining({ code: 'anchor-ambiguous-path', field: 'center_pos[0].at' }),
    );
    // 整批拒绝：ok:false 分支不产出 updates（类型上该分支即无此字段）
    expect('updates' in plan).toBe(false);
  });

  it('T18b：旧文件已有 dangling 锚 → 保留 + 诊断，不阻断无关编辑', () => {
    const before = makeTree();
    const after = applyOp(before, { type: 'update-node', id: 'q', patch: { text: '生活2' } });
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'centers[0].at', anchor: 'node:总览/不存在' },
      { noteKey: 'root', field: 'edges[0].to', anchor: 'node:总览/生活' },
    ];
    const plan = planReferenceMigration(before, after, refs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // dangling 不阻断：无关锚正常迁移
    expect(plan.updates).toEqual([
      expect.objectContaining({ field: 'edges[0].to', to: 'node:总览/生活2' }),
    ]);
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({
        code: 'dangling-kept',
        field: 'centers[0].at',
        anchor: 'node:总览/不存在',
      }),
    ]);
  });

  it('T18c：纯实体锚（kind:id）原样保留；实体节点锚未动不产生 updates', () => {
    const before = makeTree();
    // p 下挂一个实体节点 e（@issue:88）
    const withEntity = applyOp(before, {
      type: 'add-child',
      parentId: 'p',
      child: { id: 'e', type: 'entity', ref: { kind: 'issue', id: '88' }, children: [] },
    });
    const after = applyOp(withEntity, { type: 'update-node', id: 'p', patch: { text: '工作2' } });
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'links[9].to', anchor: 'issue:88' },
      { noteKey: 'root', field: 'edges[1].from', anchor: '@issue:88' },
    ];
    const plan = planReferenceMigration(withEntity, after, refs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 纯实体锚（issue:88）不指向树节点：不出 updates、不出 diagnostics
    expect(plan.updates.find((u) => u.field === 'links[9].to')).toBeUndefined();
    expect(plan.diagnostics.find((d) => d.field === 'links[9].to')).toBeUndefined();
    // 实体节点锚 @issue:88 与路径无关（实体节点移动/祖先改名不影响）→ 锚文本不变 → 不进 updates
    expect(plan.updates.find((u) => u.field === 'edges[1].from')).toBeUndefined();
  });

  it('T18d：实体节点多重出现 #N 消歧：前序重复消除后 #2 → 裸锚迁移', () => {
    const before = makeTree();
    const two = applyOp(before, {
      type: 'add-child',
      parentId: 'p',
      child: { id: 'e1', type: 'entity', ref: { kind: 'issue', id: '88' }, children: [] },
    });
    const withTwo = applyOp(two, {
      type: 'add-child',
      parentId: 'p',
      child: { id: 'e2', type: 'entity', ref: { kind: 'issue', id: '88' }, children: [] },
    });
    // after：清除第一个实体的 ref（降级为 text）→ @issue:88 只剩 e2（原 #2）
    const after = applyOp(withTwo, {
      type: 'update-node',
      id: 'e1',
      patch: { type: 'text', ref: undefined },
    });
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'edges[1].from', anchor: '@issue:88#2' },
    ];
    const plan = planReferenceMigration(withTwo, after, refs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates).toEqual([
      expect.objectContaining({
        field: 'edges[1].from',
        from: '@issue:88#2',
        to: '@issue:88',
      }),
    ]);
  });

  it('T18e：节点名含斜杠 → 新路径不可唯一表示，冲突阻断', () => {
    const before = makeTree();
    const after = applyOp(before, { type: 'update-node', id: 'c', patch: { text: '任/务' } });
    const plan = planReferenceMigration(before, after, t17Refs());
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.conflicts[0]).toEqual(
      expect.objectContaining({ code: 'anchor-name-contains-slash', nodeId: 'c' }),
    );
  });

  it('T18f：目标被清空为无名节点 → 冲突阻断（透明空节点不可寻址）', () => {
    const before = makeTree();
    const after = applyOp(before, { type: 'update-node', id: 'c', patch: { text: '' } });
    const plan = planReferenceMigration(before, after, t17Refs());
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.conflicts[0]).toEqual(
      expect.objectContaining({ code: 'anchor-target-unnamed', nodeId: 'c' }),
    );
  });

  it('T18g：before 上已存在的歧义锚 → 保留 + 诊断（非本次操作新增，不阻断）', () => {
    const base = makeTree();
    const withDupe = applyOp(base, {
      type: 'add-child',
      parentId: 'p',
      child: { id: 'dupe', type: 'text', text: '任务A', children: [] },
    });
    // before 已歧义，after 不再改动歧义路径
    const after = applyOp(withDupe, { type: 'update-node', id: 'q', patch: { text: '生活2' } });
    const plan = planReferenceMigration(withDupe, after, t17Refs());
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates.find((u) => u.field === 'centers[0].at')).toBeUndefined();
    // centers.at 与 center_pos.at 是两条同锚引用，各产出一条诊断
    expect(plan.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'pre-existing-ambiguous', field: 'centers[0].at' }),
        expect.objectContaining({ code: 'pre-existing-ambiguous', field: 'center_pos[0].at' }),
      ]),
    );
  });

  it('T18h：多冲突聚合：一条歧义 + 一条斜杠同时报告，整批拒绝', () => {
    const before = makeTree();
    let after = applyOp(before, {
      type: 'add-child',
      parentId: 'p',
      child: { id: 'dupe', type: 'text', text: '任务A', children: [] },
    });
    after = applyOp(after, { type: 'update-node', id: 'q', patch: { text: '生/活' } });
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'centers[0].at', anchor: 'node:总览/工作/任务A' },
      { noteKey: 'root', field: 'edges[0].to', anchor: 'node:总览/生活' },
    ];
    const plan = planReferenceMigration(before, after, refs);
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.conflicts).toHaveLength(2);
    expect(plan.conflicts.map((c) => c.code).sort()).toEqual([
      'anchor-ambiguous-path',
      'anchor-name-contains-slash',
    ]);
  });
});

describe('T17-s · sections[].root 锚迁移（v1.5.0 Phase 1）', () => {
  /** before/after：工作 → 职场（id/cid 不变）；sections 双形态锚挂根 note */
  function makeSecTree(workName: string): EditableNode {
    return {
      id: 'root',
      type: 'text',
      text: '总览',
      note: {
        sections: [
          { id: 'sec_p', root: 'node:总览/工作' },
          { id: 'sec_c', root: 'cid:c-work' },
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
      ],
    };
  }

  it('node: 路径锚随改名迁移重建；cid 锚原样保留（不进 updates）', () => {
    const before = makeSecTree('工作');
    const after = makeSecTree('职场');
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'sections[0].root', anchor: 'node:总览/工作' },
      { noteKey: 'root', field: 'sections[1].root', anchor: 'cid:c-work' },
    ];
    const plan = planReferenceMigration(before, after, refs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 仅 sections[0].root 产出更新：node:总览/工作 → node:总览/职场
    expect(plan.updates).toEqual([
      { noteKey: 'root', field: 'sections[0].root', from: 'node:总览/工作', to: 'node:总览/职场' },
    ]);
    // cid 锚无更新（身份稳定，保留即正确）；且无 dangling 诊断
    expect(plan.updates.find((u) => u.field === 'sections[1].root')).toBeUndefined();
    expect(plan.diagnostics.filter((d) => d.field === 'sections[1].root')).toEqual([]);
  });
});

describe('R2-0：tolerateMissingTargets（目标被删 → 降级诊断而非冲突）', () => {
  /** 夹具：三个注定丢失的引用（cid / 路径锚 / 实体锚）+ 一个正常迁移引用 */
  function makeDoomedTree(): EditableNode {
    return {
      id: 'root',
      type: 'text',
      text: '总览',
      note: {
        centers: [{ at: 'node:总览/宿命', x: 1, y: 2 }],
        edges: [
          { from: 'node:总览/工作', to: 'node:总览/宿命', rel: 'relates-to' }, // 路径锚 → 目标被删
          { from: 'node:总览/工作', to: '@issue:8', rel: 'relates-to' }, // 实体锚 → 目标被删
          { from: 'node:总览/工作', to: 'node:总览/生活', rel: 'relates-to' }, // 正常：无变化
        ],
      },
      children: [
        { id: 'p', type: 'text', text: '工作', children: [] },
        { id: 'q', type: 'text', text: '生活', children: [] },
        { id: 'x', type: 'text', text: '宿命', note: { cid: 'cid-x' }, children: [] },
        { id: 'e', type: 'entity', ref: { kind: 'issue', id: '8' }, children: [] },
      ],
    };
  }

  function makeAfter(): EditableNode {
    let after = applyOp(makeDoomedTree(), { type: 'remove-node', id: 'x' });
    after = applyOp(after, { type: 'remove-node', id: 'e' });
    after = applyOp(after, { type: 'update-node', id: 'p', patch: { text: '工作2' } });
    return after;
  }

  function doomedRefs(): AnchorRef[] {
    return [
      { noteKey: 'root', field: 'centers[0].at', anchor: 'node:总览/宿命', cid: 'cid-x' },
      { noteKey: 'root', field: 'edges[0].to', anchor: 'node:总览/宿命' },
      { noteKey: 'root', field: 'edges[1].to', anchor: '@issue:8' },
      { noteKey: 'root', field: 'edges[0].from', anchor: 'node:总览/工作' },
      { noteKey: 'root', field: 'edges[2].to', anchor: 'node:总览/生活' },
    ];
  }

  it('tolerate:true → ok:true，三个丢失引用产 target-lost-kept 诊断、其余照常迁移', () => {
    const plan = planReferenceMigration(makeDoomedTree(), makeAfter(), doomedRefs(), {
      tolerateMissingTargets: true,
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // 三个被删目标的引用 → target-lost-kept 诊断（cid/路径/实体三个分支都覆盖）
    const kept = plan.diagnostics.filter((d) => d.code === 'target-lost-kept');
    expect(kept).toHaveLength(3);
    expect(kept.map((d) => d.field).sort()).toEqual([
      'centers[0].at',
      'edges[0].to',
      'edges[1].to',
    ]);
    // 保留原值 → 无对应 updates
    expect(plan.updates.find((u) => u.field === 'edges[0].to')).toBeUndefined();
    expect(plan.updates.find((u) => u.field === 'edges[1].to')).toBeUndefined();
    expect(plan.updates.find((u) => u.field === 'centers[0].at')).toBeUndefined();
    // 其余引用照常迁移：工作 → 工作2
    expect(plan.updates).toEqual([
      { noteKey: 'root', field: 'edges[0].from', from: 'node:总览/工作', to: 'node:总览/工作2' },
    ]);
  });

  it('缺省（不带选项）→ ok:false + target-lost 冲突（默认语义逐位不变）', () => {
    const plan = planReferenceMigration(makeDoomedTree(), makeAfter(), doomedRefs());
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.conflicts.map((c) => c.code)).toEqual(['target-lost', 'target-lost', 'target-lost']);
  });
});
