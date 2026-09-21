/**
 * 素材面板的共享类型（从 AssetPanel.tsx 下移到独立模块）。
 *
 * 动因：`AssetPanel` 与拆分出的 `assetViews` 都要用 `AssetItem`；
 * 若类型留在面板组件内，展示层就得反向依赖主组件 —— 方向颠倒且易成环。
 */

export interface AssetItem {
  kind: 'img' | 'draw';
  id: string;
  name: string;
  type: string;
  /**
   * 来源（FA1-T4/T5）：'upload' = 用户上传（缺省），'builtin' = 内置矢量图标。
   * 内置项直接带 `svg` 源码，不依赖资产宿主解析。
   */
  source?: 'upload' | 'builtin';
  /** 内联 SVG 源码（内置图标 / <15KB 上传的 SVG）；有值即可脱离宿主自包含分发 */
  svg?: string;
}

/** 素材的三种插入语义（FA1-T3） */
export type AssetInsertAction = 'icon' | 'media' | 'child';
