import { describe, expect, it } from 'vitest';
import {
  buildRelGeometries,
  collectRelRefs,
  normalizeRel,
  resolveRelTargets,
  type EntityRef,
} from '../src/layout/relations.js';
import type { MindNode } from '../src/protocol/types.js';

function t(text: string, children: MindNode[] = [], note?: MindNode['note']): MindNode {
  return { type: 'text', text, children, ...(note ? { note } : {}) };
}

/**
 * 关系边：节点 note.rel 指向目标实体引用（@kind:id 或 kind:id），跨子树显式连线。
 * 数据沿正文 note 透传（协议兼容预留已验证），渲染层生成曲线几何。
 */
describe('layout/relations：关系边协议与几何', () => {
  it('normalizeRel：@kind:id 与裸 kind:id 统一为 @kind:id，非法忽略', () => {
    const ok: EntityRef = { kind: 'idea', id: 'forge-inbox:5' };
    expect(normalizeRel('@idea:forge-inbox:5')).toEqual(ok);
    expect(normalizeRel('idea:forge-inbox:5')).toEqual(ok);
    expect(normalizeRel('')).toBe(null);
    expect(normalizeRel('不是引用')).toBe(null);
  });

  it('collectRelRefs：汇总全部节点的 note.rel（单值/数组），关联到源节点', () => {
    const root: MindNode = t('root', [
      t('a', [], { rel: '@idea:1' }),
      t('b', [t('c', [], { rel: ['@idea:2', '@idea:3'] })]),
      t('d'),
    ]);
    const rels = collectRelRefs(root);
    expect(rels).toEqual([
      { from: 'root/0', targets: [{ kind: 'idea', id: '1' }] },
      {
        from: 'root/1/0',
        targets: [
          { kind: 'idea', id: '2' },
          { kind: 'idea', id: '3' },
        ],
      },
    ]);
  });

  it('resolveRelTargets：目标命中当前布局中的实体节点 → 取盒子；未命中跳过', () => {
    const nodes = [
      { id: 'x', box: { x: 10, y: 20, w: 100, h: 40 }, refKey: 'idea:1' },
      { id: 'y', box: { x: 300, y: 200, w: 80, h: 30 }, refKey: 'idea:2' },
    ];
    const resolved = resolveRelTargets(
      [
        { from: 'a', targets: [{ kind: 'idea', id: '1' }] },
        { from: 'b', targets: [{ kind: 'idea', id: '9' }] }, // 图中不存在 → 丢弃
      ],
      nodes,
    );
    expect(resolved).toEqual([{ from: 'a', to: 'x', targetBox: nodes[0]!.box, ref: 'idea:1' }]);
  });

  it('buildRelGeometries：为命中组合生成贝塞尔 path（源盒→目标盒中心）', () => {
    const geos = buildRelGeometries(
      [{ from: 'a', to: 'x', targetBox: { x: 300, y: 200, w: 80, h: 30 }, ref: 'idea:1' }],
      { a: { x: 10, y: 20, w: 100, h: 40 } },
    );
    expect(geos).toHaveLength(1);
    expect(geos[0]?.path).toMatch(/^M \d+(\.\d+)? \d+(\.\d+)? C /);
    expect(geos[0]?.ref).toBe('idea:1');
  });
});
