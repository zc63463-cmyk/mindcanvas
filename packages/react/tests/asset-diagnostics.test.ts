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
