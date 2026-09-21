/**
 * `note.frame` 协议访问器（子树框编辑 · FO-A1 读写 + FO-A2 相对深度 / 嵌套 / 钳制）。
 *
 * 规格：`docs/specs/2026-09-15-subtree-frame-outline-design.md` §3.1（字段形状）、
 * §3.2（D1 深度语义）、§3.3（嵌套纪律：大纲层拒、挂载层允）
 * 计划：`docs/superpowers/plans/2026-09-15-subtree-frame-outline.md` Task 1 / Task 2
 *
 * 口径（读侧严格、写侧校验）：
 *  - `version` 必须严格 `=== 1`；`depth` 为有限整数且 ≥ 1；否则 `frameOf` 返回 undefined；
 *  - **读侧不认 ≠ 丢弃**：note 里的原值仍原样透传（见「原值不丢」用例）；
 *  - 写入非法 depth 直接抛 `invalid frame depth`（设计 §8「写时校验拒绝」）；
 *  - 相对深度**一律以框根为 0**（禁用 `depthOf`——它从文档根计且 root=1）；
 *  - 嵌套以**最近成框祖先**为准（设计 §3.3）：`1 ≤ d ≤ D` 拒（大纲层内），`d > D` 允（挂载层）。
 */
import { describe, expect, it } from 'vitest';
import {
  canCreateFrame,
  clampFrameDepth,
  clearFrame,
  frameOf,
  normalizeFrameDepth,
  relativeDepth,
  setFrame,
  subtreeMaxRelativeDepth,
} from '../src/protocol/frame.js';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';
import type { Note } from '../src/protocol/types.js';
import { makeTextNode } from '../src/tree/treeOps.js';

/**
 * 敌意输入构造：`Note.frame` 在类型上是强类型 `FrameSpec`，而读侧容错要接受的恰是
 * **盘上来的任意形态原值**（手写 YAML / 旧版本 / 未来版本）。测试经宽形状注入，
 * 断言对象与计划 Task 1 逐条一致，只是绕开静态类型（非「断言宽松」而是「模拟脏数据」）。
 */
function looseNote(fields: Record<string, unknown>): Note {
  return fields as unknown as Note;
}

describe('frameOf / setFrame / clearFrame', () => {
  it('缺省无 frame', () => {
    expect(frameOf(undefined)).toBeUndefined();
    expect(frameOf({})).toBeUndefined();
  });

  it('读合法 frame', () => {
    expect(frameOf({ frame: { version: 1, depth: 2 } })).toEqual({ version: 1, depth: 2 });
  });

  it('非法 depth / version 读侧忽略', () => {
    expect(frameOf(looseNote({ frame: { version: 1, depth: 0 } }))).toBeUndefined();
    expect(frameOf(looseNote({ frame: { version: 2, depth: 2 } }))).toBeUndefined();
    expect(frameOf(looseNote({ frame: { version: 1, depth: 1.5 } }))).toBeUndefined();
    expect(frameOf(looseNote({ frame: 'x' }))).toBeUndefined();
  });

  it('setFrame 写入；clearFrame 删除', () => {
    const n = setFrame({ desc: 'keep' }, 3);
    expect(n.frame).toEqual({ version: 1, depth: 3 });
    expect(n.desc).toBe('keep');
    const cleared = clearFrame(n);
    expect(cleared?.frame).toBeUndefined();
    expect(cleared?.desc).toBe('keep');
  });

  it('normalizeFrameDepth', () => {
    expect(normalizeFrameDepth(2)).toBe(2);
    expect(normalizeFrameDepth(0)).toBeUndefined();
    expect(normalizeFrameDepth(-1)).toBeUndefined();
    expect(normalizeFrameDepth(1.2)).toBeUndefined();
    expect(normalizeFrameDepth('2')).toBeUndefined();
  });
});

describe('frameOf 读侧容错（不认非法形态，但原值不丢）', () => {
  it('null / 非对象 / 缺 depth / 非有限整数一律 undefined', () => {
    expect(frameOf(null)).toBeUndefined();
    expect(frameOf(looseNote({ frame: { version: 1 } }))).toBeUndefined();
    expect(frameOf(looseNote({ frame: { version: 1, depth: Number.NaN } }))).toBeUndefined();
    expect(
      frameOf(looseNote({ frame: { version: 1, depth: Number.POSITIVE_INFINITY } })),
    ).toBeUndefined();
    expect(frameOf(looseNote({ frame: { version: 1, depth: -2 } }))).toBeUndefined();
    expect(frameOf(looseNote({ frame: ['version', 1] }))).toBeUndefined();
  });

  it('读侧不修改 note：非法 frame 原值透传保留', () => {
    const note = looseNote({ frame: { version: 2, depth: 0 } });
    expect(frameOf(note)).toBeUndefined();
    expect(note.frame).toEqual({ version: 2, depth: 0 });
  });
});

