# 摘要节点(XMind 式概要)实施计划

- **日期**:2026-09-20
- **起点 HEAD**:开工前实测填入(勿沿用写稿时状态)
- **出处**:设计稿 `docs/2026-09-20-摘要节点-设计与实施规划.md`(2026-09-20,**D1–D6 已锁定 = 采纳全部推荐**);XMind 行为证据 `outputs/summary-xmind/`
- **批次代号**:S1 … S5

## §0 基线(开工前实测并报告;数字不符先报告再动手)

| 项 | 参考值(2026-09-19 收口报;以开工实测为准) |
|---|---|
| 三包测试 | kernel **622** / react **1502** / canvas **353** |
| 门禁 | tsc ×3 = 0;react dist 重建 = 0;depcruise **530 模块 / 1574 deps / 0 违规**;lint **1541 warn + 48 info**(**不得上升**) |
| 预算 | any **0**、bang **89/90**、asCast **31/31**、bigFiles **4/4**(>600 行) |
| 参考出处 | `docs/dispatch/2026-09-19-delivery-close-finish-repair2-report.md:151`(同 `outputs/delivery-close-finish/20260919-03/gates/gate.log`) |

**行数余量(本批高相关;开工与每次提交前 `wc -l` 核对)**:

| 文件 | 现状 | 备注 |
|---|---|---|
| `kernel/layout/mindmap.ts` | **499**/600 | 只留钩子;主体逻辑放新文件 `layout/satellite.ts` |
| `kernel/layout/layouts.ts` | 414/600 | layoutLogic 钩子(数十行) |
| `kernel/layout/forest.ts` | 304/600 | 平移/链接扩展 |
| `react/edit/cutAttach.ts` | **557**/600 | 余量小;解析分支严控,超余量则外提 `edit/summaryAnchorFields.ts` |
| `kernel/layout/branching.ts` | 564/600 | **本批不动** |
| `apps/canvas/src/MindmapStage.tsx` | 2512 | 已在 bigFiles 名单,增量注意 |

**工作树注意(重要)**:写稿时工作树在分支 `codex/file-assets-foundation-20260920`,且含**大量 file-assets 批次的未提交改动**(`git status` 一屏)。**开工前必须与协调人核对基线**——不得在混用工作树上直接开工本批;建议等该批落盘/提交后,从干净基线(或约定分支)起工。CHANGELOG 号位按开工时顶部实际号顺延。

**冻结纪律**:阈值/契约测试不得放宽;禁 `git add -A`;不 push;每任务一条 commit;TDD **红→绿**(红证据贴原文);**布局/缓存类第一判据 = 逐位等价**;报告数字贴工具原样输出;**做完停下**。

**DoD**:① 每任务测试先红后绿且红证据贴原文;② 每任务一条 commit(按 §2 建议信息);③ 等价性/阴性对照证据齐全;④ 门禁与预算实测并贴原文;⑤ 完成后停下、交报告。

## §1 取证(file:line,写稿时逐条核过)

### 1.1 卫星落点:只承诺两条布局路径(其余显式降级)

- 单树:`pipeline.ts:237 → :259-268`(`useForest ? layoutForest : layoutMindmapBranched`);无显式 `note.dir` 时 `layoutMindmapBranched` **逐像素回退** `layoutMindmap`(`branching.ts:107-114`)→ **卫星实现于 `layoutMindmap` 即覆盖绝大多数文档**。
- 森林岛:`layoutForest` 每岛 `layoutMindmapBranched({ fallback: LAYOUT_BY_DIR[dir] })`(`forest.ts:50-63 / :134-144`):右/左岛回退 `layoutLogic`(`layouts.ts:264-302`)→ **第二条卫星路径 = `layoutLogic`**;down/up 岛走 `layoutOrg` → **不承诺**(S 留流内,§1.4 有防"消失"断言)。
- 有显式 `note.dir` 的"思想分叉"路径(`branching.ts` 主体,564 行)带碰撞消解(`separate`/`linkClear`)→ **不承诺**(本批不碰 branching.ts)。

### 1.2 可复用原语(不造新轮子)

