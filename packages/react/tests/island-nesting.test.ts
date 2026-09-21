/**
 * 嵌套升格岛 · 内容树祖先关系单元测试。
 */
import { describe, expect, it } from 'vitest';
import { astToEditable, makeTextNode } from '@mindcanvas/kernel';
import {
  buildNestedCenterIdsByRoot,
  containedMemberIds,
} from '../src/render/islandNesting.js';

describe('buildNestedCenterIdsByRoot', () => {
  it('P 包容子孙 C；C 无更深层时值为 []', () => {
    const root = astToEditable(
      makeTextNode('root', [makeTextNode('P', [makeTextNode('p1'), makeTextNode('C', [makeTextNode('c1')])])]),
    )!;
    const p = root.children[0]!;
    const c = p.children[1]!;
    const nested = buildNestedCenterIdsByRoot(root, new Set([p.id, c.id]));
    expect(nested.get(p.id)).toEqual([c.id]);
    expect(nested.get(c.id)).toEqual([]);
  });

  it('切断 C：不挂到 P；C 仍可包容自己的子孙 D', () => {
    const root = astToEditable(
      makeTextNode('root', [
        makeTextNode('P', [makeTextNode('C', [makeTextNode('D', [makeTextNode('d1')])])]),
      ]),
    )!;
    const p = root.children[0]!;
    const c = p.children[0]!;
    const d = c.children[0]!;
    const nested = buildNestedCenterIdsByRoot(
      root,
      new Set([p.id, c.id, d.id]),
      new Set([c.id]),
    );
    expect(nested.get(p.id)).toEqual([]);
    expect(nested.get(c.id)).toEqual([d.id]);
    expect(nested.get(d.id)).toEqual([]);
  });
});

describe('containedMemberIds', () => {
  it('并入子孙岛成员，本岛在前、去重', () => {
    const members = new Map([
      ['P', ['P', 'p1']],
      ['C', ['C', 'c1']],
    ]);
    const nested = new Map([['P', ['C']], ['C', [] as string[]]]);
    expect(containedMemberIds('P', members, nested)).toEqual(['P', 'p1', 'C', 'c1']);
    expect(containedMemberIds('C', members, nested)).toEqual(['C', 'c1']);
  });
});