describe('setFrame / clearFrame 边界', () => {
  it('setFrame 对非法 depth 抛 Error("invalid frame depth")', () => {
    expect(() => setFrame({}, 0)).toThrow('invalid frame depth');
    expect(() => setFrame(undefined, 1.5)).toThrow('invalid frame depth');
    expect(() => setFrame({}, Number.NaN)).toThrow('invalid frame depth');
    expect(() => setFrame({}, Number.NEGATIVE_INFINITY)).toThrow('invalid frame depth');
  });

  it('setFrame 不可变：不改传入 note；无 note 亦可成框', () => {
    const base: Note = { desc: 'keep' };
    const next = setFrame(base, 2);
    expect(base.frame).toBeUndefined();
    expect(next).not.toBe(base);
    expect(next.desc).toBe('keep');
    expect(setFrame(undefined, 1).frame).toEqual({ version: 1, depth: 1 });
  });

  it('clearFrame：undefined 透传；无 frame 时其它键不动', () => {
    expect(clearFrame(undefined)).toBeUndefined();
    expect(clearFrame({ desc: 'keep' })).toEqual({ desc: 'keep' });
  });

  it('clearFrame：非法形态的 frame 键一并删除（拆框 = 删键）', () => {
    expect(clearFrame(looseNote({ frame: 'x', desc: 'keep' }))).toEqual({ desc: 'keep' });
    expect(clearFrame(looseNote({ frame: { version: 2, depth: 0 } }))).toEqual({});
  });

  it('normalizeFrameDepth：非 number 形态一律 undefined', () => {
    expect(normalizeFrameDepth(8)).toBe(8);
    expect(normalizeFrameDepth(Number.NaN)).toBeUndefined();
    expect(normalizeFrameDepth(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(normalizeFrameDepth(null)).toBeUndefined();
    expect(normalizeFrameDepth(true)).toBeUndefined();
    expect(normalizeFrameDepth(undefined)).toBeUndefined();
  });
});

describe('note.frame 落盘往返（透传纪律；零 parser/serializer 改动）', () => {
  it('setFrame 写入 → serialize → parse 读回同值，且二次序列化字节稳定', () => {
    const root = makeTextNode('根');
    root.note = setFrame(undefined, 2);
    const text = serializeMm(root);
    expect(text).toMatch(/frame:/);
    const back = parseMm(text).root;
    if (back === null) throw new Error('解析失败：root 缺失');
    expect(frameOf(back.note)).toEqual({ version: 1, depth: 2 });
    expect(serializeMm(back)).toBe(text);
  });

  it('手写块形态：透传不丢，但不认作框（块内标量读回为字符串，等同旧客户端忽略）', () => {
    const root1 = parseMm('<!--\nframe:\n  version: 1\n  depth: 2\n-->\n# 根').root;
    if (root1 === null) throw new Error('解析失败：root 缺失');
    const raw1: unknown = root1.note?.frame;
    expect(raw1).toEqual({ version: '1', depth: '2' });
    expect(frameOf(root1.note)).toBeUndefined();
    // 键值仍在：写侧把对象值规范化为内联 JSON，重解析仍是同一份内容（无数据丢失）
    const back = parseMm(serializeMm(root1)).root;
    if (back === null) throw new Error('解析失败：root 缺失');
    expect(back.note?.frame).toEqual(raw1);
  });
});

// ── FO-A2：相对深度（框根 = 0）/ 子树高度 / 嵌套许可 / 深度钳制 ────────────────

describe('relativeDepth / subtreeMaxRelativeDepth', () => {
  // 计划 Task 2 夹具：root → mid → leaf，另有兄弟 side
  const leaf = makeTextNode('leaf');
  const mid = makeTextNode('mid', [leaf]);
  const side = makeTextNode('side');
  const root = makeTextNode('root', [mid, side]);

  it('框根 = 0，逐层 +1；不在子树内（含祖先方向）→ null', () => {
    expect(relativeDepth(root, root.id)).toBe(0);
    expect(relativeDepth(root, mid.id)).toBe(1);
    expect(relativeDepth(root, leaf.id)).toBe(2);
    expect(relativeDepth(root, side.id)).toBe(1);
    expect(relativeDepth(mid, root.id)).toBeNull();
    expect(relativeDepth(mid, side.id)).toBeNull();
    expect(relativeDepth(root, 'nd-missing')).toBeNull();
  });

  it('subtreeMaxRelativeDepth：最深后代；叶子（仅自身）→ 0', () => {
    expect(subtreeMaxRelativeDepth(root)).toBe(2);
    expect(subtreeMaxRelativeDepth(mid)).toBe(1);
    expect(subtreeMaxRelativeDepth(leaf)).toBe(0);
    expect(subtreeMaxRelativeDepth(side)).toBe(0);
  });
});

describe('canCreateFrame：嵌套纪律（设计 §3.3）', () => {
  const leaf = makeTextNode('leaf');
  const mid = makeTextNode('mid', [leaf]);
  const side = makeTextNode('side');
  const root = makeTextNode('root', [mid, side]);

  it('候选不在树内 → not-found', () => {
    expect(canCreateFrame(root, 'nd-missing')).toEqual({ ok: false, reason: 'not-found' });
  });

  it('无成框祖先 → 允许（含框根自身）', () => {
    expect(canCreateFrame(root, root.id)).toEqual({ ok: true });
    expect(canCreateFrame(root, mid.id)).toEqual({ ok: true });
  });

  it('depth=1：子在大纲层拒绝（d=1 ≤ D），孙在挂载层允许（d=2 > D）', () => {
    const doc = {
      ...root,
      note: setFrame(root.note, 1),
      children: [{ ...mid, children: [leaf] }, side],
    };
    // 大纲层：1 ≤ d ≤ D → 拒（side 同样 d=1，规格 §3.3 无例外）
    expect(canCreateFrame(doc, mid.id)).toEqual({ ok: false, reason: 'inside-ancestor-outline' });
    expect(canCreateFrame(doc, side.id)).toEqual({ ok: false, reason: 'inside-ancestor-outline' });
    // 挂载层：d > D → 允
    expect(canCreateFrame(doc, leaf.id)).toEqual({ ok: true });
  });

  it('depth=2：孙在大纲层拒绝（d=2 ≤ D），曾孙在挂载层允许（d=3 > D）', () => {
    const g3 = makeTextNode('g3');
    const g2 = makeTextNode('g2', [g3]);
    const g1 = makeTextNode('g1', [g2]);
    const doc = { ...makeTextNode('r2', [g1]), note: setFrame(undefined, 2) };
    expect(canCreateFrame(doc, g1.id)).toEqual({ ok: false, reason: 'inside-ancestor-outline' });
    expect(canCreateFrame(doc, g2.id)).toEqual({ ok: false, reason: 'inside-ancestor-outline' });
    expect(canCreateFrame(doc, g3.id)).toEqual({ ok: true });
  });

  it('挂载层可再成框；此后以最近成框祖先为准（该框自身大纲层重新生效）', () => {
    const grand = makeTextNode('grand');
    const leafC = makeTextNode('leafC', [grand]);
    const midC = makeTextNode('midC', [leafC]);
    const doc = { ...makeTextNode('rootC', [midC]), note: setFrame(undefined, 1) };
    // grand 相对 doc d=3 > 1（挂载层）→ 允许成框
    expect(canCreateFrame(doc, grand.id)).toEqual({ ok: true });
    // leafC 在挂载层成框（depth=2）后：grand 相对最近成框祖先 leafC d=1 ≤ 2 → 拒
    const doc2 = {
      ...doc,
      children: [{ ...midC, children: [{ ...leafC, note: setFrame(undefined, 2) }] }],
    };
    expect(canCreateFrame(doc2, grand.id)).toEqual({
      ok: false,
      reason: 'inside-ancestor-outline',
    });
  });

  it('非法 frame（读侧不认）视为非框：不产生拒绝', () => {
    const doc = looseNote({ frame: { version: 2, depth: 0 } });
    const child = makeTextNode('c');
    const rootLoose = { ...makeTextNode('rootLoose', [child]), note: doc };
    expect(canCreateFrame(rootLoose, child.id)).toEqual({ ok: true });
  });
});

describe('clampFrameDepth：尊重子树高度与设计上限 8', () => {
  it('常规：不超 maxRel、下限 1、上限 8', () => {
    expect(clampFrameDepth(2, 5)).toBe(2);
    expect(clampFrameDepth(5, 3)).toBe(3);
    expect(clampFrameDepth(1, 9)).toBe(1);
    expect(clampFrameDepth(9, 20)).toBe(8);
    expect(clampFrameDepth(8, 8)).toBe(8);
    expect(clampFrameDepth(0, 5)).toBe(1);
    expect(clampFrameDepth(-3, 5)).toBe(1);
    expect(clampFrameDepth(3, 0)).toBe(1);
  });

  it('非有限 / 小数入参不泄漏 NaN 或非整数（写侧 setFrame 会拒）', () => {
    expect(clampFrameDepth(Number.NaN, 5)).toBe(1);
    expect(clampFrameDepth(2, Number.NaN)).toBe(1);
    expect(clampFrameDepth(Number.POSITIVE_INFINITY, 5)).toBe(1);
    expect(clampFrameDepth(3.7, 5)).toBe(3);
    expect(clampFrameDepth(3, 2.9)).toBe(2);
    // 恒等式：结果总能被 setFrame 接受（有限整数 ≥ 1）
    for (const [req, maxRel] of [
      [Number.NaN, Number.NaN],
      [1e9, 1e9],
      [0, 0],
      [2.4, 1.2],
    ] as const) {
      const d = clampFrameDepth(req, maxRel);
      expect(normalizeFrameDepth(d)).toBe(d);
      expect(d).toBeLessThanOrEqual(8);
    }
  });
});
