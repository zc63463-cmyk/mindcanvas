/**
 * render 模块：K3 渲染核心（dirty-flag 单帧调度 + 视口裁剪/LOD + 组件几何分离）。
 * M5 追加：motion（动画常量集中管理）、transition（节点位置过渡计划器）、
 * nodeDrag（拖拽重排规划器）、backend（渲染后端抽象：SVG 适配器，Canvas 预留）。
 */
export * from './scheduler.js';
export * from './viewport.js';
export * from './geometry.js';
export * from './motion.js';
export * from './transition.js';
export * from './nodeDrag.js';
export * from './backend.js';
export * from './domMeasure.js';
export * from './MapView.js';
export * from './NodeG.js';
export * from './LinkG.js';
export * from './sceneBuilder.js';
export * from './freeEdges.js';
export * from './FreeEdgeLayer.js';
export * from './EdgeLabel.js';
export * from './EdgeLabelLayer.js';
export * from './edgeRouting.js';
// FA2-T3：画布拖拽落点智能感知
export * from './dropSensing.js';
