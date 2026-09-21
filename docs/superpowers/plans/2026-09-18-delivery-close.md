# DELIVERY-CLOSE 当前版本质量与交付收口实施计划

> For agentic workers: 使用 `superpowers:executing-plans` 逐任务执行；行为变更使用 test-driven-development，最终结论遵循 verification-before-completion。当前仅准备计划，实施由启动 prompt 发起。

**Goal:** 包 1、2 和当前视觉/度量成果通过真实门禁与产品旅程验收，形成可审查、可提交的版本候选。

**Architecture:** 保留现有四子项目分层。以独立 tests 类型配置补盲区，按职责抽取布局辅助计算以还原预算，以小规模浏览器矩阵验证视觉与内容生命周期；不重写引擎或扩大产品功能。

**Tech Stack:** pnpm 10.33.2、TypeScript、Vitest、Biome、dependency-cruiser、Vite、既有浏览器验证工具。

**Spec:** 总纲；包 1/2 回执；审计报告；`docs/specs/2026-09-18-depth-visual-hierarchy-design.md`（末尾 1.1 修订优先于初版）；ADR-0004/CONTRIBUTING。

## Global Constraints

- 上游包 1、2 已复核。不重做保存协调器/离开交互，不顺手实现 Agent、Sidecar、新视觉效果。
- 不提高 CODE_BUDGET、不扩大排除目录逃避生产计数、不压缩多语句/删职责注释凑 600 行、不删冻结导出。
- any=0、tsIgnore=0；最终 bang≤90、asCast≤31、console≤4、todo≤1、defaultExport≤2、bigFiles≤4。若开工值更优，不退回宽松基线。
- lint 新增代码零新增警告；总水位不得高于本包开工值，参考审计 1541 warnings+47 infos。无需本包清零全部历史警告。
- 标准最终检查必须真实返回成功；不能把 2376 测试计数写死为目标，新增有效用例应增加，删除/合并必须逐项说明。
- 具名导出和公开类型/行为保持兼容。语义性 API 调整不得伪装成内部重构。
- 当前默认不发包、不升 package 版本、不推送；记录 CHANGELOG 1.12.0 是在制批次、包 1.7.0 尚未升级的事实，不机械同步数字冒充发布。
- 对当前视觉改动仅做职责拆分、规格一致性和实际缺陷的最小修正；FrameOutline 新视觉阶梯、父链高亮、缓存新算法均不在本包。

## Task 1：重新核对候选范围与检查基线

**Files:** 新建 `docs/dispatch/2026-09-18-delivery-close-report.md` 草稿；读取现有 diff、上游回执、审计日志。

- [ ] 记录 HEAD、已有修改/未跟踪文件、包 1/2 实际交付列表与视觉列表。若源码被其他执行者推进，先归属，不用审计旧数字覆盖当前事实。
- [ ] 运行 `pnpm gate`、`pnpm build`、`pnpm analyze`，保存每项退出码和报告；修复过程中用定向测试，末尾再完整跑一次。
- [ ] 核对真实公开导出与旧 HEAD 的差异，保留导出清单供 Task 3 前后对照。
- [ ] 比对 CHANGELOG 与当前 token：glass leaf 标题目前是 `#d3d7e0`，不得保留首版“改成 #98a2b3”的错误完成说明。设计“仅视觉”已扩到按档位度量，要准确补记范围。

## Task 2：canvas 测试类型纳入门禁

**Files:** 新增 `apps/canvas/tsconfig.test.json`；修改 `apps/canvas/package.json`、相关测试夹具、`.githooks/pre-push` 与 CI 说明；确有必要才更新开发类型依赖及 lockfile。

