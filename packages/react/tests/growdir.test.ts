/**
 * D1′ note.dir 协议层测试（growDir.ts 纯函数）：
 * readGrowDir 校验与诊断 / effectiveGrowDir 继承链 / collectExplicitDir 全树收集 /
 * upsertGrowDir 不可变写回 / probeDirRoundTrip 序列化往返。
 */
import { describe, expect, it } from 'vitest';
import { makeTextNode, type Note } from '@mindcanvas/kernel';
import {
  collectDeclaredGrowDir,
  collectExplicitDir,
  effectiveGrowDir,
  probeDirRoundTrip,
  readGrowDir,
  summarizeGrowDirDiagnostics,
  upsertGrowDir,
  type GrowDirDiagnostic,
} from '../src/render/growDir.js';

describe('readGrowDir：读取与校验', () => {
  it('无 note / 无 dir → null（未声明）', () => {
    expect(readGrowDir(undefined)).toBeNull();
    expect(readGrowDir({})).toBeNull();
  });
  it('合法四向 → 返回原值', () => {
    for (const d of ['left', 'right', 'up', 'down'] as const) {
      expect(readGrowDir({ dir: d })).toBe(d);
    }
  });
  it('非法值 → null + 诊断（非四向/数字/对象）', () => {
    const diags: GrowDirDiagnostic[] = [];
    expect(readGrowDir({ dir: 'north' }, 'n1', diags)).toBeNull();
    expect(readGrowDir({ dir: 3 }, 'n2', diags)).toBeNull();
    expect(diags).toHaveLength(2);
    expect(diags[0]!.code).toBe('grow-dir-invalid');
    expect(diags[0]!.nodeId).toBe('n1');
    expect(summarizeGrowDirDiagnostics(diags)).toContain('north');
  });
});

describe('effectiveGrowDir：继承链', () => {
  it('自身显式优先于祖先与岛方向', () => {
    const node = makeTextNode('子');
    node.note = { dir: 'left' };
    const parent = makeTextNode('父');
    parent.note = { dir: 'down' };
    expect(effectiveGrowDir(node, [parent], 'right')).toBe('left');
  });
  it('自身无声明 → 最近显式祖先；全无 → islandDir', () => {
    const node = makeTextNode('子');
    const parent = makeTextNode('父');
    parent.note = { dir: 'up' };
    const grand = makeTextNode('祖');
    grand.note = { dir: 'down' };
    expect(effectiveGrowDir(node, [parent, grand], 'right')).toBe('up');
    expect(effectiveGrowDir(node, [], 'down')).toBe('down');
  });
});

describe('collectExplicitDir：全树收集', () => {
  it('合法声明进映射；非法进诊断不进映射', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    root.children[0]!.note = { dir: 'left' };
    root.children[1]!.note = { dir: 'bogus' };
    const { dirByNodeId, diagnostics } = collectExplicitDir(root);
    expect(dirByNodeId.get(root.children[0]!.id)).toBe('left');
    expect(dirByNodeId.has(root.children[1]!.id)).toBe(false);
    expect(diagnostics).toHaveLength(1);
  });
});

describe('upsertGrowDir：不可变写回', () => {
  it('写入 dir；原 note 不被修改', () => {
    const before: Note = { status: 'keep' };
    const after = upsertGrowDir(before, 'left');
    expect(after.dir).toBe('left');
    expect(after.status).toBe('keep');
    expect(before.dir).toBeUndefined();
  });
  it('dir=null → 删除 dir 键（继承语义，不残留 null）', () => {
    const after = upsertGrowDir({ dir: 'left', status: 'x' }, null);
    expect('dir' in after).toBe(false);
    expect(after.status).toBe('x');
  });
  it('非法 dir → 不写', () => {
    const before: Note = { dir: 'right' };
    // 运行期非法值（JSON.parse 产出 any，规避类型层）——读侧语义：不写、原样返回
    const after = upsertGrowDir(before, JSON.parse('"north"'));
    expect(after.dir).toBe('right');
  });
});

describe('probeDirRoundTrip：序列化往返探针', () => {
  it('四向 note.dir 经 parse→serialize→parse 保持', () => {
    for (const d of ['left', 'right', 'up', 'down'] as const) {
      const r = probeDirRoundTrip(d);
      expect(r.ok).toBe(true);
      expect(r.before).toBe(d);
      expect(r.after).toBe(d);
    }
  });
});

describe('collectDeclaredGrowDir：全树声明方向（岛默认不得充当声明——中心节点特化）', () => {
  it('★ 全树无声明 → 映射为空（连线回退几何自适应，不被岛方向顶死左右）', () => {
    const root = makeTextNode('根', [makeTextNode('A'), makeTextNode('B')]);
    const m = collectDeclaredGrowDir(root);
    expect(m.size).toBe(0);
    expect(m.has(root.id)).toBe(false);
    expect(m.has(root.children[0]!.id)).toBe(false);
    expect(m.has(root.children[1]!.id)).toBe(false);
  });

  it('★ 显式声明入表；其无声明子节点继承父方向（内核 case② 同语义）', () => {
    const root = makeTextNode('根', [
      { ...makeTextNode('A', [makeTextNode('A1')]), note: { dir: 'up' } },
      makeTextNode('B'),
    ]);
    const m = collectDeclaredGrowDir(root);
    const aIn = root.children[0]!;
    expect(m.get(aIn.id)).toBe('up');
    expect(m.get(aIn.children[0]!.id)).toBe('up'); // 无声明子节点随显式父
    expect(m.has(root.id)).toBe(false);
    expect(m.has(root.children[1]!.id)).toBe(false); // 隔离分支不受染
  });

  it('最近显式祖先沿链继承；隔离分支保持缺席', () => {
    const b = makeTextNode('B', [makeTextNode('B1', [makeTextNode('B1a')])]);
    b.note = { dir: 'left' };
    const c = makeTextNode('C', [makeTextNode('C1')]);
    const root = makeTextNode('根', [b, c]);
    const m = collectDeclaredGrowDir(root);
    expect(m.get(b.id)).toBe('left');
    expect(m.get(b.children[0]!.id)).toBe('left');
    expect(m.get(b.children[0]!.children[0]!.id)).toBe('left');
    expect(m.has(c.id)).toBe(false);
    expect(m.has(c.children[0]!.id)).toBe(false);
  });
});
