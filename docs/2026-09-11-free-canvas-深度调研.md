# 自由画布（Infinite / Free-form Canvas）开源生态深度调研

- 调研日期：2026-09-10 ~ 2026-09-11
- 调研目的：为 mindcanvas（纯文本 `.mm.md` 事实源 + React/TS + SVG 渲染 + kernel 纯布局）判断「是否引入/借鉴现成自由画布方案」，以及从严格树形思维导图演进到自由画布时的技术路径。
- 调研方法：GitHub trending（脚本 + 网页双路）、GitHub topic（infinite-canvas / whiteboard）、官方文档与源码、社区实测基准；五路并行子调研交叉验证。
- 数据纪律：所有数字标注来源与核实日期；无法核实的明确写「未核实」，不做推算填充。

---

## 0. TL;DR（先给结论）

1. **自由画布本身已不是 GitHub 趋势热点，热点是「AI Agent × 无限画布」**。本周 JS/TS trending 前排全是 agent 工具链，画布类零上榜；但 topic `infinite-canvas` 下近一年新增的高星项目（opencove 1.6k、thoughtdag 416、dim0 132、horizon 705、termcanvas 395）清一色是「agent 工作区 + 无限画布」。
2. **「纯文本/Markdown 为事实源 + 可自由摆放」这个组合目前基本是空白**，这是 mindcanvas 的真实卡位。Markmap/Mermaid 纯文本但强制自动布局；Obsidian Canvas 自由摆放但事实源是 JSON；Excalidraw/tldraw 自由但事实源是自家二进制/JSON 快照。
3. **不建议 mindcanvas 直接依赖任何白板 SDK**。tldraw 生产需商业许可（非 OSI、带水印强制），Excalidraw SDK 体积 344kB gzip 且 API 有 breaking 史，xyflow 的分组/自动布局/撤销在 Pro 付费层。**借鉴架构而非依赖**，是成本最低、风险最小的路径。
4. **SVG 还能撑很久**：实测临界点在「可见 DOM 数千」量级（5000 节点 SVG ~150ms/帧 vs Canvas 12ms），而 mindcanvas 已有视口裁剪 + LOD，真实可见节点通常远低于此。**先补四叉树与 transform-only 更新，不要急着换渲染器**——这与既有决策（保持 SVG，先证实瓶颈）一致，本次调研给了量化阈值。
5. **最值得抄的三处设计**：Excalidraw 的「Elements 与 ViewState 严格分离 + version/nonce 合并」、tldraw 的「signals + record store + 视口剔除 + LOD」、JSON Canvas 的「nodes/edges 两数组 + 纯 JSON 可 diff」。

---

## 1. 生态全景：五层分类与代表项目

```
第 5 层  应用/产品       tldraw.com   Excalidraw   Miro   FigJam   Obsidian Canvas
第 4 层  画布 SDK        tldraw SDK   @excalidraw/excalidraw   quickdraw(MIT, v0.2)   Plait
第 3 层  节点图/图编辑    xyflow(38k)  AntV X6(6.5k)  LogicFlow(11.5k)  butterfly(停更)
第 2 层  底层渲染引擎     Konva  Fabric.js  PixiJS  leafer-ui(国产,4.4k)  roughjs
第 1 层  浏览器原语       SVG DOM   Canvas 2D   WebGL/WebGPU   CSS transform
```

### 1.1 GitHub topic `infinite-canvas` 实测榜单（2026-09-11 抓取）