- 放置:`placeSubtreeIncremental(ln, side, top, xEdge, cache)`(`mindmap.ts:355-382`)——任意 `(top, xEdge)` 即可放置整棵子树(含 stamps 增量);**卫星盒 = 传特制参数,无需新放置器**。
- 成员带:`subtreeBBox(ln)`(`layouts.ts:392-407`,已导出)——成员子树并集 = 带外沿。
- 收集:`collectCached`(`mindmap.ts:305-323`,含 P→子 links;卫星子树单独收集,天然**无 P→S 边**)、`boundsOf`(`:326-346`)。
- 骨架复用:`build`(`mindmap.ts:210-241`)/ `buildSkeletonCached`(`layouts.ts:221-255`)。

### 1.3 缓存契约(卫星必须与之共处)

- `LayoutCache` 键位:`collapsedKey`/`measureKey` **身份比较**(`mindmap.ts:177-186`);`cache.nodes` 复用判据 = `side/depth/parentId` 三项(`:216-225`);放置戳 `stamps`(`:362-363`);子树的 `collects`/`bounds` 随重放失效(`:364-365`)。
- 跳过集变化 ⇒ 从根到受影响节点的**祖先链换壳**(不可变编辑)⇒ 缓存身份自然失效——**推理成立但不许只靠推理**:S3 用"编辑序列 × 缓存开/关逐位等价"钉死。

### 1.4 森林(平移与链接是第二现场)

- `shiftIsland/shiftTree`(`forest.ts:210-256`)只遍历 `children` 并重建实例;`islandLinks`(`:269-296`)同。→ 卫星若不显式随平移处理,会**留在局部坐标**或**被丢弃**;岛内 S→其子链接需在 `islandLinks` 补一支;`placed` 缓存条目(forest.ts:181-198)须包含平移后的卫星。
- 岛级缓存条目 `local` 是**非破坏式**的(forest.ts 坑 1 注释)→ 卫星放置只许写"局部产物",平移出副本。

### 1.5 数据 / 迁移 / 事务(全部有现成模板)

- 访问器/解析模板:`protocol/section.ts` + `registry/section-anchor.ts:41-85`(三态 + 诊断;`collectSectionDiagnostics` 目前**无 UI 消费方**,摘要诊断对齐即可)。
- 迁移:字段解析写死在两处正则(`cutAttach.ts:174-207` `applyAnchorUpdateToNote`、`:298+` `readAnchorField`;field 形态 `centers[0].at` / `desc#0`)——**`summary_of.from/to` 是新形态,需登记**;采集 `collectReferenceAnchors`(`:111-170`,数组键 walk;`summary_of` 是对象值,需单列分支);幂等跳过在 `buildMigrationOps`(`:334-352`)。
- 事务:`TreeOp` 含 `add-child`(带 index)(`tree-op.ts:31-39`);`OpHistory.applyTransaction` 整批校验 + 单条 undo(`:220-258`);`ensureNodeCid(rootNote, nodeNote)`(`react/render/centers.ts:127-137`);创建 plan 模板 = `planPromoteCenter`(`centers.ts:429-462`,返回 `{ok, ops, cid}`)。

### 1.6 交互(点选完成的先例是 E7,不是 linkDraft)

- `linkDraft` 的真实机制 = **候选面板**(`EdgeDraftLayer.tsx:121-153` 渲 `LinkCreator`);草稿态置位 `MindmapStage.tsx:746`、清理 `:1421-1432`——**只借"草稿态 + 提示/清理"骨架**。
- "点画布节点完成第二跳"的先例 = **E7 Shift+点击两节点连线**(`MindmapStage.tsx:1632-1650`,`onNodeClick` 内 `mods.shift` 分支)→ 摘要 draft 照此加**首个分支**。

### 1.7 渲染 / 导出 / 诊断 / 命中

- 层挂载:`SectionLayer` 于变换 g 首部(`MapView.tsx:1910-1934`;层序契约 `:1902-1907`),数据流 `:976-1005`(由 `sectionFrames.buildSectionViews` 出视图,`:79-125` 从盒算 AABB+pad)→ `SummaryLayer` 照此:react 层从 `layout.satellites` + 成员盒**算几何**;kernel 只出标记。
- 导出:`exportSvg.ts:36-161`(顺序:背景 `:54-61` → 树线 `:79-113` → 边界虚线 `:117-135` → 节点卡 `:138-158`)→ 括线插在 `:135` 与 `:138` 之间。
- 诊断(可选接入):诊断条入口 `MindmapStage.tsx:2119-2148`(`data-diagnostics`)。
- 命中/选择:平面表(`MapView.tsx:1168-1200`)+ `controller.select(id)`;搜索走 **raw 树**(`search.ts`)→ 卫星在 raw 树内,天然可搜可导航。**卫星只从"布局树"摘除,事实源/编辑树不动**——这条是全部涟漪的边界。

