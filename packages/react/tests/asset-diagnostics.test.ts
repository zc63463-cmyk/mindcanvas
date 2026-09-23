import { describe, expect, it } from 'vitest';
import { assetDiagnostics, hasAssetIn } from '../src/chrome/assetDiagnostics.js';
import type { EntityRef } from '@mindcanvas/kernel';

const LIST = [
  {
    kind: 'img' as const,
    id: 'demo-assets/demo-diagram.svg',
    name: 'demo-diagram.svg',
    type: 'svg',
  },
  { kind: 'draw' as const, id: 'demo-assets/board.svg', name: 'board.svg', type: 'svg' },
];

const refs: EntityRef[] = [
  { kind: 'img', id: 'demo-assets/demo-diagram.svg' },
  { kind: 'draw', id: 'demo-assets/board.svg' },
  { kind: 'img', id: 'assets/missing.png' },
  { kind: 'issue', id: '1' },
];

describe('资产失效诊断（B3：W-ASSET-MISSING 入解析层）', () => {
  it('清单内资产引用 → 无诊断；缺失 → W-ASSET-MISSING（含引用）', () => {
    const diags = assetDiagnostics(refs, LIST);
    expect(diags.length).toBe(1);
    expect(diags[0]!.code).toBe('W-ASSET-MISSING');
    expect(diags[0]!.message).toContain('@img:assets/missing.png');
    expect(diags[0]!.line).toBe(0);
  });

  it('非资产引用（@issue）不产生诊断', () => {
    expect(assetDiagnostics([{ kind: 'issue', id: '1' }], [])).toEqual([]);
  });

  it('上传后清单更新 → 缺失诊断消失（同一引用两次判定）', () => {
    const uploaded = [
      ...LIST,
      { kind: 'img' as const, id: 'assets/missing.png', name: 'missing.png', type: 'png' },
    ];
    expect(assetDiagnostics(refs, LIST).length).toBe(1);
    expect(assetDiagnostics(refs, uploaded).length).toBe(0);
  });

  it('hasAssetIn：kind+id 精确匹配', () => {
    expect(hasAssetIn(LIST, { kind: 'img', id: 'demo-assets/demo-diagram.svg' })).toBe(true);
    expect(hasAssetIn(LIST, { kind: 'draw', id: 'demo-assets/demo-diagram.svg' })).toBe(false); // kind 不同
    expect(hasAssetIn(LIST, { kind: 'img', id: 'x.png' })).toBe(false);
  });
});

/**
 * ── P0-FIX-R1 R1-2(N4 同根)：自包含引用不得被误报为缺失 ──────────────
 *
 * 内置图标以 child 语义插入时会被内联成 `@draw:data:...`（CE-05）。这是**正常**形态，
 * 字节就在引用里，图库清单里当然没有它 —— 旧诊断无条件按 `kind+id` 查清单，
 * 于是每次插入内置图标都会挂一条 `W-ASSET-MISSING`，与渲染端（能画出图）自相矛盾。
 * 真机 N4.5「重开后无资产缺失标记」因此长红。
 *
 * 成对钉住：自包含不报；`assets/` 真缺失照报（**口径不弱化**）。
 */
describe('R1-2：自包含引用（data:/builtin:）不产生缺失诊断', () => {
  const dataRef: EntityRef = {
    kind: 'draw',
    id: 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
  };

  it('内联 data: 图标不在清单里 —— 但**不**报缺失（渲染画得出，诊断不得更悲观）', () => {
    expect(hasAssetIn(LIST, dataRef)).toBe(false); // 前提：它确实不在清单里
    expect(assetDiagnostics([dataRef], LIST)).toEqual([]);
  });

  it('builtin:<id> 同样不报（自包含的另一种形态，I-5）', () => {
    const builtinRef: EntityRef = { kind: 'draw', id: 'builtin:star' };
    expect(assetDiagnostics([builtinRef], LIST)).toEqual([]);
  });

  it('口径不弱化：`assets/` 的**真缺失**照旧产出 W-ASSET-MISSING', () => {
    const gone: EntityRef = { kind: 'img', id: 'assets/never.png' };
    const diags = assetDiagnostics([dataRef, gone], LIST);
    expect(diags.length).toBe(1);
    expect(diags[0]!.message).toContain('@img:assets/never.png');
  });

  it('混合清单：data: 内联项在清单中（带着同样 id）时也不重复报（两路都静默）', () => {
    const listWithInline = [...LIST, { kind: 'draw' as const, id: dataRef.id, name: 'x', type: 'svg' }];
    expect(assetDiagnostics([dataRef], listWithInline)).toEqual([]);
  });
});