| 项目 | Star | 语言 | 最近更新 | 定位 |
|---|---|---|---|---|
| flxzt/rnote | 11.6k | Rust | 2026-09-08 | 手写笔记/草图（gtk4） |
| mbrlabs/Lorien | 6.8k | GDScript | 2025-09-22 | Godot 实现的无限画布白板 |
| leaferjs/leafer-ui | 4.4k | TypeScript | 2026-09-04 | **国产** Canvas 引擎，自称"AI 时代的无限画布引擎" |
| miroiu/nodify | 2k | C# | 2026-06-10 | WPF 节点编辑器控件 |
| serge-rgb/milton | 1.9k | C++ | 2023-06-04 | OpenGL 无限画布绘画 |
| malbiruk/driftwm | 1.7k | Rust | 2026-09-06 | 触控优先的 Wayland 合成器 |
| DeadWaveWave/opencove | 1.6k | TypeScript | 2026-09-10 | **Agent 无限画布工作区**（Claude Code/Codex/终端/任务/笔记） |
| xiaoiver/infinite-canvas-tutorial | 1.1k | TypeScript | 2026-08-19 | **WebGL/WebGPU 无限画布教程**（含 ECS 渲染引擎） |
| peters/horizon | 705 | Rust | 2026-09-10 | GPU 加速终端板（wgpu） |
| ErrorAtLine0/infinipaint | 485 | C++ | 2026-09-10 | 无限缩放协作绘画 |
| quickdrawjs/quickdraw | 451 | JavaScript | 2026-09-10 | **MIT 白板 SDK，tldraw 开源替代（v0.2.0）** |
| chenxiachan/thoughtdag | 416 | TypeScript | 2026-09-10 | LLM 对话长成可编辑思维图（react-flow + local-first + MCP） |
| blueberrycongee/termcanvas | 395 | TypeScript | 2026-05-31 | 终端可视管理的无限画布 |
| Sayhi-bzb/CharDesk | 334 | TypeScript | 2026-09-10 | **Unicode 画布：把图/界面/幻灯片画成可编辑文本** |
| vcmf/dim0 | 132 | TypeScript | 2026-09-08 | 实时协作 AI 画布（含 mindmap、RAG、mini-apps） |

来源：https://github.com/topics/infinite-canvas （2026-09-11 抓取）

### 1.2 Trending 侧写（本轮实测）

- TypeScript monthly / JavaScript weekly 前排**无任何画布类项目**，全部是 AI agent 工具链（cursor/plugins、openclaude、oh-my-pi、distilly 等）。
- 说明：画布已经从"新鲜概念"变成"基础设施"，热度转移到上层 AI 应用；**靠 trending 发现画布项目的路子已失效，必须走 topic + 定向搜索**。
- 工具提示：`github-trending-cn` 脚本本次因 GitHub API 匿名配额耗尽（Rate limit，重置约 26 分钟）取详情失败，trending 页面本身可直接抓（不消耗 API）。**建议给脚本配 `GITHUB_TOKEN`**，否则 50 个仓库详情会全部打空。

---

## 2. 关键项目深度剖析

### 2.1 tldraw（画布 SDK 事实标准，但许可不友好）

| 维度 | 事实 | 来源/日期 |
|---|---|---|
| Star / 下载 | 50.2K★；npm 周下载 217.3K | tldraw.dev 首页，2026-09-11 |
| 版本 | v5.4.2（核实前 4 小时发布）；minor 月更且可能含 breaking | npmjs.com/package/tldraw，2026-09-11 |
| 体积 | 解压 14.9 MB / 1881 文件；依赖 TipTap、radix-ui | registry.npmjs.org，2026-09-11 |
| 许可 | **tldraw License，非 OSI 开源**；生产环境（含 SaaS）需商业许可密钥，含强制水印技术措施；100 天试用；商业价未公开，第三方称 ~$6,000/年（**未核实官方**） | LICENSE.md / tldraw.dev |
| 渲染 | 形状走 **HTML/SVG DOM + CSS transform**；画笔/手柄/吸附等瞬态 overlay 走 Canvas 2D 以绕开 React reconciliation；minimap 是否 WebGL **未核实** | tldraw.dev、deepwiki |
| 状态 | `@tldraw/state`（signals 细粒度响应式）+ `@tldraw/store`（TLRecord 记录库，事务批处理、自动迁移） | tldraw.dev |
| 扩展模型 | `ShapeUtil`（component / getGeometry / getIndicatorPath / props 校验器）+ `Binding` + `StateNode` 工具状态机 | tldraw.dev |
| 性能 | `maxShapesPerPage=4000`；屏外形状 `display:none` 剔除（"10000 形状可能只渲染 50 个"）；几何缓存；`debouncedZoomThreshold=500`；`textShadowLod=0.35` | tldraw.dev/sdk-features/performance、/culling |
| 协作 | `@tldraw/sync` 基于 Cloudflare Durable Objects，每 room 单例权威副本，WebSocket 做记录级 CRUD 中继；**生产必须自托管** | tldraw.dev/docs/sync |
| 限制 | 不支持 SSR（须 `ssr:false` 动态导入）；仅 React（peerDep ^18.2\|\|^19.2）；v4.0 起 WCAG 2.2 AA | GitHub discussion #552、releases v4.0 |

