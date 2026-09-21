# 批次 R：富内容 / 触控 / 远端接缝 / Canvas 后端

> 日期：2026-08-30 · 四线并进（用户点名）：M2 富内容、移动端触控、EntityHost 远端接缝、Canvas 后端
> 冻结纪律：kernel 零改动；MapView 主渲染循环不重构（R4 只交付后端类 + 测试，主循环接入留专项）

## 任务与范围（务实边界）

### R1 · M2a：@draw SVG 富内容（轻）
- 现状已大半支持：SVG 文件可上传（图库）、`kindOfFileName` 判定 kind、`assetKind` 含 draw、渲染走 image
- 增量：①链路测试补强（上传 .svg → kind=draw → AssetPanel draw 徽章 → 渲染）②翻卡背面显示实体引用详情（实体节点翻卡 = 实体元信息）

### R2 · 移动端触控：pinch zoom（中）
- API 就位：`ViewportController.zoomAt(sx, sy, factor)` / `panBy`
- 改法：MapView 容器层多指跟踪（pointerdown 登记 ≥2 指 → pinch 模式：距离比 → zoomAt(中点)；单指保持既有 pan）
- 测试：合成 pointer 事件序列（down×2 → move → up）

### R3 · EntityHost 远端接缝（轻）
- 关键约束：`EntityHost.list()` 是**同步**（缓存语义）——HTTP 天然异步
- 改法：`HttpEntityHost`（构造 `{ baseUrl, fetchImpl? }`）：`refresh(): Promise`（GET /entities 拉取入缓存）、`list()` 同步读缓存、`remember/remove` 本地立即生效 + POST/DELETE fire-and-forget
- 价值：B 线 sidecar（GET /entities）上线后**换 baseUrl 即接入**，画布侧零改动

### R4 · Canvas 后端骨架（重，只做后端类）
- `CanvasBackend implements RenderBackend`：nodeCard/text/link/image/group → 2D 绘制指令收集；`render()` 返回 `<CanvasSurface>` React 元素（useEffect 执行指令）
- **不接入 MapView 主循环**（接入含命中检测/动画/文本布局重构 = 独立专项）；本轮交付：后端类完整 + fake ctx 单测（指令映射正确性）
- 诚实标注：>50K 自动切换在主循环接入后才生效

### R5 · 验收 + 报告

## 顺序

R1（轻）→ R3（轻）→ R2（中）→ R4（重）→ R5。每个独立提交 + 全量回归。
