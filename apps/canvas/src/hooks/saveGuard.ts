/**
 * S2G：保存侧同步守卫 —— 写盘前的「同步不变量」谓词 + 拦截文案单点。
 *
 * 为什么要「簿记」而不是随手两行：两个直觉判据都不可用（见派遣计划 §1）——
 * ① `doc.source` vs `controller.serialize()`：E 批口径下 doc.source 是「打开/新建时的
 *    解析输入」，不随编辑更新 → 正常保存时恒不等 → 全误报；
 * ② `controller.root === editable`：编辑走不可变更新，root 每步换对象 → 同样恒不等。
 * 故维护 `syncedSourceRef` =「controller 的树所对应的 `doc.source`」，只在**确定同步**的
 * 时刻置位（三写点：controller 创建 / switch 首挂同源跳过 / switch reset 后）；写盘前以
 * `canWriteDoc` 精确等值判定（两读点：自动保存定时器 / 手动保存任务）。
 *
 * 边界（已接受）：两份内容逐字相同的文档互切 → source 等值 → 视为同步（沿 E 批
 * 「source 不变 = 不重建」语义）；`handleSaveAs` 放行（逃生口：把改动救到新文件）。
 */

/** 写盘前判定：controller 的树是否确属该文档。synced 为 null（尚未置位）→ 不同步。 */
export function canWriteDoc(synced: string | null, docSource: string): boolean {
  return synced === docSource;
}

/** 守卫拦截文案（两处通知同源：自动保存「每 doc.source 一次」/ 手动保存「每次」） */
export const SAVE_BLOCKED_NOTICE =
  '已阻止保存：当前画布内容与文档不同步（防误写）。改动未丢失——请用「另存为」保存到新文件，然后重新打开原文档。';