**坑**：许可合规（水印 + 生产付费）是最大风险；体积大；自定义形状须完整实现 ShapeUtil，DOM 测量类形状要关闭剔除否则出 bug。

**对 mindcanvas 可借鉴**：signals + record store 的细粒度响应式；视口剔除 + 空间索引 + 几何缓存；ShapeUtil 的「props 校验 / geometry / component」三分离；缩放防抖与 LOD 简化。

### 2.2 Excalidraw（MIT，Canvas 双分层，最值得抄数据模型）

| 维度 | 事实 | 来源/日期 |
|---|---|---|
| Star | 131,539（fork 15,197） | api.github.com/repos/excalidraw/excalidraw，2026-09-10 |
| 许可 | 仓库与 `@excalidraw/excalidraw` 均 **MIT**，商用无限制 | package.json / LICENSE |
| 版本 | 0.18.1（2026-04-21，修 Mermaid XSS CVE-2025-54881）；0.18.0 加 CJK 字体（2025-03） | winterflow.io releases |
| 渲染 | 双 Canvas：**StaticCanvas**（形状/文本/图像，仅场景变更重绘）+ **InteractiveCanvas**（选区、远程光标、吸附线，rAF 驱动）；手绘风 roughjs | deepwiki rendering-architecture |
| 数据模型 | Element 含 `id/version/versionNonce/seed/index/isDeleted/groupIds/frameId/boundElements/containerId`；冲突靠 `version+versionNonce` 经 `reconcileElements` 合并 —— **不是完整 CRDT** | plus.excalidraw.com scene-content-schema |
| 状态 | React class `App`，`state = AppState`（70+ 字段：scrollX/scrollY/zoom/theme/tool）；轻量 UI 态用 **Jotai**；Scene 单独存 elements（**Elements 与 ViewState 严格分离**） | deepwiki state-management |
| 协作 | 浏览器生成 **128-bit AES-GCM** 密钥放 URL fragment（`#room=ID,KEY`，服务端不可见）；Socket.IO 中转密文；自托管需 excalidraw-room + storage-backend(PostgreSQL)，横向扩展要 sticky session/Redis | deepwiki collaboration、railway |
| 文件格式 | `.excalidraw` = `{type, version:2, elements, appState, files}`；迁移靠 `restoreElements` + migration 函数 | docs.excalidraw.com/json-schema |
| 性能 | 视口剔除 + `ShapeCache`(WeakMap 缓存 rough Drawable) + 离屏 canvas + `getRenderableElements` 记忆化；**社区实测 ~8000 对象起 ~30fps（非官方基准）**；issue #10512 全景遍历致 pan/zoom 卡，PR #10514 用空间索引修（2025-12 未合入） | deepwiki、GitHub #10512/#10514 |
| SDK 体积 | ~1.1 MB min / **344.4 kB gzip**（@0.18.1） | Bundlephobia |

**坑**：SDK API 有过多次 breaking（0.17.0 移除 Ref 等）；文字绘进像素，不可被搜索引擎/读屏索引；E2EE 导致服务端无法检索与撤销；自托管协作三件套运维成本不低。

**对 mindcanvas 可借鉴**：① Elements 与 ViewState 严格分离 + version/nonce 合并，天然适配纯文本事实源；② 文件带 `version` 字段 + migration 函数做向前兼容；③ 形状缓存 + 离屏复用对应到 SVG 侧的「布局/文本测量缓存」；④ 反过来确认：**SVG 在中文文本、无障碍、可选中性上优于 Canvas，这是 mindcanvas 的差异化优势，不要为了追 Excalidraw 而丢掉**。

### 2.3 节点图 / 图编辑框架（自由画布的中间形态）

