import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { GOLDEN_CASES } from '../src/protocol/goldenCases.js';

const normDiag = (ds: { code: string; line: number }[]): string[] =>
  ds.map((x) => `${x.code}@${x.line}`).sort();

describe('entity-ref v0.2.1 golden tests（T01–T30）', () => {
  for (const c of GOLDEN_CASES) {
    it(`${c.id} ${c.name}`, () => {
      const actual = parseMm(c.input);
      expect(actual.root).toEqual(c.expected.root);
      expect(actual.refs).toEqual(c.expected.refs);
      expect(normDiag(actual.diagnostics)).toEqual(normDiag(c.expected.diagnostics));
    });
  }
});

describe('golden 零噪声约束', () => {
  it('期望零诊断的用例不得产出任何 E-/W- 码', () => {
    for (const c of GOLDEN_CASES) {
      if (c.expected.diagnostics.length === 0) {
        const actual = parseMm(c.input);
        expect(actual.diagnostics, `${c.id} 应零诊断`).toEqual([]);
      }
    }
  });
});
