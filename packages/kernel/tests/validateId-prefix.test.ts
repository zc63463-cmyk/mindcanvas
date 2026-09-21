import { describe, expect, it } from 'vitest';
import { validateId } from '../src/protocol/types.js';
import { parseMm } from '../src/protocol/parser.js';

describe('validateId：v0.2.2 跨库前缀', () => {
  it('issue/pr：裸数字、org 单段、org/repo 双段均合法', () => {
    expect(validateId('issue', '5')).toBe(true);
    expect(validateId('issue', 'markvault:5')).toBe(true);
    expect(validateId('issue', 'markvault/docs:5')).toBe(true);
    expect(validateId('pr', 'pomodoroxii/ideas:12')).toBe(true);
  });

  it('issue/pr 非法形态仍拒绝', () => {
    expect(validateId('issue', '0')).toBe(false);
    expect(validateId('issue', 'abc')).toBe(false);
    expect(validateId('issue', 'markvault:0')).toBe(false);
    expect(validateId('issue', 'markvault/docs:abc')).toBe(false);
  });

  it('doc：前缀 + 路径合法；非法路径仍拒绝', () => {
    expect(validateId('doc', 'markvault:跨库验证.md')).toBe(true);
    expect(validateId('doc', 'markvault/docs:docs/a.md')).toBe(true);
    expect(validateId('doc', 'docs/01-architecture.md')).toBe(true);
    expect(validateId('doc', '../secrets.md')).toBe(false);
    expect(validateId('doc', 'markvault/docs:../secrets.md')).toBe(false);
  });

  it('note/milestone：前缀 + 名称合法', () => {
    expect(validateId('note', 'markvault/docs:mynote')).toBe(true);
    expect(validateId('milestone', 'markvault:门户优化')).toBe(true);
    expect(validateId('note', 'mynote')).toBe(true);
  });

  it('idea 语义不变（跨库前缀不作用于 idea）', () => {
    expect(validateId('idea', '42')).toBe(true);
    expect(validateId('idea', 'markvault:42')).toBe(true);
    expect(validateId('idea', 'MARKVAULT:42')).toBe(false);
    expect(validateId('idea', 'markvault:42:extra')).toBe(false);
  });
});

describe('parser：跨库前缀引用解析不再报 W-INVALID-REF', () => {
  it('@issue:markvault/docs:5 → 实体引用、无 INVALID 诊断', () => {
    const r = parseMm('# 根\n- @issue:markvault/docs:5');
    expect(r.refs[0]).toEqual({ kind: 'issue', id: 'markvault/docs:5' });
    expect(r.diagnostics.some((d) => d.code === 'W-INVALID-REF')).toBe(false);
  });

  it('既有非法 id 用例仍报 W-INVALID-REF（回归）', () => {
    const r = parseMm('# 根\n- @issue:abc');
    expect(r.diagnostics.some((d) => d.code === 'W-INVALID-REF')).toBe(true);
  });
});