| 项目 | Star(2026-09) | 渲染 | 许可 | 维护 | 规模上限 | 最适合场景 |
|---|---|---|---|---|---|---|
| xyflow (React/Svelte Flow) | ~38K | HTML 节点 + SVG 边 | MIT，**分组/对齐/自动布局/撤销在 Pro 付费层** | 活跃（2026-09-01 有发布） | 数百流畅，数千需 `onlyRenderVisibleElements`；社区实测 1 万节点 | React 通用节点编辑器、工作流 |
| AntV X6 | ~6.5K | SVG + HTML | MIT（无付费墙/水印） | 活跃（3.1.8，2026-08） | `virtual:true` 视口裁剪，社区建议 ≤3000 | 企业级流程图/ER/BPMN/DAG，跨框架 |
| LogicFlow（滴滴） | ~11.5K | SVG + HTML 覆盖层 | **Apache-2.0** | 较慢（2.1.11，2026-01） | 虚拟化 3000 实测 OK | 业务流程图/BPMN/审批流 |
| alibaba/butterfly | ~4.5K | DOM + SVG | MIT | **停滞（2023-08 后无提交）** | 未核实 | 血缘/调度（不建议新项目） |
| Plait（worktile） | ~630 | SVG(roughjs) + foreignObject | MIT | 小众活跃（v0.91.0，2025-11） | 1000+ 脑图流畅 | 一体化白板：mind / draw / flow 三模块 |
| JointJS | ~5.4K | SVG | MPL-2.0（高级功能商业） | 活跃 | 未核实 | SVG 图编辑器 |
| GoJS | ~6.1K（较早数据） | Canvas | 商业（试用带水印） | 商业维护 | 高 | 全功能商业图编辑器 |
| Cytoscape.js | ~11.2K | Canvas/WebGL | MIT | 活跃 | 大网络优化 | 关系图分析，非编辑 UI |
| Konva / Fabric / PixiJS | 11K / 29K / 44K | Canvas/WebGL | MIT | 活跃 | 数千~万级 | 自研画布的底层原语 |

**判断**：从"严格树形"演进到"自由画布"，形态上最接近的是 **xyflow**（任意坐标、自由连线、多父 DAG、自定义节点全部原生支持，且同为 React）。代价：分组/对齐/自动布局/撤销属付费层，超大图有 DOM 瓶颈需自研虚拟化。**X6** 无付费墙、插件最全，但不是白板范式。**Plait** 的「Slate 式插件 + mind/draw/flow 三件套」架构最贴合 mindcanvas 的愿景（脑图 → 自由画布 → 白板），但 star 少、偏 Angular、节奏慢，**适合借鉴架构而非直接依赖**。Butterfly 停更、LogicFlow 偏流程，均不建议。

### 2.4 思维导图类与"纯文本事实源"竞品

| 项目 | Star | 许可 | 渲染 | 事实源 | 自由摆放 | 维护 |
|---|---|---|---|---|---|---|
| wanglin2/mind-map (simple-mind-map) | ~12.5K | MIT | SVG/Canvas | 自有 JSON（可导入 MD/XMind） | 支持**自由节点 + 关联线** | README 自述开源库进入**低维护状态**（闭源客户端仍在开发） |
| markmap | 未核实 | MIT | SVG(d3) | Markdown → 树 | **否**（自动层级布局，纯渲染非编辑器） | v0.18.12（2025-06）；README 2026-06 更新 |
| Freeplane | ~4.3K | GPL-2.0 | Java/Swing | `.mm` (XML) | 支持自由浮动节点/自由定位 | 活跃，已加 AI chat + MCP server |
| FreeMind | — | GPLv2 | Java | `.mm` | 支持 | **基本休眠**（2023-11 后） |
| Obsidian Canvas | —（格式 MIT） | MIT | — | `.canvas` JSON：根对象仅 `nodes`/`edges`，node 有 `x/y/width/height`，edge 有 `fromNode/toNode/fromSide/toSide/label` | **是** | 生态活跃 |
| markvault-js / @hediet/vite-plugin-mindmap | — | — | — | — | — | **未核实**（搜索未命中可靠仓库） |

**关键发现**：「纯文本事实源 + 自由摆放」几乎是空白赛道 —— Markmap/Mermaid 是纯文本但强制自动布局；Obsidian Canvas 可自由摆放但节点文本内嵌 JSON，不是外部 `.md`。**mindcanvas 的 `.mm.md` + 坐标覆盖思路正好落在这个空档**。

### 2.5 新锐项目（值得持续观察）

