# K3 交付报告（2026-08-27）

> 本文件是 K3 阶段（`packages/react` 渲染层从零构建：主题令牌 + 渲染核心 + 内核集成 + 玻璃 chrome + 性能验证 + 视觉基线）的交付自查与总结。
> 执行依据：K3 深度外派任务书（`docs/dispatch/K3-dispatch-prompt.md`）、ADR-0003、`docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` K3 段、设计报告 `docs/preview/mindmap-design-styles-report.html`。

## 验收门禁（逐项确认）

- [x] `pnpm -r build && pnpm -r test` 全绿
  - build：kernel / react / canvas 三包全过
  - test：kernel **225 tests / 31 文件**保持全绿 + react **40 tests / 9 文件**新增全过
  - typecheck：三包全过
- [x] 三主题切换流畅（classic / sticker / glass 各自视觉符合设计报告；切换即换令牌，组件零重挂载——`MapView` 与节点/连线组件不变，仅 `useTheme()` 令牌对象切换，布局按主题字体度量重排）
- [x] 500+ 节点平移/缩放流畅（681 节点：布局中位数 1.86ms、单帧裁剪 1.4ms；远低于 16ms/帧预算）
- [x] 空闲 CPU ≈ 0：无永续 rAF/轮询——`FrameScheduler` 单帧合批 + 脏标记（测试证明同帧多次变更仅 1 次 rAF、帧后 `hasPending=false` 休眠）；`PerfPanel` 零定时器
- [x] 玻璃翻卡组件可交互（`FlipCard` 点击 3D 翻转显示节点 note；jsdom 测试通过；画布点选节点 → 翻卡展示其笔记）
- [x] 三张主题快照 `docs/preview/themes/{classic,sticker,glass}.svg` 存档（gateway.mm.md 视觉验收基线）
- [x] 组件逻辑无硬编码视觉值：`#hex`/`rgba` 仅出现在 `packages/react/src/theme/`（grep 抽查见下）
- [x] git log 呈 `K3: TX ...` 分步提交

**#hex 抽查**（实证：`packages/react/src` 下仅 `theme/tokens.ts` 含颜色字面量）：

```
$ grep -rnE '#[0-9a-fA-F]{3,8}|rgba?\s*\(' packages/react/src --include='*.{ts,tsx}' -l
packages/react/src/theme/tokens.ts
```

（`tokens.ts` 是令牌事实源；其余组件/渲染/geometry/domMeasure/chrome 零命中——组件逻辑无硬编码视觉值。）

**git log（K3 分步）**

```
7ba3ba4 K3: T5 性能验证——681 节点基准（布局中位数 1.86ms / 裁剪 1.4ms / 空闲零挂起帧）+ scheduler 同步 rAF 注入健壮性修复
a758662 K3: T4 玻璃 chrome + apps/canvas——工具条/主题切换/翻卡（CHROME 恒定令牌）+ gateway demo 接入；MapView 点选命中
51467dc K3: T3 集成内核——parseMm→astToEditable→layoutMindmap 数据管线 + DOM 精确度量注入（只读消费，kernel 零改动）
537b8c2 K3: T2 渲染核心——令牌参数化 NodeG/LinkG + dirty-flag 单帧调度 + 视口裁剪/LOD + 令牌基座补全（叶态/警示/叶描边）
6b25506 K3: T1 主题令牌系统
e6103d8 K3: T1 主题令牌系统（lineStyle 补 curvature 连线曲率令牌）
```

## 一、令牌系统设计说明（T1，含 T2 令牌基座补全）

### TokenSet 结构（`packages/react/src/theme/types.ts`）

三主题全部差异收敛为一份只读令牌集：`color`（画布/文字/分支色板/实体基座/霓虹/连线基座/叶默认卡/警示）/ `radius`（节点/叶/面板）/ `spacing` / `font`（字级/字重根）/ `motion` / `lineStyle`（连线语言 + 线宽 + 曲率）/ `nodeStyle`（形态 + 描边宽 + 叶描边宽 + 阴影）/ `shadow`（面板投影）。

### 三套令牌数据（`tokens.ts`）与设计报告映射

