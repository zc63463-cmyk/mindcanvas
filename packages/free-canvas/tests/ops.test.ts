import { describe, expect, it } from 'vitest';
import {
  addBack,
  addEdge,
  createEmptyDocument,
  createNativePlacement,
  movePlacement,
  nativeBackEnabled,
  patchBack,
  removeEdge,
  removePlacement,
  toggleFace,
} from '../src/index.js';

describe('ops', () => {
  it('addBack 启用翻面并切到背面；空 body 也可 toggle', () => {
    const p = createNativePlacement({ shell: 'sticky-classic', x: 0, y: 0 });
    let doc = { ...createEmptyDocument(), placements: [p] };
    expect(nativeBackEnabled(doc.placements[0]?.back)).toBe(false);
    doc = addBack(doc, p.placementUuid);
    expect(nativeBackEnabled(doc.placements[0]?.back)).toBe(true);
    expect(doc.placements[0]?.face).toBe('back');
    expect(doc.placements[0]?.back?.body).toBe('');
    doc = toggleFace(doc, p.placementUuid);
    expect(doc.placements[0]?.face).toBe('front');
    doc = toggleFace(doc, p.placementUuid);
    expect(doc.placements[0]?.face).toBe('back');
  });

  it('无 back 时 toggleFace no-op', () => {
    const p = createNativePlacement({ shell: 'card-panel', x: 0, y: 0 });
    let doc = { ...createEmptyDocument(), placements: [p] };
    doc = toggleFace(doc, p.placementUuid);
    expect(doc.placements[0]?.face).toBe('front');
  });

  it('patchBack / movePlacement', () => {
    const p = createNativePlacement({ shell: 'sticky-classic', x: 0, y: 0 });
    let doc = addBack({ ...createEmptyDocument(), placements: [p] }, p.placementUuid);
    doc = patchBack(doc, p.placementUuid, 'hello');
    expect(doc.placements[0]?.back?.body).toBe('hello');
    doc = movePlacement(doc, p.placementUuid, 40, 50);
    expect(doc.placements[0]?.transform).toMatchObject({ x: 40, y: 50 });
  });

  it('addEdge + removePlacement 级联', () => {
    const a = createNativePlacement({ shell: 'sticky-classic', x: 0, y: 0 });
    const b = createNativePlacement({ shell: 'card-panel', x: 200, y: 0 });
    let doc = { ...createEmptyDocument(), placements: [a, b] };
    doc = addEdge(doc, {
      fromPlacementUuid: a.placementUuid,
      toPlacementUuid: b.placementUuid,
    });
    expect(doc.edges).toHaveLength(1);
    const eid = doc.edges[0]?.edgeUuid ?? '';
    doc = removeEdge(doc, eid);
    expect(doc.edges).toHaveLength(0);
    doc = addEdge(doc, {
      fromPlacementUuid: a.placementUuid,
      toPlacementUuid: b.placementUuid,
    });
    doc = removePlacement(doc, a.placementUuid);
    expect(doc.placements).toHaveLength(1);
    expect(doc.edges).toHaveLength(0);
  });

  it('自环边 / 缺端点 no-op', () => {
    const a = createNativePlacement({ shell: 'sticky-classic', x: 0, y: 0 });
    let doc = { ...createEmptyDocument(), placements: [a] };
    doc = addEdge(doc, {
      fromPlacementUuid: a.placementUuid,
      toPlacementUuid: a.placementUuid,
    });
    expect(doc.edges).toHaveLength(0);
    doc = addEdge(doc, {
      fromPlacementUuid: a.placementUuid,
      toPlacementUuid: 'missing',
    });
    expect(doc.edges).toHaveLength(0);
  });
});
