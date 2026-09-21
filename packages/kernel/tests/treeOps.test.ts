import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import {
  addChild,
  astToEditable,
  collectRefs,
  depthOf,
  duplicateNode,
  editableToAst,
  findNode,
  getNode,
  isInSubtree,
  makeEntityNode,
  makeTextNode,
  moveNode,
  nodeByPath,
  pathOf,
  removeNode,
  searchNodes,
  updateNode,
} from '../src/tree/treeOps.js';
import { History } from '../src/tree/history.js';

function buildTree() {
  return astToEditable(parseMm('# 根\n## A\n- 甲\n- @issue:1\n## B\n- 乙').root!)!;
}

describe('treeOps：AST ⇄ Editable 转换', () => {
  it('astToEditable/editableToAst round-trip 保持结构', () => {
    const text = '# 根\n## A\n- @issue:1\n  - 子\n- ![](a.png)';
    const ast = parseMm(text).root!;
    const editable = astToEditable(ast)!;
    expect(editableToAst(editable)).toEqual(ast);
  });

  it('每个节点拥有唯一 id', () => {
    const root = buildTree();
    const ids: string[] = [];
    const walk = (n: typeof root): void => {
      ids.push(n.id);
      n.children.forEach(walk);
    };
    walk(root);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('treeOps：增删改', () => {
  it('addChild 末尾/指定位置', () => {
    const root = buildTree();
    const branchA = root.children[0];
    const next = addChild(root, branchA.id, makeTextNode('新节点'));
    expect(getNode(next, branchA.id)!.children.map((c) => c.text)).toContain('新节点');
    const next2 = addChild(root, branchA.id, makeTextNode('插队'), 0);
    expect(getNode(next2, branchA.id)!.children[0].text).toBe('插队');
  });

  it('removeNode 删除并保持兄弟；根不可删', () => {
    const root = buildTree();
    const branchA = root.children[0];
    const item甲 = branchA.children[0];
    const { root: r1, removed } = removeNode(root, item甲.id);
    expect(removed).toBe(true);
    const remaining = getNode(r1, branchA.id)!.children;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].type).toBe('entity');
    expect(remaining[0].ref).toEqual({ kind: 'issue', id: '1' });
    const { removed: rootRemoved } = removeNode(root, root.id);
    expect(rootRemoved).toBe(false);
  });

  it('updateNode 改名与设置笔记', () => {
    const root = buildTree();
    const branchB = root.children[1];
    const next = updateNode(root, branchB.id, { text: 'B改' });
    expect(next.children[1].text).toBe('B改');
    const next2 = updateNode(next, branchB.id, { note: { one_liner: 'x' } });
    expect(next2.children[1].note?.one_liner).toBe('x');
  });
});

describe('treeOps：移动与环防护', () => {
  it('moveNode：换父（挂到 B 下）', () => {
    const root = buildTree();
    const branchA = root.children[0];
    const branchB = root.children[1];
    const item甲 = branchA.children[0];
    const { root: moved, moved: ok } = moveNode(root, item甲.id, branchB.id, 0);
    expect(ok).toBe(true);
    expect(getNode(moved, branchB.id)!.children[0].text).toBe('甲');
    expect(getNode(moved, branchA.id)!.children.length).toBe(1);
  });

  it('moveNode：拒绝移入自己的子树', () => {
    const root = buildTree();
    const branchA = root.children[0];
    const item甲 = branchA.children[0];
    const { moved, reason } = moveNode(root, branchA.id, item甲.id, 0);
    expect(moved).toBe(false);
    expect(reason).toContain('子树');
  });

  it('moveNode：拒绝移动根', () => {
    const root = buildTree();
    const { moved } = moveNode(root, root.id, root.children[0].id, 0);
    expect(moved).toBe(false);
  });

  it('moveNode：深度超限拒绝', () => {
    // 满深链 D(1)→L2..L6(6)→i7..i16(16) + 兄弟分支 Z(带子节点)
    const lines = ['# D'];
    for (let d = 2; d <= 6; d++) lines.push(`${'#'.repeat(d)} L${d}`);
    for (let d = 7; d <= 16; d++) lines.push(`${' '.repeat((d - 7) * 2)}- i${d}`);
    lines.push('## Z');
    lines.push('- z1');
    const root = astToEditable(parseMm(lines.join('\n')).root!)!;
    const z = root.children[1];
    expect(depthOf(root, z.id)).toBe(2);
    let i16 = root.children[0];
    while (depthOf(root, i16.id) < 16) i16 = i16.children[0];
    expect(depthOf(root, i16.id)).toBe(16);
    // Z（高度 2）挂到 i16（深度 16）下 → 16+2 > 16 拒绝
    const res = moveNode(root, z.id, i16.id, 0);
    expect(res.moved).toBe(false);
    expect(res.reason).toContain('深度');
    // 挂到 i15（深度 15）下 → 15+2 = 17 > 16 仍拒绝；i14 → 16 ≤ 16 允许
    const i15 = findNode(root, i16.id)!.parent;
    const i14 = findNode(root, i15.id)!.parent;
    expect(moveNode(root, z.id, i15.id, 0).moved).toBe(false);
    expect(moveNode(root, z.id, i14.id, 0).moved).toBe(true);
  });

  it('isInSubtree 判定', () => {
    const root = buildTree();
    const branchA = root.children[0];
    const item甲 = branchA.children[0];
    expect(isInSubtree(root, branchA.id, item甲.id)).toBe(true);
    expect(isInSubtree(root, root.children[1].id, item甲.id)).toBe(false);
  });
});

describe('treeOps：引用收集', () => {
  it('collectRefs 前序保留重复', () => {
    const root = astToEditable(parseMm('# R\n- @issue:1\n## B\n- @issue:1\n- @doc:a.md').root!)!;
    expect(collectRefs(root)).toEqual([
      { kind: 'issue', id: '1' },
      { kind: 'issue', id: '1' },
      { kind: 'doc', id: 'a.md' },
    ]);
  });
});

describe('History', () => {
  it('push/undo/redo 序列与分支截断', () => {
    const h = new History<number>(1);
    h.push(2);
    h.push(3);
    expect(h.current).toBe(3);
    expect(h.undo()).toBe(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(null);
    expect(h.redo()).toBe(2);
    h.push(9); // 截断 redo（原 3）
    expect(h.redo()).toBe(null);
    expect(h.current).toBe(9);
    expect(h.canUndo()).toBe(true);
  });

  it('reset 清空历史', () => {
    const h = new History<string>('a');
    h.push('b');
    h.reset('c');
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
    expect(h.current).toBe('c');
  });
});

describe('treeOps：make 工厂', () => {
  it('makeEntityNode 复制 ref 防共享', () => {
    const ref = { kind: 'issue', id: '7' };
    const n = makeEntityNode(ref);
    ref.id = 'mutated';
    expect(n.ref?.id).toBe('7');
    const t = makeTextNode('x');
    expect(t.type).toBe('text');
  });
});

describe('treeOps：duplicateNode 复制子树', () => {
  it('整棵复制（含子节点/实体引用），插到原节点之后，id 全部全新', () => {
    const root = buildTree(); // 根> A[甲, @issue:1], B[乙]
    const branchA = root.children[0];
    const beforeIds: string[] = [];
    const collect = (n: typeof root): void => {
      beforeIds.push(n.id);
      n.children.forEach(collect);
    };
    collect(root);
    const { root: next, insertedId } = duplicateNode(root, branchA.id);
    expect(insertedId).toBeTruthy();
    const loc = findNode(next, insertedId!)!;
    expect(loc.parent.id).toBe(root.id);
    expect(loc.index).toBe(1); // A 之后、B 之前
    const copy = loc.node;
    expect(copy.text).toBe('A');
    expect(copy.children).toHaveLength(2);
    expect(copy.children[1].type).toBe('entity');
    expect(copy.children[1].ref).toEqual({ kind: 'issue', id: '1' });
    const copyIds: string[] = [];
    const walk = (n: typeof copy): void => {
      copyIds.push(n.id);
      n.children.forEach(walk);
    };
    walk(copy);
    expect(new Set(copyIds).size).toBe(copyIds.length);
    expect(copyIds.some((id) => beforeIds.includes(id))).toBe(false);
    // 结构 round-trip 与源一致
    expect(editableToAst(copy)).toEqual(editableToAst(branchA));
  });

  it('复制带 note 的节点保留笔记', () => {
    const root = buildTree();
    const branchB = root.children[1];
    const withNote = updateNode(root, branchB.id, { note: { one_liner: '备注' } });
    const { root: next, insertedId } = duplicateNode(withNote, branchB.id);
    expect(getNode(next, insertedId!)!.note).toEqual({ one_liner: '备注' });
  });

  it('根不可复制 → insertedId = null', () => {
    const root = buildTree();
    expect(duplicateNode(root, root.id).insertedId).toBeNull();
  });

  it('不存在的 id → noop（root 引用不变）', () => {
    const root = buildTree();
    const res = duplicateNode(root, 'missing-id');
    expect(res.insertedId).toBeNull();
    expect(res.root).toBe(root);
  });
});

describe('treeOps：searchNodes 查找定位', () => {
  it('按文本子串匹配（忽略大小写），前序返回 id', () => {
    const root = astToEditable(
      parseMm('# 根\n## Alpha\n- 贝塔\n- @issue:1\n## 阿尔法\n- 丙').root!,
    )!;
    const ids = searchNodes(root, 'alpha');
    expect(ids).toHaveLength(1);
    expect(getNode(root, ids[0])?.text).toBe('Alpha');
  });

  it('匹配实体引用（kind:id 子串）', () => {
    const root = buildTree(); // 含 @issue:1
    const ids = searchNodes(root, 'issue:1');
    expect(ids).toHaveLength(1);
    expect(getNode(root, ids[0])?.type).toBe('entity');
  });

  it('空查询 / 无匹配 → 空数组', () => {
    const root = buildTree();
    expect(searchNodes(root, '   ')).toEqual([]);
    expect(searchNodes(root, '不存在')).toEqual([]);
  });
});

describe('treeOps：pathOf / nodeByPath 折叠持久化路径', () => {
  it('pathOf 返回根到节点的子索引链；root 为 []；不存在为 null', () => {
    const root = buildTree(); // 根 > A[甲, @issue:1], B[乙]
    expect(pathOf(root, root.id)).toEqual([]);
    expect(pathOf(root, root.children[0]!.id)).toEqual([0]);
    expect(pathOf(root, root.children[0]!.children[1]!.id)).toEqual([0, 1]);
    expect(pathOf(root, root.children[1]!.id)).toEqual([1]);
    expect(pathOf(root, 'missing')).toBeNull();
  });

  it('nodeByPath 解析索引链；越界/负索引/深层缺失 → null', () => {
    const root = buildTree();
    expect(nodeByPath(root, [])?.id).toBe(root.id);
    expect(nodeByPath(root, [1])?.id).toBe(root.children[1]!.id);
    expect(nodeByPath(root, [0, 1])?.ref).toEqual({ kind: 'issue', id: '1' });
    expect(nodeByPath(root, [99])).toBeNull();
    expect(nodeByPath(root, [-1])).toBeNull();
    expect(nodeByPath(root, [0, 5])).toBeNull();
  });

  it('pathOf ⇄ nodeByPath 互逆（每层节点往返一致）', () => {
    const root = buildTree();
    const ids: string[] = [];
    const walk = (n: typeof root): void => {
      ids.push(n.id);
      n.children.forEach(walk);
    };
    walk(root);
    for (const id of ids) {
      const via = nodeByPath(root, pathOf(root, id)!);
      expect(via).not.toBeNull();
      expect(via!.id).toBe(id);
    }
  });
});
