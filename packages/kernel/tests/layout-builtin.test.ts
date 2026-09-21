import { describe, expect, it } from 'vitest';
import {
  BUILTIN_LAYOUT_KINDS,
  registerBuiltinLayouts,
  type LayoutInput,
} from '../src/layout/builtin.js';
import { defaultMeasure } from '../src/layout/measure.js';
import type { LayoutResult } from '../src/layout/mindmap.js';
import { LayoutRegistry } from '../src/registry/layout.js';
import type { EditableNode } from '../src/tree/treeOps.js';

describe('registerBuiltinLayouts：六布局种入 LayoutRegistry（K2 接线）', () => {
  it('注册六个布局算法（key=kind，layout 可执行）', () => {
    const layouts = new LayoutRegistry<LayoutInput, LayoutResult>();
    registerBuiltinLayouts(layouts);
    expect(layouts.list()).toHaveLength(6);
    const root: EditableNode = { id: 'r', type: 'text', text: '根', children: [] };
    for (const kind of BUILTIN_LAYOUT_KINDS) {
      const algo = layouts.get(kind);
      expect(algo, `${kind} 应已注册`).toBeDefined();
      const result = algo!.layout({ root, measure: defaultMeasure, collapsedIds: new Set() });
      expect(result.nodes.length).toBe(1);
      expect(Array.isArray(result.links)).toBe(true);
    }
  });

  it('未调用时注册表保持为空（显式种子语义）', () => {
    const layouts = new LayoutRegistry<LayoutInput, LayoutResult>();
    expect(layouts.list()).toHaveLength(0);
  });
});
