import { describe, expect, it } from 'vitest';
import {
  GOLDEN_CASES,
  createKernelRegistries,
  kernelPlaceholder,
  parseMm,
  serializeMm,
  unresolvedEntity,
  type MindNode,
} from '../src/index.js';

describe('协议 round-trip 冒烟（K1 协议层）', () => {
  it('单根文本节点 parseMm(serializeMm(root)) 往返一致', () => {
    const root: MindNode = { type: 'text', text: '根节点', children: [] };
    expect(parseMm(serializeMm(root)).root).toEqual(root);
  });

  it('包入口导出完整：protocol / entity / registry / kernel 均可用', () => {
    expect(kernelPlaceholder).toBe('@mindcanvas/kernel');
    expect(typeof parseMm).toBe('function');
    expect(typeof serializeMm).toBe('function');
    expect(GOLDEN_CASES.length).toBeGreaterThan(0);
    expect(createKernelRegistries().kinds.list()).toHaveLength(0);
    expect(unresolvedEntity({ kind: 'x', id: '1' }, 'unknown-kind').status).toBe('unresolved');
  });
});
