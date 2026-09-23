/**
 * 资产失效诊断（B3：W-ASSET-MISSING 入解析层）：
 * 对导图内的 @img/@draw 引用与图库清单比对，缺失项产出诊断（与 parse 诊断同形状，可一并展示）。
 * 纯函数：清单数组即判定依据（上传后清单更新 → 诊断消失），不依赖宿主实例，便于测试。
 *
 * ── P0-FIX-R1 R1-2：**自包含引用不参与清单比对**（N4 同根） ──
 *
 * `data:`（内联 SVG/位图）与 `builtin:<id>` 按 I-5 是**自包含**的：字节就在引用里，
 * 永远**不会**也不**应该**出现在图库清单中。旧实现无条件拿 `kind+id` 去清单里找，
 * 于是「内置图标插入成内联 data:」这条**正常**路径每次都被报成 `W-ASSET-MISSING` ——
 * 而渲染端同一时刻明明画得出来（解析层对 `data:` 有特判）。判定与呈现自相矛盾，
 * 真机 N4.5 因此长红。
 *
 * 判据与解析层同源（`isSelfContainedRef`）：**诊断不得比渲染更悲观**。
 * 这不是「弱化缺失口径」—— `assets/` 引用的缺失照旧产出诊断（下方用例钉住）。
 */
import type { Diagnostic, EntityRef } from '@mindcanvas/kernel';
import { isSelfContainedRef } from './assetHost.js';
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
    // 自包含（data: / builtin:）：字节在引用里，本来就不该在清单里 —— 不产生缺失诊断
    if (isSelfContainedRef(ref.id)) continue;
    if (hasAssetIn(assetList, ref)) continue;
    out.push({
      code: 'W-ASSET-MISSING',
      line: 0,
      message: `资产缺失：@${ref.kind}:${ref.id} 不在图库清单中（渲染为失效占位）`,
    });
  }
  return out;
}
