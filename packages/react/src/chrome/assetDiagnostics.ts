/**
 * 资产失效诊断（B3：W-ASSET-MISSING 入解析层）：
 * 对导图内的 @img/@draw 引用与图库清单比对，缺失项产出诊断（与 parse 诊断同形状，可一并展示）。
 * 纯函数：清单数组即判定依据（上传后清单更新 → 诊断消失），不依赖宿主实例，便于测试。
 */
import type { Diagnostic, EntityRef } from '@mindcanvas/kernel';
import type { AssetItem } from './assetTypes.js';

/** 资产引用是否存在于清单（kind + id 精确匹配） */
export function hasAssetIn(assetList: readonly AssetItem[], ref: EntityRef): boolean {
  return assetList.some((a) => a.kind === ref.kind && a.id === ref.id);
}

/** 资产引用 → 诊断（W-ASSET-MISSING；非资产引用不产生；line 0 = 解析层后置判定） */
export function assetDiagnostics(
  refs: readonly EntityRef[],
  assetList: readonly AssetItem[],
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const ref of refs) {
    if (ref.kind !== 'img' && ref.kind !== 'draw') continue;
    if (hasAssetIn(assetList, ref)) continue;
    out.push({
      code: 'W-ASSET-MISSING',
      line: 0,
      message: `资产缺失：@${ref.kind}:${ref.id} 不在图库清单中（渲染为失效占位）`,
    });
  }
  return out;
}
