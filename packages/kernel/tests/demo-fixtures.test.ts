import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm } from '../src/protocol/serializer.js';
import gateway from './fixtures/gateway.mm.md?raw';
import roadmap from './fixtures/roadmap.mm.md?raw';
import ideasPool from './fixtures/ideas-pool.mm.md?raw';

const fixtures: Array<[string, string]> = [
  ['gateway.mm.md', gateway],
  ['roadmap.mm.md', roadmap],
  ['ideas-pool.mm.md', ideasPool],
];

describe('demo 画布 fixtures 抽样验证', () => {
  for (const [name, text] of fixtures) {
    it(`${name}：解析无 E 级（错误级）诊断`, () => {
      const p = parseMm(text);
      expect(p.root).not.toBeNull();
      const eLevel = p.diagnostics.filter((d) => d.code.startsWith('E-'));
      expect(eLevel).toEqual([]);
    });

    it(`${name}：round-trip 幂等（serialize(parse(serialize(parse(x)))) === serialize(parse(x))）`, () => {
      const p1 = parseMm(text);
      const s1 = serializeMm(p1.root!);
      const p2 = parseMm(s1);
      const s2 = serializeMm(p2.root!);
      expect(s2).toBe(s1);
    });
  }
});