### 1.8 常量口径(先定死,防两侧漂移)

- `SUMMARY_BRACKET_GAP`(带外沿→括线)、`SUMMARY_STEM_GAP`(括线→S 左缘):**定义在 kernel `layout/satellite.ts` 并导出**,react 复用。
- 公式(右向;左向镜像):`bracketX = band.maxX + BRACKET_GAP`;`S.left = bracketX + STEM_GAP`;`topS = bandCenterY − subtreeHeightCached(lnS) / 2`;`xEdgeS = S.left − H_GAP`(再交 `placeSubtreeIncremental`)。

## §2 任务

### S1 · 数据层:summary_of 访问器 / 三态解析 / 诊断 / 迁移登记

**改动点**
- 新 `kernel/src/protocol/summary.ts`:`summaryOf(note)`(严格收窄:两字段皆非空字符串;未知值透传不丢);`upsertSummaryOf / removeSummaryOf`(不可变)。
- 新 `kernel/src/registry/summary-anchor.ts`:`resolveSummaries(root)`(cid 索引一次预建;锚三态 + **同父 + 顺序 + S 不在范围内**校验;输出 `{summaryNodeId, state, memberIds?, reason?}`);`collectSummaryDiagnostics` + `W_SUMMARY_DANGLING`。
- `kernel/src/index.ts` 导出两模块。
- `react/src/edit/cutAttach.ts`:① `collectReferenceAnchors` 增 `summary_of.from/to` 分支(field 形态 `summary_of.from`);② `applyAnchorUpdateToNote` / `readAnchorField` 增该形态解析(行数余量小,严控)。

**判别测试(先红)**
- `kernel/tests/summary-roundtrip.test.ts`:嵌套 mapping + 内联 JSON 两形态往返;坏形态透传;canonical 快照。
- `kernel/tests/summary-anchor.test.ts`:三态矩阵(from 删 / 移出同父 / 倒序 / 坏值 / S 不同父 / 单成员 `from==to` 合法);memberIds 连续区间正确。
- `react/tests/summary-anchor-migration.test.ts`:改名成员 → 路径锚重写、cid 锚原样;cut/attach 含摘要子树批量场景(仿 `controller-anchor-migration.test.ts`)。
- **阴性对照**:移除"同父"校验 → 跨父用例必红。

**commit**:`feat(kernel): 摘要数据层(summary_of 访问器/三态解析/诊断)` + `feat(react): summary_of 锚迁移登记(采集/解析/写回)`

### S2 · 创建事务与交互(两跳式)

**改动点**
- 新 `react/src/edit/summaryCommands.ts`:
  - `planCreateSummary(root, fromId, toId)`:校验(存在 / 非根 / 同父 / 顺序);`ensureNodeCid` 两端(**缺失才补**);构造 S 节点(`newId()`、默认文本「摘要」、note `summary_of`);ops = `[update root(next_cid 变化时), update from/to(cid 补发时), add-child(parent, S, index = to.index + 1)]`。
  - `createSummary(controller, fromId, toId)`:applyTransaction;成功 `select(S)`。
- `react/src/edit/contextMenuItems.ts` + `menuActionTypes.ts`:`summaryActions?: { onStartSummary(id) }`(**加法**;缺省不渲染);菜单项「创建摘要…」入「结构」区(仅非根;与「连线到…」并列)。
- `apps/canvas/src/nodeMenuBags.ts` + `NodeContextMenu.tsx` + `MindmapStage.tsx`:装配 bag;`summaryDraft` 状态;`onNodeClick` **首分支**(先于 shift / note / 选择逻辑):点击合法末成员 → 创建;**跨父/根 → `setCommandNotice` 提示且保留 draft**;点空白 / Esc / 切文档 → 清草稿;提示文案「点选范围末成员(需同一父级;Esc 取消)」。
- (可选)`subRingItems.ts` 环席位——可延后,(缺省只做右键菜单)。

