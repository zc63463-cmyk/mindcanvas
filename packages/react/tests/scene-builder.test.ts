import { describe, expect, it } from 'vitest';
import {
  buildSceneFromLayout,
  CANVAS_AUTO_NODES,
  resolveBackend,
  type SceneInput,
} from '../src/render/sceneBuilder.js';
import { glassToken } from '../src/theme/tokens.js';
import type { ScenePrimitive } from '../src/render/backend.js';
import type { Box } from '@mindcanvas/kernel';

const box = (x: number, y: number, w = 100, h = 36): Box => ({ x, y, w, h });

function input(over: Partial<SceneInput> = {}): SceneInput {
  return {
    nodes: [
      {
        id: 'root',
        box: box(0, 0),
        depth: 0,
        text: '根',
        isEntity: false,
        entityKind: null,
        childCount: 2,
        collapsed: false,
        selected: false,
      },
      {
        id: 'a',
        box: box(200, 10),
        depth: 1,
        text: '分支 A',
        isEntity: false,
        entityKind: null,
        childCount: 0,
        collapsed: false,
        selected: true,
      },
      {
        id: 'a1',
        box: box(400, 10),
        depth: 2,
        text: '叶',
        isEntity: false,
        entityKind: null,
        childCount: 3,
        collapsed: true,
        selected: false,
      },
    ],
    links: [
      { fromId: 'root', from: box(0, 0), to: box(200, 10), toId: 'a' },
      { fromId: 'a', from: box(200, 10), to: box(400, 10), toId: 'a1' },
    ],
    branchColorOf: () => undefined,
    token: glassToken,
    ...over,
  };
}

describe('场景构建器（C1：Canvas 主循环接入第一块）', () => {
  it('结构：根 group 含连线 path ×2 + 节点 group ×3（世界坐标）', () => {
    const scene = buildSceneFromLayout(input());
    expect(scene.type).toBe('group');
    if (scene.type !== 'group') return;
    const paths = scene.children.filter((c) => c.type === 'path');
    const groups = scene.children.filter((c) => c.type === 'group');
    expect(paths.length).toBe(2);
    expect(groups.length).toBe(3);
    // 节点组用世界坐标 translate
    const first = groups[0]!;
    expect(first.transform).toBe('translate(0 0)');
  });

  it('视觉决策：叶样式（depth≥2）/ 选中描边 / 折叠计数', () => {
    const scene = buildSceneFromLayout(input());
    if (scene.type !== 'group') return;
    const groups = scene.children.filter(
      (c): c is Extract<ScenePrimitive, { type: 'group' }> => c.type === 'group',
    );
    // 选中节点 a：描边 = selection 色
    const a = groups.find((g) => g.dataId === 'a');
    if (a?.type !== 'group') return;
    const card = a.children[0];
    if (card?.type !== 'rect') return;
    expect(card.stroke).toBe(glassToken.color.selection);
    // 折叠叶 a1：+3 计数文本
    const a1 = groups.find((g) => g.dataId === 'a1');
    if (a1?.type !== 'group') return;
    const texts = a1.children.filter((c) => c.type === 'text');
    expect(texts.some((t) => t.type === 'text' && t.value === '+3')).toBe(true);
  });

  it('实体节点：entityKind 传入样式（卡样式按实体分支）', () => {
    const scene = buildSceneFromLayout(
      input({
        nodes: [
          {
            id: 'e',
            box: box(0, 0),
            depth: 1,
            text: '查看',
            isEntity: true,
            entityKind: 'issue',
            childCount: 0,
            collapsed: false,
            selected: false,
          },
        ],
        links: [],
      }),
    );
    if (scene.type !== 'group') return;
    const g = scene.children.find(
      (c): c is Extract<ScenePrimitive, { type: 'group' }> => c.type === 'group',
    );
    expect(g?.dataId).toBe('e');
  });

  it('CANVAS_AUTO_NODES = 50000（T8 L3 阈值）', () => {
    expect(CANVAS_AUTO_NODES).toBe(50000);
  });

  describe('resolveBackend（A6/T23 Canvas 门禁）', () => {
    it('显式 canvas → canvas（既有行为）', () => {
      expect(resolveBackend('canvas', 0)).toBe('canvas');
    });
    it('显式 svg 压过自动降级（>50K 也保持 SVG——岛/自由边文档不静默丢内容）', () => {
      expect(resolveBackend('svg', CANVAS_AUTO_NODES + 1)).toBe('svg');
    });
    it('未指定：≤50K → SVG，>50K → 自动降级 Canvas（既有行为回归）', () => {
      expect(resolveBackend(undefined, CANVAS_AUTO_NODES)).toBe('svg');
      expect(resolveBackend(undefined, CANVAS_AUTO_NODES + 1)).toBe('canvas');
    });
  });
});
