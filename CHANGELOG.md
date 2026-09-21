# mindcanvas Changelog

本文件记录已冻结的公开接口面（K0-K5 阶段演进）。自 **1.0.0** 起，`@mindcanvas/kernel` 与 `@mindcanvas/react` 的公开导出遵循 semver 管理（见 `docs/adr/ADR-0004-interface-freeze-v1.md`）。

> **版本号说明（2026-09-11 补记）**：`v1.4.0`–`v1.7.0` 的号位最初预定于代码注释
> （`packages/kernel/src/protocol/types.ts`）。其中「布局岛 / cid 持久身份 / `note.dir`」
> （09-05~09-06）与「图引擎适配 / 文件工作台」（09-10）等批次未单独标号，
> 按完成时间归入对应段落末尾的「同批」小节。

## [未发布 · 待版本号] — 2026-09-21 · 摘要节点（XMind 式概要）S1–S4

> **版本状态（如实）**：本段是在制批次，**尚未发版**——`@mindcanvas/kernel` / `@mindcanvas/react`
> 版本号仍为 **1.7.0**（`apps/canvas` 亦然），根 `package.json` 为 `0.0.0`。
> 号位按仓内既有惯例留作 **v1.12 候选**（`docs/specs/2026-09-02-mm-md-protocol.md` §6.5 /
> §十二 版本历史同措辞）；发布批次统一编号。**本段只记到 S4**，S5（收尾与文档收口）未启动。

**本批含四组**（S1 数据层 / S2 创建事务与交互 / S3 布局卫星 / S4 括线渲染与导出）。
S4 的完整回执与证据在 `docs/dispatch/2026-09-21-summary-node-s4-report.md` 与
`outputs/summary-node/S4/S4-20260921-160000/`。

- **数据层（S1）**：新增 `Note.summary_of`（`{ from, to }`，两字段非空、写入一律 `cid:`）；
  `resolveSummaries` 三态解析（`well-formed` / `dangling` / `stale`，含**同父 + 顺序 +
  S 不在区间内**校验）+ `W-SUMMARY-DANGLING` 诊断；锚迁移登记进 `cutAttach`
  （形态 `summary_of.from` / `summary_of.to`）。
- **创建事务与两跳交互（S2）**：`planCreateSummary` / `createSummary`（校验存在/非根/同父/顺序；
  `ensureNodeCid` 两端缺失才补；单条 undo）；右键菜单「创建摘要…」入「结构」区（**加法**：
  `summaryActions` 缺省不渲染）；画布第一跳进 draft、第二跳点选末成员完成（Esc/空白/切文档清草稿）。
- **布局卫星（S3）**：`buildSatellitePlan` 把 well-formed 摘要**从布局树摘除**为成员带外侧卫星
  （`LayoutResult.satellites` **加法字段**；卫星子树根同时出现在扁表 → 渲染/命中/选择零改动）；
  只承诺 `layoutMindmap`（含无 `note.dir` 回退）与 `layoutLogic`（森林左/右岛）两条路径，
  org / 显式 `note.dir` / 框内**留流内降级**（宁可无括线，不让节点消失）；嵌套摘要
  （成员区间含另一摘要）走 `nestedSkip` 同一出口；森林岛平移与岛内链接随动。
  导出常量 `SUMMARY_BRACKET_GAP` / `SUMMARY_STEM_GAP` 供渲染层复用（唯一口径）。
- **括线渲染与导出（S4）**：
  - `render/summaryFrames.ts`（**纯几何**，零 React/DOM）：`buildSummaryViews` 由
    `layout.satellites`（唯一的「该不该画」判据）+ `buildSatellitePlan().specs`（成员区间）
    + 扁表盒 + kernel 常量产出 `{ summaryId, side, memberIds, bracketPath, stem*, memberBand, summaryBox }`。
    **不重解析** raw `summary_of`、不重跑 `resolveSummaries`；成员**子树**并集为带，左右严格镜像；
    成员盒/satellite 盒缺失或降级项（dangling/stale/nestedSkip）一律跳过。
  - `render/SummaryLayer.tsx`：方括号 + stem，线色/线宽取主题 token；
    挂载在 MapView 变换 `<g>` 内**层序 `sections → summaries → tree-links → … → nodes`**
    （括线是树线延伸，必须在节点卡之下）；`pointer-events: none` → **命中/选择逻辑零改动**；
    稳定锚点 `data-summary-bracket` / `data-summary-stem`。选中摘要 → 成员高亮；
    选中成员 → 反向显示所属摘要状态（**只读可视化，不写布局数据**）。
    Canvas 后端**不宣称支持括线**（与 SectionLayer 同边界，不经 SVG 分支即不渲染）。
  - `chrome/exportSvg.ts`：括线插入**导出实际发射序**「背景 `rect` → 树线 `path` →
    跨岛补线 `boundaryLinks`（虚线）→ **摘要括线** → 节点卡」。
    （导出**不画框边界**；且此处括线在树线**之后**，与画布 DOM 层序
    `sections → summaries → tree-links`（括线在树线**之前**）方向相反 —— 两者是不同契约，见协议 §6.5 对照表。）
    `root` 为**加法选项**，**不传 = 与 S4 之前逐字等价**（有逐字等价用例钉死）；
    导出件保留 `data-summary-bracket` / `data-summary-stem`；PNG 经 `exportPng` 透传同口径。
    产品壳 `useExportActions` 透传 `controller.root`（缺省不传 → 旧调用方零改动）。
  - 回归：`packages/react/tests/summary-frames.test.ts`（18）、`summary-layer-host.test.tsx`（6，
    **真挂载生产 MapView**）、`summary-export-svg.test.ts`（10）、
    `apps/canvas/tests/summary-export-root.test.tsx`（2，宿主 root 透传）、
    `apps/canvas/tests/prod-build-isolation.test.ts`（2，**产物级**扫 dist 断言
    `__mindcanvasSummaryHost` / `__MINDCANVAS_TEST_BUILD__` 零命中）。
    浏览器 `tools/verify-summary.mjs`（创建 / 成员变化 / 左右向 / 三主题 / 三档缩放 / 导出，全绿）。
  - **negative controls（4 组，实测退出码 1，红因均为目标断言）**：删 `<SummaryLayer>` 挂载 →
    宿主括线用例红；摘要层挪到节点层之后 → 层序用例红；成员带改用**成员自身盒** →
    子树几何用例红；删 `satellites` 空早退（改消费 `plan.specs`）→ 降级用例红。

## [未发布 · 待交付] — 2026-09-19 · 交付收口（保存生命周期 + MODE-GUARD + 类型门禁 + 债务收口）

> **版本状态（如实）**：本段是在制批次，**尚未发版、未提交**——`@mindcanvas/kernel` / `@mindcanvas/react` 版本号仍为 **1.7.0**（`apps/canvas` 亦然），根 `package.json` 为 `0.0.0`。上方 `[1.12.0]` 同样是**未发布**的号位预留；请勿把本段当作已发布说明。发布时需另起一批：升版本号 + 更新 README 状态 + 打 tag。

**本批含五组**（每组都有真浏览器证据与回归钉；详见 `docs/dispatch/2026-09-18-delivery-close-report.md` 与两份回执，以及深度收尾返修回执 `docs/dispatch/2026-09-19-delivery-close-finish-repair-report.md`）：

- **保存生命周期（包 1）**：慢写窗口不误清新编辑（写出快照按**内容身份**判定，继续编辑则保持 dirty 并续写）；另存为后的排队写入写**新目的地**；`downloaded` 只表示「发起了下载」，不当作已落盘、不自动离开，提示文案不再声称「已写入文件」；`remember` 等附属失败与写盘成功解耦（独立警告渠道）。回归：`apps/canvas/tests/save-lifecycle.test.tsx`、`useAutoSave.test.tsx`、`useDocumentActions.test.tsx`；浏览器 `tools/verify-save-lifecycle.mjs`（PASS）。
- **MODE-GUARD 离开保护（包 2）**：单实例离开决策器（三选项模态 + 默认非破坏性焦点 + Tab 约束 + 焦点恢复）、单请求互斥（含异步目标期间）、「flush 草稿 → 复核 dirty/saving → 才执行目标」；中文组合输入（IME）**未结束不得提交候选串**（组合跟踪加载即装、编辑器提交边界拒绝并在 `compositionend` 补提交、暂缓期不弹模态/非模态提示 + 自动续跑）；端口注销/替换/决策器卸载使在途请求结算 `false`（迟到回调零副作用）；草稿会话通道覆盖**预览态/隐藏态**草稿；提交**失败**如实上报（`'failed'`）——保留草稿、目标零执行、可修正后重试或显式放弃。回归：`unsaved-transition.test.tsx`、`mode-guard.test.tsx`、`free-canvas-leave.test.tsx`、`leave-entry-matrix.test.tsx`、`note-back-leave.test.tsx`；浏览器 `tools/verify-mode-guard.mjs`（PASS，含 A/B/C/D/E 旅程）。
- **Canvas 后端连线落笔（DF-R4 最小修复）**：`canvasBackend.tsx` 的 `tracePath` 此前只对 `M` 调 `beginPath()`、不产出任何几何指令，`case 'path'` 对空路径 `stroke()` —— 显式 `?backend=canvas` 或**布局节点总数 > 50000**（`CANVAS_AUTO_NODES`）自动降级时，节点卡与文字正常但**树线/组织图梁线/hub 箭头全不显示**。现按场景构造器实际产出的 `M`/`L`/`Q`/`C`/`Z` 绝对指令做有界解析（空格与逗号分隔都吃；未知/相对指令不落笔也不抛错），`Ctx2D` 相应增补 `moveTo`/`lineTo`/`quadraticCurveTo`/`bezierCurveTo`/`closePath`。回归：`packages/react/tests/canvas-backend.test.tsx`（+4 条，react 1498→1502）+ 浏览器 `tools/verify-release-123.mjs` 的 R5d（墨迹跨度内无整列空白 + 连线细柱）；负控 `neg-canvas-links`（只把路径几何打成空函数）只让 R5d 转红。**未**顺带做 DPR、图片异步缓存或后端重构；含中心/自由边的文档仍由产品壳强制 SVG。
- **类型门禁补盲区**：新增 `apps/canvas/tsconfig.test.json`（`tsc -p … --noEmit`），canvas `typecheck` 脚本、`.githooks/pre-push` 回退路径与 CI 同时覆盖 `tests/`；实测诊断 **7 → 0**（其中 `no-native-dialogs` 改用 Vite `?raw` glob，不再需要 `@types/node`）；pre-push 回退补齐 **free-canvas** 的类型与测试（四子项目集合与 `pnpm gate` 一致）。
- **债务收口（budget 回到全绿）**：`asCast 32 → 31`（`domMeasure` 用 `WeakMap<EditableNode, DisplayMetrics>` 取代 `as WeakMap<…, never>` 断言）；超 600 行生产文件 **6 → 4**——`mindmap.ts` 631 → **499**（连线几何抽到 `layout/linkGeometry.ts`，原符号**再导出**、导入路径不变）、`frameLayout.ts` 983 → **424**（按职责拆出 `frameHangGeometry.ts` / `frameIslandGeometry.ts` / `frameTreeGeometry.ts`；框语义、四向镜像、baseDepth 透传、布局缓存键与既有导出面均不变）。`pnpm budget` 退出码 **0**（`asCast 31/31`、`bigFiles 4/4`，其余持平或更优）。
- **验收基础设施强化（深度收尾 · 仅工具与夹具，该批产品源码零改动）**：① 写盘替身改为**账本**（`tools/lib/releaseAcceptance.mjs` 的 `createWriteLedger`：`write()` 只记 pending、`close()` 成功才入 committed，失败/未完成不可读），注入浏览器用同一份函数源码，并在启动前做 Node 端自检；显式保存改为**等待本次新的已完成写入**（不再靠 `writes.length>=1` 或历史「已保存」文本）。② **运行输入冻结清单**：`--inputs=` 逐项复算脚本/依赖/夹具/产物入口 bundle，不一致即 `exit 3` 并停止该运行（篡改副本已实测 3）。③ 行为负控改为**扰动独立副本 / 运行期省略动作**，不再改动期望值（6 个负控各自只让预定 caseId 转红）：`neg-undoredo`→R1e、`neg-stalejson`→R6d/R6f、`neg-canvas`→R5a/R5b、`neg-endpoints`→R3d（扰动夹具副本的边端点）、`neg-theme`→R2d（扰动导出 SVG 副本的字号）、`neg-canvas-links`→R5d（只把路径几何打成空函数）。④ 夹具 `apps/canvas/tests/fixtures/release-123-nested.mm.md`（框内成框）与对应检查（GEO-FRAME 行/壳几何、嵌套双壳、LOD **两档滞回带**真实 wheel 旅程 + **手势窗口冻结**、Canvas 逐墨迹带绘制 + 坐标命中身份、导出 PNG 逐节点区域有效内容、**句柄身份**跨夹具切换与延迟 close 不串档）。⑤ **完整候选清单**（`fullCandidateList`：`git ls-files` ∪ 未跟踪未忽略，含点目录与删除项；`verifyFullCandidate` 逐项复算）。⑥ **文件目的地三层身份**（DF-R5）：写盘替身此前只有 `md:<夹具来源>` 一个存储键，**「另存为」的新文件与已打开文件共用身份** —— 写 B 之后经 A 也读出 B 的内容。现拆为「夹具来源 / 目的地 id（打开 = `open:<夹具来源>:<名>`、另存为 = `save:<名>`）/ 句柄对象」三层：两个不同 Markdown 文件必得两个身份，**同名但来源不同也不合并**，同一份文件换 handle 重开读回同一 committed（不再每次 picker 造空文件）；`close()` 失败不记账、pending 不可读等既有契约不变。回归：浏览器 R7 旅程（真实 UI 点「另存为」）+ 7 个行为负控（新增 `neg-saveas-share` 只让另存为目的地塌回打开文件身份 → 只 R7 家族转红）。该轮**只改验收工具与文档，产品源码逐字未动**。

## [1.12.0] — 2026-09-18 · 深度视觉阶梯（DEPTH-VIS-1）+ 档位度量收口（MEASURE-RANK）

**触发**：岛内树父子同款描边/字号/填色 → 扫读时密叶与一级分支抢注意力（**抓叶漏骨**；用户信息链路默认「父 → 子」）。设计 `docs/specs/2026-09-18-depth-visual-hierarchy-design.md`（V1–V7 口径 / §4 锁定数值）；外派 `docs/dispatch/2026-09-18-depth-visual-hierarchy-dispatch-prompt.md`。本段含**两批**：DEPTH-VIS-1（视觉阶梯）与 MEASURE-RANK（阶梯引出的度量同源收口）。

- **DEPTH-VIS-1 · 三档视觉档**：`render/geometry.ts` 新增 `VisualRank = 'root' | 'branch' | 'leaf'`（`depth===0 / ===1 / ≥2`，**不改**「有子才算父」与 branchIndex）+ 唯一出口 `visualRankOf` / `fontOf` / `fontForRank`；`CardLevel` 扩为同域（旧传 `'branch'|'leaf'` 零改动）。三主题 token 按 §4 锁定值填数（classic 13/12/9·700/600/500·描边 1.8/1.4/1.0；sticker 14/13/10·700/600/500·1.8/1.2/1.0；glass 13/12/9·650/550/450·1.6/1.0/0.7；新键 `font.sizeRoot?` `font.weightLeaf?` `nodeStyle.strokeWidthRoot?` `color.rootDefault?` `BranchColor.root?` 全可选，缺省回退旧行为）。`nodeCardStyle` 三档：root = 分支 `root` 变体（classic/sticker 取**同支深色**作描边；glass 走 `rootDefault` fill .10/边 .34/主文字色）→ branch 原样 → leaf 再弱一档（glass leafDefault .08/.35/霓虹 → **.04/.16/#98a2b3**）。接线：`NodeG`（字号字重 + kind chip 同档）、`OverlayEditor`（编辑框与节点卡同档）、`MapView`（rank 进 styleKey 缓存键）、`sceneBuilder`（Canvas 同源）、`exportSvg`（导出即所见）。
- **MEASURE-RANK · 度量随档位**（ADR-0004 **minor**：只新增可选参数，不改既有签名）：`MeasureFn` 增可选第二参 `(node, depth?)`——布局把自己即将写入 `LayoutNode.depth` 的深度交给度量方，`(node) => …` 旧实现与旧调用方零改动。kernel 逐层传深度：`layoutMindmap`（含 `subtreeHeightOf`）/ `layoutMindmapBranched` 骨架 / `buildSkeletonCached`（logic·org）/ `buildLayoutTree`（timeline·fishbone）/ `createFrameShellMeasure` 穿透 + `subtreeMainExtent`·`subtreeCrossExtent`·挂点 / `layoutForest` 新增 `measureDepthBase`（框挂出岛以**文档绝对深度**参与档位，岛条目键含 `depthBase`）；`LayoutCache.heightsByDepth`（节点身份 × 深度**双键**——拖拽改层级时不得命中旧高度；旧 `heights` 字段保留仅为兼容）。react：`createRankedCharMeasure(token.font)` 产出三档字符度量、`createNodeMeasure` / `createDisplayMetricsFn` 增可选 `charOf`（缓存按档位度量实例隔离）、`MapView` 增 `charOf` prop（展示度量与布局同源）、`layoutDemo` 增 `charOf` 参且 desc/expand/fixedNote 装饰器逐层透传 depth。canvas：`MindmapStage` 建 `charOf` 同时喂 `layoutDemo` 与 `MapView`，`measureKey` 纳入分档字号全量（`sizeRoot/sizeLeaf/三档字重`）。
- **LOD 滞回**：`lodFor(k, nodeCount?, prev?)` 增可选 `prev`（回传上一帧档位）——已在某档时按「阈值 − `LOD_HYSTERESIS`」退出，防 fit k 停在 0.5 / 0.26 附近时密叶文字随 ±0.001 抖动反复进出；不传 `prev` 逐值等于旧行为。`MapView` 接线（手势冻结逻辑不变）。
- **效果**：叶盒不再按 branch 字号量（白边约 25% 的根源），整体布局收紧 → fit k 回升、LOD 文字更晚被省。实证：`apps/canvas` 的 jsdom 视口桩（960×720）在 DEPTH-VIS-1 期间算出 k=0.4938（**恰好压线**掉进 detail），MEASURE-RANK 后回到 full 档——该测试设施临时改动已**完全复原**（`git diff apps/` 仅剩 MindmapStage 接线）。
- **测试**：kernel `tests/measure-depth.test.ts`（+8：逐层深度、折叠口径、旧式单参零改动、框壳穿透、挂出岛绝对深度、`heightsByDepth` 双键）；react `tests/ranked-measure.test.ts`（+6：三档字符度量、实例缓存、缺省 `sizeRoot` 回退、三主题盒阶梯、缺省 charOf = 旧行为、叶盒等价性）+ `tests/lod-auto.test.ts`（+4 滞回）+ `tests/visual-rank.test.ts` / `tests/node-card-style.test.tsx`（DEPTH-VIS-1 期新增）；`tests/geometry.test.ts` 同步 glass 叶档期望值。
- **验收**：kernel **622**（+8）/ react **1494**（+10）/ canvas **245** 全绿；tsc ×3 零错误；未 push。
- **非目标 / 待跟进**：① 实体卡（`KIND_META`）不参与阶梯（仍 `strokeWidth` + 语义色）；② `DescBlock` 描述区**宽度估算**仍用 branch 字符度量（行高恒 `DESC_LINE_H` 不随档，防 measure 错位）；③ `FrameOutline` 行内样式与 `scripts/theme-snapshot.mjs`（仍自带 depth 分支，主题预览快照未重生）未对齐；④ 岛/框内布局以**岛根/框根为 0** 计深度（与 `LayoutNode.depth` 同源，等升格中心仍是 root 档）。

## [1.11.0] — 2026-09-17 · 共享梁双把手（trunk / rail 分流：`note.beamAt`）

**触发**：用户摩擦「拖共享梁抬高时，子节点短桩与梁 **1:1 齐步走**」——直觉要拉长「父 → 梁」的主干，实现却在改整段层距（子组被推开）。设计 `docs/specs/2026-09-17-beam-dual-handle-design.md`（方案 C：一根梁两个把手）；外派 `docs/dispatch/2026-09-17-beam-dual-handle-prompt.md`。三提交：B1 `ea18c74` → B2 `d284890` → B3 本提交（不 push）。

- **B1 协议读取 + 几何**（`ea18c74`）：`Note.beamAt?: {up?/down?/left?/right?: number}`（加法）——共享梁在「父出边 ↔ 最近子入边」空隙中的**比例位**（0..1），缺省/非法 = `0.5`（= 旧中点公式**逐位**兼容；`beamRailBetween` 对 0.5 走原式而不是插值式，回归钉锁死）。`layout/beamSide.ts` 新增 `readBeamAt` / `readBeamAtMap` / `clampBeamAt` / `beamRailBetween`（PAD 护栏 `BEAM_AT_PAD = LINK_CLEAR_MARGIN`：trunk/stub 各留 ≥ 6px，空隙 < 2×PAD 锁 0.5；与 lens 同容错纪律：数字串 / 内联 JSON / 宽松流式串皆可）；`beamYUp`/`beamYDown`（branching）与 `beamXRight`/`beamXLeft`（beamSide）**四向换轴镜像同源**吃 beamAt；森林岛内连线重建经 `linkGeometry` 自动同源（`islandLinks` 不再写死中点）。`readLensMap` 的流式解析抽为 `readDirMapRaw` 共用（零语义改动）。测试 `kernel/tests/beam-at.test.ts` **+11**。
- **B2 双把手交互**（`d284890`）：`render/beamDrag.ts` **命中分裂**——trunk（父出边 → 梁交点，含交汇垫 ±`BEAM_JUNCTION_PAD`）→ `bias`；rail 中段（沿梁轴扣除交汇垫）→ `lens`；交汇垫优先 trunk（摩擦入口）；把手带 `parentEdge` / `childEdge` / `parentCenter` / `at`；拖拽映射、状态转移、提交、预览梁与徽标文案全部收敛为纯函数（`beamDragMove` / `beamDragCommit` / `beamDragRail` / `beamDragBadge`），MapView 只接线（叠层 + 光标三态不变）。`geometry.ts` 梁映射吃 `atOf`（`BeamAtOf`：`beamYForGroup` / `beamXForGroup` / `verticalBeamMap` / `horizontalBeamMap`），`sceneBuilder` / `exportSvg` 同步（导出与画布同形）。canvas 侧 `onBeamLensChange` → `onBeamChange(fromId, BeamCommit)`（单字段分流），写路径集中到新模块 `apps/canvas/src/beamEdit.ts`。测试 `react/tests/beam-drag.test.ts` **+14**。
- **B3 写路径 + 协议**（本提交）：`applyBeamCommit`——`bias` 写 `beamAt[dir]`（`≈0.5` 在 `BEAM_AT_EPS` 容差内**删该方向键**；方向键全空 → 连键一起删）、`lens` 写 `lens[dir]` 且 beamAt 原样保留；一次拖拽一个字段、单条 undo。协议 §5.2 补 `beamAt` 一行 + 版本历史 v1.11.0；`Note.beamAt` 进 `protocol/types.ts`。测试：canvas `tests/beam-at-write.test.tsx` **+8**（trunk 只写 beamAt / 子盒零位移 / rail 改层距且子组外推 / ≈0.5 删键与透传边界 / 往返 / 单条 undo）、react `tests/mapview-beam-drag.test.tsx` **+3**（**真指针路径**：trunk → 徽标「主干 72px」+ `{kind:'bias'}`；rail → 「层距 126px」+ `{kind:'lens'}`；拖拽中节点世界 transform 逐值不变）、kernel 协议往返 **+3**。
- **验收**：kernel **614**（+14）/ react **1374**（+17）/ canvas **239**（+8）全绿；tsc ×3 零错误；`tools/graph-engine/` 零触碰；未 push。
- **偏差与记录**：① `JUNCTION_PAD` 实值 **12px**（世界坐标，设计建议值）；② 徽标文案按设计「**主干** Npx」/「**层距** Npx」（替代原「出线 Npx」）；③ 避障交互：默认空隙（V_GAP=14）下 PAD 钳制 + `beamVariants` 细分采样会把梁推离极端比例——宽空隙（如 lens ≥ 32）时默认候选干净、与公式逐值一致（B1 测试用 lens=96 锁定；属设计 §8「避障把梁推离 beamAt」已知项）；④ **「≈0.5 不落盘」是写侧纪律**：序列化器对 `beamAt` 零特殊分支（前向兼容透传铁律），手写 `beamAt: 0.5` 原样保留，只有拖拽提交路径才会删键（canvas 测试两个口径都钉住）；⑤ 阴性对照：B1 把 `beamYUp` 写死 0.5 → 比例用例红；B3 去掉 ≈0.5 删键 → 删键/源文两用例红（均已回退复原）。
- **待跟进**：默认 14px 空隙下 bias 行程仅 ±1px（PAD 护栏所致，先拖梁中段留白再分配主干）；梁拖拽仅 SVG 后端（Canvas 把手同族缺口照旧）。