**判别测试(先红)**
- `react/tests/summary-create.test.ts`:plan 矩阵(合法 / 跨父 / 根 / 倒序;ops 形状与顺序;`index = to.index + 1`);事务级:`applyTransaction` 后 `undo` 逐位回原树(含 cid 补发场景);已存在 cid 不 bump。
- 菜单:bag 缺省不出现;提供时出现且文案正确。
- 边界:to 为末位兄弟时插到末尾。

**commit**:`feat(react): 摘要创建事务与两跳交互(planCreateSummary/菜单/草稿态)`

### S3 · 布局卫星(核心;带停止条款)

**改动点**
- 新 `kernel/src/layout/satellite.ts`:`buildSatellitePlan(root)`(`resolveSummaries` → `skipIds` + `specs[{parentId, sNode, memberIds}]`;memo 视压测);`placeSatellites(...)`(成员带 / 常量 / `build(S)` / `placeSubtreeIncremental` / 收集并入);导出常量(§1.8)。
- `kernel/src/layout/mindmap.ts` **钩子**(严格控行,~数十行):`LayoutResult` 增 `satellites?: LayoutNode[]`(加法字段);`build` 子映射过滤 skip;`subtreeHeightOf` 同过滤器;root 左右分配过滤;放置后调用 post-pass 并入 `nodes/links/bounds`。**过滤与 post-pass 必须同一 commit**。
- `kernel/src/layout/layouts.ts`:`layoutLogic` 同款钩子(骨架过滤 + post-pass)。
- `kernel/src/layout/forest.ts`:`shiftIsland` 平移 satellites(shiftTree 副本);`islandLinks` 增卫星子树链接(仅 S→其子);`placed` 缓存条目含 satellites。

**判别测试(先红,逐位等价方法论)**
1. **零变更基线**:无 `summary_of` 文档,`layoutMindmap`/`layoutLogic` 输出与现状**逐位等价**(多夹具 × 缓存开/关);**阴性对照**:故意放宽过滤 → 差异必现。
2. 卫星几何:右/左镜像;带随成员子树伸缩;S 垂直居中;`satellites` 字段与扁表一致。
3. 成员增删:中间删 → 带收缩;端点删 → 无卫星(S 回流);折叠:父折叠 → 无卫星;S 折叠 → 仅盒。
4. S 带子主题:子树链路盒与链接正确(链接**不含 P→S**、**含 S→子**)。
5. **编辑序列**:连续 N 次编辑(创建/删摘要、改成员、改 S 文本、缩进/移动成员)每步"缓存开 == 关"逐位等价。
6. 森林:岛内摘要(右岛/左岛)平移逐位等价 + 幂等(连续 3 次);岛链接补链断言。
7. 降级域:`layoutOrg` 与显式 dir 分支路径断言 S **留在流内且可见**(防"节点消失")。
8. (L2 带高整合,可选):`H_s > band` 时父级堆叠纳入 extra——**若预研 > 1 天或扰动既有等价判据 → 触发停止条款**。

**停止条款(硬)**:若卫星与 `stamps`/等价性冲突不可收敛 → **停止卫星,降级形态**:S 作为范围后常规兄弟入流、括线照画(数据/交互/语义全保留);冲突点写报告;卫星独立后续批。**不许为"做完"放宽等价性判据。**

**commit**(建议 3 条):
1. `feat(kernel): 摘要卫星(mindmap 过滤+放置;LayoutResult.satellites)`
2. `feat(kernel): 摘要卫星(layoutLogic 岛左/右)`
3. `feat(kernel): 森林卫星平移与岛链接`

### S4 · 括线渲染(SummaryLayer + 导出)

**改动点**
- 新 `react/src/render/summaryFrames.ts`:`buildSummaryViews({root, nodes, satellites})` → views(`{id, side, bracketPath, stemX1/Y1/X2/Y2, memberIds, summaryId}`);判定只用 `layout.satellites`;缺盒/降级跳过;常量自 kernel 导入。
- 新 `react/src/render/SummaryLayer.tsx`:path 绘制(线色/粗细 token);选中摘要 → 成员高亮;锚 `data-summary-bracket` / `data-summary-stem`;**挂载 MapView 变换 g**(SectionLayer 旁;数据流仿 `:976-1005`)。
- `react/src/chrome/exportSvg.ts`:括线绘制插于 `:135` / `:138` 之间。