- **quickdrawjs/quickdraw**（451★，MIT，v0.2.0，2026-09-10 更新）：明确对标"tldraw 的免费开源替代"，零运行时依赖、纯 ESM、框架无关（core/react/react-native 三包），**文档模型每次变更产出 JSON-safe diff，可接任意传输层同步**；自认年轻，缺首方多人服务、图层、frame、富文本。**若 mindcanvas 未来真要引入白板能力，这是许可上唯一无雷的选项，但 0.x 阶段不能直接上生产。**
- **leaferjs/leafer-ui**（4.4K★，TS，国产）：Canvas 引擎，自称"AI 时代的无限画布引擎"，活跃度高，可作为未来切 Canvas 渲染时的国产备选。
- **xiaoiver/infinite-canvas-tutorial**（1.1K★）：WebGL/WebGPU + ECS 的无限画布系统教程，**是切 WebGL 前最划算的预习材料**（含渲染引擎、拾取、文本、网格等专题）。
- **thoughtdag**（416★）：LLM 对话 → 可编辑思维图（react-flow + local-first + MCP），"Wires are the context" —— 与 mindcanvas 的 AI 编写守则方向高度同构。
- **CharDesk**（334★）：Unicode 画布，把图/界面/幻灯片**画成可编辑文本** —— 与 mindcanvas「纯文本优先」哲学最同频的极端形态，值得看它的交互取舍。
- **OCIF（Open Canvas Interchange Format）**：CC BY-SA 4.0，2026-03 发布 v0.7 候选推荐，目标是跨工具无损互通 —— **画布界的"通用交换格式"正在成型，值得跟踪**。

---

## 3. 技术维度对比矩阵

| 维度 | tldraw | Excalidraw | xyflow | AntV X6 | Plait | mindcanvas（现状） |
|---|---|---|---|---|---|---|
| 渲染 | DOM+SVG 为主，overlay 用 Canvas | 双 Canvas 2D | HTML 节点 + SVG 边 | SVG + HTML | SVG(roughjs) | **SVG** |
| 事实源 | JSON 快照（store） | `.excalidraw` JSON | 宿主应用数据 | 宿主应用数据 | 自有模型 | **`.mm.md` 纯文本** |
| 坐标 | 页面/形状坐标 + CSS transform | 场景坐标 + scrollX/Y/zoom | 节点 x/y + viewport transform | cell position | 有限画布模型 | 文档级坐标覆盖（设计中） |
| 状态 | signals + record store | AppState + Scene 分离 | Zustand（宿主） | 自有 | Slate 式插件 | kernel 解析 + React |
| 视口裁剪 | `display:none` + 空间索引 | `isElementInViewport` + ShapeCache | `onlyRenderVisibleElements` | `virtual:true` | 未核实 | **已实现**（CULL_MARGIN=128） |
| LOD | zoom 阈值降级（阴影/图案/简化几何） | 网格按缩放跳过细线 | 无（靠虚拟化） | 未核实 | 未核实 | **已实现**（按总节点数） |
| 命中测试 | 几何系统 + 空间索引 | 视口过滤后遍历 | DOM 事件 | DOM/SVG 事件 | 未核实 | O(N) 遍历（**待加索引**） |
| 协作 | @tldraw/sync（DO，自托管） | E2EE + Socket.IO 中继 | 无（宿主负责） | 无 | 无 | 无 |
| 许可 | 商业（生产付费+水印） | MIT | MIT + Pro 付费 | MIT | MIT | 自有 |
| 文本可索引 | 好（DOM） | **差**（绘进像素） | 好 | 好 | 好（foreignObject） | **好**（SVG + 文本源） |

---

## 4. 性能与渲染专题：SVG 的天花板与切换阈值

### 4.1 量化差异（实测基准，非官方）

| 规模 | SVG | Canvas 2D | WebGL |
|---|---|---|---|
| 1,000 节点 | 25 ms | 3 ms | — |
| 5,000 节点 | 150 ms（~35fps）/ 另一组 85ms | 12 ms | — |
| 10,000 节点 | >400 ms（<3fps）/ 另一组 210ms（12fps） | 25 ms | — |
| 100,000 元素 | 不可用 | 95 ms | 2 ms |
| 1,000,000 元素 | 不可用 | — | 8 ms |

来源：blog.form.dev/renderer/renderer-series-why-not-svg；svggenie.com/blog/svg-vs-canvas-vs-webgl-performance-2025；chartts.com/blog/canvas-vs-svg-vs-webgl
经验法则：静态 SVG ≤500–1000 元素安全，动态 >2000 应考虑 Canvas（blog.vijayt.com）。
**注意：这些数字是"总渲染节点"，不是"可见节点"——mindcanvas 已裁剪，应对标可见数。**

