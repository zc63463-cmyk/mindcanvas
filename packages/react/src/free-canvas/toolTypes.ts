/**
 * 自由画布工具类型（FC-B：选择 / 便签 / 面板；FC-D：连线）。
 * 独立小模块承载：避免 FreeCanvasView ↔ Toolbar 的类型循环依赖。
 */
export type CanvasTool = 'select' | 'sticky' | 'panel' | 'connect';
