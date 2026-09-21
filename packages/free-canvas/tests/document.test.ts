import { describe, expect, it } from 'vitest';
import {
  createEmptyDocument,
  createNativePlacement,
  normalizeDocument,
  parseCanvasDocument,
  serializeCanvasDocument,
} from '../src/index.js';

describe('CanvasDocument parse/serialize', () => {
  it('empty doc round-trip 字段稳定', () => {
    const doc = createEmptyDocument('演示');
    const src = serializeCanvasDocument(doc);
    const again = parseCanvasDocument(src);
    expect(again.schemaVersion).toBe(1);
    expect(again.title).toBe('演示');
    expect(again.placements).toEqual([]);
    expect(again.edges).toEqual([]);
    expect(again.viewport.scale).toBe(1);
    const src2 = serializeCanvasDocument(again);
    expect(parseCanvasDocument(src2).canvasId).toBe(again.canvasId);
  });

  it('含卡+边+背面 round-trip 逐字关键字段', () => {
    const a = createNativePlacement({ shell: 'sticky-classic', x: 10, y: 20 });
    a.back = { contentKind: 'markdown', body: '## 背\n' };
    a.face = 'back';
    const b = createNativePlacement({ shell: 'card-panel', x: 300, y: 40 });
    let doc = createEmptyDocument('rt');
    doc = {
      ...doc,
      placements: [a, b],
      edges: [
        {
          edgeUuid: 'ed_1',
          fromPlacementUuid: a.placementUuid,
          toPlacementUuid: b.placementUuid,
          fromAnchor: 'right',
          toAnchor: 'left',
          label: '相关',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      viewport: { panX: 5, panY: -3, scale: 1.25 },
      customMeta: { foo: 1 },
    };
    const parsed = parseCanvasDocument(serializeCanvasDocument(doc));
    expect(parsed.placements).toHaveLength(2);
    expect(parsed.placements[0]?.face).toBe('back');
    expect(parsed.placements[0]?.back?.body).toBe('## 背\n');
    expect(parsed.edges[0]?.label).toBe('相关');
    expect(parsed.viewport.scale).toBe(1.25);
    expect(parsed.customMeta).toEqual({ foo: 1 });
  });

  it('未知 placement 键透传', () => {
    const raw = {
      schemaVersion: 1,
      canvasId: 'c1',
      title: 't',
      placements: [
        {
          kind: 'native',
          placementUuid: 'p1',
          shell: 'sticky-classic',
          face: 'front',
          front: { contentKind: 'plain', text: 'hi' },
          transform: { x: 0, y: 0, w: 100, h: 80 },
          zIndex: 0,
          createdAt: 1,
          updatedAt: 1,
          experimentalFlag: true,
        },
      ],
      edges: [],
      viewport: { panX: 0, panY: 0, scale: 1 },
      updatedAt: 1,
    };
    const doc = normalizeDocument(raw);
    expect(doc.placements[0]?.experimentalFlag).toBe(true);
    const again = parseCanvasDocument(serializeCanvasDocument(doc));
    expect(again.placements[0]?.experimentalFlag).toBe(true);
  });

  it('annotation kind 丢弃；缺 uuid 丢弃', () => {
    const doc = normalizeDocument({
      schemaVersion: 1,
      canvasId: 'c',
      title: 't',
      placements: [
        { kind: 'annotation', placementUuid: 'a1' },
        { kind: 'native', shell: 'sticky-classic', front: { contentKind: 'markdown', body: 'x' } },
        {
          kind: 'native',
          placementUuid: 'ok',
          shell: 'card-panel',
          front: { contentKind: 'markdown', body: 'y' },
          transform: { x: 1, y: 2, w: 50, h: 50 },
        },
      ],
      edges: [],
      viewport: {},
      updatedAt: 0,
    });
    expect(doc.placements).toHaveLength(1);
    expect(doc.placements[0]?.placementUuid).toBe('ok');
  });

  it('无 back 时 face=back 归一为 front', () => {
    const doc = normalizeDocument({
      schemaVersion: 1,
      canvasId: 'c',
      title: 't',
      placements: [
        {
          kind: 'native',
          placementUuid: 'p',
          shell: 'sticky-classic',
          face: 'back',
          front: { contentKind: 'markdown', body: '' },
          transform: { x: 0, y: 0, w: 100, h: 100 },
        },
      ],
      edges: [],
      viewport: { panX: 0, panY: 0, scale: 1 },
      updatedAt: 1,
    });
    expect(doc.placements[0]?.face).toBe('front');
  });
});