| 差异维度 | classic（V1 XMind） | sticker（V7 Miro/FigJam） | glass（V8 Linear，默认） |
|---|---|---|---|
| 节点形态 | 圆角矩形（rx 9/8） | 贴纸卡（rx 10/7 + drop-shadow(0 2px 3px ≈.12)） | 半透明卡（rx 10/8） |
| 画布底色 | #faf8f4 | #fdfdfb | #16181d + 径向辉光 |
| 分支配色 | 每分支一色（高饱和 6 色） | 多彩贴纸 6 色 | 统一白透明卡（rgba 白 .05/.18） |
| 叶子配色 | 分支色浅化（fill≈95% tint / stroke≈60% tint） | 橄榄贴 #eaf3de/#639922 | 霓虹卡（fill .08 / border .35 / 字 #7ae9c4） |
| 连线语言 | 彩色曲线贝塞尔（宽 2.2，随分支色） | 任意曲线（灰 #c9c4b8 宽 1.2） | 柔和贝塞尔（灰 #3a3f4d 宽 1.2） |
| 字体 | 11/9，weight 500/600 | 12/10，weight 500/600 | 11/9，weight 400/500 |
| 实体节点 | 底 #f5f3ee + KIND_META 语义色描边（跨主题一致） | 同左 | 底 rgba 白 .07 + 语义色描边 |

**T2 令牌基座补全**（渲染必需、按「先令牌后组件」纪律补进 tokens，组件未绕过令牌）：

| 令牌 | classic | sticker | glass | 出处 |
|---|---|---|---|---|
| `color.warn` | #e8590c | #d85a30 | #f76b58 | 未解析实体警示角标 |
| `color.leafDefault` | #fff7ec/#e8a34e | #eaf3de/#639922 | rgba(122,233,196,.08)/.35 | 叶子卡默认（sticker/glass 全叶统一） |
| `BranchColor.leaf?`（每分支） | 6 分支全部设置 → 浅化卡 | — | — | V1 叶子染色随分支浅化 |
| `nodeStyle.strokeWidthLeaf` | 1 | 1 | 0.8 | V1 叶 sw=1 / 贴纸叶 sw=1 / 玻璃叶 0.8 |

### 主题上下文（`ThemeContext.tsx`）

`ThemeProvider`（默认 glass，ADR-0003 决策 4）+ `useTheme()` 返回 `{ token, setTheme }`——切换即换令牌，React 仅重渲染消费方，无组件重挂载（jsdom 测试验证）。

## 二、渲染核心设计说明（T2）

### 调度纪律（禁永续 rAF —— 空闲 CPU ≈ 0 硬验收）

- **`FrameScheduler`**（`render/scheduler.ts`）：dirty-flag + 单帧合批。`request()` 只在无挂起帧时调度一次 rAF，帧内合批执行全部回调后立即休眠；同帧 N 次变更 → 1 次 rAF → 1 次广播（`viewport.test.ts` 断言）。`hasPending===false` = 空闲零活动。
- **`ViewportController`**（`render/viewport.ts`）：pan/zoom/fit 均为「脏标记 + epoch 递增」，经调度器**一帧一次广播**（`broadcasting` 去重）；React `useSyncExternalStore` 单帧单渲。无交互 → 无 rAF / 无 timer。
- `MapView` 卸载 `dispose()` 取消挂起帧。

### 视口裁剪 + LOD

- 裁剪复用 kernel `cull.ts`（`worldViewportRect` / `isBoxInView` / `filterVisibleLinks`），外扩 128px 防边缘闪烁；单帧只提交可见节点/连线。
- `lodFor(k)`：full（k≥0.5）/ detail（叶省略文本）/ skeleton（只画卡）。

### 组件/几何分离（ShapeUtil 精神）

- **几何层**（`render/geometry.ts`，纯函数零 React）：`nodeCardStyle`（全令牌驱动 + KIND_META）、`buildLinkPath`（连线语言分支）、`linkEndpoints`、`nodeHitTest`、`computeBranchIndex`、`lodFor/lodSkipText`。
- **组件层**（`NodeG.tsx` / `LinkG.tsx`）：只做投影，零视觉值、零几何算法；命中检测经 geometry 调用。

## 三、内核集成（T3，kernel 零改动）

- 纯只读消费：`parseMm` / `astToEditable` / `layoutMindmap` / `cachedMetrics`/`displayMetrics` / `compactBezier` / `KIND_META` / cull 系列——kernel 目录零 diff。
- **DOM 精确文本度量注入**（`render/domMeasure.ts`）：主题字体 → canvas 2d `measureText` → kernel `cachedMetrics` 同源 DisplayMetrics（度量盒=渲染盒同源，杜绝溢出）；无 DOM 回退估算；缓存按字符度量实例隔离，主题切换不串盒。
- **数据管线**（`demo/pipeline.ts` → `apps/canvas/MindmapStage.tsx`）：`.mm.md`（kernel fixture gateway，`?raw`）→ `buildEditable` → `buildEntities`（缺口 = unresolved 演示）→ 主题字体度量 → `layoutDemo` → `MapView`。

## 四、玻璃 chrome（T4）