建议配置：

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["vite/client", "node"] },
  "include": ["src", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

主配置的 references 要保持可用；若继承行为需显式重复，写清 TypeScript 原因。不要修改生产 include 将测试混入发布产物。

- [ ] 运行 `pnpm --filter canvas exec tsc -p tsconfig.test.json --noEmit --pretty false`，记录实际诊断。审计 9 条仅作线索，前两包已可能改变数量。
- [ ] 正确声明 Node 类型环境；修 undefined 收窄、Element→HTMLTextAreaElement 的类型守卫、不完整 FS 句柄、只读 root 的真实 controller 夹具、SaveOutcome 窄类型。禁止批量 `as unknown as`、`@ts-ignore` 或降低 strict/noUncheckedIndexedAccess。
- [ ] 将 canvas 的 `typecheck` 脚本扩为生产检查 + 测试检查，保证根 `pnpm typecheck`、gate、CI 均自然覆盖；无需再新增一条只在本机执行的孤立命令。
- [ ] 修正 pre-push 无 pnpm 回退：当前只列三包，必须包含 free-canvas 的类型和测试，以及 canvas tests 类型检查。回退与主路径的检查集合一致，更新陈旧计数注释。
- [ ] 精确检查所有新增/改动测试类型通过，维持相同业务断言；再次跑 canvas 全测试。

验证：`pnpm typecheck`，以及上面的独立 test config 命令。若需要 @types/node，先核对现有锁文件中版本，按项目管理器加入开发依赖；不引入运行时依赖。

## Task 3：债务收口与结构安全

**Files:** `packages/kernel/src/layout/mindmap.ts`、`frameLayout.ts`；建议新增 `layout/linkGeometry.ts`、`layout/frameHangGeometry.ts`；必要时用只含类型的新模块切断循环；仅核对 `packages/react/src/index.ts`，默认不改导出面。

当前 6 个大文件须至少减少 2 个，优先把 mindmap 和 frameLayout 按职责拆到各模块≤600行，保留 MapView/Stage 大规模重构作为另项。入口 661 行可留在现有 bigFiles 总预算之内，不需要为了过门禁新增特殊排除。

- [ ] 先追溯 asCast 32 的真实来源（预算脚本扫描的不只 src，且注释/正则可能参与），区分真实断言与统计误报。真实断言优先用守卫/推断替代；若修统计器，必须用真实语法与误报反例双向测试，保持阈值不动，不把真实断言从计数中藏掉。
- [ ] mindmap 抽取纯连线几何：`compactBezier`、`bezierControls`、`bezierPath`、`sampleBezier`、正交/梁连线辅助函数等。原路径保留显式 re-export 以兼容包内旧引用；Point/BezierControls 等类型保持同源，禁止运行时反向循环。
- [ ] frameLayout 抽取挂出子树外包络/跨轴分带计算：`fanOutHangCrossCenters`、`hangEnvelopeLocal`、`subtreeMainExtent`、`subtreeCrossExtent` 及依赖明确的纯函数。框语义、四向镜像、baseDepth 透传、布局缓存键不改。
- [ ] 抽取前保留真实布局夹具的盒/边/bounds 输出，抽取后逐值一致；使用已有框挂点/碰撞/shift 不变量/measure-depth 测试，不为压文件规模修改预期。
- [ ] 若上述拆分后仍超限，报告实际新增大文件来源并按职责再拆；不把所有困难推给 MapView 的一次巨型重构。
- [ ] 比较导出符号及类型、运行 `pnpm typecheck`、kernel/react 定向测试、`pnpm depcruise`、`pnpm budget`。

回归命令：

```powershell
pnpm --filter @mindcanvas/kernel test
pnpm --filter @mindcanvas/react test
pnpm depcruise
pnpm budget
```

## Task 4：视觉、导出与产品旅程验收

**Files:** 必要时最小修正现有视觉文件；可新增 `tools/verify-release-123.mjs`（复用现有工具与 snapshotCheck），新增非私密小夹具 `apps/canvas/tests/fixtures/release-123.mm.md`；截图入 `verify-shots/`。

先构建，再核对实际页面加载的是新 bundle；同一最新构建完成矩阵，不依赖旧截图。自动化只能使用当前环境支持的浏览器接口；本地 mock 保存可验证生命周期，但“真实 picker/真实写盘”必须另列是否人工或浏览器验证。

| 旅程 | 检查点 |
|---|---|
| 普通导图新建→编辑→保存→打开 | 文本/注释/背面保真；保存不 reset/fit/清 Undo |
| 慢保存期间继续输入 | 旧保存不清新 dirty；最后文件与最新成功快照一致 |
| 两模式双向切换 | 三选项、未 blur 草稿、中文输入、失败与下载分支符合包 2 |
| 三主题 root/branch/leaf | 父层级清晰、叶标题与 desc 区分；绘制/度量/输入框命中一致 |
| 多中心+跨框边+嵌套框 | 升格/拖动、总览切换、框内编辑与挂出节点不重叠；边端点正确 |
| LOD 阈值邻域 | k≈0.5/0.26 附近缩放无文字来回闪烁；回到 full 可读 |
| SVG/PNG 导出 | 三档字号/色彩与画布一致，普通树/中心/框的已承诺导出能力无回退 |
| 自由画布保存与重开 | 正面/背面/位置/连线一致，离开失败不丢内容 |

- [ ] 真实浏览器至少完成上表旅程，记录测试环境、夹具、动作、截图、断言。Canvas 后端另用适合的纯树夹具或强制测试入口检查，不把高级岛图的 SVG 结果声称为 Canvas 全能力。
- [ ] 若发现视觉规格冲突，只修当前批次需要的差异；记录 FrameOutline 视觉和 desc 宽度估算等已接受边界，不开启新功能。
- [ ] 若浏览器不可用，明确留下“浏览器验收未完成”，不能写全收口；可继续完成其他检查和交付回执。

## Task 5：性能复测、文档和最终门禁

**Files:** `README.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`docs/roadmap/2026-09-15-open-items.md`、CI/hook 注释、最终回执；不修改历史审计报告中的当时事实。

- [ ] `pnpm build` 后运行 `node scripts/bench-layout-cache.mjs`，写样本/机器/统计口径；森林编辑参考5.62/7.40ms，主要门槛仍为<16ms，<5ms为争取值。明显退化时同机顺序复测与归因，不通过改基准阈值结案。
- [ ] 准确更新 README 能力/测试数量、四子项目结构、当前版本状态；CI 注释中“无远端/794测试/三包”纠正；不对测试计数作难维护的多处硬编码。
- [ ] CHANGELOG 为今天视觉/度量与 1+2 修复分别写问题、实际行为、证据。未提交阶段使用清楚的待交付标记，不谎称已经发布 1.12.0。
- [ ] open-items 的 O1 根据类型门禁实测更新；O2 根据包 1 守卫先于 saving 更新；O3/O4 未做不划完成。H1 不再作为整包重跑任务，避免覆盖本系列成果。
- [ ] 最终 `pnpm gate` 和 `pnpm build` **退出码均0**，保存各包数量/新失败=0、lint水位、budget实际数；最后修改代码后必须重新跑受影响检查。
- [ ] 验证包公开导出无意外减少、协议往返/shift不变量不回退。文档变化只校验文本，无需反复全测。
- [ ] 写最终回执及提交分组建议：视觉/度量基线、保存、离开保护、类型门禁、职责拆分、文档。若一个文件同时承载两组改动，说明按块拆分或整体组合提交的理由，由主控组织；不要自行整文件提交他人基线。

最终出口必须同时满足：1/2 正确行为回归通过；全 gate/build 通过；预算未放宽；浏览器矩阵有证据；原有工作区成果完整；版本/台账真实。停下交接，不 push，不启动 Agent 验证。