### 4.2 无限画布的标准优化套路

1. **视口裁剪 / 虚拟化**：tldraw 用空间索引 + `display:none`，"10000 形状可能只渲染 50 个"（tldraw.dev/performance）；Excalidraw `isElementInViewport`，>500 元素就有明显收益。mindcanvas 的 `CULL_MARGIN=128` 属合理量级（最优值未实测）。
2. **LOD**：tldraw 缩小时图案转纯色、关文字阴影、简化几何；Excalidraw 网格 `actualGridSize<10` 不画。mindcanvas 已有 LOD，但按"总节点数"而非"屏幕尺寸/zoom"判定，**平移时会整体跳变**（既有记忆：LOD 用总节点数是为保持平移稳定）——可考虑改为「按 zoom 分级 + 平移期间冻结等级」。
3. **空间索引**：四叉树/R-tree/网格，命中测试 O(N)→O(logN)。tldraw/Miro 均用四叉树。Excalidraw 直到 2025-12 才有 PR #10514 补（未合入），说明 **O(N) 在数千规模下确实会卡**。
4. **批处理 / 分层 / 离屏**：Excalidraw 静态层+交互层分离；脏矩形在 10–20% 区域变化时省 70–80% 渲染（reintech.io）。
5. **绕开 React 重渲染**：tldraw 相机移动直接 `setProperty` 改 CSS transform；signals 只更新变更 shape。
6. **命中测试方案对比**：SVG 原生事件最省；几何检测（反序+包围盒）10,000 点 5–20ms；`isPointInPath` 10,000 次需 2000ms（仅适合 <100 图形）；**拾色缓冲（color picking）0.1ms、O(1)**，Konva 采用，适合图形多且不常重绘（mo4tech）。

### 4.3 平移/缩放的正确做法与坑

- 用 **transform 全局矩阵**而非逐元素重排（Excalidraw 一次 `ctx.transform` 投影）。
- 坑 1：CSS `translate` 位移上限约 **±10,000,000px** 会截断（超大画布需注意）。
- 坑 2：缩放**必须重绘路径**，否则矢量拉伸模糊；Canvas 下需按 **DPR** 放大缓冲区（`canvas.width = rect.width * dpr` + `ctx.scale(dpr,dpr)`）。
- Figma 的经验：GPU 渲染成本按**像素**而非对象数计费，10 个与 5 万个形状开销相近（figma.com/blog）；Miro 用 WebGL + 四叉树 + 实例化，10 万 widget 保 60fps。

### 4.4 迁移路径（渐进，不要一次性重写）

```
阶段 0（当下）   SVG + 视口裁剪 + LOD                     ← mindcanvas 在此
阶段 1           加四叉树空间索引 + transform-only 更新
阶段 2           混合渲染：结构/文本层 SVG，海量层 Canvas
阶段 3           WebGL/WebGPU 瓦片化（Figma 路线，成本最高）
```
tldraw 本身就是「DOM/HTML 结构层 + Canvas 瞬态层」的混合范例；Figma 则彻底自研 WebGL + WASM（2018 重写提速 3x，2025 加 WebGPU）。**成本量级（人日未核实）**：SVG→Canvas 中等（重写渲染层 + 自建命中测试与文本缓存）；Canvas→WebGL 高（自建文本布局、输入、无障碍）。

---

## 5. 趋势判断：真实需求 vs 噪音

**真实需求**
1. **AI 生成式画布**：tldraw Make Real（草图→HTML）、Flowith（非线性思考工作区）、Napkin/Gamma（文本→视觉资产）已跑通商业形态；本轮 topic 榜单里 opencove/thoughtdag/dim0/horizon 全是这个方向。
2. **协作 + CRDT / local-first**：tldraw-sync、Excalidraw E2EE、Yjs/Automerge 已成标配。
3. **开放可 diff 格式**：JSON Canvas（MIT）已被 Obsidian 生态采用；**OCIF**（CC BY-SA 4.0，2026-03 v0.7 候选）正在做跨工具互通标准。

**噪音**
4. 大量"AI Agent 无限画布"只是 GPT 包装层，无数据模型创新；"无限 agent 步数/上下文"多为营销。
5. 单纯"手绘风白板"赛道已极度内卷（Excalidraw 131k★ + tldraw 50k★ 双寡头），**新进入者没有差异化就别做**。