**判别测试(先红)**
- `react/tests/summary-frames.test.ts`:几何矩阵(右/左;多摘要;成员缺盒跳过;S 无盒跳过)。
- 渲染:jsdom 断言锚点与 path 存在;三主题 × 缩放人工清单(截图存报告)。
- 导出:含摘要文档导出串包含括线 path。

**commit**:`feat(react): 摘要括线渲染(SummaryLayer/视图构建/导出插线)`

### S5 · 收尾验证与文档

**改动点**
- `tools/verify-summary.mjs`(按既有 `tools/verify-*` 惯例):创建 → 括线存在 → 成员删除 → 降级断言 → 无残留。
- 文档:AI 契约补读法(`docs/specs/2026-09-17-mm-md-ai-contract.md`);协议字段/诊断码补记(`docs/specs/2026-09-02-mm-md-protocol.md`,以"v1.12 候选 / 待版本号"措辞);`CHANGELOG.md` 顺延。
- 报告:`docs/dispatch/2026-09-20-summary-node-report.md` + 证据 `outputs/summary-node/20260920-01/`(截图 / 日志 / 数字)。
- (可选)诊断条接入(`MindmapStage.tsx:2119-2148`)。

**验收(总清单,收敛自设计稿 §5)**:roundtrip / 两跳 + 单条 undo / 左右向几何 / 成员增删与降级 / 迁移 / 布局回归 + pan-memo / 导出含括线 / lint + budget 逐数持平。

**commit**:`docs+test: 摘要节点收尾(verify 脚本 + 契约/协议补记 + CHANGELOG + 报告)`

## §3 决策点(实现级,按推荐执行)

| # | 决策点 | 推荐 |
|---|---|---|
| S-A1 | 卫星表示 | `LayoutResult.satellites?: LayoutNode[]` 加法字段;扁表含卫星(渲染/命中零改动) |
| S-A2 | 过滤落点 | 仅 `layoutMindmap` + `layoutLogic`;org / 显式 dir / 框内 **留流内降级**(显式测试防消失) |
| S-A3 | skip 集来源 | 布局内直调 `resolveSummaries`(单一事实源);memo 视压测 |
| S-A4 | 创建交互 | 自持 `summaryDraft` + `onNodeClick` 首判(E7 同族);**不用** LinkCreator 面板 |
| S-A5 | cid 策略 | 创建事务补发 from/to(缺失才补;单条 undo) |
| S-A6 | 降级呈现 | 无括线 + S 回流;诊断码产出留 parity;UI 接入可选 |
| S-A7 | 括线样式 | 方括号;线色/粗细 token;常量 kernel 导出共用 |
| S-A8 | 摘除边界 | 只从"布局树"摘除;事实源 / 编辑树不动(搜索 / 路径 / 迁移天然不受影响) |

## §4 风险

1. **卫星 × 缓存耦合**(唯一能出"静默陈旧几何"处)→ 等价性 + 编辑序列 + 阴性对照三件套 + 停止条款。
2. **forest 漏移/漏链** → 岛内摘要专测(平移 + 幂等 + 链接)。
3. **行数预算**:`mindmap.ts` 499→<600、`cutAttach.ts` 557→<600(余量小,超则外提);`branching.ts` 不动。
4. **并行批冲突**:工作树含 file-assets 未提交改动——**开工前核对基线**(§0);CHANGELOG 号位顺延。
5. **降级域行为差异**(org / 显式 dir 域无括线)属设计承诺边界——文档写明,防当 bug。
6. **L2 带高整合**超预期 → 停止条款降级并记录(设计稿已预留该出口)。

## §5 交付与报告格式

- 逐任务:commit + 改动文件 + 分包测试数(实测)+ 新增用例数 + **红证据原文**。
- S3:等价证据(逐位断言原文)+ 阴性对照原文 + 编辑序列结果 +(触发时)停止条款冲突点。
- S5:verify 输出原文 + 截图清单 + lint/budget **逐数持平**判定;然后停。

## §6 明确不做(本批)

拖拽手柄调范围 / 拖入拖出自动增删 / up·down 与 hub / 嵌套摘要(范围含另一摘要)/ 跨父 / 多选系统 / 线型样式配置 / Canvas 后端 / 框内(FO)括线 / "解除摘要但保留节点"动作 / 非连续成员集合 / 诊断条 UI 接入(可选)/ duplicate 的 cid 债务(②批次)/ sections 框对卫星的 AABB 覆盖微调。
