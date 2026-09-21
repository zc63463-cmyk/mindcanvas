# 批次 R（富内容 / 触控 / 远端接缝 / Canvas 后端）交付报告

> 日期：2026-08-30 · 四线并进（用户点名）· 计划：`2026-08-30-r-batch-dispatch.md`
> 提交：R1（5741834）→ R3（8a293f0）→ R2（76c3362 + a436929）→ R4（fba770e）
> 基线：react 268 → **281**（+13 测试）；kernel 282 不变；typecheck / build 0 错误

## 一、交付内容

| 任务 | 内容 | 状态 |
|---|---|---|
| **R1 M2a @draw 富内容** | 实体节点翻卡背面 = 引用详情（@kind + 标题 + 操作引导）；svg→draw 上传链路测试**确认已覆盖零缺口** | ✅ |
| **R3 EntityHost 远端接缝** | `HttpEntityHost`：同步缓存 `list()` + `refresh()` 拉 `/entities` + `remember/remove` 乐观写 + POST/DELETE fire-and-forget；合并逻辑抽 `mergeInto` 双实现共用 | ✅ 骨架（接缝就位） |
| **R2 移动端 pinch 触控** | `PinchTracker` 纯逻辑类 + MapView 多指接线：第二指落下进 pinch（取消 pan/拖拽）、move → `zoomAt(指间中点, 距离比)`、up/cancel 退出 | ✅ |
| **R4 Canvas 后端骨架** | `CanvasBackend implements RenderBackend`（原语构造同构）+ `drawScene` 2D 指令映射（group/rect+shadow/path/text）+ `CanvasSurface`（useEffect 绘制） | ✅ 骨架（主循环接入留专项） |

## 二、关键实现与发现

| # | 内容 |
|---|---|
| D1 | **EntityHost 同步接口 + 异步源**：`list()` 保持同步（缓存语义），HTTP 走 `refresh()` 拉取入缓存——Local/Http 双实现共用 `mergeInto`（Local 行为不变由既有测试守护） |
| D2 | **pinch 与视口解耦**：手势逻辑抽 `PinchTracker` 纯类（可注入测试）；`zoomAt(中点, 距离比)` 中点位移自然转化为平移；与滚轮同走 animateTo 路径（连续调用互相打断、终值正确） |
| D3 | **jsdom 无 rAF**：渲染动画无法在 jsdom 驱动 → pinch 组合测试在 node 环境注入同步 frame（每帧立即执行 → 动画跳终值） |
| D4 | Canvas `drop-shadow` 简版解析暴露 Number('2px')=NaN 陷阱 → 统一剥 px |
| D5 | R4 **诚实边界**：未接入 MapView 主渲染循环（命中检测/动画/文本布局重构 = 独立专项）；>50K 自动切换待接入后生效；path 绘制仅 M 开路径骨架 |

## 三、浏览器验收清单（:5174）

1. **@draw**：图库上传 .svg → draw 徽章 → 插入 → 节点渲染 SVG；选中实体节点翻卡 → 背面显示 @kind + 标题
2. **pinch**（触屏/开发者工具触摸模拟）：双指张开放大、捏合缩小、中点拖移平移；单指拖拽 pan 不受影响
3. **EntityHost**：控制台 `new HttpEntityHost('http://localhost:PORT').refresh()` → 候选来自远端（B 线 sidecar 上线即用）
4. **Canvas**：`new CanvasBackend().render(scene)` 渲染元素检查（主循环接入后即为实际画布）

## 四、下一轮候选

1. **Canvas 后端主循环接入**（专项：命中检测/动画/文本布局）——T8 L3 完全体
2. **M2 继续深化**：`@draw` 画板（画布内绘制 SVG → 资产）
3. **B 线**（B0 任务书就绪）：LLM 提议质量验证
4. **I1**：Forgejo remote（仍欠着）