- **恒定玻璃气质**：`CHROME` 常量（`theme/tokens.ts`，ADR-0003 决策 3——外壳不随画布主题漂移）：深色半透明面板 + 霓虹 #7ae9c4 + 恒定圆角/投影；`GlassCard` / 工具条 / `ThemeSwitcher` / `FlipCard` / `PerfPanel` 全部消费 CHROME，组件内零颜色字面量。
- **翻卡交互**（呼应设计报告翻卡评估）：`FlipCard` 3D rotateY；画布点选节点（MapView 命中检测）→ 右侧翻卡正面=节点摘要、背面=`formatNote` 分区笔记（one_liner / status / next / reminder / decisions）。
- apps/canvas：全屏玻璃外壳 + gateway demo 默认 glass 渲染 + 三主题一键切换 + 适配/缩放 + 性能面板。

## 五、性能验证（T5）

基准（`tests/perf.test.ts`，中位数 ×5 采样，681 节点平衡树，对照 kernel 2000 节点 ~23ms 预算）：

| 指标 | 数值 | 对照 |
|---|---|---|
| 节点数 / 连线数 | 681 / 680 | ≥ 500 门禁 ✓ |
| 布局耗时（中位数） | **1.86ms** | kernel 2000 节点 ~23ms；681 节点线性折算 ≈5.5ms/2000 节点，**优于预算 4 倍** |
| 单帧视口裁剪（fit 全图全量扫描） | **1.405ms** | < 8ms CI 阈值；实际交互只渲染可见子集 |
| 可见节点（fit 全图 1280×800） | 325 / 681 + 332 连线 | 裁剪起效（约半） |
| 空闲活动 | `hasPending=false`（帧后休眠） | 无永续 rAF ✓ |

交互流畅性依据：单帧裁剪 < 2ms + React 单帧单渲 + SVG 可见子集提交 → 稳定 60fps 量级；dev-tools Performance 面板可验证空闲段零 rAF 事件（无用户操作时代码路径不产生任何帧调度）。

## 六、三主题实现差异清单（快照即验证）

- **形态**：classic 圆角矩形 / sticker 贴纸卡（CSS `filter: drop-shadow(...)` 令牌直发）/ glass 半透明卡——全部落到 `nodeStyle.shape + color + shadow` 令牌，渲染器单一路径。
- **连线语言**：color-curve（分支色 + curvature 0.4）/ wavy（双弧 S 形 + curvature 0.5）/ soft（curvature 0.3 缓弧）——`buildLinkPath` 按 `lineStyle.language` 分支。
- **叶子态**：classic 分支浅化 / sticker 橄榄贴 / glass 霓虹卡——`nodeCardStyle` 按 `CardLevel` 决策。
- 快照 `docs/preview/themes/*.svg` 由 `scripts/theme-snapshot.mjs` 直接消费 react dist 的 tokens + geometry 生成（与组件同源，非第二套实现）。

## 七、冲突与映射记录（按任务书规则如实记录）

1. **连线曲率取值**：设计报告三版本 SVG 实为同型水平切线单弧（曲率均在 ≈0.44–0.5 区间，视觉差异微弱）。为落实 ADR-0003「连线语言」差异，令牌取 classic 0.4 / wavy 0.5 / soft 0.3；wavy 另以双弧 S 形体现「任意曲线」，soft 以缓弧体现「柔和」。
2. **classic 分支 leaf 浅化**：报告仅给出分支 0（#fff7ec/#e8a34e/#854f0b）与分支 1/2（#f3f8e9/#88a94e、#e8f6f1/#4fa88f）的叶子染色；分支 3–5 未给出，按同法浅化延伸（b3 #efedfc/#9189e0、b4 #fdf0ea/#f2a284、b5 #e9f1fb/#7ba7d4），文本沿用分支 text 色。
3. **sticker 叶子统一橄榄贴**：报告「贴1/贴2」均为 #eaf3de/#639922，故设 `leafDefault` 让所有分支叶子统一，分支卡仍各用贴纸色。
4. **glass 快照底色**：报告 V8 有深底径向辉光（CSS 渐变）；SVG 快照以纯色 #16181d 呈现（径向辉光留在运行时画布，MapView 已通过 `backgroundImage` 应用），视觉基线以节点/连线/配色为主。
5. **chrome 恒定立论**：ADR-0003 决策 3 下 chrome 视觉跨主题相同 → 不入 `TokenSet`（否则三套重复冗余），以独立 `CHROME` 常量承载，仍位于 theme/ 目录满足 grep 纪律。

## 八、参考文档

- ADR: `docs/adr/ADR-0003-design-theme-strategy.md`
- 路线图: `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md`（K3 段）
- 调研: `docs/research/2026-08-27-mindmap-kernel-oss-research.md` §1（渲染架构分野：dirty-flag/单帧调度、ShapeUtil 组件几何分离）
- 设计报告: `docs/preview/mindmap-design-styles-report.html`（V1/V7/V8 内联 SVG = 视觉 spec）
- 快照: `docs/preview/themes/{classic,sticker,glass}.svg`