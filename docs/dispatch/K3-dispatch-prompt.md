# K3 外派执行任务书：渲染层重写 · 三主题设计令牌系统

> 用法：将本文件全文喂给执行 agent（Claude Code / Codex / deepseek-harness 等），工作目录设为仓库根（`<workspace>`）。任务书自包含全部上下文。

---

## 你的角色

你是 mindcanvas 仓库的工程执行 agent，负责 **K3 阶段**：`packages/react` 渲染层的从零构建——这是项目第一个有像素的阶段。**视觉方向已由用户钦定并固化为 ADR-0003，你的职责是高品质工程化实现，不得重新设计视觉方向。**

## 项目背景（1 分钟）

mindcanvas 是纯文本思维导图平台。内核 `packages/kernel` 已完成（225 测试全绿）：协议层（`.mm.md` parse/serialize）、headless 树（TreeOp 可重放）、布局引擎（`layoutMindmap` 六布局，O(N)，2000 节点 ~23ms）、六注册表 + 插件基座。K0/K1/K2 全部验收通过。`packages/react` 目前是占位包——本轮把它建成真正的渲染层。

## 必读文档（开工前按序读完）

1. `docs/adr/ADR-0003-design-theme-strategy.md` —— **本轮视觉纲领（用户钦定）**：三主题 + 玻璃 chrome + 主题即令牌
2. `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` 的 **K3 段**
3. `docs/research/2026-08-27-mindmap-kernel-oss-research.md` §1 —— 渲染架构分野（tldraw DOM+Signals vs Excalidraw Canvas；**空闲 CPU 由 tick 架构决定，禁永续 rAF**；ShapeUtil 组件/几何分离）
4. **视觉参照**：用浏览器打开 `docs/preview/mindmap-design-styles-report.html` —— V1（经典曲线）/ V7（画布贴纸）/ V8（玻璃现代）三个版本的内联 SVG 就是你的视觉 spec（节点形态、连线语言、配色）
5. 内核 API（已读过的用 `import` 验证即可）：`parseMm` / `astToEditable` / `layoutMindmap` / `defaultMeasure`（估算度量）/ `createKernelRegistries`

## 任务清单（T1-T6 按序执行，每任务一个 commit）

### T1 · 主题令牌系统（`packages/react/src/theme/`）

- `TokenSet` 接口：color / radius / spacing / font / motion / lineStyle / nodeStyle / shadow —— 覆盖 ADR-0003 主题集定义表的全部差异
- 三套令牌数据：`classic`（V1）/ `sticker`（V7）/ `glass`（V8，默认）——视觉值严格对照设计报告内联 SVG（颜色、圆角、描边、阴影）
- 主题上下文 + 运行时切换（React context 或等价）；`useTheme()` 消费
- 附 TokenSet 类型测试（缺字段编译报错）

### T2 · 渲染核心（`packages/react/src/render/`）

- **节点渲染器**按 TokenSet 参数化：矩形（classic）/ 贴纸卡含阴影（sticker）/ 半透明卡（glass）；实体节点（`@kind:id`）按 KIND_META 着色
- **连线渲染器**按 token.lineStyle 分支：彩色曲线 / 任意曲线 / 柔和贝塞尔（复用 kernel 布局产出的 LinkGeometry.path 或重新生成）
- **视口裁剪 + LOD + dirty-flag 按需渲染**——**禁止永续 rAF 循环**（空闲 CPU ≈ 0 是硬验收）；状态更新走显式脏标记 + 单帧调度
- 组件/几何分离（ShapeUtil 精神）：渲染组件与命中检测/边界独立

### T3 · 集成内核（只读消费）

- kernel 包作为纯依赖（`layoutMindmap` + 裁剪 + `MeasureFn`）——**本轮只 import 消费，不改 kernel 一行代码**
- DOM 精确文本度量注入：实现 react 侧 `MeasureFn`（canvas measureText 或 DOM 度量），替换估算默认值
- 数据管线：`parseMm → astToEditable → layoutMindmap → 渲染`，demo 画布来自 kernel fixtures

### T4 · 玻璃 chrome 与主题切换演示

- 应用外壳（工具栏 / 面板 / **翻卡交互**）：深色半透明 + 霓虹强调（V8 气质，恒定不随画布主题漂移）
- 主题切换控件（三主题一键切换）+ 玻璃风格翻卡组件（演示交互，可点击翻转显示节点 note）——呼应设计报告翻卡评估
- `apps/canvas` 接入：加载 demo 画布 → 默认 glass 主题渲染 → 可切换

### T5 · 性能验证

- 500+ 节点（复用 kernel 平衡树生成思路）渲染：首屏 + 平移 + 缩放流畅
- **空闲 CPU ≈ 0**（无用户操作时性能面板不活跃；可用 dev 工具验证）
- 数值记录进报告（对照 kernel 布局 23ms 预算）

### T6 · 交付与视觉基线

- `docs/dispatch/K3-report.md`：门禁打勾 + 令牌系统设计说明 + 性能数值 + 三主题实现差异清单
- **三张主题快照**：三主题各渲染 `gateway.mm.md` 导出 SVG 存档 `docs/preview/themes/{classic,sticker,glass}.svg`（视觉验收基线）

## 硬约束（违反任意一条即返工）

1. **视觉方向锁定**：严格按 ADR-0003 与设计报告实现三主题 + 玻璃 chrome——不做「我觉得这样更好」的视觉发明
2. **组件逻辑不写死视觉值**：一切颜色/圆角/阴影/连线样式走 TokenSet；主题切换 = 换令牌，不得出现「if theme==='classic' 写死颜色」
3. **禁永续 rAF / 轮询 tick**：渲染调度必须按需触发（dirty-flag + 单帧），空闲时零活动
4. **kernel 零改动**（只读 import）；`packages/react` 新增依赖仅 react/react-dom（devDeps 不限）
5. React 19 技术栈（与现有 workspace 一致）；测试用 vitest + React Testing Library（如需）
6. 只做 T1-T6，不做「顺手优化」

## 验收门禁（完成后逐项确认）

- [ ] `pnpm -r build && pnpm -r test` 全绿（kernel 225 测试保持全绿 + react 包新增测试）
- [ ] 三主题切换流畅（classic / sticker / glass 各自视觉符合设计报告；切换无组件重挂载抖动）
- [ ] 500+ 节点平移/缩放流畅；**空闲 CPU ≈ 0**（无永续循环）
- [ ] 玻璃翻卡组件可交互（翻转显示节点 note）
- [ ] 三张主题快照 `docs/preview/themes/*.svg` 存档
- [ ] 组件逻辑无硬编码视觉值（grep 抽查 `#hex` 只出现在 theme/ 目录）
- [ ] git log 呈 `K3: TX ...` 分步提交

## 遇到问题时的规则

- ADR/报告与实现冲突 → 以 ADR-0003 为准，记录冲突到报告
- 视觉细节拿不准（如玻璃透明度具体值）→ 对照设计报告内联 SVG 的取值，报告里记录映射
- 单点阻塞超过 30 分钟 → 写 `docs/dispatch/K3-blockers.md`，跳过继续