## [1.10.0] — 2026-09-15 · 子树框编辑（局部大纲 · 按深度挂载：`note.frame` + 布局岛 + FrameOutline）

**触发**：用户裁定「画布上『空间导图』与『局部可写大纲』的持久互转」——选中节点**成框**后按可配置深度把浅层后代收进**框内可写大纲**，更深后代仍以**空间节点**挂在 `d = depth` 行的挂点上；数据仍是同一棵 `children` 树，仅持久 `note.frame` 元数据，**不新增 `type`**（设计 §0 单一事实源 / 扩展缝优先）。规格 `docs/specs/2026-09-15-subtree-frame-outline-design.md`；计划 `docs/superpowers/plans/2026-09-15-subtree-frame-outline.md`（Task 1–6，分 FO-A/B 两批派发）；报告 `outputs/2026-09-15-subtree-frame-outline-report.md`。

- **FO-A 协议 + 命令**（`164fc95` / `3290bab` / `386e315` / `3d17dcb`）：`Note.frame?: FrameSpec`（加法，`{version:1, depth}`）+ `protocol/frame.ts` 访问器（`frameOf` / `setFrame` / `clearFrame` / `normalizeFrameDepth`）；**相对框根深度**（框根 `d=0`，与 `depthOf` 明确分工：禁混用）+ 子树最大相对深度 + `canCreateFrame`（设计 §3.3：祖先**大纲层内**拒、**挂载层**允）+ `clampFrameDepth`（`1…min(子树高度,8)`）；`layout/framePartition.ts` `partitionFrameSubtree`（纯函数切「大纲层 / 挂点」，**不搬家**：`spatialRoot` 为原树同引用）；react `edit/frameCommands.ts`（成框/拆框/改深度经 `controller.updateNote` → 同一撤销栈）+ 右键「结构」区三态入口（默认 depth 2；改深度一期走原生 `prompt`，无 prompt 环境 no-op）。协议表补 `frame` 一行。
- **FO-B1 布局岛**（`de0673a` / `3bf0aaf`）：kernel `layout/frameLayout.ts`：`layoutFrameIsland`（大纲行盒按前序堆叠 + 缩进 + `outlineHeight`；`d = depth` 行**子侧**出挂点，值 = 空间根**中心**，与 `CenterSpec.pos` 同口径）+ `expandFrameIslands`（基座布局先按「折叠」剪出框内子树 → 框头盒不变（上游父子边端点不动）→ 空间层各挂出子树作一个中心交回 **`layoutForest`**（不重写布局算法）→ 挂点连线 + bounds 全量重算）+ `collectFrameRoots` / `framePrunedCollapsed`（按（折叠集身份 × 框根 id 序列）记忆化，守住 `LayoutCache` 的 `collapsedKey` 身份纪律）+ 空间挂载层上的**嵌套框根递归成岛**；框根被用户折叠 → 整岛隐藏（§5.2）；跨 depth 边界守卫 `frameLayerOf` / `crossesFrameDepthBoundary`（进/出大纲层拦；大纲层内重排与空间层内排序放行）。react 接线 `demo/pipeline.ts`（`layoutDemo`：剪枝 → 基座 → 岛展开，无框时**同引用零行为变更**）+ `edit/controller.ts`（`apply` 对 `move-node` 单点拦截 → 拖拽落点 / Shift+Tab 缩进 / 右键缩进共用；切断/接回走 `applyTransaction` 不受影响）。
- **FO-B2 框壳 + 框内大纲**（`847a085`）：新 `chrome/FrameOutline.tsx`——框壳 = 大纲包围盒 + padding；大纲行 = `partitionFrameSubtree` 大纲层，**行盒直接取 B1 岛产出**（不重算布局；与节点卡同口径含过渡插值）；单击行选中（复用既有 `onNodeClick` 通道）、双击 text 行进入既有内联编辑（`NodeTextOverlay` 按同盒渲染，编辑态行让位自身文本）、image/entity 行**只读占位**（一期不改 url / ref）；结构键与 `edit/keys.ts` 对齐（Tab=建子 / Enter=建同级 / Shift+Tab=缩进 / Ctrl+Shift+Tab=反缩进 → `onFrameKey` → controller），跨 depth 由 controller 守卫 no-op；注释 = 行内只读提示 + 「注释」入口（复用既有幕布 `desc` 编辑，勿新 WYSIWYG）；整框出屏不建 DOM。接线：`render/MapView.tsx`（框视图派生 + 框内行让位节点卡、空间层节点仍是节点卡 + `onFrameKey` 通道）、`apps/canvas/src/MindmapStage.tsx`（结构键 → controller，含生长方向固化）。**Ctrl+D `OutlinePanel` 零改动**（仍只读）。
- **FO-B3 收口**（`0029877`）：真 `MindmapStage` e2e `apps/canvas/tests/frame-outline-host.test.tsx` 4 例（成框 → **保存源含 `frame/depth`** → 切文档往返重解析仍在；拆框 → `frame` 键删除且 `desc` 仍在；祖先 depth=1 → 大纲层子无成框入口、挂载层孙成框落盘；大纲行双击改 text → 拆框后 text 保留）；B3 最小修正：`MapView` 框内行盒改走 `renderBoxOf`（与节点卡同一口径，消除布局过渡期行/卡错位）。
- **验收**：kernel **567**（本系列新增 44：`frame.test.ts` 24 + `frame-partition.test.ts` 7 + `frame-layout.test.ts` 13）/ react **1340**（新增 32）/ canvas **218**（新增 4）= **2125 全绿**；tsc ×3 零错误；depcruise **482 模块 / 1366 deps 零违规**；lint：本批新增 3 文件 0 告警，`MapView` 30 / `MindmapStage` 23 与 HEAD 基线逐数持平；budget 全绿（**bang 89/90 ↓1、bigFiles 3/4 ↓1**，asCast 31/31 持平）；react dist 重建（canvas 消费）。
- **偏差与记录**：① **框岛暂不参与外层占位**——岛内容（行 + 挂出子树）不 inflate `measure`，密集文档中可能与邻节点重叠；外壳尺寸按「行盒 + padding」交付，「内容撑高触发外层重排」需 measure 通道改造，留后续批（报告 §七）；② 跨 depth 拖拽的**落点预览**仍显示几何合法，松手由 controller 守卫 no-op（视觉拒绝留后续）；③ 结构键口径按**计划 Task 5「与 keys 对齐」**执行（Shift+Tab=缩进 / Ctrl+Shift+Tab=反缩进），设计稿 §4.3 行文的「Tab 升降级」由该组合键承担；④ 框内行不支持拖拽、无挂点圆点；⑤ e2e 需 `ResizeObserver` 尺寸桩（jsdom 容器 0×0 → fit 落最小缩放会触发 LOD 省文本，属**测试设施**而非产品缺陷）；夹具补 A2a 使孙非叶（「成框编辑…」按 A3 口径不给叶子入口）。
- **非目标（逐项未做）**：大纲层内嵌套成框、框内 ▸ 折叠落盘、跨 depth 拖拽改层级（一期 no-op）、大纲行内改 image/entity 字段、框内编自由边 / 翻 `note.md`、新 `type: 'frame'`、方案 Y、OPML 往返；`tools/graph-engine/` 零触碰。

## [1.9.0] — 2026-09-15 · Free Canvas C+1（独立子模式：`*.mc.canvas.json` + 两壳翻卡 + 卡间连线）

**触发**：用户裁定 C（多壳 / 翻面 / 连线 / 持久化）+ 1（独立 `.mc.canvas.json` + 模式切换）——对标 markvault native 翻卡 UX，与导图 `.mm.md` 平级。规格 `docs/specs/2026-09-15-free-canvas-spec.md`；计划 `docs/dispatch/2026-09-15-free-canvas-c1-plan.md`；报告 `outputs/2026-09-15-free-canvas-c1-report.md`。决策 D1–D7 见计划 §3；**导图 note 链（`NotePopover` / `fixedNotePanels` / `note.md`）零触碰**（零协议改动，证据见报告 §三）。

- **FC-A 模型包**（`ecbefc7`、`2db7fae`）：新包 `@mindcanvas/free-canvas`（headless，零 React）：`McCanvasDocument schemaVersion:1`（`placements` / `edges` / `viewport` / 未知键逐层透传，同 `.mm.md` 铁律口径）；`NativePlacement`（两壳 `sticky-classic`/`card-panel`、`face`、`front`/`back?`、`transform`、`zIndex`）；`McCanvasEdge`（`fromPlacementUuid`/`toPlacementUuid` + 可选锚与 label）；ops：`toggleFace`/`setFace`/`addBack`/`patchFront`/`patchBack`/`movePlacement`/`resizePlacement`/`removePlacement`（级联删边）/`addEdge`（防自环与缺端点）/`removeEdge`/`setViewport`；viewport `zoomAt`（锚点世界坐标不漂移）/`panBy`/`viewportCssTransform`；`nativeBackEnabled`（D3：back 对象存在即可翻）。`free-canvas-pure` 依赖守护（禁 react/react-dom/@mindcanvas/react/apps）。测试 +12。
- **FC-B 视口 + 落卡**（`faf9ddd`）：`packages/react/src/free-canvas/`：`FreeCanvasView`（受控 `doc` + `onChange`；空白 pan；滚轮 zoom 走原生 `passive:false` 监听；世界层 CSS transform）/ `NativeCard`（两壳视觉：黄便签 / 玻璃面板）/ `Toolbar`（选择 / 便签 / 面板）。react 入口加法导出（`4b2beec` 合并导出守 600 线）。测试 +5。
- **FC-C 翻面 + 编辑**（`12b74b1`）：整卡 CSS 3D（`perspective` + `preserve-3d` + `rotateY(180deg)` + `backface-visibility`；锚点 `data-flip-state`）——**自写不包 `FlipCard`**（两壳皮肤 ≠ 其内建玻璃 face 样式；face 需由 doc 字符串驱动而非布尔控，理由见报告 §二）；悬停翻面钮（仅 `nativeBackEnabled` 渲染，`data-fc-flip`）；右键菜单「添加背面」→ `addBack` → 自动进入背面编辑；双击编辑**当前面**；提交口径**对齐 DescBlock / NoteBackEditor 实测**（非受控 textarea；失焦 / Shift+Enter 提交 / Esc 取消；Enter 换行；无改动不上抛）；`face` 写入 doc。测试 +5。
- **FC-D 连线**（`79a5864`）：`EdgeLayer`（世界坐标 SVG 直线，中心锚 MVP；`data-fc-edge` + 选中霓虹）/ connect 工具（从卡拖到卡 → `addEdge`，保持工具可连多条）/ 选中边 + Delete 删边；边随卡拖移与视口变换更新（世界坐标断言钉）。测试 +5。
- **FC-E 应用集成**（`f3988c4`）：`App` 模式态 `mindmap | free-canvas`（分 Stage 挂载/卸载，文档状态不互串）+ 常驻入口胶囊；`FreeCanvasStage`（顶栏：← 导图 / 新建 / 打开 / 保存 / 最近 / 看演示）；`canvasDocHost.ts`（平行 `DocumentHost`：独立 localStorage key `mindcanvas.canvas.recent.v1`；FS picker → 下载 JSON 兜底；file input 兜底）；`StartupScreen` 加法入口（缺省不渲染，导图入口不受影响）；`MindmapStage` 接线级透传 `onOpenFreeCanvas`（note 链零触碰）；demo `public/demo-free.mc.canvas.json`（2 卡 + 1 边 + 一卡有 back；`src/demo/` 同内容供 `?raw` 内联）。e2e +3。
- **债务修缮**（`433fbc4`）：新代码 7 处 `as` 断言改类型守卫 / `Reflect.get` / `instanceof`（budget asCast 38→31 归位）；`ops.test` 去非空断言（`ef3b31a`）；FC-C 遗留未用回调清理（`44c29a3`）。
- **验收**：free-canvas **12** / react **1293→1308**（+15）/ canvas **211→214**（+3）/ kernel **523 不动** = **2057 全绿**；tsc ×4 零错误；depcruise **469 模块 / 1312 deps 零违规**（含 `free-canvas-pure`）；lint **1468 + 46**（批次起点 1469 → 净 −1；free-canvas 定向检查 0 warning 0 error）；budget 全绿（**asCast 31/31 持平、bang 89/90 ↓1、bigFiles 3/4 ↓1**）；free-canvas dist 重建 + react dist 重建（canvas 消费）。
- **偏差与记录**：① `factory.ts` 宿主 `crypto` 走局部结构化类型（不引 DOM lib / `@types/node`，保 headless 纯净）；② `@mindcanvas/free-canvas` 在 `apps/canvas` 无 vite alias → canvas/react 测试**消费 dist**（与 kernel/react 走 src 的口径不同）——本批已重建 dist，统一 alias 另议；③ `MindmapStage` 接线级 +8 行（note 链零触碰）；④ demo 双份（`public/` 供 URL 直取 + `src/demo/` 供打包内联）。
- **待跟进（范围外，计划 §7）**：text-banner / 多选对齐 / 边样式与 label 编辑；JSON Canvas 导出互换；空间索引；导图 `note.md` 实验入口降级文案。

## [1.8.22] — 2026-09-15 · P2b 背面 markdown 表格（GFM pipe 子集；parser 提取 `cardBackMd.ts`）

