/**
 * 环形菜单 · 几何类型（中立模块，v1.8.2 收口）
 * ══════════════════════════════════════════════════════════════════════
 * 从 `radialActions.ts` 抽出：`radialSubRing.ts`（外圈几何）只需要**几何形状**，
 * 原先是 `radialSubRing → radialActions`（type-only）+ `radialActions → radialSubRing`（值）
 * 形成依赖环（depcruise no-circular 报错）。把几何类型放中立模块后两个方向都不成环。
 *
 * 公开 API 不变：`radialActions.ts` 仍 re-export 本文件的类型（`index.ts` 出口不动）。
 */
/** 环形几何配置（预览页以滑杆暴露，方便调手感） */
export interface RadialGeometryConfig {
  /** 内孔半径（仅观感；命中不设限） */
  innerR: number;
  /** 外缘半径 */
  outerR: number;
  /** 死区半径：距锚点 < deadR 视为「未瞄准」→ 取消 */
  deadR: number;
  /** 缺口中心角（默认 135° = 朝向所依附的节点角：环挂节点右上角、节点在锚点左下） */
  gapCenterDeg: number;
  /** 缺口宽度（度）——视觉断口 + 取消带 */
  gapWidthDeg: number;
  /** 外缘命中宽容（px）——Fitts：外圈多留余量 */
  hitSlack: number;
}

export interface RadialGeometry {
  cx: number;
  cy: number;
  cfg: RadialGeometryConfig;
}