---

## 6. 对 mindcanvas 的具体建议（按优先级）

### P0 — 立刻可做、收益确定

1. **不要把白板 SDK 作为依赖引入**。tldraw（生产付费+水印）、Excalidraw SDK（344kB gzip + breaking 史）、xyflow（核心能力在 Pro 付费层）都不划算；继续自研 kernel + SVG。若未来必须引入，唯一无许可雷的是 quickdraw（MIT，但 v0.2.0，只可作为观察对象）。
2. **加空间索引**：把命中测试与可见性查询从 O(N) 换成四叉树/网格 O(logN)。触发阈值建议：总节点 > 1000 或可见节点 > 300 时启用。
3. **transform-only 更新**：平移/缩放一律走 CSS transform / `setProperty`，禁止逐节点 React 重渲染；节点 > 500 时禁用逐节点 state 更新。

### P1 — 短期（1–2 个迭代）

4. **LOD 判定改为「zoom 分级 + 平移期冻结」**：当前按总节点数判定会导致平移时整体跳变；改为按屏幕尺寸（节点 < 24px 或 zoom < 0.3 降级），并在平移/缩放手势期间锁定等级，手势结束再重算。
5. **裁剪 margin 自适应**：`CULL_MARGIN=128` 保持默认，但当可见节点 > 2000 且帧率 < 50fps 时动态扩大 margin，减少进出抖动带来的反复挂载。
6. **对齐 JSON Canvas 作为交换格式（只做导出/导入，不改事实源）**：`.mm.md` 仍是唯一事实源，额外支持导出 `.canvas`（nodes/edges 两数组），直接吃下 Obsidian 生态。这能把既有的「自由连线 + 多中心升格」成果变成可互操作资产。
7. **文件格式版本化**：学 Excalidraw 的 `version` 字段 + migration 函数链，为 `.mm.md` 的 note 协议（v1.4）升级做准备，避免将来靠 parse 时兜底。

### P2 — 中期（需要摩擦驱动，不要提前做）

8. **AI 只做"薄生成层"**：让 AI 以「追加可 diff 的 `.mm.md` 文本片段」方式生成导图，先在内存预览再落盘（与既有"AI 改动先进预览再确认"一致）。不要现在就做画布内多模态生成或长链路 agent 管线。
9. **协作**：若出现 ≥2 条跨文档真实摩擦再启动；届时优先 Yjs（local-first），不要自造同步后端。
10. **渲染器切换**：只有同时满足「可见节点 > 5000 且帧率 < 30fps」或「总节点 > 20000」时才启动「SVG 结构层 + Canvas 海量层」的混合方案评估；WebGL 之前先读 xiaoiver/infinite-canvas-tutorial。

### 明确不做

- ❌ 为追 Excalidraw 的手绘风切 Canvas（会丢掉中文文本、无障碍、可选中、可 diff 的差异化优势）。
- ❌ 依赖 tldraw/xyflow Pro 等带付费或水印的组件。
- ❌ 现在上协作、上 AI agent 画布——没有真实摩擦驱动就是治理动作。

---

## 7. 未核实项与风险

| 项 | 状态 |
|---|---|
| tldraw 商业授权官方价格 | 未核实（仅第三方 ~$6,000/年） |
| tldraw 空间索引具体结构（四叉树/R-tree） | 未核实（官方只说"维护 spatial index"） |
| tldraw minimap 是否 WebGL | 未核实 |
| markmap 精确 star 数 | 未核实（页面未取到计数） |
| markvault-js / @hediet/vite-plugin-mindmap | 未核实（未命中可靠仓库） |
| Plait 的嵌套/frame 分组能力 | 未核实 |
| 各渲染基准的浏览器/硬件条件 | 未核实（来源未统一环境，只能看量级） |
| butterfly、GoJS 最新 star | 较早数据 |
| 国产 flowmix / 腾讯·字节系开源画布 | 未核实（无可靠开源仓库） |

**风险提示**：本轮 GitHub API 匿名配额已耗尽，`github-trending-cn` 脚本的仓库详情抓取全部失败，trending 数据改用网页直抓；引用 star 数以各来源标注日期为准，可能随时间漂移。