**触发**：设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md` D2 范围表——表格 P1 不支持（按段落文本行）、P2 支持。本批在 `CardBackMarkdown` 补 GFM pipe 表格子集；「535 + ~70 行必破 600 线」→ 按守线先例**提取 parser** 到纯函数模块 `chrome/cardBackMd.ts`；`NoteBackEditor` 预览同源自动受益（零额外改动）。计划：`docs/dispatch/2026-09-15-p2b-md-table-plan.md`；报告：`outputs/2026-09-15-p2b-md-table-report.md`。

- **P2b-1 parser 提取 + 表格解析**（`4a305bd`）：新模块 `chrome/cardBackMd.ts`（逐字搬迁块类型/解析函数，零语义改动）；新增 `{ t: 'table'; align; head; rows }`——判定 = 当前行含未转义 `|` 且下一行为合法 delimiter 行（每列 `:?-+:?`、列数 ≥ 1）；拆列按未转义 `|`（首尾管道可选、`\|` 保字面）；列数以 header 为准（多丢少补）；`startsBlock` 增表格起点（表格终止前文段落）；引用内表格沿递归白捡、**列表项内不支持**（沿 P1 口径）。`CardBackMarkdown.tsx` 只留渲染、import 自新模块、不做 re-export：**budget 口径 535 → 395 行**（新模块 351 行）。
- **P2b-2 渲染**（同提交）：`<table data-note-md-table>` + thead/tbody；单元格走 `renderInline`（strong/code/link 与**内部锚**同段落口径）；对齐 → th/td 同列同款 `textAlign`（无标记兜底 left）；CHROME token 样式 + 容器 `overflowX: auto`（同代码块先例）；无 delimiter 行 → 维持段落语义。
- **P2b-3 判别钉（+12 例，先红后绿）**：解析 8 例（新 `tests/card-back-md-parse.test.ts`，node 纯函数）+ 渲染 4 例（`card-back-markdown.test.tsx`）；既有「表格按段落文本」范围外钉**原位翻转**（白名单①；图片/裸 HTML 等其余范围外钉逐字未动）。**白名单②（import 路径行）未动用**——实测该文件从未 import `parseCardBackMd`（原生只 import 组件，未随提取失效）。
- **阴性对照**：拆掉 delimiter 判定（表格永不成立）→ 12 钉红（原文见报告）→ 回退 + 残留 grep 空 + 复跑 40/40 绿自证。
- **验收**：kernel **523 不动** / react **1281→1293**（+12）/ canvas **211 不动**；tsc ×3 零错误；depcruise **445/1264 零违规**（+2 模块 = `cardBackMd.ts` + 解析测试；+2 deps）；lint **1468+46** 逐数持平（Checked 444 = 442+2）；budget 全持平（bigFiles 3/4 保持）；react dist 重建（含 `cardBackMd.js/.d.ts`）。
- **偏差与记录**：① 白名单②未动用（解析钉落新文件 `card-back-md-parse.test.ts`；原文件 import 行无需改）；② 表格判定字面执行计划「delimiter 列数 ≥ 1」（不强制与 header 同列）——`a | b` + `---` 形态成立为表格（简化口径，测试钉住）；③ 转义仅 `\|`：行内代码内管道**不豁免**拆列（模块注释注明，范围外）。
- **待跟进（范围外）**：HTML 表格 / colspan·rowspan、列表项内表格、行内代码内管道豁免（如需）；O7 其余切片同前。

## [1.8.21] — 2026-09-15 · P2 节点卡背面编辑（textarea + 预览双态；写回 `note.md`）

**触发**：P1（[1.8.17]）的背面 markdown 为只读；按设计稿 §7 补编辑闭环——背面态「编辑背面」→ 浮窗编辑器（源文 textarea +「源文/预览」双态）→ 失焦 / **Shift+Enter** 提交 → `controller.updateNote` 写回（空文本删 `md` 键）；undo / 自动保存 / S2G 守卫零成本继承。计划：`docs/dispatch/2026-09-15-p2-card-back-edit-plan.md`；报告：`outputs/2026-09-15-p2-back-edit-report.md`。

- **P2-1/P2-2 编辑器 + 接线**（`e21566a`）：新 `chrome/NoteBackEditor.tsx`（三导出：`NoteBackEditor`——非受控 textarea（防 IME/焦点抖动，同正文区做法）+ 单窗双态（预览复用 `CardBackMarkdown` 零新解析；锚点 `data-note-md-editor`/`data-note-md-mode`）；`MdEditButton`——入口 `data-note-md-edit`，仅 `isFlipped && md 非空 && !floating` 渲染；`NoteBody`——面板主体三态提取（md 编辑面/翻卡/正面直出），DOM 与提取前逐字一致）。`NotePopover` 接线（`+ onChangeMd` + `mdEditing` 会话态 → `floating` 判定扩展；`flipActive` 门**逐字未动**；提交对比当前 md（无改动不写盘）+ 退出回背面视图）。**提交键位以 `DescBlock` 实测为准**（失焦 / Shift+Enter / Esc；设计稿 §7 转述的 `Ctrl+Enter` 实测不存在——按 §4①「以 DescBlock 为准」执行，e2e 留「Ctrl+Enter 不提交」插钉）。**NotePopover 守 600 线**（直连超 8 行 → 按计划提取后终值 599（wc）/ **600（budget 口径）**，bigFiles 3/4 未动）。react 单测 +15。
- **P2-3 写回链 + e2e**（`b9c1a72`）：`MapView` +3 行（`onNoteChangeMd`，固定卡渲染位透传，同 `onNoteChangeSeq` 先例）；`MindmapStage` `onNoteChangeMd={(id, md) => controller.updateNote(id, md.trim() === '' ? { md: undefined } : { md })}`（**不 trim 存储值**，只 trim 判空）。canvas e2e +2（真 MindmapStage：翻面 → 编辑 → Ctrl+Enter 不提交（实测钉）→ Shift+Enter 提交 → 卸载重挂仍背面新内容 → **保存后 source 含 `md: "…"` 逐字**（serialize 往返）；清空提交 → 翻面按钮消失 + **source 无 `md:` 键**）。
- **阴性对照 2 组**（原文见报告 §P2-4）：① 恒源文态 → 双态钉红（`expected 'source' to be 'preview'`）；② 空文本不删键 → source 断言钉红（`md: "   "` 现身）；均回退 + `git diff` 自证。
- **验收**：kernel **523 不动** / react **1266→1281**（+15）/ canvas **209→211**（+2）；tsc ×3 零错误；depcruise **443 模块 / 1262 deps 零违规**（+3 模块 = `NoteBackEditor.tsx` + 两个新测试文件；+8 deps = 新文件出边 9 条 − `NotePopover` 净 −1）；lint **1468 + 46** 逐数持平（Checked 442 = 439 + 3）；budget 全持平（bigFiles 3/4、bang 89/90）；react dist 重建（BUILD_REACT=0）。
- **偏差与记录**：① 键位实测（Shift+Enter ≠ 设计稿字面 Ctrl+Enter；全链抄录见报告 §P2-1）；② 上抛原文不 trim（markdown 前导空白有意义；与 DescBlock 的唯一受控差异，按 P2-3 施工单执行）；③ e2e 基建：关闭面板引发「note 预留移除 → 布局重排」过渡窗口（实测 ~40px 级位移），窗口内点击 hit-test 落空——**既有画布行为（非 P2 引入）**，测试以 `waitForStablePos` 显式等待、`clickNodeFlushed` 贴近真实（down/up 间让帧）；④ `_tmp_93540_*`（0 字节）内核级拒删（ACCESS_DENIED；环境项，非本批引入，报告 §偏差④）。
- **待跟进（范围外）**：P2 剩余切片（表格 / 图片 / 导出选面 / 创建入口）见 `docs/roadmap/2026-09-15-open-items.md` O7；「关闭→立即点击」落空窗口如需产品侧兜底（防抖/等待），另立小批。

## [1.8.20] — 2026-09-15 · S2G 保存侧同步守卫（防「画布树不属于该文档」的误写）

**触发**：S2F 修复根因后，用户裁定加第二道闸——写盘前的同步不变量：错位窗口内自动保存会把 controller 树**以目标文档身份**落盘（覆盖用户文档）。本批把「将来再出现同类错位」从**静默数据损坏**降级为**拒写 + 通知 + 另存为逃生口**。计划：`docs/dispatch/2026-09-15-s2g-save-guard-plan.md`；报告：`outputs/2026-09-15-s2g-save-guard-report.md`。

- **机制**（`231e832`）：新模块 `hooks/saveGuard.ts`（`canWriteDoc(synced, docSource)` 精确等值谓词 + `SAVE_BLOCKED_NOTICE` 文案单点）。**同步标记 `syncedSourceRef` =「controller 的树所对应的 `doc.source`」，三写点**：① StageInner controller 创建处；② `useDocumentSwitch` 首挂同源跳过分支；③ 其 reset 分支后（`if (!editable) return;` 早退**不置位**）。**两读点**：自动保存定时器回调 `serialize()` 前（不同步 → 不写 / 不 `markSaved` / `dirty` 保持；通知**每 `doc.source` 一次**去重）；`handleSave` 任务开头（通知**每次**）。`handleSaveAs` **不拦**（逃生口）。
- **判别钉**（先红后绿，+6 例）：t5 置位钉（skip 置位 / reset 后置位 / 首挂不同源同样置位 / `editable=null` 不置位）；`useAutoSave` ×2（拒写 + 通知去重 / 置位后恢复）；`useDocumentActions` ×3（拒写 + 通知 / 同步照常 / saveAs 放行）。**阴性对照**：`canWriteDoc` 临时恒 true → 三钉转红（原文见报告）→ 回退后 `git diff` 空自证。
- **边界（已接受）**：内容逐字相同的文档互切 → source 等值 → 视为同步（沿 E 批「source 不变 = 不重建」）；拦截后**不自动重试**（等下一次 dirty 边沿或手动动作）；另存为后会话仍是原文档身份 → 原文档继续被拦（保持正确）；用户在系统选择器里自行覆盖原文件属知情操作。
- **验收**：kernel **523 不动** / react **1266 不动** / canvas **203→209**（+6）；tsc ×3 零错误；depcruise **440/1254 零违规**（+1 模块 = saveGuard.ts）；lint **1468+46** 持平（Checked 439 = 438 + 1）；budget 持平。

## [1.8.19] — 2026-09-14 · S2F 启动页文档切换同步（状态判据修复）

**触发**：P1 收尾小修复核的「范围外发现①」——启动页三出口（继续上次/最近/新建）`setDoc` 直通 + `StageContent`（内含 `useDocumentSwitch`）在启动页期间未挂载 → hook 的「首挂跳过」吃掉了唯一一次同步机会 → **文档名已切、画布仍是 gateway 示例树**（会话内不自愈；错位期编辑 + 自动保存有写错文档的数据风险）。用户裁定**方案 A**：判据从**时间点**（`isFirst`）改**状态**（`ctrl.root === editable`）。计划：`docs/dispatch/2026-09-14-s2f-startup-doc-switch-sync-plan.md`；报告：`outputs/2026-09-14-s2f-doc-switch-sync-report.md`。

- **修复**（`d7ec9a6`）：`useDocumentSwitch.ts:66` → `if (isFirst && controllerRef.current?.root === editable) return;`——首挂**且同源**才跳过；首挂**不同源**（挂载前改 doc 的路径）→ 补做四动作（reset/setEntities/setExpandedQaId/fit）。四动作与 `remember` 逐字未动；deps 仍锁 `[doc.source]`；注释同步（hook 头 + 条件处 + `MindmapStage` 启动页段订正：「不需要未保存守卫」≠「不需要同步」）。
- **判别钉（先红后绿）**：hook t0 判据实证（真实 `EditorController`：构造后 `root === editable`、`reset(other)` 后 `root === other`）/ t3 首挂不同源 → 四动作各恰一次 / t4 controller 为 null 不崩（reset 安全空调用）；三出口 e2e（**双边断言**：目标独有节点存在 且 gateway 节点不存在）；`tools/verify-startup-doc-switch.mjs` 真浏览器复现→修复（**构建产物**；含 M5-T2 过渡 ghost 等落定后的稳态口径）。
- **StrictMode 掩蔽（记录）**：`main.tsx` 启用 StrictMode → dev 下 effect 双调用（第二次 `isFirst=false` → 四动作照做）**掩盖本 bug**；bug 只在构建产物发作——一切复现/验证以 `vite preview` 产物为准。
- **验收**：kernel **523 不动** / react **1266 不动** / canvas **197→203**（+6：hook t0/t3/t4 + 三出口 e2e）；tsc ×3 零错误；depcruise **439 模块 / 1250 deps 零违规**（+1 = 新测试文件）；lint **1468 + 46** 逐数持平（Checked 438 = 437 + 1）；budget 全持平。红→绿原文与浏览器输出（含截图路径）见报告。
- **同类路径扫描（收口表）**：全仓 `setDoc(` 7 点——启动页两出口 = 原缺陷路径（已修）；`applyDoc` / 保存写回 ×3 / 自动保存写回 / 句柄回填 = 「挂载后」或「不改 `source`」= 安全。仅启动页两出口可能发生在 `StageContent` 挂载前（状态判据已兜住，且对未来同类路径通用）。

## [1.8.18] — 2026-09-14 · P1 收尾小修（翻卡态提升宿主 / FlipCard 非交互模式 / 最小记录）

**触发**：P1（[1.8.17]）复核裁定三项收尾——② 设计稿 §6「翻卡态随节点离屏保持（会话态、按节点 id 记）」未兑现（实现为面板内 state、卸载即丢）→ 提升至宿主；③ 受控 no-op 的 FlipCard 残留 `role=button`/`cursor:pointer`「幽灵按钮」a11y 语义 → 加 `interactive`；① P1 宿主勘误（NotePopover embedded）与 `NoteGrowthPanel` 孤儿状态 → 最小记录。计划：`docs/dispatch/2026-09-14-node-card-p1-tail-fix-plan.md`；报告：`outputs/2026-09-14-node-card-p1-tail-fix-report.md`。

- **T1 翻卡态提升宿主**（`09d3007`）：`MindmapStage` 会话态 `flippedNoteIds`（Set + 幂等 toggle；不落盘；不顺手清——承「点空白不静默关面板」既有裁决）+ `MapView` 两新 props（`flippedNoteIds` / `onToggleNoteFlip`）→ 固定卡渲染位传受控值（floating 预览零改动）；`NotePopover` 翻面态改**受控/非受控双模**（`flipped` + `onFlipChange`；缺省回退内部 state = 现行为；`flipActive` 门逐字未动）。**面板卸载/重挂不丢翻面**。判别：受控驱动 / 按钮回传恰一次 / 卸载重挂保持 / 不存在 id 负向（react 6 例，红→绿）+ 真 MindmapStage 端到端 1 例（启动页进入 → 经「最近」菜单打开含 `note.md` 文档 → 翻面 → 关闭面板 → 重新固定 → 仍背面）。NotePopover 596→**600 行**（守 600 线）。
- **T2 FlipCard 非交互模式**（`9839b6f`）：`interactive?: boolean`（缺省 true 向后兼容）；false 时去 `role`/`aria-pressed`/`aria-label`/`tabIndex`/键盘与整卡点击、`cursor` 缺省——受控 no-op 场景不再向屏幕阅读器播报「按了没反应的按钮」；**始终**输出 `data-flip-card` / `data-flip-state` 锚点。`NotePopover` 内传 `interactive={false}`。断言改动白名单 3 处（note-panel-flip :48 锚点替换 / :77 锚点替换 / :80-85 卡级 aria-pressed → data-flip-state；保护强度不变）；`chrome.test.tsx:34-46` 两例**逐字未动**（向后兼容证据）+ 补锚点/非交互 2 例。
- **T3 最小记录**：设计稿实现注记（宿主勘误 + 孤儿状态 + 翻卡态宿主化）；CHANGELOG 本段。
- **验收**：kernel **523 不动** / react **1266**（+8）/ canvas **197**（+1）= **1986 全绿**；tsc ×3 零错误；react dist 重建；depcruise **438 模块 / 1249 deps 零违规**（+2 模块 = 2 新测试文件）；lint **1468 + 46** 逐数持平（Checked 437 = 435 + 2）；budget 全持平（bang 89/90、bigFiles 3/4；MindmapStage 2315 / MapView 2244 接线级增长）。
- **偏差与记录**：① **计划 §0 基线参考值为陈旧读数**（516/1206/195、depcruise 432/1224）——实测 = P1 报告口径 **523/1258/196、436/1241**，已按实测执行并报告；② 端到端入口路径偏离（计划未指定入口）：启动页「继续上次」为 `setDoc` 直通、绕过 `useDocumentSwitch` 的 reset（见范围外发现 ①），改为「看内置示例 + 最近菜单」即走 `applyDoc` 正常 reset；③ `interactive={false}` 并入既有行（NotePopover 600/600 零余量）。
- **范围外发现（未动手，待裁定）**：① **启动页直开文档树不切换**——`StageContent`（ADR-0007 拆分）里的 `useDocumentSwitch`「首挂跳过」时机与启动页 `setDoc` 直通错位：从启动页「继续上次/新建」打开的文档**文档名已换、画布仍为前一棵树**（e2e 现场 dump：`doc=e2e-flip.mm.md` + 节点全为 gateway 树）；机制与建议（补 reset 条件）见报告 §范围外发现。② 自研 note YAML **不支持流式序列**（`note: ["…"]` 被读成字符串，`hasNote`=false）——列表须用块形态（`note:` + `- 条目`）；kernel `note.ts` 头注释的 `[条目…]` 为概念示意。

## [1.8.17] — 2026-09-14 · 节点卡翻面 · 背面 markdown 只读渲染（P1 / 零协议 · 零布局改动）

**触发**：M2 富内容实验第二项（第一项是资产画廊）——给固定 note 面板加**翻面**：正面 = 现有区块（一行不改），背面 = `note.md` 源文的 **markdown 只读渲染**（复用既有 `FlipCard`）；**`estimateNoteAreaHeight()` 一字不改**（背面在同一 footprint 内滚动）= 零协议 / 零布局 / 零既有交互改动。设计稿 `docs/specs/2026-09-14-node-card-flip-markdown-design.md`；计划 `docs/dispatch/2026-09-14-node-card-p1-readonly-plan.md`；报告 `outputs/2026-09-14-node-card-p1-report.md`。

- **N1 前置验证**（不改码）：① `note.md` 的 `.mm.md` 表达实测——**块标量 `md: |` 不受支持**（`E-INVALID-NOTE-YAML`，**整条笔记丢弃**）→ 取**转义单行形态**（`"a\nb"`，同 `note_text` / `desc` 先例，零解析器改动）；② 引擎实测——`markdown-it@15.0.2` 网络可装 / MIT，但 rolldown（vite 8 底层）实测产物 **+46.5KB gzip**（5 个静态传递依赖），且行内层必须绕开其解析（A4 对齐 `inline.ts`）、linkify 必须关闭 → **体积与收益不成比例，判定受阻**，走**受限子集渲染器**（一等选项，非降级凑数）。
- **N2 渲染器 + 往返钉**（`4dfb465`）：`chrome/CardBackMarkdown.tsx`（+328 行）范围 = 标题 h1–h6 / 无序·有序·嵌套列表 / 任务列表（只读 checkbox）/ 引用块（可嵌套）/ 围栏代码块（``` 与 ~~~）/ 水平线 / 段落；行内 = `kernel/layout/inline.ts` 同口径（**strong·code·link**，不引第二套语法）；链接 = http(s) 白名单（外链 `target=_blank rel="noopener noreferrer"`）+ 内部锚（`node:`/`cid:`/`@kind:id`，`isUrlLike` 卫兵防 `mailto:`/`javascript:` 被实体锚正则误吞——L 批同款口径）；范围外按纯文本（图片不加载 / HTML 不执行 / 表格按文本 / 斜体·删除线不解释）；**无 `dangerouslySetInnerHTML`**（输出走 React 元素树）。kernel 钉：转义单行形态 parse→serialize→parse **逐字**（含引号/反斜杠/尾空格硬字符集、幂等、空串不落键、note 块哨兵 `-->` 安全）。**红→绿 28/28**（红 = `Failed to resolve import CardBackMarkdown`）。
- **N3 翻面接线**（`ee5b28d`）：**载体 = `NotePopover`（embedded 固定卡）**——*勘误*：计划所指 `NoteGrowthPanel` 为**零生产引用的孤儿组件**（全 git 史无渲染点，仅测试/导出引用；真实固定卡 = MapView `fixedNotePanels` → `NotePopover mode="embedded"`），已按偏差上报（证据链见报告 §N3）。受控 `FlipCard` + 面板头 **`data-note-flip`** 按钮（`aria-pressed` / `title`；受控且不注入 onFlip → 整卡点击 no-op = 禁止整卡翻面）；翻面态 = **会话态**（面板内 state，按节点 id 经 `key={panel.id}` 挂载）；floating 预览 / 编辑态不翻（§1.2）；`note.md` 透传链 = `fixedNotePanelsOf`（加法字段 `md`）→ MapView（+1 行）→ NotePopover（+42 行，553→595 未越 600）；背面**内部滚动**（区域滚动、外层不滚）。**反例三钉**：① 无 `md` → 面板 DOM 与接前**字节级一致**（pre/post `innerHTML` diff 为空）；② 按钮命中区独立（`stopPropagation`；内容双击不翻）；③ `estimateNoteAreaHeight()` 常量（132）与面板宽高样式不变。**红→绿 12/12**（红 7 failed / 5 passed——阴性对照 5 例即绿）；既有面板测试 66/66 复跑绿。
- **验收**：kernel **523**（+6）/ react **1258**（+40）/ canvas **196** = **1977 全绿**；tsc ×3 零错误；react dist 重建（canvas 消费）；depcruise **436 模块 / 1241 deps 零违规**（+4 模块 = 3 新测试 + 1 src；+13 deps）；lint **1468 + 46**（持平原水位，含 3 处带理由的 `noArrayIndexKey` 定向抑制——静态只读内容位置键）；budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4、console 4/4）。
- **偏差与记录**：① **宿主勘误**（NoteGrowthPanel → NotePopover embedded；`grep` + `git log --all` 证据见报告）；② N1 引擎走子集路线（体积受阻，实测原文在报告 §N1）；③ 翻面态为「面板内 state」（计划明确允许二选一；离屏剔除会复位——严格「离屏保持」需宿主态、超出 MapView ≤3 行纪律，留复核裁定）；④ 复用未改的 `FlipCard` 在受控无 onFlip 下残留 `role=button` / `cursor:pointer` 视觉（点击 no-op；如需清理可另批加 `passive` 开关）；⑤ 收口门禁复跑修正（`09ae8f9`）：budget `bang` 假阳性 ×4（图片字面量触发哑正则）→ `\x21` 转义改写，bang 93→89/90、infos 47→46 复原；kernel 往返钉 2 处 TS2345（`serializeMm(p.root)` 未收窄 null；vitest 不查类型故测试全绿）→ guard-throw 收窄，`tsc -b` 复原（「测试通过 ≠ 类型通过」实锤一次）。
- **待跟进（范围外）**：背面编辑（textarea + 预览，P2）；`note.card.size` S/M/L（P2，与「卡尺寸是否影响布局」并议）；图片 / 表格渲染（P2）；严格「翻卡态离屏保持」（如需）。

## [1.8.16] — 2026-09-14 · 边 attrs 链路透传 + 丢弃诊断口径补全（R6 小批 / 零协议改动）

**触发**：边这条线两笔小账——① 坏边已能看见一半，但诊断条「总数 ≠ 分项数」（`problems` 含 malformed/自关联/重复/未知关系，括号里只有悬空/陈旧/失效三类，用户数不出第 N 条）且畸形项在关系面板无席位（点诊断条打开面板找不到那一条）；② `attrs` 协议层能存能往返（E1），但 react 层零命中（存了看不见）。计划：`docs/dispatch/2026-09-14-r6-attrs-and-diagnostics-plan.md`；报告：`outputs/2026-09-14-r6-attrs-diagnostics-report.md`。**零协议改动**：`.mm.md` parse/serialize 与 ADR 一行未动；`cid:` 边锚化归「R6-大」（须先出 ADR，`resolveAnchorToId` 现对 `cid:` 会落实体分支判 dangling）。

- **S1 诊断口径补全 + 畸形项可处置**（`cb33079`）：`render/edgeHealth.ts` 加法导出 `healthBreakdown`（互斥主分类，每项恰归一档；优先级 `malformed > invalid > dangling > stale > selfAnchor > duplicate > unknownRel`）；`EdgeHealthBar` 标题改消费分类——**括号内数字之和 === problems.length**（零类目省略；测试钉死；既有字段语义与明细/其余略契约未动）。`EntityGraphPanel` 连线区补「原始项非法」组（`第 N 条 · 原始项非法` + 删除入口，走既有 `onDeleteEdge` → `removeEdgeAt` 写路径，key 沿用 `e{index}` 位置键）；宿主 `MindmapStage` 从 `edgeHealthOf.problems` 过滤 malformed 派生 `malformedRows`（**面板不扫原始数组**，口径单一来源）；section 计数含畸形项；仅有畸形项时连线区仍渲染、空态引导不误现；**判据**：删除后 `malformed === 0` 且无其它问题时诊断条消失（测试钉死）。**口径变更对照表**（旧断言 → 新断言 + 为什么不是放宽）见 `cb33079` commit message 与报告 §S1。
- **S2 attrs 链路透传 + 只读呈现**（`a5ee1c2`）：`DocEdge` / `FreeEdge` 加法 `attrs?: Record<string, unknown>`；`collectFreeEdges` 对象守卫后**引用透传**（非对象/数组值不视为 attrs；显式收窄无 `as`）；`EdgeEditor` 样式行下方**只读**属性区（计数 + 最多 2 行 `k = v` + `title` 全量；无 attrs/空对象不渲染；不提供编辑，R6-A4）。**方向说明**：不是「修 attrs 丢失」——写路径本就安全（`patchEdgeAt`/`mergeStyleAt`/`removeEdgeAt` 经 spread 保未知键，保真钉 ② 锁死）。**四颗保真钉**：① `collectFreeEdges` 引用相等透传（红→绿）；② `patchEdgeAt` spread 保真（钉既有行为，初跑即绿）；③ `EdgeEditor` 渲染有则呈现无则不渲染（红→绿）；④ 协议往返 `edges` 面补钉（kernel `passthrough-ironlaw`：parse→serialize→parse 逐值相等 + 二次序列化字节稳定；E1 已覆盖 links 面）。
- **验收**：kernel **517**（+1）/ react **1218**（+12）/ canvas **196**（+1）= **1931 全绿**；tsc ×3 / react dist 重建 / depcruise（**432 模块 / 1228 deps 零违规**；+4 = S1 测试新增 4 条 src 相对导入，模块数不变——JSON 逐条归因见报告）/ lint **1468 + 46**（持平原水位）/ budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4；MindmapStage 2293→2299 接线级 +6）。**TDD 红证据 4 组**（原文见报告）：① `TypeError: healthBreakdown is not a function`（3 例红）；② 诊断条旧文案三例（`5 条（悬空 3 / 陈旧 1 / 失效 0）` = 3+1+0=4 ≠ 5——自关联那条在括号里没有席位；`3 条（悬空 1 / 陈旧 0 / 失效 1）` = 2 ≠ 3——畸形项数不出）；③ 面板畸形行缺失（`expected '连线 1…' to contain '连线 2'` / `element not found: [data-edge-delete="e1"]`，4 例红）；④ attrs 未透传 / 未呈现（`expected undefined to be { severity: 'high', w: 3 }` / `element not found: [data-edge-attrs]`）。
- **偏差与记录**：① **S1b 未降级**（宿主改动 MindmapStage +6 / SidePanels +3 行，远低于降级阈值；面板为纯加法，既有行结构与 `data-*` 契约未动）；② depcruise deps 1224→1228（+4；模块 432 不变）；③ **并行进程干扰记录**：收口期检测到并行批次（节点卡 P1 的 N1 探针）产物 `packages/react/tmp-n1-bundletest/`、`tmp-n1-probe.mjs` 落进 lint/depcruise 扫描范围 → 全量读数出现 41 errors / 2635 warnings / 437 模块的假象；按文件路径分桶后**本批口径 = 0 errors / 1468 warnings + 46 infos**（与基线逐数持平），depcruise 干净读数 432/1228 零违规（该批产物未触碰、未提交）；④ lint 收口期一次 +1 告警（canvas 测试新增 `m[1]!`，`noNonNullAssertion`）已即时修正并 amend 入 S1（`0a2f8f3` → `cb33079`；最终 1468 持平）。
- **待跟进（范围外）**：`cid:` 边锚化（「R6-大」，先出 ADR）；attrs 编辑 UX（JSON/键值编辑器另议，本批只做只读呈现）。

## [1.8.15] — 2026-09-14 · 森林布局缓存（岛级 + 岛内增量 / 投影壳稳定化 / 基准收口）

**触发**：C5 取证（`634ef9b`）N≈3280 多中心 21.7–33.3ms 同时越过 1.5×+16ms 双阈值 → 判定立项缓存批。计划：`docs/dispatch/2026-09-14-forest-layout-cache-plan.md`；报告：`outputs/2026-09-14-forest-layout-cache-report.md`。

- **F1 缓存通道 + 逐位等价基线**（`e3d3fde`）：`layoutForest` / `layoutIslands` opts 增 `cache` / `measureKey`（kernel 加法），`layoutDemo` 森林分支透传；森林入口统一执行 `mindmap.ts:112-121` 同款失效契约（collapsedKey / measureKey **身份比较**，不用内容深比较）；每岛调用 `layoutMindmapBranched({ ..., cache, measureKey })` 通道就位。判别：C5 矩阵 k∈{1,3,8}×N∈{364,1093,3280}+自动排列混搭，缓存开/关 `nodes/links/bounds` **全字段逐位相同**（Object.is 口径）。
- **F2 岛级缓存**（`5c472f9`）：`LayoutCache.forestIslands`（键 = 岛根身份 + dir）——未编辑岛零重算（零 measure）/ 引用复用；**非破坏式平移**（局部产物永不被平移污染；合并期产出平移副本 + placedAt 守卫）——幂等性（连续 3 次）与 20+8 步编辑序列逐步逐位等价钉死。**阴性对照**：岛键漏「岛根身份」（所有岛共享首岛键）→ 15 用例红（`expected 486 to be 364`）。
- **F3 岛内分支布局接 LayoutCache**（`cc728ae`）：`layoutLogic` / `layoutOrg` 接增量原语（`buildSkeletonCached` 命中复用、`placeSubtreeIncremental` / `placeOrgIncremental` 放置戳、`collectCached` 收集复用——域隔离靠构建期 side：logic=±1 / org=0 / mindmap=分区）；`layoutMindmapBranched` 回退与基准均透传缓存。**未触发停止条款**（无放宽等价判据）；深编辑零 measure + `cache.nodes` 引用复用达成。**阴性对照**：measureKey 判定失效（透传键不反映度量语义）→ 3 用例红（`box.x 非逐位相等（-23 vs -24.5）`）。
- **F4 投影壳稳定化 + 基准收口**（`74303aa`）：`projectIslands` 对「与上次产出逐项同一」的节点复用壳（结构共享感知，不做深比较）+ 文档根跨对象特判（`lastRootShell`）——**修掉「升格剪枝导致根岛每次换壳」**（F4 基准暴露：k=1 根岛 2187 节点每次编辑全量重算 ≈19ms）；`shiftTree` 加 delta memo。**基准 `scripts/bench-layout-cache.mjs`**（C5 矩阵复测 + 编辑型前后对照）：单树 N=3280 编辑 5.0→0.09ms；**森林 k=1 28.9→6.9ms（4.2×）/ k=3 25.2→6.5ms / 无改动复跑 29.5→0.02ms**；F-A7 判定：**<16ms 达成（6.5–7.0ms）、<5ms 未达**（残余成本：岛内 place 重放 / links 重建 / 遍历的 O(n) 残余——后续优化点）。
- **F5 复核修复**（`cafa20f`）：F 批收尾复核发现 F4 的 `shiftTree` delta memo 存在**静默陈旧几何**（memo 只校验岛平移 `dx/dy`；岛内放置重放会**原地改写复用 LayoutNode 的 box** → 命中返回陈旧副本，实测 n5 差 36px 且持久、真实 App「单行内敲字」可达）——**已移除 memo**（`shiftTree` 每次实算，复核实测代价 ~2.1ms、本机复跑 k=1 6.36ms 仍远低于 16ms 预算）；复核探针转正为回归钉 `packages/kernel/tests/layout-forest-shift-invariance.test.ts`（四方向 × 两种 measure × 8 场景）；同族风险盘点（cache.nodes/heights/stamps/collects/bounds、placedAt、投影稳定化）**无第二个缺口**（报告 `outputs/2026-09-14-f5-shift-memo-fix-report.md`）。

**验收**：kernel **508**（+25）/ react **1206**（+3）/ canvas **195** = **1909 全绿**；tsc ×3 / react dist 重建 / depcruise（431 模块 / 1220 deps，零违规）/ lint **1468 warnings + 46 infos**（持平原水位；mindmap.ts 新增注释压缩至 594 行）/ budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4）。**TDD 红证据 6 组 + 阴性对照 3 组**（各自精确变红后恢复、`git diff` 空）：① F1 通道 3 例红 + TS2353 ×7；② F2 引用复用红（`Compared values have no visual difference`）；③ F3 深编辑 355 节点重度量红；④ F4 根岛身份红（同上「无视觉差异」）；⑤ 岛键漏岛根身份 → 15 红；⑥ measureKey 判定失效 → 3 红。

**偏差与记录**：① **F4 投影壳稳定化为计划外新增**（计划 F-A5「投影缓存不做」）——实测证明「升格剪枝每次换壳」令根岛**恒 miss**（k=1 编辑 24ms 不达标）；稳定化非「缓存投影计算」（walk 照跑），是「壳身份稳定化」——§1.4 岛根身份假设的补全；② **已知边界**：编辑「嵌套升格子岛」内时其祖先升格岛会误 miss（内容未变但重算——需「投影产出的层级对齐」，另批）；③ `<5ms` 争取档未达（6.5–7.0ms；硬目标 <16ms 达成）；④ 本批与 L 批（文本链接）并行：文件面零重叠，CHANGELOG 顺延至 [1.8.15]。

**待跟进（范围外）**：islandLinks 子树级 memo / place 重放的 delta 平移 / 嵌套中层投影对齐（见本批边界②）。

## [1.8.14] — 2026-09-14 · 文本区域链接 Phase 1（解析 / 只读渲染 / 跳转 / 迁移跟随 / 插入入口）

**触发**：注释 / 内容区 / 笔记区三处文本此前都是纯文本——`[名](锚)` 显示为原样文字（无解析、无样式、无跳转）。本轮接上「命名 + 跳转 + 改名跟随」：语法采用 **CommonMark 行内链接**（T-A1，不引入 Wikilink），锚语法与 `note.rel` / `sections.root` 逐字一致（`node:` 路径锚 / `cid:` 稳定身份 / `@实体`）；**不存 nodeId**（原文即所写，会话内 id 每次解析都变）。计划：`docs/dispatch/2026-09-13-text-links-phase1-plan.md`；报告：`outputs/2026-09-13-text-links-report.md`。

- **L1 解析纯函数 + 只读渲染 + 跳转**（`0990caf`）：新 `edit/textLinks.ts`——`parseTextLinks`（label/target 转义 `\]`/`\)`、嵌套 `[` 宁可不认、URL 形态不认作内部锚 T-A6、三态复用 kernel `resolveLinkAnchor`）、`applySpanReplace`（**从右往左**应用防位移）、`findEntityNodeId`（实体锚→树中节点桥）；新 `chrome/TextLinkSpans.tsx`（**零包裹容器** Fragment 直出——不改变既有行内排版与 measure 口径）；三区域只读态接入（DescBlock / NotePopover / NoteGrowthPanel，**编辑态一行不动** T-A3）；`onJumpToAnchor` 宿主接线（MapView 透传 → 面板；MindmapStage 实现：展开折叠祖先 → reveal → 选中，T-A4，不自动开浮窗）。**round-trip 保真钉**（kernel `tests/text-links-roundtrip.test.ts`）：desc / note[2] / note_text 各含一条链接 → parse→serialize→parse **三字段逐字相同** + canonical 幂等（§1.4「`[` 起始文本往返安全」的证据化）。判别要点：`[已归档]`（无目标）、裸 `(node:x)`、`[a](http://…)`（Phase 1 = 纯文本）不误伤。
- **L2 迁移收集扩展**（`597e71f`）：`collectReferenceAnchors` 增扫文本字段内行内链接——`desc#0` / `note_text#0` / `note[2]#1` / `qa[0]#0`（span 级 field，与渲染同源判定）；`applyAnchorUpdateToNote` / `readAnchorField` 支持 span 形态（同一字段多处替换**从右往左**——实现注释 + 判别测试钉死）；改名/切搬后路径锚自动迁移为新路径、`cid:` 锚原样保留（走原样保留路径）；**坏锚保留原值、不阻断其他迁移**（回归钉）。盘点清单断言**纯追加**（cut-attach 既有 `toContain` 断言未动）。
- **L3 插入链接入口**（`e6bfc7d`）：**复用 `EdgeAnchorPicker` 未改其公开契约**（choices/onPick/onClose 原样；调用点用 `createPortal` 到 body——浮窗根有 transform，fixed 遮罩会被困住）；编辑态正文区「插入链接」按钮 → 候选选择器 → textarea **光标处**插入 `[显示名](锚)`；`preferredLinkAnchor`：目标有 cid 写 `cid:`（T-A7，**不做全库补发**）。
- **收口期两处真浏览器实测修复**（各带判别对照）：① **光标记录移到按钮 `pointerdown`**（`4decf73`）——按钮 onClick 时 textarea 已失焦、selection 可能被重置（对照：恒重读版插到位置 0，`expected '[A](node:根/任务/A)AB' to be 'A[A](node:根/任务/A)B'`）；② **链接 pointerdown 不冒泡**（`2ba219a`）——预览浮窗内点链接时 down 先触发「点击固定」→ floating→embedded **DOM 重建** → up/click 丢失（实测「要点两次才生效」的根因）。点链接 = 跳转意图，不承担固定浮窗职责。
- **真浏览器验证**（新 `tools/verify-l-text-links.mjs`）：① 预览浮窗 2 链接三态样式（well-formed 实线 + pointer；dangling 虚线 + title + default）；② 点击跳转——A 屏幕位置 (958,382)→(640,400) **精确居中**（指标用 getBoundingClientRect：`g.transform` 是世界坐标，viewport 平移不改它）；③ 幽灵点击视图不动；④ 环（Alt→更多→二级「编辑笔记」）→ 插入按钮 → 选择器 → textarea 插入第二条 `[A](node:根/任务/A)`。**全通过**；截图 `verify-shots/l-links-{preview,preview-zoom,jump,insert-picker,insert-done}.png`（快照守卫 `--allow-stale` 因 HEAD 为并行 docs 提交而正当——源码新鲜度通过）。

**验收**：kernel **483**（+3）/ react **1203**（+63）/ canvas **195** = **1881 全绿**；tsc ×3 / react dist 重建 / depcruise（429 模块 / 1214 deps，零违规）/ lint **1468 warnings + 46 infos**（持平原水位，新代码零告警）/ budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4；超 600 行：MindmapStage 2293 / edgeRouting 1235 / MapView 2230）。**TDD 红证据 4 组 + 阴性对照 3 组**（各自精确变红后恢复、`git diff` 空）：① text-links 29/31 红（`expected [] to have a length of 1`）；② 渲染接入 9/13 红（`expected null not to be null`）；③ 迁移 7/18 红（`expected undefined to be 'node:根/生活'`）；④ 去文本字段扫描 → 7 红（`expected '看 [名](node:根/任务/A)…' to be '…(node:根/任务/A2)…'`）；⑤ caret 恒重读对照 → 1 红；⑥ 按钮禁用对照 → 5 红（`未渲染 插入链接按钮`）。

**偏差与记录**：① canvas 首轮全量 3 红（C 批 `center-actions-promote` 的 cid 断言）——单跑/复跑全绿 + 路径论证（该链路 op 全为 note patch，`isAnchorAffectingOp` 短路、不经迁移收集）+ 历史偶发先例 → 判**低频偶发、与本批无因果**（留观察）；② 右键菜单已无「编辑笔记」（v1.8.2 瘦身移出，环内二级有等价席位）——验证脚本走环路径；③ L2 后重建的 dist 含同树并行批次源码（同工作树纪律，报备）。

## [1.8.13] — 2026-09-14 · 升中心 Phase 2（写路径统一 / 守卫补齐 / 嵌套语义收口 / 可见性 / 缓存取证）

**触发**：升中心方向已落地「协议/身份/布局/拖拽/菜单」全链，但留五处未收口——升格写路径双轨（菜单/环不分配 cid）、`planPromoteCenter` 与三个写动作无直测、嵌套跟随语义「设计确认中」、中心无任何视觉标记、森林布局无缓存且无实测数据。计划：`docs/dispatch/2026-09-13-centers-phase2-plan.md`。

- **C1 升格写路径统一**（`e5420ad`）：`makeCenterActions.onPromote` 由「`upsertCenter + updateNote`」双轨改为 `planPromoteCenter + applyTransaction`（与「设为 Section」共用唯一写路径）——右键/环两条入口自动同源；升格开始分配/沿用**节点 `note.cid`**（只给被升格节点，不做全库迁移）、单批 ops 一次 undo、root 守卫与失败通道（`onAttachError`）随 plan 生效。**口径变更（列明）**：`at` 不可解析（如空文本节点）时不再静默不动作，改由 plan 兜底 `cid:` 锚继续升格。判别测试 `center-actions-promote.test.tsx` 5 例（红→绿）。
- **C2 守卫补齐**（`96445e2`）：`planPromoteCenter` 直测 5 例（is-root / not-found / 无 cid 两 op+bump / 有 cid 一 op 不 bump / pos 落点写入）；写动作直测 4 例（`onDemote` 连键删+坐标进历史+cid 保留、多中心只删被降、非中心 no-op；`onToggleParentLink` show 写 / hide 删回读）。**顺带修复**：`onDemote` 未命中（非中心）不再写空 note/置脏（原实现会把 `root.note` 从 undefined 写成 `{}`，进 history 且弄脏 dirty）。**阴性对照**：改坏 `ensureNodeCid` 沿用分支 → 3 文件 3 用例全红（已恢复）。
- **C3 嵌套跟随语义收口**（`a7c7511`）：走真实管线的判别测试 3 例（投影层 `membersByRoot` 互不含 + 拖 P 时 C 岛成员盒不动 + 拖 C 时 P 岛不动）；spec §6.3 补「嵌套岛移动语义」——子岛独立坐标身份（`x`/`y` 与 `center_pos`）、父岛拖动**不带动**子岛（C-A3 裁决；钉住型测试直接绿，现状与计划 §1.2 判断一致）。
- **C4 中心可见性角标**（`b082438`）：节点**左上角**小圆点 + `data-center` + `<title>中心（doc#cid）</title>`（`pointerEvents:'none'` 不抢命中；右上=note 角标、右中=折叠钮，分侧不冲突）。渲染条件吃 `centerTitles`（collectCenters 真实中心事实）——**不用 `centerIds`**：后者含布局输出所需的「根岛根」，会把文档根误标为中心（真浏览器核对抓到）。**补漏**：`MindmapStage` 接线 `islandMembers`——A4「中心拖动整岛预览」的 `centerPreview` 自实现起**无任何调用方**，画布拖中心曾落「浮空克隆 + 置灰」的改结构表现（提交层一直正常）。`canvas-degrade.test.tsx` 追加 `data-center` 1→0（既有 1/1 与 0/0 断言未动）；`CANVAS_DEGRADE_NOTICE` 追加「中心标记」。真浏览器四态 verify `tools/verify-c4-center-badge.mjs`：普通/选中/拖拽中（整岛跟随 +107.6/+40.3 世界、非成员不动）/Canvas 降级（提示含中心标记）**全通过**；阴性对照禁用角标渲染 → 4 用例全红（已恢复）。截图 `verify-shots/c4-badge-{plain,selected,dragging,canvas}.png`。
- **C5 森林布局耗时取证**（`634ef9b`，只测不实现）：A6 原样基准（1097 节点 4 中心：3.3 → 12.3ms，3.74x，未超 16ms）；新增矩阵 `scripts/bench-islands-matrix.mjs`（N∈{364,1093,3280} × 中心数∈{0,1,3,8}）：N≤1093 各格比值 2.4-5.8x 但绝对耗时 <16ms；**N≈3280 三格全部同时越过 1.5×+16ms 双阈值（33.2/27.8/31.0ms = 4.87-5.82x，复跑一致）→ 触发条款命中，数据支持立项缓存批**（实现另批）。N=0 对照 ≈ 单树（封装开销 ≤0.2ms）。

**验收**：kernel **480** / react **1140**（+13）/ canvas **195**（+9）= **1815 全绿**（净增 +22；较计划预期 1804±2 多 +11——各任务判别测试均多写，无一条测试删除或放宽）；tsc ×3 / react dist 重建 / depcruise（421 模块 / 1181 deps，零违规）/ lint **1468 warnings + 46 infos**（持平原水位，新代码零告警）/ budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4；超 600 行：MapView 2193→2218 / MindmapStage 2254 / edgeRouting 1235）。**阴性对照 2 组 + TDD 红证据 3 组**（各自精确变红后恢复、`git diff` 空）：① `ensureNodeCid` 沿用分支改坏 → C1/C2 3 用例红（`expected 'c7' to be 'c3'` 等）；② C4 禁用角标渲染 → 4 用例红（`expected null not to be null`）；③ C1 双轨现状红（`centers 条目无 cid` / `expected [] to have a length of 1`）；④ C2 `onDemote` 修复前红（`expected {} to be undefined`）。

**待跟进（范围外）**：森林布局缓存批（C5 数据支持立项——P2「中心局部布局缓存」）；jsdom 视口裁剪口径可测试性笔记（0×0 视口 + worldRect/isBoxInView 双重 margin → 有效可见 ≈ ±256，夹具需贴近原点并加防裁剪假绿断言；已在 `mapview-center-nested-drag.test.tsx` 注释记录）。

## [1.8.12] — 2026-09-13 · 边会话稳定性深度修复（跨文档换代检查 / 鼓向顶点化 / 路由事实门控）

**触发**：R5 收口复核的独立探针复现两处缺陷——① 数据级：`stableByKeys` 跨文档误复用致**自由边整层不渲染**（R5 报告已记「范围外发现」，本轮独立复现并修）；② 行为级：R5-1 折线跳桥把「直线 + 跳线」的鼓向读成有侧（`inferBowSide` 形态漂移，`d05a043` commit message 已注明但未落测试）。修复中又收口同族第三处（选中边三项路由事实未按 key 门控）。报告：`outputs/2026-09-13-edge-stability-deepfix-report.md`。

- **① 自由边稳定化带来源换代检查**（`77c5c3b`）：`FreeEdge.key = e${index}` 是**位置键**——换文档后「边数相同且非零」时 key 序列逐项相等，`stableByKeys`（只比 key）返回**旧文档的边对象**（sourceId/targetId 已不指向本代次节点 → 端点盒全落空 → `renderable=false`）→ 自由边整层不渲染（含标签/命中区/手柄）。实测：文档 A 1 条边 → 切文档 B 1 条边 → `[data-free-edge]` 1 → 0。修法：稳定化 ref 改存 `{ source, arr }`，代次标识 = `rootNode`（`collectFreeEdges` 的输入；平移/缩放不换代 → G-P1/G-P9 零重算保证不受影响；打开/切换文档必然换代）；`stableArray.ts` 头部补**调用方契约**（key 相同 ≠ 成员内容相同，跨代次必须先换代）。回归钉：`freeedge-crossdoc.test.tsx`（+2）。
- **② Opp 鼓向改由路由折线顶点推断**（`84fe718`）：新 `inferBowSideFromPoints(points)`（约定与 `inferBowSide` 分支② 逐位一致；分支② 改为**委托**它、删重复实现——C 形态历史/人工路径仍经 `onPathPointsOf` 落此分支）；`useEdgeActions` 由 `entry.route.points` 算鼓向 → `EdgeDraftLayer` → `EdgeEditor.currentBowSide`（**首选**；缺省回落 `currentD` 字符串解析，旧调用方行为不变）。判定依据：`applyLineJumps` 只改写 d、不改 points → 跳线桥天然不进判向；「直线 + 跳线」恢复判 `auto`（Opp 落 right 兜底），不再按跳线抬升方向翻转。导出：`inferBowSideFromPoints` 登记进 `src/index.ts` 具名清单（包入口非 `export *`；canvas 侧消费 dist——实测踩到 `is not a function`，重建后通过）。判别测试：`edge-routing.test.ts` +3（含「桥 d 报 right / 顶点报 auto」两法差异记录）、`edge-editor.test.tsx` +2（判别 + 缺省回落兼容钉）、新 `edge-bow-side.test.tsx`。
- **③ 选中边三项路由事实统一按 key 门控**（`43c20ae`）：`d` / 鼓向 / `forcedSideFallback` 合并为单个 `selEdgeRoute`（含 key），出口 `selEdgeRouteHit` 统一门控——**换到尚未收到路由的边时三项一律回落默认**，不再把上一条边的 d 当作本边的（旧实现会让 Opp 的回落解析据上一条边的 d 翻转）。对外 API 名称/类型不变；值比较短路沿用 R3-4 纪律。判别测试：`edge-bow-side.test.tsx`「换边门控」用例。
- **边界（记录）**：`inferBowSide` **字符串 API** 对含桥的 d 仍报侧（兼容/历史路径；已在 `edge-routing.test.ts` 作为「两法差异」钉住）——产品路径已全部走顶点，仅 d-only 调用方可见。

**验收**：kernel **480** / react **1127**（+7）/ canvas **186**（+4）= **1793 全绿**；tsc ×3 / react dist 重建 / depcruise（416 模块 / 1170 deps，零违规）/ lint **1468 warnings + 46 infos**（持平，新代码零告警）/ budget 持平（bang 89/90、asCast 31/31、bigFiles 3/4；超 600 行：edgeRouting 1221→1235 / MapView 2182→2193 / MindmapStage 2254 不变）。**阴性对照 4 组**（各自精确变红后恢复、`git diff` 空）：① 去掉换代检查 → `expected +0 to be 1`；② EdgeEditor 忽略 `currentBowSide` → 直线+跳线落 `left`；③ 宿主丢弃顶点 → 弓形 `expected 'auto' to be 'left'`；④ 去掉 key 门控 → 换边门控 `expected 'M 0 100 C 50 0, 150 0, 200 100' to be undefined`。

## [1.8.11] — 2026-09-13 · 渲染一致性 R5（跳线折线化 / 边标签层上提 / Canvas 降级提示）

**触发**：R2/R3/R4 补齐边能力后，渲染层三项一致性欠账——跳线是「折线主体 + 贝塞尔弧」混合形态、边标签被节点遮挡（两处 `EdgeLabel` 渲染点都在节点层之下）、>5 万可见节点自动降级 Canvas 时用户零感知（全仓无降级提示）。计划：`docs/dispatch/2026-09-13-r5-render-consistency-plan.md`。

- **R5-1 跳线折线化**（`d05a043`）：`pathWithJumps` 的 hop 由「L enter + C 拱弧」改为折线梯形桥四折点（enter → 法向抬起 r → 沿路径跨 2r → 落回 exit）——单几何形态贯穿路由 → 渲染 → 判定（`inferBowSide`）→ 导出；跳线点位置 / 上下判定 / 前后各留 r / 忽略规则 / 无交叉零拷贝 / `fastRouting` 门控 / R4-3② 失效边剔除路径 全不变。**断言口径变更 3 处**（均换语义等价折线判据、非放宽）：① `pathWithJumps` 用例「`toContain('C')`」→「不含 C + 全串写死（顶点 2+4=6、抬升=radius）」；② R3-2 夹具前置「`toContain('C')`」→「M/L/C 指令 ≥ 4」（`inferBowSide` 期望 left/right 不变）；③ 对角线用例 d0「`toMatch(/C /)`」→「不含 C + M/L 指令写死 7」、d1「`not.toMatch(/C /)`」（折线化后恒真、守卫静默失效）→「与输入直出折线逐字相等」。另核第 4 处 C 判据（`edge-invalid-routing:90`——探针实证其 C 来自短边自身贝塞尔形态，与跳线无关）。真浏览器 before/after：`tools/verify-r5-jump.mjs` → `verify-shots/r5-jump-{before,after}-{full,zoom}.png`（梯形桥清晰可辨、无断点感、与折线主体风格一致）。
- **R5-2 边标签层上提 + 层序契约**（`859a930`）：新 `EdgeLabelLayer.tsx`（`FreeEdgeLabelStore` + `useSyncExternalStore`）——树线标注与自由边标签统一搬到节点层之上（ghost 之下）；`FreeEdgeLayer` 只收集（`onLabelsChange`；ghost 锚点 / stroke 三态 / 空文本口径逐项一致）+ layout effect 上报 + 卸载清空；**命中区留原层**（`data-free-edge-hit` 反例钉：仍在节点之下、不在标签层）。层序契约注释 + 各层 `data-layer`（sections/tree-links/free-edges/nodes/edge-labels/ghosts/drag）+ `mapview-layer-order.test.tsx` 4 例（先红后绿）+ `edge-label-guard.test.tsx` 改走真实 MapView 组合（四例语义不变）。**偏差**：最小文档上标签-节点最近约 1 世界 px 贴边不交叠（布局/路由天然保持净空），before/after 截图像素一致——层序主验收 = jsdom 契约，`tools/verify-r5-labels.mjs` 留作邻接态证据。
- **R5-3 Canvas 降级提示**（`a4d9cc4`）：`MapStats.backend` 加法字段并**并入材料字段**（触发 dep = `useCanvas`；biome 中性已对照验证）；新 hook `useCanvasDegradeNotice`（同文档只提示一次 / 切文档重新允许）+ 命令告警条 + `PerfPanel` 后端行。**损失清单实测**（DoD）：同夹具 svg↔canvas diff = `data-tree-edge-label` 1→0、`data-note-badge` 1→0（占位跑原样捕获）→ 文案终稿：「已进入大图模式（Canvas）：为保住帧率，边标签与注释角标暂不渲染（可见节点超过 5 万自动切换）。折叠部分分支可回到完整渲染。」（判据吃折叠裁剪后的可见节点数——折叠跌回阈值自动恢复 SVG）。
- **发现（范围外，未修，建议后续批次）**：`stableByKeys`（G-P1）仅按 key 序列判复用——文档切换后新边集 key 相同（如 e0/e1）而内容全新时，返回**旧解析树**的边 → `boxOf` 全落空 → 自由边整层不渲染（fiber 探针实测：feEdges id ≠ documentRoot id；触发条件：切换前后自由边数相同）。本批 verify 脚本以 3 边文档绕开（脚本注释有指向）；修复方向：稳定化需带来源换代检查（如 rootNode 身份）或内容判据。

**验收**：kernel **480** / react **1120** / canvas **182** = **1782 全绿**（R5 批 +10：R5-1 +2 / R5-2 +4 / R5-3 +4）；tsc ×3 / react dist 重建 / depcruise（414 模块 / 1167 deps，+5 文件为新模块与新测试；零违规）/ lint **1468 warnings + 46 infos**（持平原水位——终检曾 +5（新测试夹具非空断言），修复提交 `0767992` 后复跑回 1468）/ budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4——超 600 行：MindmapStage 2249→2254 / edgeRouting 1213→1221 / MapView 2112→2182）。

## [1.8.10] — 2026-09-13 · 空白区交互裁决 + 快照新鲜度守卫

**触发**：用户裁决两条"画布空白处"交互（双击 / 单击），并收口本轮「快照过期导致白跑一轮」的流程坑。

- **双击空白 = 无操作**（`MapView` onDoubleClick）：此前空白分支会 `fitBoundsAnimated`（跳回全图）——「随手在空白双击就把视图重置」是编辑流干扰源；适配视图的显式入口仍在（工具栏「适配视图」/ Ctrl+0）。判别测试 `mapview-dblclick.test.tsx` +1。**测试口径记录**：「什么都不该发生」类断言不能只用 `waitFor`（首次轮询即成功 → 假绿，阴性对照实测踩过），正确做法是等 rAF 视口动画窗口跑完再断言恒等。
- **单击空白 = 只取消选中**（`MindmapStage` onBlankClick）：不再顺手清 `pinnedNotePaths` / `editingNotePaths` —— 那是**用户显式打开的面板**（不属于选中态），此前会被静默关掉：正在输入的笔记内容直接消失。卡片关闭路径仍完整（卡片 × → `onNoteClose`）。
- **快照新鲜度守卫**（新 `tools/lib/snapshotCheck.mjs`；三个 verify 脚本共用）：三查 ① 产物是否新于 HEAD 提交 ② 产物是否新于最新源码 ③ 页面**实际加载**的 bundle 是否就是产物引用的那个（浏览器缓存）；过期即拒绝执行并打印重建命令（`--allow-stale` 可忽略）。背景：本日编辑流批次收口后，用户在过期快照上复测得出「没解决」，白费一轮往返。
- **工程卫生**：`analyze-codebase.mjs` C2 最长函数计数 off-by-one（少算 1 行；`StageContent` 1780 → **1787**，与实际闭区间吻合）；`LenBubble` / `UnsavedPrompt` 两处 no-op `biome-ignore` 抑制清理（biome 自报 `suppressions/unused`）。
- **验收**：三包 **480 / 1110 / 179 = 1769**（react +1）；三个真浏览器脚本 PASS（blank-click 3/3 · arrow 7/7 · edit-flow 5/5，且各自先过快照守卫）；tsc ×3 / depcruise / lint 全 0（水位 1470 → 1468）；budget 持平（bang 89/90、bigFiles 3/4）。

## [1.8.9] — 2026-09-13 · 方向键几何导航（A 档：就近节点 + 视口最小推入）

**触发**：用户实测——方向键「意义不明」：`↓` 要穿完整棵子树才换到下一个兄弟，且 `↓` 与 `→` 是**同一实现**（`EditorController.navigate` 的 `ids[i+1]`）。画布是左右双翼的二维布局，线性（DFS 前序）语义与用户的空间心智不符。

- **A 档几何导航**（新 `packages/react/src/render/navigateDirection.ts`）：按**视觉方向**取最近可见节点；两级判定 ① 对齐带优先（垂直投影重叠 = 真·正上/下/左/右）② 主方向距离 → 横向偏差 → 输入序（等距确定性）；锥形过滤 `NAV_CONE_RATIO = 1.6`（≈58°）挡擦边邻居。输入直接吃 `layout.nodes`（零额外分配），**天然尊重折叠**（布局已裁剪）与双翼（几何方向与树层级无关：右翼 `←` 是父、左翼 `←` 是更深的节点）。
- **视口最小推入**（`revealTargetInViewport`，纯计算）：目标不在视口内时只挪「刚好可见」的量（`NAV_REVEAL_PAD = 24`，不居中、不改 k）；已可见 → 零动作（不晃画面）。
- **接线**：`MapViewApi.navigateFrom(id, dir)`（算目标 + 推视口，**不写选中**——由宿主 `controller.select` 写入）；`MindmapStage` 的 `case 'navigate'` 改走它。
- **兼容**：`EditorController.navigate` **保留**（JSDoc 标注为「大纲式线性导航」，语义与既有 5 例测试不变）；快捷键表文案 → `方向导航（就近节点）`。
- **验收**：单测 16 例（合成盒 7 + 真实布局 3 + 视口推入 4 + MapView 接线 2）；真浏览器 `tools/verify-arrow-navigation.mjs` **6/6 PASS**（含两条旧实现必红项：`↓ from A` 不钻子树 / `→ from B` 左翼走父；推入按像素对齐 `1256 = 1280 − 24`）；三包 **480 / 1109 / 179 = 1768**（react +16）；tsc ×3 / depcruise / lint 全 0；budget 持平（bigFiles 3/4、bang 89/90）。

## [1.8.8] — 2026-09-13 · 编辑流保全（保存不再打断会话）

**触发**：用户实测——每次编辑提交 / 新建节点后「页面回正刷新」：选中丢失、正在编辑的内容丢失，必须重新点节点。计划：`docs/dispatch/2026-09-13-edit-flow-session-integrity-plan.md`（因果链已定位到 file:line）。

- **病根（保存 → 重建回读环）**：autosave 300ms 落盘后 `setDoc((d) => ({ ...d, source }))` 改写 `doc.source` → 数据管线按新 source 重解析（`buildEditable(doc.source)`，每次全量 parse + 重建节点 id）→ 文档重建 effect（deps `[doc.source]`）误触发：`controller.reset()` + 实体表重建 + 收起 QA + `fit()`（「页面回正」真身）。**四类损失**：选中 / 编辑中（editingId、descEditingId）/ Undo 历史 / 折叠态。
- **E-1** `MindDoc.savedSource` 新增字段（「最近一次成功保存的内容快照」）+ 抽 `useAutoSave`（`apps/canvas/src/hooks/useAutoSave.ts`，纯搬迁）——保存写回改 `savedSource`，不再改写 `source`；判别测试 `useAutoSave.test.tsx`（写回口径 / dirty·handle·saved 三重早退 / unmount 清理，5 例）。
- **E-2** 手动保存 / 另存为同口径：`useDocumentActions` 两处 setDoc 补丁改 `savedSource`；`remember()` 契约「传入即内容」不动（防 spread 残留旧值）；判别 +2 例。
- **E-3** 抽 `useDocumentSwitch`（`apps/canvas/src/hooks/useDocumentSwitch.ts`，纯搬迁 B1 重建 effect）——文档切换语义单点化；判别测试双向钉：t1「仅 savedSource/ts/handle 变 → reset/setEntities/setExpandedQaId/fit 零调用」（防误触发）、t2「source 变 → 四动作各恰一次」（防删功能）。
- **E-4** 连带口径：文档库 / 最近文档快照改读 `doc.savedSource ?? doc.source`（deps 同步）；`useAutoSave` / `useDocumentSwitch` / `MindmapStage` 加防回潮注释（保存路径不得改写 `doc.source`）。
- **契约变更**：`source` 语义收敛为「本次会话打开 / 新建时的内容（解析输入）」；新增 `savedSource` 承担「最近一次成功保存的快照」；全部消费点一律 `savedSource ?? source`（新建文档首次保存前无该字段）。

**验收**：kernel **480** / react **1093** / canvas **179** = **1752 全绿**（E 批 +9：useAutoSave 5 + useDocumentActions 2 + useDocumentSwitch 2）；tsc ×3 / react dist 重建 / depcruise（406 模块）零违规 / lint **1464 warnings + 46 infos**（搬迁段 useExhaustiveDependencies 警告以 `biome-ignore` 显式抑制——该段 deps 为刻意保留、原代码即带 `eslint-disable` 声明；全仓净降 17，exit 0）/ budget 全持平（bang 89/90、asCast 31/31、bigFiles 3/4——**MindmapStage 2269 → 2241 行**）；阈值 / 契约测试零放宽；`CULL_MARGIN` 未动。

**判别性证据（两条阴性对照，DoD）**：① `useAutoSave` 写回改回 `source` → 判别用例红（`AssertionError: expected undefined to be 'SRC'`）；② `useDocumentSwitch` deps 改对象身份 `[doc]` → t1 红（`expected "vi.fn()" to not be called at all, but actually been called 1 times`，reset 误触发）；两者恢复后复跑全绿（7 passed）、`git diff` 为空。

## [1.8.7] — 2026-09-13 · 关系线 R4（能力补齐：菜单 / 反向 / 失效语义 / 级联 / 批量）

**触发**：关系线能力面收尾——`reverseOf` 全仓零消费者、失效边静默吞新建并塑形他人、级联从未定义、无批量。计划：`docs/dispatch/2026-09-13-edge-r4-capabilities-plan.md`。

- **R4-1** 边右键菜单：FreeEdgeLayer 命中区 `onContextMenu`（preventDefault + stopPropagation 防两层菜单；右键同左键语义先选中）→ MapView `onEdgeContext?` → 新 `edgeContextItems.ts`（数据在 react / 渲染在宿主，禁用矩阵测试钉死：回调缺省即禁用、manual 不禁重挂、dangling/对称/未注册不禁反向与复制）→ EdgeDraftLayer 渲染 ContextMenu + 重挂复用 EdgeAnchorPicker；菜单状态提升 Stage（4 行）。宿主接线：重挂/复制/失效/删除走 `useEdgeActions` 唯一写路径（新增 duplicateEdge / setEdgeInvalid）。
- **R4-2** 反向（数据层反转）：`reverseEdge`——交换 from/to；rel 三态（成对反向 → `reverseOf` 换名 / 对称不变 / 未注册不变 + message 经 commandNotice 提示，R4-A2）；渲染端保形（manual 交换 + routingSide 翻转，同 R3-3 问题域）；**与 dir 正交（反向不改 dir）**。表驱动 **18 组合**（rel 三态 × dir 三态 × manual 有无全交叉，覆盖计划要求的 12 组合）+ 端点保位（真实渲染 d 起终点互换）+ undo 全回滚。EdgeEditor 加法扩展可选 `onReverse?`（缺省不渲染按钮）。
- **R4-3** 失效语义补全：① 去重口径——`connectEdge` 只对未失效边查重，同名失效边不吞新建（并存 + 提示「已存在 N 条同名失效边」）；② 失效边**退出路由协调**（R4-A3）：不占 stagger 档、不进 routedPolylines、不参与跳线，仍照常绘制灰虚线——契约测试（A→D × B→C 交叉判别场景）+ 真浏览器硬断言（其余边 d 逐字节相同，`tools/verify-edge-invalid-routing.mjs`，截图 verify-shots/edge-invalid-*.png）+ 独立可回退 commit；③ 空 label：label 空串回落 rel（与计划偏差：EdgeLabel 本就有空文本守卫，「渲染空胶囊」前提不成立——实测钉死后补回落语义）。
- **R4-4** 级联（限定语义，R4-A4）：成对反向边（同一节点对无序匹配 + rel === reverseOf，源 rel 非对称、已注册）**同步失效 / 恢复**——同一 invalidAt 时间戳、已失效不覆盖原戳、已有效恢复 no-op、一次 undo 全回滚；对称 / 未注册 / 非成对不联动（表驱动钉死）；EdgeDraftLayer 失效/恢复收敛为 hook 动作。**明确不做**：节点删除→自动失效标记（保持 dangling 自然语义 + R0 可见）、传递闭包、跨文档。
- **R4-5** 批量（最小可用，**未触发停止上报条款**）：Shift+点边多选（`selectedEdgeKeys?`/`onSelect` 第 4 参均为加法，MapView 改动 8 行 <30；多选状态存 useEdgeActions 而非画布手势层，无新手势机制；Shift+点边与「Shift+点两节点连线」目标不同、无冲突）→ 批量条（`data-edge-multi-bar`：N 条 + 失效/恢复/删除）；批量删除/失效/恢复各一次写一条 history（一次 undo 全回滚），批量失效跳过已失效并提示「已跳过 N 条已失效」；单条选中与编辑回归钉全绿。清空路径：Esc / 退出关系模式 / 单选——**点空白清空未做**（与 pan 手势相邻，按停止条款精神豁免）。

**验收**：kernel **480** / react **1093** / canvas **170** = **1743 全绿**（R3 基线 1694 + 本批 +49）；tsc ×3 / dist 重建 / depcruise（402 模块）/ lint **1481 warnings + 46 infos 持平**（新代码零告警）/ budget 持平（bang 89/90、asCast 31/31、bigFiles 3/4——MindmapStage 2269 / MapView 2088 属宿主接线与透传增长）；阈值/契约测试零放宽（新增 props 全部可选、缺省回落原行为，既有用例零修改）。

## [1.8.6] — 2026-09-13 · 关系线 R3（自动行为可预期化）

**触发**：三类静默——「点了没反应」（manual 边上 routingSide/Opp 永不生效、Opp 对跳线恒落 right）、「形状悄悄变了」（切 dir 手工几何换端）、「方向反了无感知」（指定侧无解静默变直连）。计划：`docs/dispatch/2026-09-13-edge-r3-predictable-autobehavior-plan.md`。

- **R3-1** manual 边显式禁用 routingSide/Opp：EdgeEditor edge prop 加法扩展 `manual?`；禁用态 tooltip 指引「双击 bend 恢复自动」；flipSide/onChange 双早退（R3-A1）。
- **R3-2** `inferBowSide` 支持多段路径：单 C 段分支逐位不变（回归钉）；跳线/折线走「离首末弦最远的路径顶点」判定——对 plan A2「最长 C 段」的修正（pathWithJumps 主体是 L 段，C 段只是过障小弧）；Opp 的 `'auto'` 兜底仍落 right 但给行内提示（不再静默）。
- **R3-3** dir 切换保形：`useEdgeActions.setEdgeDir`——fwd↔back 同一补丁交换 manual.from/to 并翻转 routingSide（两端锚点与侧向保位，手工把手不跳），both 与 fwd 同向不交换（三态边界钉）；单补丁一次写一条 history。**偏差**：plan 绿期望「渲染 d 逐位相同」数学不可达（dir 翻转后渲染起点必须落在另一盒；manualBezier 切线手性使反向重建非同一曲线），按可达成的最强契约钉「端点保位」。
- **R3-4** `RouteResult` 加法扩展可选 `forcedSideFallback?`——仅 forceSide 指定侧且走到直穿降级时置位（`routed` 语义不动，R3-A4）；无 forceSide 的降级/空旷直连不置位（区分钉）；经 `handleEdgeRoutes`（值比较）→ EdgeEditor 行内提示「指定侧不可行：已回退直连（可试另一侧）」。
- **R3-5** 注释对齐：forceSide「回退两侧全枚举」→ 实情（直穿降级兜底绝不空白）；stagger 步长注释 0.125 → 实际 0.0625 半档；freeEdges.ts forward 判据旁落渲染端语义契约。
- **结构**：LinkCreator 机械抽出 EdgeEditor（630 破 600 → bigFiles 回 3/4），公开出口经 re-export 不变。

**已知取舍（R3-5 明文档化）**：
- **低 LOD 关避障 / 动画期形状瞬变 = 刻意换帧率**：低 LOD 下 `MapView` 的 `edgeObstaclesOf` 门控关闭障碍收集、`FreeEdgeLayer` 动画期 `fastRouting` 跳过跳线——形状在门控边界瞬变是性能权衡（B-P3 已冻结手势期 LOD），**不修行为**（R3-A5）。
- **manual / routingSide 的渲染端语义契约（R3-A3）**：两者都按「渲染 from→to」解释；dir 的 fwd↔back 切换由 `useEdgeActions.setEdgeDir` 保形（同一补丁交换 manual 两端 + 翻转 routingSide）；`both` 与 `fwd` 同向不交换。`RouteResult.forcedSideFallback`（R3-4）仅在 forceSide 指定侧且走到直穿降级时置位——`routed:false` 的两种含义（空旷直连 / 降级直穿）语义不动（R3-A4）。

## [1.8.5] — 2026-09-13 · 关系线 R2（修复闭环：重挂锚点 + 可发现性 + 删除漂移修复）

**触发**：R0/R1 之后「坏边能看见但不能修」——无任何重挂锚点 UI；R1 复核发现③：删除重复实体会让其余同实体节点的 `#N` 锚越界漂移（stale）。计划：`docs/dispatch/2026-09-13-edge-r2-repair-and-reattach-plan.md`。

- **R2-0** kernel `planReferenceMigration` 加 `opts.tolerateMissingTargets`（缺省 false = 现行语义逐位不变，kernel 测试钉死）；`ReferenceDiagnostic.code` 加 `'target-lost-kept'`；三个冲突调用点（cid/路径/实体）统一走降级出口。`remove-node` 条件式入迁移白名单（R2-A4：仅触发 op/批次含 remove-node 时传 true，其余保持严格）——**契约更新**：推翻 R1-1「remove-node 不参与迁移」的偏差；删除不再被 target-lost 阻断，删重复实体时其余实体的 `#N` 锚自动回裸锚（不漂移），指向被删者的引用降级保留原锚（解析层的 #N 定位语义会把保留的 `#N` 重解析到幸存出现，属既有解析行为非迁移改写）。
- **R2-1** 全仓**第一个**边锚修复入口：`EdgeAnchorPicker`（候选 + 过滤 + Esc/遮罩取消 + `excludeAnchor` 防自关联 + 面板内 stopPropagation）→ `EdgeEditor` head 行「重挂源/重挂靶」入口（可选 props 缺省不渲染）→ `useEdgeActions.reattachEdge` **唯一重挂写路径**（`writeEdges + patchEdgeAt`，只 patch 指定端、不清 `invalidAt`（R2-A3）、一次 undo 回滚）。
- **R2-2** 可发现性闭环：EdgeHealthBar 加 `onOpen` → 点击打开关系面板——**契约反转** R0-2 的「零点击（pointerEvents none）」为「单点击可达」（缺省未接线仍 none 向后兼容）；点击区域仅条体本身。
- **R2-3** 关系面板行内动作：「重挂」只出现在有未解析端的行（源锚未解析 → from / 目标未解析 → to / 两端都坏 → from 优先并注明），复用 EdgeAnchorPicker（排除另一端原文防自关联）；「删除」走同一 `writeEdges` 写路径（`useEdgeActions.deleteEdge` = `writeEdges + removeEdgeAt`），动作按钮 stopPropagation 不触发行聚焦。
- **R2-4** `edgeHealth` 口径注释写准：与 freeEdgeEndpoints 逐情形对照（源锚不可解析/ghost/自关联一致；缺盒/塌陷/零尺寸判不了 → renderable 只会高估不会低估）；noBox 注明【含 ghost 场景】。偏差：计划原表述「ghost 被本函数 renderable 排除（低估）」与实现事实相反（ghost 计入且被测试钉死），按「写准」目标记录实际口径。
- **R2-A1 裁决（范围收口）**：无源边的画布占位（收件箱角/原点附近）**不做**——`freeEdges.ts:307-314` 有历史裁决「不画飞向世界原点的误导性直线」（E8 P0），该形态需新 UX 概念与命中/z-order 处理；改为「诊断条可点 + 面板行可修复」的**发现路径**闭环。若要收件箱，另立 UX 决策批。

**验收**：kernel **480** / react **1062** / canvas **128** = **1670 全绿**（R1 基线 1651 + 本批 +19）；tsc ×3 / dist 重建 / depcruise（392 模块）/ lint **1481 warnings + 46 infos 持平**（新代码零告警）/ budget 持平（bang 89/90、asCast 31/31）；阈值/契约测试零放宽（唯二契约反转：R2-0 remove-node 条件式启用、R2-2 零点击 → 单点击可达，均在对应 commit message 逐条写明）。

**R3 验收（本段终稿）**：kernel **480** / react **1081** / canvas **133** = **1694 全绿**（R2 基线 1670 + 本批 +24）；tsc ×3 / dist 重建 / depcruise（393 模块）/ lint **1481 warnings + 46 infos 持平** / budget 持平（bang 89/90、asCast 31/31、bigFiles 3/4 经 LinkCreator 拆分维持）；阈值/契约测试零放宽（既有 edge-routing/edge-editor 用例零修改，新增全部为加法）。

## [1.8.4] — 2026-09-13 · 关系线 R0+R1（边健康度观测 + 锚迁移接线；react 加法导出 + canvas 接线）

**触发**：自由边「坏了但静默」——畸形项被 `collectFreeEdges` 静默丢弃、改名/缩进/反缩进/重排四类结构编辑默默断开关系线（`planReferenceMigration` 此前只挂在切断/接回两条命令上）。计划：`docs/dispatch/2026-09-13-edge-health-and-anchor-migration-plan.md`。

**R0 观测先行（全部加法）**
- **R0-1** `edgeHealthOf` 纯函数（`packages/react/src/render/edgeHealth.ts`）：独立扫原始边数组 + 复用 collectFreeEdges 三态产物，产出 total/renderable/byState/invalid/malformed/selfAnchor/noBox/unknownRel/duplicates 计数与 problems 明细；不修改 `collectFreeEdges`（静默丢弃行为留给 R6 契约对齐批）。renderable/noBox 为数据层口径（无 layout，文件头已声明与画布差异）。
- **R0-2** `EdgeHealthBar` 诊断条：problems 非空才渲染（阴性对照钉死），文案「悬空 X / 陈旧 Y / 失效 Z」+ 最多 3 明细 + 其余略；`pointerEvents:none`；中心诊断条可见时抬至其上方避让。
- **R0-3** 关系面板按状态分区（正常/悬空/陈旧/已失效，区标题带计数）；`sourceId===''`（源锚未解析）行不再 `onFocusNode('')` 静默 no-op → 禁用态 + 「源锚未解析」。
- **R0-4** 迁移诊断不再被吞：`CutAttachPlan` ok 分支带 `diagnostics`，切断（MindmapStage）与接回（nodeMenuBags）两路径经既有告警通道上报一行汇总（`summarizeReferenceDiagnostics`，语义=「本来就是坏，非本次操作造成」）；不阻断提交。

**R1 身份根治（写路径收敛，与 ADR-0008 同哲学）**
- **R1-1** 锚引用迁移收敛到编辑管线：`EditorController.apply/applyTransaction` 一处统一 `before → 预演 → planReferenceMigration → 迁移 op 与结构 op 同一 history 条目`（一次 Ctrl+Z 同撤文本与锚）；冲突整批拒绝（apply 走新增 `onAnchorConflict` 回调，applyTransaction 返回 `code=reference-conflict`），文案含冲突码/字段/锚文本。**op 白名单（R1-A4）执行偏差**：① `update-node` 仅 text patch（计划口径）；R1-1 commit 曾扩展 type/ref，R1-2 实测 kernel anchor-migrate 不支持「路径锚→实体锚」重建+回验（migration-verify-failed 会整批拒绝转实体）后撤销——`setEntityRef` 转实体为已知缺口（旧锚悬空，R0 可见，留后续批次）。② `remove-node` 不参与迁移：迁移对「目标被删」只能产出 target-lost 冲突 → 会阻断「删除被边引用的节点」这一合法主流程；删除维持既有语义（边悬空 → R0 可见 → R2 重挂修复）。
- **R1-2** 结构编辑入口全枚举：全部树变更入口均经 controller（拖拽重排 MindmapStage `onNodeMove → controller.apply`、切断/接回 → `applyTransaction`、其余走 controller 命令），无绕过管线的直接树改写；`it.each` 表驱动 10 行钉「操作后边锚存活」。
- **R1-3** 「改名即 dangling」断言核查：63 处 dangling 命中逐类核对，**零处**钉「管线改名/移动 → dangling 为预期」；数据层旧锚 dangling（外部手改/旧文件）仍是正确语义，新增分层对照钉防语义互污。
- **R1-4** 宿主接线：`onAnchorConflict → setCommandNotice`（commandNotice 状态提升至 StageInner 以供 controller 构造处闭包）；全 gate 实测见验收。

**明确不做**（沿用计划 §4）：边 cid 化（须另立 ADR）、重挂锚点 UI（R2）、自动行为可预期化（R3）、能力补齐（R4）。

**验收**：kernel 478 / react **1048** / canvas **125** = **1651 全绿**（基线 1610 + 本批 +41）；tsc ×3 / react dist 重建 / depcruise（389 模块）/ lint **1481 warnings + 46 infos 持平**（新代码零告警）/ budget 全持平（bang 89/90、asCast 31/31、any·tsIgnore 0/0）；阈值/契约测试零放宽（R1-3 为语义反转核查，无断言改写）。

## [1.8.3] — 2026-09-12 · 自由边路由治理批次 G 收口（react 内部性能与守卫；no-API）

**触发**：pan 期自由边路由整表重算（成员进出时 E×全量枚举，E=100×10K 实测 1331ms 卡顿级）。本批 G-P1 内容键 identity 稳定化 + G-P2 裁剪窗口量化 256 + G-P3 每边成本下降（折叠解析器预计算 / 障碍预构建表 / 索引粗筛 R=2·chordMax+210）+ G-P6 路由结果 LRU（`FREEEDGE_ROUTE_CACHE`，**默认关**，收口决策：成员进出场景真浏览器 A/B 后再定默认值）落地，G-P9/P9b 复核守卫补判别缺口（跨量化边界零重算、绕过 stableByKeys 接线必红；保守界充分性 200+ 对拍 + 界内缘对抗几何，R 一缩即红）。数字与两轮阴性对照红证据见 `docs/preview/perf-baseline.md` §8.4–8.5；计划 `docs/dispatch/2026-09-12-freeedge-routing-recompute-plan.md`。

## [1.8.2] — 2026-09-12 · 性能地基批次 B（P0–P4；react/kernel 内部性能，no-API）

**触发**：pan/zoom 每帧重算整棵渲染体与父壳、裁剪与命中与节点总数耦合。本批先建可对照基线（P0），再做索引（P1）/memo（P2）/节流与 LOD 冻结（P3），最后复测并决策 P5。

| 项 | 内容 | 说明 |
|---|---|---|
| **P0 交互基线** | 新增 `tools/bench-interaction.mjs`（真浏览器：`nodeMutations` 节点 DOM 变更 + 帧间隔）；`perf-baseline.md` §6 落档 | 侦察证伪计划预期：基线 `nodeMutations` 已为 0（React 结构复用本就避免节点 DOM 重挂）→ 机制指标改用**节点组件渲染次数**（jsdom 计数） |
| **P1 网格索引** | kernel 新增 `layout/spatialIndex.ts`（`buildBoxIndex`/`queryBoxIndex`，半开分桶 + 查询膨胀 1 格保证不漏）；MapView 裁剪与 `hitNodeAt` 接入（≥1000 节点启用，以下线性零回归） | 等价性钉死（kernel 13 例 + react「索引 vs 线性」7 例含 skip/6px pad）；**典型视口裁剪 ↓85%~98%** |
| **P2 memo 化** | `NodeG` 包 `memo`；MapView 稳定 `visibleNodes`（useMemo）/`style`（按色板键缓存）/`onToggleCollapse`（useCallback + 传 id）/`resolveAssetUrl`（ref 转发） | jsdom 机制断言：纯平移 `NodeG` 渲染 **10 → 0**；真浏览器 `nodeMutations` 恒 0 |
| **P3 父壳降载** | `onStats` 节流（≥200ms 且材料字段变化才回调，`viewMs` 不作触发）；缩放手势期冻结 LOD（`onGestureActive`，平移不冻结） | 窗口内 10 次 epoch → **1 次**回调；手势内跨 0.5 阈值不再抖档 |
| **P4 复测与决策** | `perf-baseline.md` §7 四列对照（P0/P1/P2/P3）+ 门禁对照 | **决策：P5（transform-only）不做** —— 机制指标已归零、典型视口裁剪 ↓≥85%、门禁无劣化，收益面不存在而视觉回归风险仍在 |
| **P6 搜索面板检索 memo**（收口轮追加） | `SearchPanel` 的 `results` 改 `useMemo([query, search])`（原先渲染体内直算全树 walk：父组件每帧重渲、甚至 ↑/↓ 的 `setActive` 都重跑）；注入方 `SidePanels` 的 search 闭包 `useCallback` 稳定 | jsdom 判别 ×2：同 props 重渲染 / setActive 的 walk 次数 **+1 → 0**；改 query / 换 search 引用才重算。**OutlinePanel 递归整树渲染只记录**（计划明令不虚拟化，另立批次） |
| **P8 NodeG 生产 memo 守卫**（复核追加·必做） | 新增 `tests/nodeg-memo-guard.test.ts`（无 vi.mock，直断言生产导出 `$$typeof === react.memo`） | 复核阴性对照发现缺口：pan-memo 用例的 mock 自带 memo，摘掉生产 memo 后**仍全绿**；本守卫阴性对照「删 memo 必红」（`expected 'function' to be 'object'`）→ 恢复复绿 |
| **P9 导出 deps 防御修补**（lint 告警升级必做） | `useExportActions` 两个 `useCallback` deps 补 `boundaryLinks`（`useExhaustiveDependencies` ×2 → 0）；连带修「PNG 降级 SVG 不带 boundaryLinks」的既有不一致 | 现状不可触发（与 layout 同源同变）；hook 级判别测试 +1（同 layout 只换 boundaryLinks → exportSvg/exportPng 收到新值，修复前红） |

**验收（终稿）**：kernel 478 / react 981 / canvas 119 = **1578 全绿**；tsc ×3 / dist / depcruise（372 模块）/ lint / budget 全绿、债务未增长；既有性能门禁一条未放宽（多数优于基线）。
计划：`docs/dispatch/2026-09-12-debt-and-perf-foundation-plan.md`（批次 B 全部完成；P5 经实测不做，理由与数字见 `perf-baseline.md` §7）。

## [1.8.1] — 2026-09-12 · 债务腾挪批次 A（工程 · no-API：bigFiles 4→3 + 原生对话框清零）

**触发**：`bigFiles` 预算 4/4 零余量，同时画布壳还残留三处「IDE webview 静默吞掉原生对话框」的假死点（09-11 修的是键盘删除那处）。本批只做两件事：拆出共享层腾出预算一格；三处对话框全部替换为内联 UI / 宿主通知 / 自定义模态。

| 项 | 内容 | 说明 |
|---|---|---|
| **A-D1 EdgeEditor 拆分** | 新增 `chrome/edgeEditorShared.tsx`（纯函数 / 紧凑样式 / DirToggle·RoutingSideToggle·StyleRow）；`EdgeEditor.tsx` 显式具名 re-export，既有 import 路径零改动（808 → **531** 行） | 搬迁块 vs git HEAD 逐字节 diff 仅差 `export` 关键字（组件区 diff=0）；**`bigFiles 4 → 3`**，为后续性能批次腾出余量 |
| **A-D2 PNG 导出降级提示去 `alert`** | `useExportActions` 增 `onNotice?` 注入（缺省静默降级）；`MindmapStage` 接 `setCommandNotice` 走命令告警条 | 新增 `useExportActions.test.tsx` ×3（`alert` 换抛错 spy，实现回退即红） |
| **A-D3 文件工作台删除/命名去 `confirm`/`prompt`** | 删除改内联确认条（`data-fm-confirm`：删除/取消）；新建文件夹改内联命名（`data-fm-name`，Enter 提交 / Esc 取消）；树行递归渲染抽 `FileManagerTree.tsx`（ctx 透传，`data-*` 不变；598 → **549** 行） | 新增 `file-manager-dialogs.test.tsx` ×7；`file-manager-tree.test.tsx` 3 例旧契约（confirm/prompt mock）同步迁移 |
| **A-D4 未保存切换确认去 `confirm`** | 新增 `UnsavedPrompt.tsx`（玻璃模态：放弃修改并切换 / 取消；Enter/Esc 与 LenBubble 同语义）；`useDocumentActions` 增 `confirmDiscard?` 注入（缺省保守 false，绝不静默丢数据）；`MindmapStage` 组装 asker | 白名单**清空**；`useDocumentActions.test.tsx` 24 例（applyDoc 契约 4 + 模态 5） |

**验收**：`no-native-dialogs.test.ts` 空集 + 两条自检保留（画布壳零裸 `confirm/prompt/alert`）；kernel 465 / react 966 / canvas **118** 全绿；tsc ×3 / depcruise / lint / budget 全绿。计划：`docs/dispatch/2026-09-12-debt-and-perf-foundation-plan.md`（批次 B 性能地基待做）。

## [1.8.0] — 2026-09-11 · 环形快捷操作 Phase 1：纯逻辑 + 静态预览（react minor）

**触发**：右键菜单逐项选择太重，设计「选中节点 → 按住 Alt → 节点右上角浮现四分之三圆环」的一级快捷操作；本批只做纯逻辑模块与静态预览页（未接画布）。

| 项 | 内容 | 说明 |
|---|---|---|
| **`edit/radialActions.ts`（纯逻辑）** | 零依赖零 DOM：四向槽位几何 / 命中（半开边界、死区、外缘宽容、**朝节点角（135°）缺口**取消带）/ `visibleArcs` 渲染弧 / 方向键直映射 / `radialReduce` 时序状态机（效果流 open·commit·close·pre-dir）/ V1 一等动作表（新建·编辑·删除·更多，16px stroke 图标路径） | 设计理念：pie menu（Callahan：≤8 项更快）+ marking menu（按住看单、快击盲执行）+ Fitts（环贴节点角、大目标）。`RADIAL_HOLD_MS=250`；缺口朝**所依附的节点角**（环挂节点盒右上角、节点在锚点左下 → 135°），既是依附开口也是取消带 |
| **Alt 冲突裁决（双通道）** | Alt+方向键已属「预方向」——状态机以**相位**承载两种熟练度：阈值内快击 → `pre-dir`（环不浮现、交还既有语义）；按住 ≥250ms → 环浮现，方向键直映射漫游 | 同一按键不抢键位：慢按=菜单、快击=手势 |
| **静态预览页** | `apps/canvas/radial.html` + `src/radialPreview.tsx`（+ 拆分件 `radialRing.tsx` 渲染组件 / `radialPreviewCss.ts` 样式）：可拖节点卡、Alt/Shift 按住出环（另备「模拟触发」按钮——webview 可能吞裸 Alt）、悬停/方向键高亮、点击/Enter 提交、Esc 取消、滑杆调按住阈值/缺口宽度/外环半径、按键诊断与效果日志；圆角段式弧 + 辉光高亮 + 入场动效 + 毛玻璃控制台；vite 多页入口（产物 `dist/radial.html`） | 全部逻辑经 `@mindcanvas/react` 源码别名消费（HMR 直连）；Phase 2 接画布时替换的就是这层接线。**修复**：首版 SVG 缺 width/height（替换元素内在尺寸 300×150），圆环被裁在视口外不可见 |
| **预览页六项手感升级** | ① **蓄力进度弧**（arming 期间 rAF 逐帧 0→阈值，快击/慢按窗口可见）② 高亮**过渡动画**（stroke/辉光 120ms）③ **悬停防抖**（呼吸缝/缺口处延迟 60ms 才熄灭，快速划过不抖）④ **禁用态**（「模拟根节点」开关 → 删除扇区灰显不可选）+ **危险动作二次确认**（1.6s 气泡：Enter/点击确认、Esc/超时取消）⑤ **幽灵预览**（高亮「新建」出线方向虚线幽灵节点；高亮「删除」卡片变红半透明）⑥ **死区提示**（指针停环心显示「松开取消」） | 全部在预览层实现（状态机零改动）；渲染件抽为纯展示组件 `RadialRing`/`ChargeArc`——Phase 2 可平移到 packages/react；预览页 472 行回到预算内 |

**验收**：几何/弧/映射/状态机断言全绿（node 等价运行 + `radial-actions.test.ts` 固化）；`vite build` 产出 `dist/radial.html`；dev server 三端点 200（预览页转译 56KB、import 解析到 react 源码）；lint / 预算 / 类型检查全绿。

| **Phase 2：接入主画布** | `hooks/useRadialStage.tsx`：键盘状态机（宿主 onKey 首位 `handleKey`）+ 窗口级指针接线（悬停防抖/死区/capture 吞点击防连带改选中）+ 环内二次确认；`RadialStageOverlay` 覆盖层；动作**复用既有命令路径**（addChild 与 Tab 生长同路径、editText、removeNode 走环内确认、more 打开既有右键菜单）；预方向共谋：快击 → `setPreDir` 写既有 `preDirsRef`；`MapViewApi.nodeCorner(id)` 新增（节点盒右上角客户端坐标 = toWorld 逆变换）；渲染件上收 react 包 `chrome/radialSurface.tsx`（RadialRing/ChargeArc/RadialStyles——预览页与画布**单一实现**） | marking 双通道落地：快击 Alt+方向键=预方向（专家肌肉记忆零破坏）、按住 ≥250ms=环；环开的点击在 capture 阶段吞掉、不改变画布选中；类型双包绿 / lint 零新增（59 条=改动前基线）/ 预算持平 / 构建产出 `dist/radial.html` |

| **Phase 2 深审收口（接线层五修）** | ① **删除确认捕获 nodeId**：`confirm` 升起时记录发起节点，`settleConfirm` 不再读实时选中——修「气泡期内换选中 + 新 Alt 会话 → Enter 删错节点」（可误删级别）；② **键盘意图分流**：`ring` 为模态（其余键全部吞掉，防「环外快捷键 + 环内提交」双触发，如悬停『新建』时按 Tab 会追加两子节点；纯修饰键静默吞、环保持），`arming` 期其余键**撤会话放行**（防「Tab 生长后环弹在旧锚点」），`pre-dir` 手势通道照旧放行（Tab 正常消费预方向）；③ **指针守卫**：确认气泡期点别处即收起（气泡自身 `data-radial-ignore` 除外）、环开右击**撤环让路**（右键菜单照常打开）、蓄力期点击撤会话；④ **滚轮撤环**（视口缩放/平移 → 环锚点立即失准）；⑤ 窗口失焦同时收起气泡 | 深审结论：纯逻辑层（`radialActions`）无恙、**接线层**五处缺口。新增 `apps/canvas/tests/radial-stage.test.tsx`（14 例：双通道 / 意图分流 / 指针守卫 / 确认生命周期，jsdom + 假定时器补 rAF）；对「换选中删错节点」做**阴性对照**（摘掉修复该用例精确变红）；canvas 70 例 + react 926 例全绿；tsc / lint / 预算全绿。有意取舍：环开时键盘为模态（Ctrl+Z 等先 Esc/松键退出），滚轮/点击即撤会话（视口或意图已变）

| **P1 体验打磨三件（用户实测后）** | ① **环锚点视口钳制**：Alt 按下时锚点收进视口安全边距（外环 52 + 余量 40 = 92px）——贴右/上边缘不再出屏，中央节点零位移；② **帮助面板补条目**：`EDITOR_KEY_BINDINGS` 增「按住 Alt（≥250ms）→ 环形快捷操作」行（`?` 面板可见，补齐此前只有预方向行的缺口）；③ **撤销白名单**：环开时 Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y **先撤环、按键照常落画布**（不再被模态吞掉），其余组合键仍吞 | 五项新行为用户实测通过后的打磨批；radial-stage 测试 73 例（+3：越界钳制 / 中央不动 / Ctrl+Z 让路且 Ctrl+C 仍吞）；手感参数（按住阈值/缺口/外环半径）待用户滑杆反馈后固化 |

| **Phase 3 ① 幽灵预览（画布版）** | `MapViewApi` 补 `nodeBox`（客户端矩形 + 缩放 k）/ `subtreeBoxes`（可见子树全部盒）；纯函数 `ghostBoxOf`（四向落点 = 水平 `H_GAP` / 垂直 `V_GAP` × k + 视口内收，决策 A1）；`RadialStageOverlay` 增 `ghost` / `dangerBoxes` 可选层（z 59，环 60 之下）；`MindmapStage` 按环高亮**同源派生**（方向推断与 addChild 命令一致） | 高亮「新建子节点」显示生长方向虚线幽灵节点、高亮「删除节点」红虚描边可见子树；缺省零渲染。测试：react +2（nodeBox/subtreeBoxes 客户端坐标与子树遍历）/ canvas +6（ghostBoxOf ×5、覆盖层渲染 ×1）；套件 canvas 79 / react 928 / kernel 456 全绿；tsc ×3 / lint / 预算全绿。设计与计划：`docs/specs/2026-09-11-radial-phase3-design.md` + `docs/dispatch/2026-09-11-radial-ghost-preview-plan.md` |

| **右键菜单梳理（② 二级环前置）** | ① **P0 分区 + 快捷键提示**：「常用」（新建/同级/编辑/删除——与环一级对齐置顶）/ 内容 / 结构 / 生长与连线 / 岛与区域；`ContextMenuItem` 增 `section`/`hint`，`ContextMenu` 渲染分区标题与行内 kbd 提示（Tab·Enter·F2·Del·Space·Shift+Tab…）；② **P2 副标题消歧**：编辑描述（盒内）/ 编辑笔记（盒下）/ 升为中心（钉住坐标）/ 生长方向（子树往哪边长）；③ **删除改直删**（裁决 M2）：原生 `confirm` 退役，撤销（Ctrl+Z）兜底；④ **自定义长度改数值气泡**（裁决 M3）：原生 `prompt` 退役，`chrome` 级 `LenBubble`（Enter 提交·下限 14·Esc/点外取消）+ `lenEdit.ts` 与菜单预设共用单一写入 | 盘点文档 `docs/specs/2026-09-11-context-menu-audit.md`（28 项全量清单 + 三问题证据 + 清理提案）；测试：react +4（分区/提示/直删/自定义回调）、canvas +3（气泡）；react 932 / canvas 82 全绿；tsc / lint / 预算全绿。② 子环四席（B2）与布局形态待拍板 |

| **② 二级环原型：独立沙盒页 `/subring.html`** | 形态拍板前的可视化（设计文档 B1/B2）：`src/radialPreviewSubRing.tsx`（组件）+ `src/subringPreview.tsx`（页面）+ 多页入口 `subring.html`。触发链路与正片同语义——**点击=仅选中**（不出环）；按住 Alt/Shift ≥250ms = 出一级环（快击未达阈值=取消，锚点脉冲蓄力反馈）；停「更多」450ms / 点它 / 高亮时 Enter = 二级展开；松开 Alt = 提交高亮席位并收起；**一级四向可切换**（↑新建 ↓删除 →编辑 ←更多，浮标带键位与图标；除「更多」外为桩：只回日志——正片已接）；二级 N 席（4/5/6 滑块）沿可用弧（360°−缺口）均分、数据序=角度序、角度命中 + ←→ 轮转 + Enter 提交、环心=返回一级；「锁定展开」沙盒辅助（静态审形态） | 环心 = 节点**实测**右上角（`getBoundingClientRect`；修首版「按 158px 假定卡宽算锚点 → 环心右偏 64px」）；**取消「二级→一级退回键」**（Alt 仍按着 + 指针停在「更多」上会 450ms 自动回二级，退回键等于白给；回一级改用环心或松开重进）；独立成页原因：与 `/radial.html` 同页会抢键盘（曾试过「指针区域决定键盘归属」路由，拆页后整套撤销）；tsc / lint / 预算全绿，`/subring.html` 200 |
| **环内取消键补 Backspace 别名（Windows Alt+Esc 让路）** | 用户实测发现设计层缺陷：**Windows 把 Alt+Esc 当系统快捷键（切换窗口）**——浏览器收不到 Esc，而窗口失焦又触发 blur 撤环，于是「按住 Alt 出环后按 Esc 取消」在 Windows 上实际不可用。补 `Backspace` 别名（Alt+Backspace 无系统占用）三处：① 环内取消（arming/pre-dir/ring）② 二次确认气泡取消 ③ 顺带修掉一处旧行为——蓄力期按 Backspace 原会「撤会话 + 按键落画布（`keys.ts`：Backspace=删除节点）」，现在只撤会话且按键被消费，**防 Alt 蓄力窗口内误删**。Esc 保留为别名（macOS / 未按 Alt 时仍有效） | `apps/canvas/tests/radial-stage.test.tsx` +3（环内 Backspace 取消且拦默认 / 蓄力期 Backspace 被消费不误删 / 确认气泡 Backspace 取消不删）；对「环内取消」做**阴性对照**（摘掉别名 → 两条用例精确在断言处变红，恢复复绿）；canvas 85 例全绿；tsc / lint / 预算全绿 |

| **键盘删除假死修复（原生对话框退役收尾）** | 用户重启后实测：Del 删节点「不弹气泡也删不掉」。根因：`MindmapStage` 的键盘删除路径**仍在用原生 `confirm()`**——IDE 内嵌 webview 会**静默吞掉**原生对话框（不是「弹窗被拒」，而是不弹、且恒返回 false → 走进了 `if (confirm(...))` 的 else 侧，静默什么都不做）；右键菜单那批按裁决 M2 改直删时漏了这条路径。改为**直删**（撤销 Ctrl+Z 兜底；根节点由 `controller.removeNode` 守卫返回 false）。新增 `apps/canvas/tests/no-native-dialogs.test.ts`：扫描 `apps/canvas/src` **禁止裸 `confirm/prompt/alert`**（存量三处白名单：`useDocumentActions` 未保存切换 / `useExportActions` 导出降级 alert / `FileManager` 文件删除与命名——各有替代计划，修一处删一处；另带「白名单不腐烂」自检） | 这类修复无法用行为测试钉住（webview 的「静默吞掉」语义在 jsdom 里复现不出来），故以**源码不变量测试**代网；canvas 87 例全绿；tsc / lint / 预算全绿。**二轮补网（用户复测仍报「没修复」后）**：新增 `tests/delete-key.test.tsx` —— **端到端**（真点中一个非根节点 → 按 Del → 断言节点消失；jsdom 的 `confirm` 恒 false，等价复现 webview 语义），并做**阴性对照**（改回 `confirm()` 写法该用例精确变红）；新增 `tests/subring-prototype.test.tsx`（`/subring.html` 触发链 jsdom 端到端：点选不出环 → Alt 250ms 出一级 → 悬停「更多」450ms 出二级 → 松键收起）；原型页补**「输入诊断」行**（最近按键 / Alt·Shift 是否到达页面）——把「按了没反应」区分为「旧缓存 / 宿主吞键 / 未获焦点」三种原因；canvas 90 例全绿 |

| **环内删除气泡不显示修复（真浏览器实测抓出）** | 用户报「删除节点**不弹气泡**也没法直接删除」的二轮深挖：键盘删除已是直删（见上行 ✓），但**环内「删除」路径**确有真 bug——`RadialStageOverlay` 的气泡渲染条件是 `confirm && anchor`，而 `anchor = state.origin`；**松键提交后 `radialReduce` 把状态归位 `RADIAL_IDLE`（`origin: null`）→ 气泡永不渲染**（`confirm` 其实已置位、盲按 Enter 也能删，但界面零提示 → 用户视角「不弹气泡也删不掉」，随后任意点击又把它取消）。修法：**锚点与 nodeId 一起在升起气泡时捕获**（`confirm.cx/cy`），渲染层不再依赖 `state.origin` | 为什么此前没抓到：既有 14 例只测 hook 状态（`confirm.itemId`），**无渲染层断言**；本次补 `RadialStageOverlay` 集成测试（hook+覆盖层同渲染：Alt → ↓ → 松键 → 断言 `.confirm-chip` 存在 → Enter 后 `removeNode` 收到调用）；**阴性对照**：条件改回 `confirm && anchor` → 该用例以「气泡未渲染：锚点丢失」精确变红。**真浏览器（Playwright/Chromium）三查全过**：① Del 直删 25→24 且 `confirm` 零调用 ② 环内删除气泡显示 + Enter 后 25→24 ③ `/subring.html` 触发链 level1+level2 均出现；新增可复跑脚本 `tools/verify-delete-subring.mjs`；canvas 91 例全绿；tsc / lint / 预算全绿 |

| **② 二级环：并入原预览页 + 引擎化（沙盒 v1.8.2）** | 用户定调「回原预览窗口继续设计」：二级环不再是独立仿制沙盒，而是**接进真引擎**并在 `/radial.html` 同场景展开——① 纯逻辑 `edit/radialActions.ts` 扩 `level / parentSlot / subIndex` + `RadialSubItem` 席位池（4/5/6 裁剪，「打开完整菜单」恒为末席）+ `subRingOf / hitSubSeat / hitInnerRing / subSeatCenterDeg`（沿可用弧均分、缺口朝节点角语义继承、数据序 = 角度序）+ reduce 分支（一级「更多」提交 = **下钻**；二级 ←→ 轮转 / Enter·点击·松 Alt 提交 / 点内圈 = **降级**回一级 / Esc 收起）；② 渲染件 `chrome/radialSurface.tsx` 增 `SubRing`（复用段式弧规范，外圈 z 58）+ `.ring-dim`（一级降透明 = 非当前级）；③ 预览页沙盒控件（开关 / 席位 4–6 / 展开延时 200–800ms；抽 `radialPreviewSubRing.tsx` 守 600 行预算）；④ 删除被取代的独立页（`/subring.html` 三件套 + vite 入口） | **零影响**：`ctx.sub` 缺省时 reduce **逐字节走原路径**（画布与既有测试不受影响，专项测试钉死）；纯逻辑 +13 例（下钻 / 零影响 / 席位裁剪 / 轮转环绕 / 外圈命中（缺口带·内圈·界外不误命中）/ 提交 / 降级）；**真浏览器三查全通**（Playwright：Del 直删 25→24、环内气泡 + Enter 删除、`/radial.html` 一级 → 悬停「更多」→ 外圈展开 + 主环降透明 + ←→ 轮转「编辑描述」）；react 套件 + canvas 套件 / tsc ×2 / lint / 预算全绿；设计文档 B1 按实测更新（Esc 不可达 → 全关 + 内圈降级）。**待拍板**：席位数 / 席位内容 / 展开延时手感 |

| **② 二级环 · 内容收敛 T1–T4（沙盒接入派生模型 + 翻页）** | 按 2026-09-12 拍板（一级 4 项不动 / 升为中心进二级 / 菜单移除 4 项 / 450ms 合适）实施前四任务：① 引擎支持**灰显席**（`RadialSubItem.disabled`：不可高亮、轮转自动跳过、点击无效——**不抽席**保角度记忆）与**外圈分页**（`RadialState.subPage` + `RadialSubItem.opensPage`：方向型动作由同一外圈换页承载，仍属二级深度；内圈 = 回上一页/降级；松键在翻页席上 = 收起，不悬空）；② 派生 `subRingPagesFor(facts)` + `submenuItemsFor(controller, id, bags)`（**单一动作源**：与右键菜单同命令 `updateNote`/`onPromote`/`onDemote`/`onCopyCid`/`onStart`；主 6 席 + 方向页；条件转灰显、文案动态「升为中心↔降格」「升级↔取消枢纽」）；③ 渲染 `SubRing` 灰显（与一级同规范）；④ 沙盒接派生：席位清单 + 「模拟：根/中心/枢纽」条件开关 + 翻页提示 | 结构治理：切出 `radialSubRing.ts`（数据/几何 132 行）与 `subRingItems.ts`（模型 153 行），`radialActions.ts` 615→513、`contextMenuItems.ts` 604→468，预算回到 4/4；`radialPreviewSubRing.tsx` 增 `SubRingLayer`（宿主 603→586）。测试：纯逻辑 +6（灰显不可高亮/轮转跳过/点击无效、进页与回页、内圈回上一页、翻页席松键不悬空）+ 席位模型 +5（6 席顺序、动态文案、条件灰显不抽席、适配器同源动作）；react **958** / canvas 89 全绿；tsc ×2 / lint / 预算绿；**真浏览器链路**：一级 → 悬停「更多」→ 外圈 → ←→ 轮转「编辑描述」→「升为中心」→ **Enter 翻页** → 「靠右生长」→ 松键收起。待办：T5 画布接线 / T6 菜单移除 4 项 / T7 帮助与文档 |

| **② 二级环 · 第 5 席动态化（修「六席有空洞」）** | 用户实测：默认态（非中心）第 5 席「复制中心编号」`disabled`，而灰显描边 alpha 仅 0.07 —— 几乎不可见 + 不可悬停 + 轮转跳过 → 观感是**席位空缺**（不是灰显）。按既定规范「条件席不抽席 + 动态文案」修：**第 5 席 = 剪贴板席动态化**——是中心且有 cid → 「复制中心编号」；否则 → 「复制节点文本」（恒可用）→ **六席恒满**。适配器：`copyActions.onCopyText` 注入优先（宿主加 toast/埋点），缺省直接 `navigator.clipboard.writeText(node.text)`。灰显席渲染同步可读化：`SubRing` 灰显 0.07 实心 → **0.13 + 虚线**（「锁着的席」而非「洞」） | 测试：席位模型 7 例（6 席顺序含 `sub:copy-text` / 第 5 席动态三态 / 灰显断言 `[T,T,T,T,F,F]` / 剪贴板注入优先 / 缺省写剪贴板 / 同源 `onCopyCid` / 适配器）；tsc ×2 / lint / 预算 / react 套件 / canvas 套件全绿；沙盒 `/radial.html` 可实测：默认态六席全亮，勾「已是中心（带编号）」→ 第 5 席变「复制中心编号」 |

| **② 二级环 · 第 7 席「新建同级节点」+ 菜单「复制节点文本」（用户拍板 2/2）** | ① 二级环主 **7 席**：第 1 席 = **新建同级节点**（非根；菜单同条件）——环内原本缺「同级」生长路径（Enter 在环内是提交键），插在**离「更多」最近**的位置（下钻后指针最先够到）；角度预算 296° ÷ 7 ≈ 42.3°/席（中半径 ≈52px 弧长，仍在舒适线内）。② 菜单**内容区**补「复制节点文本」（与环剪贴板席**同一实现**）：新增 `edit/sharedCommands.ts` 收两个共用轻命令——`copyNodeTextToClipboard(root, id)` 与 `addSiblingOf(controller, id)`（后者把菜单原有的同级生长方向推断搬过去），两条路径从此不可能漂移；`subRingItems.ts` 与菜单均改调该模块（不 import 菜单/环的运行时值 → 无循环依赖） | 测试：席位模型 9 例（7 席顺序 / 第 1 席条件与动作 / 剪贴板动态 / 灰显 `[T,T,T,T,T,F,F]`）+ 菜单 +2（复制文本写剪贴板且根节点也有 / 同级走共用命令）；tsc ×2 / lint / 预算 / react 套件 / canvas 套件全绿；`tools/verify-delete-subring.mjs` 轮转断言同步为 7 席（→ ×5 到剪贴板席） |

| **② 二级环 · T5 画布接线（二级环进正片）** | 环从沙盒进画布：① `useRadialStage` 增 **`getSubModel`**（会话开始拉取 `submenuItemsFor` 派生模型；缺省不注入 = **零影响**，逐字节走一级原路径）→ `ctx.sub` 喂状态机；`sub:*` 提交调**模型给的命令闭包**（末席「打开完整菜单」宿主播 `openMenu`）；② **「更多」停顿 450ms 下钻**（`SUB_DWELL_MS`，与沙盒/设计一致——停顿=确认意图）；③ 二级悬停命中可用席位**即时高亮**（不走一级呼吸缝的 60ms 防抖）；④ `RadialStageOverlay` 渲染外圈（灰显席=暗+虚线）+ 主环 `.ring-dim` 降透明 + 二级浮标（含 hint）；⑤ **同一闭包**：新增 `apps/canvas/src/nodeMenuBags.ts` 收「描述 / 笔记 / 中心」三袋（从 `NodeContextMenu` 纯搬运），`MindmapStage` 构建**一份**同时喂右键菜单与环——两条路径不可能漂移；`NodeContextMenu` 相应减 70 行（三个袋改注入）；⑥ `@mindcanvas/react` 公开 `CenterMenuActions / NoteMenuActions / CopyTextMenuActions` 类型（canvas 消费） | 测试：canvas +12（下钻 / **零影响** / 轮转提交调闭包 / 翻页回页 / 灰显跳过+点击无效 / 悬停即时 / 末席兜底 openMenu / Esc·Backspace 收起 / 点内圈降级 / 覆盖层 `.sub-ring`+`.ring-dim`+浮标 / 停顿下钻 / 停顿不生效）；canvas **101** / react 965 全绿；tsc ×2 / lint / 预算（bang 守住 90）全绿；**真浏览器四查**：主画布 Alt 出环 → 悬停「更多」停顿 → 外圈展开 + 主环降透明 → 轮转「新建同级节点」→ 松键提交 = **真建节点（25 → 26）**（`tools/verify-delete-subring.mjs` 新增 ④ 段） |

| **② 二级环 · T6 菜单瘦身 + 深度优化（方向型不再平铺）** | ① **阶段 1 移除 4 项**（编辑描述 / 编辑笔记 / 升级·取消出线枢纽 / 复制中心编号）——环内等价席位已进正片（T5），描述另有 Shift+Enter；② **方向/参数型收成「一行 + 子页」**：`ContextMenuItem` 增 `page`（菜单内**翻页**，与环「同一外圈换页」同语义；`onSelect` 转可选），子页首行恒为「‹ 返回」（点击 / `←` / `Backspace` 回页；Esc 仍一键关闭）；**生长方向 / 出线长度 / 升为中心** 各占 1 行，**行内显示当前值**（`生长方向：向左` / `出线长度：45` / `升为中心（钉住坐标）`），行尾 hint 指向更快通道（Alt+方向 / 拖梁 / 环：更多）；升为中心子页文案与环方向页统一（靠右生长…）；③ **菜单视口钳制**（真浏览器实测抓出）：节点贴底/右边右键时菜单顶出屏幕、下面的行点不到 → 按实测尺寸收进视口（边距 8px）+ `max-height: calc(100vh-16px)` 溢出兜底；④ 菜单签名去掉两个已不再消费的袋（`descActions` / `noteActions`——现在只喂环席位） | 菜单 **28 → 12 行**（普通节点；实体 +3、关系模式 +1）；测试：`context-menu.test.tsx` 5 → **10**（翻页 ✓ 不关闭 / 子页提交 / 返回行与 ← / 子页 Esc / 视口钳制）、`context-menu-items.test.ts` 重写（移除项、子页结构、当前值、行数预算 `toHaveLength(12)`、跨模块不变量「被移除项必须仍在环席位」）；hub 字符串容错用例自菜单**迁入**环席位模型（`radial-sub-model` 11 例）；react 965 / canvas 101 全绿；tsc ×3 / lint / 预算全绿；**真浏览器五查**：⑤ 实测首屏 15 行（该节点为实体 → 普通节点 = 12）、方向子页 4 行 + 返回行、选向后菜单关闭（`tools/verify-delete-subring.mjs` 新增 ⑤ 段） |

| **② 二级环 · T7 帮助与文档（收口）** | `ShortcutHelpPanel` 追加「**② 二级环席位**」区块：7 席清单**标签从派生模型 `subRingPagesFor` 取**（与环/菜单同一份定义——改席位不会漏改帮助面板）+ 展开条件说明（「更多」停顿 450ms / 灰显=锁着不抽席）+ 方向页说明；`keys.ts` 补 2 行（「更多 › 450ms」二级环展开、「菜单 ← / ‹ 返回」翻页）；帮助面板新增「② 二级环席位」标题与 kbd 样式常量复用 | 测试：帮助面板 +1（7 席标签与派生模型**逐字一致** + 方向页 + 剪贴板席退化态）；真浏览器 ⑥：`?` 打开 → 7 席清单 → Esc 关闭；react 套件 / canvas 套件 / tsc ×3 / lint / 预算全绿 |

**在途**：Phase 2 已落地并深审收口；P1 打磨已批（边缘钳制 / 帮助条目 / 撤销白名单）；**Phase 3 ① 幽灵预览已实现**；**右键菜单梳理完成**；**② 二级环 T1–T7 全部完成**（主 7 席 + 外圈翻页 + 灰显不抽席 + 画布接线 + 菜单瘦身/翻页 + 帮助与文档；`/radial.html` 沙盒保留作调参用）；余下 ③ 动作频率学习 / ④ 触屏长按。

## [1.7.0] — 2026-09-11 · 四向分叉碰撞消解 + 出线枢纽 / 逐向层距 + 拖共享梁（kernel/react minor）

**触发**：四向生成子树（`note.dir`）后，节点盒会互相压叠、连线从别的节点身上穿过——
D2′ 的「邻侧防叠」只在同层相邻组之间做**一次** bbox 推开、不迭代，三向以上复杂分叉
或子树内部再分叉必然残留重叠（ADR-0009 已列为已知取舍）。

| 项 | 内容 | 说明 |
|---|---|---|
| **新增 `layout/separate.ts`** | `separateTree` / `findOverlaps` / `boxesIntersect` / `overlapXOf` / `overlapYOf` + `SEPARATE_MARGIN` / `SEPARATE_MAX_ROUNDS` | 布局无关的纯几何消解：自底向上把**相交的兄弟子树整棵刚性推开**，子树内部相对布局逐像素不变 |
| **分支布局接线** | `layoutMindmapBranched` 在分组落位后调用 `separateTree`，随后重新生成连线 | 连线端点/长度自动跟随新盒坐标，不再残留穿盒旧 path；`BranchLayoutOptions.separate` 可传 `false` 关闭（仅对照测试用） |
| **森林自动排列修正** | `layoutForest` 无 pos 的岛改为对齐**真实右边界**（原 `cursorX += w` 会漏算左生长岛的左翼） | 四向生长的岛不再相互压叠；有 pos 的岛仍按用户坐标落位 |
| **新增 `layout/linkClear.ts`（连线避障）** | `NodeIndex` / `findLinkCrossings` / `pickClearGeometry` / `polylineHitsBox` / `segmentHitsRect` | **不动节点，只换连线**：在同族几何里挑一条不压节点盒的（梁线换共享梁 y 与竖干 x、贝塞尔换弓向/弓高）。默认几何干净时逐值返回默认 → 多数文档零视觉变化 |
| **子树不得回压父的出边** | `clearParentEdges`：子树朝反方向长回去（右向节点的 left 孙节点等）时整棵沿生长方向外推 | 这是「连线穿过自己子树」的根源——空间被自己的子树占住，**换任何连线画法都躲不开**；外推后父线变长（连线距离自动更新） |
| **出边走廊判定（口径修正）** | 越界判定改为 `corridorSubtreeBox`：只统计真的落进「父 → 本节点」空隙走廊的盒；落进走廊的反向分支仍整棵外推 | 原「整棵子树包围盒」口径过宽——left 组绕过祖先盒生长时仍判越界，整棵子树被无谓外推（实测根 → 议题外推 148px，未声明兄弟跟着位移、B″ 局部性被破坏）。修正后同时保住「孙节点落在父右缘 ↔ 子左缘之间 → 整棵外推」的契约 |
| **落位期避让祖先链盒** | `layoutMindmapBranched` 的 `place` 维护祖先链盒栈并并入落位避让基准 `occ`：left/up 组主动避开祖父盒 | 零重叠由落位期达成，而非事后外推——否则「left 组落进祖父盒 → clearParentEdges 整棵外推」会连带未声明兄弟位移（B″ 局部性回归） |
| **连线几何同源** | `bezierControls` / `bezierPath` / `sampleBezier` / `orgBeamPoints(Up)` 成为渲染与避障的唯一几何来源 | 避障判定的折线与真正画出来的线是同一条，不会算出「假安全带」 |
| **B″：锚定子节点的生长轴以基线落位为准** | 未声明 `dir` 且父节点也未声明的子节点，其有效方向改由「基线把它放在父的哪一侧」反推 | 修复「两兄弟被排成链式、连线穿过兄弟」：此前经典左右平衡把第 2 个子节点分到另一侧，而生长轴仍记成继承方向，消解便沿 +x 把它推回走廊。布局本身零移动，经典左右平衡保留；要强制同侧展开仍显式标 `dir` |
| **上下组水平钳制（走廊约束 + 梁线段闸门）** | 四向组**全部落位后**统一钳制：`down/up` 组水平钳制进「左右组内侧窗口」、hub 左右组纵向钳制进「上下组内侧窗口」——互读对方**最终**位置。闸门收窄到**梁线段本身**（railY ∈ 侧组 y 带 且 侧组 x 压住「子中线 ∪ 父中线」跨度，±6px） | 修复两代钳制缺陷：① 在分支内钳会读到未平移的**基线盒**（基线全在父节点下方 → 窗口倒置 [298,0]，「居中尽力」把右组瞬移 +339px）；② 高程带取整组高度（宽出几十倍），右组在父旁、down 组挂其下 14px 也判相交，居中正下的 down 组被挤偏 -287px。梁线段闸门 + 落位后执行双修：down 回正、右组回中、零重叠零穿盒 |
| **走廊排斥退役** | `clearLinkCorridors` 移出布局管线（导出保留）；「梁线被挡」由钳制闸门（落位期）与换画法 `beamVariants` 抬梁/压梁（几何期）接管，实测该场景零穿越（2026-09-11：`layout-separate.test.ts` 走廊用例 1 → 0） | 它按「折线包围盒」判走廊——共享梁的包围盒罩住梁线与父之间的整片空区，同组兄弟贴边即误判（len 抬升后链 A/B 被逐个推高 6/12px、层距参差）；四轮「排斥↔消解」博弈还会把右组当代价品挪成楼梯。两者都是用户明确反对的破坏形态，故整体退役 |
| **`note.lens`：逐方向组缺省** | `Note.lens?: { up?/down?/left?/right?: number }`——父节点四个方向组各自的共享梁层距；优先级 子 `len` > 父 `lens[dir]` > 父 `len`（仅 up/down，向后兼容）> V_GAP/H_GAP；下限钳到 `SEPARATE_MARGIN` | 四向共用一个尺度必然顾此失彼，逐方向才是规范形态；也是后续「拖共享梁」交互的落盘形态（拖哪根写哪个方向）。新模块 `layout/beamSide.ts` 承载 len/lens/beamX 家族（branching.ts 回到 600 行预算内） |
| **`note.hub`：出线枢纽（左右共享竖梁 + 出线箭头）** | `Note.hub?: boolean`——标记节点的 left/right 组从贝塞尔切换为共享竖梁 bus 线型（父中线段 → 横段 → 竖梁 → 横段 → 子中线段）；内核 `beamXVariants`（换轴镜像 `beamVariants`，避障采样滑梁位）+ `clampBeamGroupVertical`（纵向闸门钳制，镜像横向窗口）；右键菜单「升级为出线枢纽 / 取消」；react `horizontalBeamMap` + `buildLinkPath` hub 分支渲染同形正交线；**出线箭头**（左入右出、上入下出）= `hubArrowTip` 实心三角 path——MapView / sceneBuilder / exportSvg 三处同形，无需 marker defs（path 原语补 `fill`，canvas 端补 fill 分支） | 与 up/down 共享梁对称，四向枢纽形态齐了；**选择性启用**——未标记节点一根线不变（无 dir 逐像素闸门与非 hub 布局均不回归） |
| **拖共享梁（直接操纵层距）** | 新模块 `render/beamDrag.ts`（纯逻辑可测）：把手构建（hub 连线按「父+方向」分组 → 梁段范围 + 起始层距 = |梁−父出边|×2）、命中测试（±8px 带）、拖拽映射（行程轴位移 → 新层距，钳 [14, 600]）；`useMapGestures` 接入第四种手势（节点命中之后、画布平移之前）；拖拽中只更新预览叠层（梁线随指针移动 + 「出线 Npx」徽标，**节点不动**），松手经 `onBeamLensChange` → `controller.updateNote` 写 `lens[dir]`（单条 undo），布局权威重排；**层距上限 `BEAM_MAX_LEN=600`**（内核读取侧同钳）——坏窗口期拖出的巨型值在读取时自动归位，旧文档无需手动清理 | 层距调节从「菜单选值」升级为「抓住梁拖」——所见即所拖；起點取自梁位置本身（rail 是层距中点），逐子节点 `len` 覆盖不受影响（提交写组缺省，落位重排即正确） |
| **梁线候选障碍采样** | `beamVariants` 额外采样「走廊内障碍物上缘之上 / 下缘之下」的梁位 | 空隙内没有干净一层时，抬梁/压梁绕开；是否干净由节点索引复检 |
| **有效祖先盒集（封印分叉链）** | `place()` 的全局祖先栈改为按节点传递的**有效祖先盒集**：祖先盒 O 有效 ⟺ 路径 (O, 本节点] 上无分叉节点（被同样平移刚性携带时，基线相对位置才等于最终相对位置）；递归时**分叉子节点传 []**（封印上方全部祖先盒）、**锚定子节点继承 + 父盒**；`occ` = 父盒 + 保持原位的子树 + 有效祖先盒 | 修复「非枢纽节点子组被幽灵盒撑远」：岛根=培养速读技巧 时「克服阅读障碍」在经典基线（根层左右平衡）落在根**左侧**，右组目标被祖先盒顶到根右侧+64 → 间距 242px 随分叉整段带走。初审只按「节点自身是否被叉」闸门，深审发现**分叉链下的锚定子节点**仍读幽灵盒（实测 m→n 268px），封印后正确保留父盒避让（148px = 64 基础 + 84 正当越过父盒）。锚定链的祖父盒保护原样保留——B1 左叉仍精确让出 `根左缘−64` |
| **梁线细分采样（V_GAP 链正缝）** | `beamVariants` 候选表在「粗采样 + 障碍推挤」后对相邻候选（>1px）补**中点**：V_GAP(14) 链与 margin(6) 的算术（pad 8 + margin 6 = 14）会让推挤位恰好踩着邻盒的膨胀边界，粗候选全被复检淘汰时退化为「最少命中」贴边解；中点能命中盒间正缝（实测 -198 缝，两侧各留 7px） | **内核套件抓出的回归**（此前沙箱误判跑不了 vitest，本轮实测可跑）：封印生效后 up 链回到规范 V_GAP=14 间距，`layout-separate` 走廊用例（培养速读技巧 up 链 × anchored 兄弟「聚焦」）梁线候选全踩线 → 贴「聚焦」上缘恰好 6px 判穿；HEAD 之所以绿是靠幽灵把链拉长 132/节 侥幸避开。修后：走廊用例绿 / 幽灵检查 64×4 / 岛根组距 176·128 不变；**kernel 456 + canvas 70 + react 926 全绿**，tsc / lint / 预算全绿 |
| **方向指定方式澄清** | 预方向快捷键是 `Alt+方向键`（先按方向，再 Tab/Enter 生长时固化进新节点）；事后改向走右键「生长方向」 | 修正 `MindmapStage` 里残留的 `W W / S S / A A / D D` 过时注释（那是参考项目 PG 的键位，本项目实现是 Alt+方向键），并让帮助面板（`?`）文案更明确 |
| **打开/保存健壮性** | `LocalDocHost.open()` 不再吞掉非取消异常；`handleOpen` 捕获后走隐藏 `<input type=file>` 兜底 | 修复「在嵌入预览窗里点打开毫无反应」——FS Access 不可用/被权限拦截时异常被静默吞掉；在途收敛（09-11）补 3 例测试锁住三分支（成功 / 取消不弹 / 抛错兜底） |
| **空 note 往返自伤修复** | 三处同判据「空 note ≡ 无 note」：serializer 空 note（{} / 全 undefined / 空数组）不落块；parser 空块（`<!--` `-->` 间全空白）静默容忍为无笔记、不再报错；`strip`（保存前安全闸）用写端同判据（noteToLines 空 = 无 note）归一，防 `{}` 被误判「往返有损」拦保存 | 修复「清空字段的节点保存后报 **E-INVALID-NOTE-YAML · 笔记丢弃**」：`updateNote` 删光键留 `{}` → 旧写端落空块 → 重解析判非法 YAML。旧文件（含空块）重解析零诊断、下次保存自动清理；真非法笔记体（无冒号行等）仍照常报错；新测试 `empty-note-roundtrip.test.ts` 锁五例 |

**性质**：kernel 仅新增导出（ADR-0004「minor 可加不可改」），既有签名零变更。
验收：随机四向树 200 例消解后零重叠（对照组确有残留）、四向嵌套/三向共存零重叠、
森林左生长岛按 gap 精确错开、10K 级宽树耗时可控。
**在途收敛（2026-09-11）**：`pnpm gate` 全绿——typecheck 0 错误 / **1418 用例**
（kernel 451 + react 911 + canvas 56）/ depcruise 0 / budget 全项持平。
`beamDrag.ts` 的 `g.lo` 类型错误与 `geometry.ts` 的 `beamX` 收窄一并修复；
布局侧三处失败（局部性 / left·down 组 / 走廊穿越）全部收敛。

## [1.6.0] — 2026-09-11 · 出线长度 `note.len`（kernel minor 加法）

| 项 | 内容 | 说明 |
|---|---|---|
| **`note.len`：出线长度** | `Note.len?: number`——本节点与父节点连线的直线段长度（盒边到盒边），按有效方向解释（up/down 垂直、left/right 水平）；分支布局逐子节点消费，缺省/非法回落 `V_GAP`/`H_GAP`，下限钳到 `SEPARATE_MARGIN`。**up/down 组缺省归父**：父节点的 `len` 同时是其 up/down 组的缺省层距（子节点自己的 `len` 优先、孙层不受牵连） | 层次节奏的**软约束**：只调这条线的层距，不改居中/避让/消解——up/down 的转折弯（子树竖段 → 共享梁 → 父中线段）语义归父，**父上设一处、整组上下子树连同共享梁一起抬升/下移**；left/right 组不消费父级缺省（贝塞尔无共享梁，逐子节点自设）；仅分支布局消费（无 `note.dir` 的文档仍走经典布局，逐像素不变） |
| **右键菜单「出线长度」** | `GrowDirMenuActions` 追加可选 `lenOf`/`onSetLen`；菜单块在「生长方向」之后追加扁平项：预设 14/32/60/100 + 缺省（✓ 标当前值）+ 自定义…（prompt 输入，取消/非法静默放弃） | app 层经 `controller.updateNote` 写 `note.len`（undefined 删键 = 恢复缺省），undo 走 OpHistory；可选字段向后兼容——旧调用方不传即不出现该项 |

**性质**：加法字段（ADR-0004「minor 可加不可改」），既有签名零变更。

## [1.5.0] — 2026-09-10 · Section 空间分区 Phase 1（kernel/react minor）

**触发**：需要「带装饰的 Center Island」把一组相关节点框起来（调研见 `docs/2026-09-05-project-graph-调研与减法设计.md`；交付报告见 `outputs/2026-09-10-sections-phase1-delivery.md`）。

| 项 | 内容 | 说明 |
|---|---|---|
| **协议 `root.note.sections`** | `SectionSpec`（id / title / color / root `cid:` / members·collapsed 预留）+ `sectionsOf` / `upsertSection` / `removeSection` / `makeSectionId` | 文档级对象列表；子树锚定，写入一律 `cid:`（读取兼容 `node:` 路径） |
| **锚三态** | `resolveSections`：well-formed / dangling / stale + `W-SECTION-DANGLING` | dangling **保留元数据** + 幽灵态（灰虚线 chip + 显式 ✕ 清理），绝不静默删除 |
| **渲染层** | `sectionFrames` 纯几何（成员盒 AABB 外扩）+ `SectionLayer` 背景框（标题栏 / 成员徽标 / 折叠钮） | 背景层永在连线与节点之下；Canvas 模式自动降级不渲染 |
| **交互闭环** | 三态菜单（取消 / 标记 / 设为 Section）+ 标题栏拖拽整岛（复用 center 管线）+ 折叠钮（会话态不落盘）+ 选中态退出三件套（Esc / 空白 / 再点同框） | 单条 undo；不变量：Phase 1 的 Section **必然是**升格 center（D1 裁决） |
| **同批（未单独标号，09-10）** | 图引擎只读适配器 `graphJsonToMindmap`（入度 0 → 多中心；跨分支边 → 文档级自由边）；canvas 文件树模型与文件工作台（工作区 / 虚拟库双模式）；`DirectoryWorkspaceHost` 目录授权与保存句柄；节点图标 / 染色 / 落点感知；债务清偿与定向测试补全 | 按完成时间归入本段 |

## [1.4.0] — 2026-09-04 · 注释双区域 + 布局岛 / cid 持久身份 / `note.dir`（kernel/react minor）

**触发**：幕布式注释需要「序列」与「纯文本」两个区域；随后完成三项结构性增量（布局岛、cid、方向分叉）。

| 项 | 内容 | 说明 |
|---|---|---|
| **协议 `Note.note` / `Note.note_text`** | 序列区域（条目列表，浮窗内编号渲染）/ 纯文本区域（整段多行，段落渲染） | 取代旧 `qa` 的展开形态；读取兼容 `qa`（`noteOf` 回退） |
| **浮窗 `NotePopover`** | 同一浮窗两个区域；非受控 textarea（可点入编辑）；标题收口为「note 笔记」 | 附路径定位与「入口可发现性」修复 |
| **同批（未单独标号，09-05~09-06）** | 布局岛 A1–A6（升格 / 切断接回 / 边界补线导出）；cid 子树持久身份（`note.cid` + `next_cid` 单调计数器 + `cid:` 锚 + 迁移双轨）；`note.dir` 方向分叉接线（ADR-0009 第一步）；`IdbAssetHost`（IndexedDB 持久资产宿主）；C3 复制中心编号 + D3′ 生长方向菜单 | 按完成时间归入本段 |

## [1.3.1] — 2026-09-02 · 序列化分段保真（patch · 非破坏性）

**触发**：纯文本事实源的体验缺陷——手写 `.mm.md` 经应用保存后**所有空行被抹掉**，
整篇挤成一坨，首次导入产生全量 diff，削弱「可读 / 可 diff / 外部编辑器友好」的价值。

| 项 | 修复 | 说明 |
|---|---|---|
| **序列化保留分支分段** | `emitNode` 在非首个 heading 前输出一个空行 | 实测 `gateway.mm.md`：空行 62 → 12（分段保留，非原样逐行保留）；往返仍无损且幂等 |
| **空行位置在笔记块之前** | 笔记块归属其**后**的节点（解析规则）；若插在笔记之后会拆开「笔记 ↔ 所属节点」 | 约束已写入代码注释 |

**性质**：纯格式改进，**数据语义完全等价**（`parse → serialize → parse` 结构无损、幂等）。
影响面：canonical 输出文本变化 → 依赖精确字符串比对的测试需同步。
已更新 `serializer-roundtrip.test.ts` 的 canonical 用例并补幂等守卫。

## [1.3.0] — 2026-09-01 · 幕布风格描述（note.desc）· **补记**

> 事后补录：功能已于 2026-09-01 全链路实现并在代码中标注 v1.3.0，但当时未写入 CHANGELOG。

**触发**：对齐幕布（mubu.com）的「描述」语义——对某一主题的解释说明，常驻节点下方。

| 项 | 内容 | 说明 |
|---|---|---|
| **协议层 `Note.desc`** | 新增可选字段 `desc?: string` | 纯文本，多行以 `\n` 分隔；空串视为无描述（写回时删除）。与 `qa`（快速注释，按需展开）是两套并存机制 |
| **parser / serializer** | 多行描述以 `\n` 转义往返 | serializer 侧多行标量强制双引号 + `\n` 转义，parser 侧还原为真实换行 |
| **渲染 `DescBlock`** | 节点下方引用块，默认收缩一行、点击展开全文 | 仅视口内有 `desc` 的节点参与渲染 |
| **布局参与** | 有描述的节点加高；展开全文的节点额外加高 | `demo/pipeline.ts` 计入布局 → 推开其它节点 |
| **编辑入口** | Shift+Enter 切换「主题 → 描述」编辑；右键菜单「编辑描述」 | 幕布「切换主题与描述」语义 |

**性能**：编辑性能深度优化——`measure` 只依赖 `desc` 内容、不依赖 editing 状态，
且 `descEditingId` 不入缓存语义键，进入/退出描述编辑不触发全树重排（10K 图亦不卡）。

**冻结合规**：`Note.desc` 为**可选新增字段**（ADR-0004「minor 可加不可改」），既有字段与签名零变更。

## [1.2.0] — 2026-08-31 · 边一等公民交互与编辑闭环（E2-E7/E6.1 · react 侧 minor 加法）

**触发**：E 批执行 + 蒋指导交互反馈五轮 + markvault-js 采纳批。kernel 仅 1.1.0 的协议增量的延续（本轮 kernel 0 改动）。

| 项 | 内容 | 说明 |
|---|---|---|
| **MapView 加法 props** | `selectedEdgeKey / onEdgeClick / onTreeEdgeEdit / onEdgeConnect / onNodeClick(mods)` | 自由边叠加层（collectFreeEdges/FreeEdgeLayer）、连接手柄拖拽、树边右键编辑 |
| **文档级边标注** | root note.edges 透传键（DocEdge：from/to 锚 + rel/dir/label/note/style/invalidAt/source） | 边=画布级标注对象非节点属性；锚存路径跨会话稳定；updateNote 写入 undo 继承 |
| **树自然线关系标注** | 子节点 note.edge 对象（TreeEdgeAnn）+ note.via 字符串兼容 | 仅右键触发；chip 显示 label→rel→via 兜底；协议层对象标量（1.1.0 延续） |
| **RelationSchema** | 关系类型注册表（14 主动×5 分组+12 被动反向+构造三查+reverseOf） | relVisualOf 接 schema 语义色 |
| **软失效/来源** | DocEdge.invalidAt（失效/恢复二段）+ source（manual/inferred/imported） | B 线 AI 提议边识别前置 |

**性能**：树边 cubicMid 正则热路径消除、自由边视口裁剪、低 LOD 交互层门控、mapview 测试轮询化。

## [1.1.0] — 2026-08-31 · 边一等公民 schema（E1 · minor 加法扩展）

**触发**：E 批「边一等公民」规划（`docs/roadmap/2026-08-31-edge-first-relations.md`）——关系在连线上：连线需要属性/笔记/方向，支持树形之外的自主连线。

| 项 | 内容 | 说明 |
|---|---|---|
| **ResolvedLink 加法字段** | `dir?: LinkDir` / `label?` / `note?` / `attrs?` / `warnings?` | 全部可选，既有签名零变更；`dir: fwd(默认)/back/both` 仅是渲染端箭头语义（links 永远声明在源节点，无镜像写入） |
| **resolveLinks 透传** | 新字段逐条透传；非法 dir 回落 `fwd` + `warnings: ['invalid-dir-defaulted-fwd']`（W 级，不影响锚定三态） | |
| **协议层扁平对象列表** | parser/serializer 支持 note 块 YAML 的对象列表项（`- rel: blocks` + 缩进续行字段）——修复 spec §5.5 `links` 在文本协议无法表达的缺口（此前对象列表直接 E-INVALID-NOTE-YAML 丢弃整块笔记） | 对象项判别保守：未引号 + `key: value` 形态 + 存在续行字段，三者同时满足；qa/decisions 等冒号字符串列表行为不变。`attrs` 支持内联 JSON；嵌套对象/数组序列化为内联 JSON 字符串 |
| **yamlScalar 收紧** | 形如 `key:value` 的标量写端强制加引号 | 防字符串项与对象项在重新解析时歧义 |

**冻结合规**：仅增可选字段与新类型 `LinkDir`（ADR-0004「minor 可加不可改」）；既有 golden（T01-T30）与透传铁律测试全绿。

## [1.0.1] — 2026-08-29 · 资产节点渲染修复（patch · 非破坏性）

**触发**：资产节点（`@img` / `@draw`）显示异常（审查记录见 `docs/review/2026-08-29-asset-render-review.md`）。

| 项 | 修复 | 说明 |
|---|---|---|
| **P0 布局未给资产预留空间** | 内核 `displayMetrics` 对 `img`/`draw` kind 追加可选 `assetH`（96px），高度公式纳入资产区；`NodeG` 改为卡片式布局——图片占顶部独立区、文本区下移 | 修复前图片被压进约 26px 高的条带并与文字重叠（布局层与渲染层对节点高度认知不一致） |
| **P0 glass 连线对比度不足** | `linkStroke` `#3a3f4d` → `#646b7d` | 旧值对底色 `#16181d` 仅 2.3:1，低于 WCAG 非文本 3:1 |
| **P1 展开态注释区几何** | 注释区由全圆角 `rect` 改为 `path`（上半直角连体、下半圆角），去掉冗余分隔线 | 修复前连体处有圆角缺口，且顶边 stroke 与分隔线三线叠加成粗横线 |
| **P2 资产加载失败** | `<image>` 加 `onError` 降级 | 加载失败时隐藏图片区，纯文本呈现 |

**冻结合规**：`DisplayMetrics` 新增 `assetH?: number` 为**可选字段**（ADR-0004「minor 可加不可改」）；高度变化仅作用于 `img`/`draw` kind 节点，既有节点行为不变（有回归测试锁定 `issue.assetH === 0`）。属 bug fix 而非破坏性变更，故按 patch 发布。

## [1.0.0] — 2026-08-28 · 接口冻结（K5）

**里程碑**：三面镜子（Forgejo 联动 / MindFlow 标注 / PomodoroXI 任务项）压力测试六注册表与实体三件套全部通过；K5 期间按缺口修订的接口（resolveAll、note-anchor）已合入并记录于 ADR-0004 附录；自此公开签名变更视为 major。

### 冻结的公开接口面

**@mindcanvas/kernel（headless，零 DOM）**

- 协议层：`parseMm` / `serializeMm` / `astToEditable` / `editableToAst` / `validateId` / `stripOrgPrefix` / `refKey` / `unresolvedEntity` / `isUnresolved` / `REGISTERED_KINDS` / `KIND_META` / `KIND_FALLBACK_COLOR`；类型 `EntityRef` / `Entity` / `Note` / `MindNode` / `UnresolvedReason` / `Diagnostic` / `ParseResult`
- Entity 三件套：`EntityRef` / `Entity` / `Resolver`（`resolve`）+ 批量原语 `resolveAll`（K5 新增，部分失败语义）
- 六注册表：`KindRegistry` / `NoteKeyRegistry` / `RendererRegistry` / `LayoutRegistry` / `SemanticsRegistry` / `ChannelRegistry` + `Registry` 底座（`register/get/has/list` + `UnregisterHandle`）+ `createKernelRegistries` + `registerBuiltinKinds`
- links/groups 锚定契约（K5 新增）：`parseLinkAnchor` / `resolveLinkAnchor` / `resolveLinks` / `resolveGroups` + 类型 `AnchorResolutionState` / `LinkAnchor` / `ResolvedLink` / `ResolvedGroup`
- 插件基类与生命周期：`Plugin` / `PluginHost`（自注销）
- 编辑树与 TreeOp：`applyOp` / `invertOp` / `OpHistory` / `TreeOp` 判别联合（add-child / remove-node / move-node / update-node）+ `pathOf` / `nodeByPath` / `searchNodes` 等 treeOps 助手
- 布局引擎：`layoutMindmap` 等布局算法 + `MeasureFn` / `CharMeasure` 抽象 + 视口裁剪 `isBoxInView` / `filterVisibleLinks`

**@mindcanvas/react（渲染器）**

- 主题令牌系统：`ThemeProvider` / `useTheme` / `TokenSet`（classic / sticker / glass 三主题）
- 渲染核心：`MapView`（公开 props：layout/entities/char/apiRef/onStats/onNodeClick/onNodeContext/selectedId/editingId/collapsedIds/expandedId 等 + api：fit/zoomBy/resetZoom/focusNode）
- chrome 组件：`GlassCard` / `FlipCard` / `ThemeSwitcher` / `QaEditor` / `GrowthCommentPanel` / `ShortcutHelpPanel` / `ContextMenu` / `SearchPanel` / `OutlinePanel` / `formatNote`
- 编辑控制器：`EditorController` / `useEditor` / `matchEditorKey` / `EDITOR_KEY_BINDINGS`
- demo 数据管线：`buildEditable` / `buildEntities` / `layoutDemo` / `createCharMeasure`
- 搜索：`searchMind`（标题/笔记字段富文本匹配）

**apps/canvas（应用组合入口）**：v1.0.0 对齐；组合 = kernel + react 渲染器 + 内置 demo 插件。

### 测试基线（冻结门槛）

- kernel：266 测试（协议 225 基线 + 三面镜子 harness 25 + resolveAll 5 + note-anchor 11）
- react：126 测试
- kernel 依赖图零 react / 零 DOM（`pnpm why react --filter @mindcanvas/kernel` 无匹配）

### K5 接口修订（冻结前最后窗口，记录于 ADR-0004 附录）

- 新增 `resolveAll`（批量解析，镜子一对账场景缺口）
- 新增 note-anchor 模块（links/groups 锚定三态判定，镜子一/二缺口）
