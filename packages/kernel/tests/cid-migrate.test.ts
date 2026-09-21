/**
 * cid 双轨迁移（C2 anchor-migrate）。
 *
 * 覆盖：
 * - 带 cid 的 center 条目在节点改名后，按 cid 身份重建 at 提示（at 被刷新，cid 不变）；
 * - 无 cid 旧数据走 nodeId 路径匹配（行为不变）；
 * - cid 在迁移后树中丢失 → dangling-kept（保留原值，不阻断无关编辑）。
 */
import { describe, expect, it } from 'vitest';
import { planReferenceMigration, type AnchorRef } from '../src/registry/anchor-migrate.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function node(id: string, text: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text, children };
}

/** before：工作(id=w) 持 cid c7，根为 it */
function beforeTree(): EditableNode {
  const work: EditableNode = {
    id: 'w',
    type: 'text',
    text: '工作',
    note: { cid: 'c7' },
    children: [node('a', '项目A')],
  };
  return {
    id: 'root',
    type: 'text',
    text: '总览',
    note: { centers: [{ at: 'node:总览/工作', cid: 'c7', dir: 'right' }] },
    children: [work, node('l', '生活')],
  };
}

/** after：工作 改名为 工作X（同 id=w），cid 随节点保留 */
function afterRename(): EditableNode {
  const work: EditableNode = {
    id: 'w',
    type: 'text',
    text: '工作X',
    note: { cid: 'c7' },
    children: [node('a', '项目A')],
  };
  return {
    id: 'root',
    type: 'text',
    text: '总览',
    note: { centers: [{ at: 'node:总览/工作', cid: 'c7', dir: 'right' }] },
    children: [work, node('l', '生活')],
  };
}

describe('cid 双轨迁移', () => {
  it('★ 改名后：按 cid 身份重建 at 提示（at 刷新、cid 不变）', () => {
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'centers[0].at', anchor: 'node:总览/工作', cid: 'c7' },
    ];
    const plan = planReferenceMigration(beforeTree(), afterRename(), refs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]).toEqual({
      noteKey: 'root',
      field: 'centers[0].at',
      from: 'node:总览/工作',
      to: 'node:总览/工作X',
    });
  });

  it('无 cid 旧数据：仍按 nodeId 路径匹配迁移（行为不变）', () => {
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'centers[0].at', anchor: 'node:总览/工作' },
    ];
    const plan = planReferenceMigration(beforeTree(), afterRename(), refs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates[0]!.to).toBe('node:总览/工作X');
  });

  it('cid 在迁移前树中不存在（文件损坏）→ dangling-kept（保留原值，不阻断）', () => {
    // before 中节点 w 根本没有 note.cid（center 引用了一个不存在的 cid）
    const beforeNoCid: EditableNode = {
      id: 'root',
      type: 'text',
      text: '总览',
      note: { centers: [{ at: 'node:总览/工作', cid: 'c7', dir: 'right' }] },
      children: [
        { id: 'w', type: 'text', text: '工作', children: [node('a', '项目A')] },
        node('l', '生活'),
      ],
    };
    const refs: AnchorRef[] = [
      { noteKey: 'root', field: 'centers[0].at', anchor: 'node:总览/工作', cid: 'c7' },
    ];
    const plan = planReferenceMigration(beforeNoCid, afterRename(), refs);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates).toHaveLength(0);
    expect(plan.diagnostics.some((d) => d.code === 'dangling-kept')).toBe(true);
  });
});
