/**
 * 素材面板的共享类型（从 AssetPanel.tsx 下移到独立模块）。
 *
 * 动因：`AssetPanel` 与拆分出的 `assetViews` 都要用 `AssetItem`；
 * 若类型留在面板组件内，展示层就得反向依赖主组件 —— 方向颠倒且易成环。
 */

/**
 * 资产落点（契约 §4.5.1）。回答「它写到了哪」——**不回答**「多可靠 / 能不能带走」（I-12）。
 *
 * 定义在这里（而不是 `assetHost.ts`）是为了**打断依赖环**：`AssetItem.origin` 要引用它，
 * 而 `assetHost.ts` 本身要引用 `AssetItem` —— 两边互指会触发 depcruise 的 `no-circular`。
 * 本模块只含类型、不依赖任何别的模块，是这条依赖的天然下沉点。
 * `assetHost.ts` 从这里再导出，既有调用方的导入路径不变。
 */
export type AssetStore = 'workspace-assets' | 'browser-idb' | 'builtin';

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
  /**
   * **存储来源**（P0-FIX-R1 R1-1）：这一项**这一次是从哪个存储读出来的**。
   *
   * 与 `source` 正交：`source` 说「是不是内置矢量图标」，`origin` 说「字节在哪个存储里」。
   * 两者都要，因为内置项既不是上传也不是磁盘。
   *
   * **为什么必需**：`IdbAssetHost` 的上传项 id 也是 `assets/<name>`（与磁盘资产同名形态），
   * 于是「浏览器素材库里的蓝图」与「工作区磁盘上的红图」在清单里撞成一个 id。挂载工作区后
   * 磁盘项顶替浏览器项，归一化再按 id 前缀取字节 → 蓝图字节被红图静默顶替（N1.5 实测）。
   * 只有把「读出来自哪个存储」标在项上，解析才能按**来源**路由而不是按 id 前缀猜。
   *
   * **只在读侧标注，不做 IDB 迁移**：`listAssets` 重建 IDB 记录项时标 `browser-idb`、
   * 磁盘扫描项标 `workspace-assets`、静态内置项标 `builtin`。
   *
   * **运行时概念，永不入库**：不得写入 `.mm.md`、资产索引（`mindcanvas.assetindex.v2`）或
   * 文档相关的任何持久面（I-3 的同款纪律）。`idbAssetHost.putRecord` 因此显式列字段而
   * **不是** `{...item}` 展开——后者会把它静默写进 IndexedDB。
   */
  origin?: AssetStore;
}

/** 素材的三种插入语义（FA1-T3） */
export type AssetInsertAction = 'icon' | 'media' | 'child';
