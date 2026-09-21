# C 批派遣计划：升中心 Phase 2（写路径统一 / 守卫补齐 / 嵌套语义收口 / 可见性）

- **日期**：2026-09-13
- **起点 HEAD**：`0f46da6`（1.8.12 收口；工作树干净，仅 `tools/graph-engine/` 未跟踪）
- **出处**：`docs/roadmap/2026-09-13-progress-and-directions.md` §四「升中心专项」六条缺口 → 本批覆盖其中 1/2/3/4/5 条。
- **批次代号**：C1 … C6（逐个提交，做完停下报告）

---

## §0 基线（动手前自己复核一遍；数字不符先报告）

| 项 | 值（2026-09-13 实测） |
|---|---|
| 三包测试 | kernel **480** / react **1127** / canvas **186** = **1793** 全绿 |
| 门禁 | tsc ×3 = 0；react dist 重建 = 0（本批改 react 源 → 必须重建）；depcruise = 0（416 模块 / 1170 deps）；lint = **1468 warnings + 46 infos**（水位不得上升） |
| 预算 | bang **89/90** ↓1 · asCast **31/31** · console 4/4 · todo 1/1 · defaultExport 2/2 · bigFiles **3/4** ↓1 |
| 超 600 行 | `MindmapStage.tsx` 2254 / `edgeRouting.ts` 1235 / `MapView.tsx` 2193（本批只许 `MindmapStage` 微增；新文件一律 <600） |
| 冻结纪律 | 阈值/契约测试**不得放宽**；禁 `git add -A`；不 push；不动 `.codebuddy/` 与 `tools/graph-engine/`；`CULL_MARGIN` 不动 |

**DoD（每任务）**：① TDD 红→绿且**红证据贴原文**；② 每任务一条 commit（中文 `类型(范围): 摘要`）；③ 报告数字**贴工具原样输出**；④ 全部做完停下等放行。

---

## §1 取证（写稿时逐条核过；执行前请自行复核）

### 1.1 升格写路径**双轨**（本批最重要的一条）

| 路径 | 实现 | 是否分配 cid |
|---|---|---|
| 右键「升为中心 › 四向」 | `apps/canvas/src/nodeMenuBags.ts:90-95` → `upsertCenter(root.note, at, { dir })` → `controller.updateNote` | ❌ **不分配** |
| 环第二席「升为中心」 | `subRingItems.ts:86-88`（同一 `centerActions.onPromote`；装配 `MindmapStage.tsx:944-946` → 环） | ❌ 同上 |
| 右键「设为 Section（升为中心）」 | `MindmapStage.tsx:1012-1030` → `planPromoteCenter` → `applyTransaction` | ✅ 分配/沿用（`centers.ts:429-462`） |

**后果**（都可实测）：
1. 菜单/环升格的中心**没有稳定身份** → 老文档改名/移动后其 `at` 路径锚 dangling（cid 化的不会，见 `anchor-migrate.ts:290`）；
2. 环剪贴板席按 `hasCid` 动态化（`subRingItems.ts:89-92,143`）→ 同一"升为中心"动作，两条路径给出的**后续能力不同**（"复制中心编号" vs "复制节点文本"）；
3. `planPromoteCenter` 的既有语义（沿用 cid 不 bump / 坐标从 `center_pos` 吸附 / 单批 ops）在菜单路径**完全不生效**。

**不变量（C1 必须保住）**：四向 `dir`、坐标保留/历史吸附、root 不可升格、**一次 undo 回滚**、失败可发现（复用 `host.onAttachError` 通道）。

### 1.2 嵌套 / 跨岛移动语义（"设计确认中" → 本批收口）

- 岛成员映射：`packages/react/src/demo/pipeline.ts:270-274`（`membersByRoot` = 投影输出的每岛 `memberIds`；**升格子树已从父岛剔除**，`islands.ts:184-214`）。
- 拖动预览：`MapView.tsx:765-772`（`centerPreview` 只平移**本岛**成员盒）→ **子岛成员不随父中心移动**（当前行为）。
- 该行为从未被钉住；`outputs/2026-09-10-sections-phase1-delivery.md:132` 记「Section 内跨岛嵌套独立中心是否跟随移动（设计确认中）」。
- **推荐语义 = 不跟随**（理由：子岛有独立坐标身份 `pos`/`center_pos`；跟随会与"独立落位"承诺冲突；投影已保证 owner 唯一）→ 本批为**钉住 + 文档化**（不改代码）。

### 1.3 守卫缺口（清单）

- `planPromoteCenter`：**无直接单测**（全仓只有实现 `centers.ts:429`、导出 `packages/react/src/index.ts:432`、消费 `MindmapStage.tsx:1013`）。
- 写路径：`onPromote` / `onDemote` / `onToggleParentLink` 无直测；`onAttach` 已有 1 例（`apps/canvas/tests/center-actions-attach-notice.test.tsx:23-55`）。
- 已有覆盖（不得削弱）：`packages/react/tests/centers.test.ts`（collect/upsert/remove/历史区/`buildCenterSpecs`）、`centers-cid.test.ts`、`centers-pipeline.test.ts`、`cut-attach.test.ts`、`mapview-center-drag.test.tsx`、`packages/kernel/tests/layout-islands.test.ts`。

### 1.4 中心**无任何视觉标记**（可见性缺口）

- `NodeG.tsx` 全文件无 center 语义；`SectionLayer` 只画 Section 框 → 升格后除"菜单项变化/拖拽行为变化"外**没有任何指示**。
- 落点冲突实测：**右上**已被 note 角标占用（`MapView.tsx:1750-1758`，`cx = x + w - 5, cy = y + 5`）；**右中**是折叠钮（`NodeG.tsx:222-240`，`translate(b.w - COLLAPSE_R*2, bodyH/2)`）→ **左上角空闲**。
- Canvas 模式：角标若画在 SVG 节点层（与 note 角标同族）→ 自动降级时**不渲染**；既有降级损失清单钉在 `packages/react/tests/canvas-degrade.test.tsx:97-120`（svg 1/1 vs canvas 0/0），文案在 `apps/canvas/src/hooks/useCanvasDegradeNotice.ts:21-22`。

### 1.5 森林布局缓存（取证任务，不实现）

- 已知：森林路径**不接管 LayoutCache**（`packages/kernel/src/layout/islands.ts:18`）；A6 验收记「森林路径无缓存（已知取舍）」（`outputs/2026-09-05-layout-islands-a6-acceptance.md:64`）；P2「中心局部布局缓存」待实测收益（`outputs/architecture-godot-decision-2026-09-05.md:94`）。
- 现成工具：`scripts/bench-islands-a6.mjs`（单树基线 vs 中心岛 layoutForest + 边界边 + detached 采样）→ 本批只**跑数据 + 判定**。

### 1.6 七个坑

1. **C1 会让"升格"开始写节点 `note.cid`** —— 这是**刻意**（身份前置）；但**不得**顺手给全库节点补 cid（惰性补发原则：`outputs/2026-09-05-progress-locate-and-cid-plan.md:98`）。
2. **`at` 兜底口径变更**：`planPromoteCenter` 在 `anchorOfNode` 为空时兜底 `cid:${cid}`（`centers.ts:442`），而现 `onPromote` 是"`at` 为空即不动作"（`nodeMenuBags.ts:91-92`）→ 行为变更必须在 commit message 列明 + 测试钉住。
3. **单条 undo**：C1 的 ops 必须**同批**提交（节点 note + root note），一次 Ctrl+Z 全回滚。
4. **C3 是"钉住"不是"改"**：若判别测试红，说明 §1.2 的现状判断错了 → **报告里改口径**，不许为了绿而改测试期望。
5. **C4 角标不得进入命中/拖拽几何**（`pointerEvents: 'none'`，比照 note 角标写法）——否则抢节点点击。
6. **C4 只允许加法**：`canvas-degrade.test.tsx` 的既有 1/1 与 0/0 断言**不得改动**，只追加 `data-center` 一项；文案追加同理。
7. **报告数字贴工具原样输出**；tmp 日志定向清理（批量删 `tmp-*.log` 会被沙箱安全删除守则拦截——**不要重试整批**）。

---

## §2 任务

### C1 · 升格写路径统一（唯一 `planPromoteCenter`）

**目标**：把 `makeCenterActions.onPromote` 改为走 `planPromoteCenter` + `applyTransaction` —— 右键与环两条入口自动同源。

**不变量**：四向 `dir` 语义不变；坐标保留/历史吸附不变；root 守卫（plan 内已有）；**单条 undo**；失败经 `host.onAttachError` 上报（复用通道，不新增 UI）。

**判别测试（先红）**
1. `onPromote(id,'left')` → ① `root.note.centers` 条目含 `cid`；② 该节点 note 含同 `cid`；③ **一次 undo** 后两者同时回滚。
2. 已有 cid 的节点再升格 → **不 bump** `next_cid`、不重写节点 note（ops 只含 root 一条）。
3. `center_pos` 有历史坐标的节点升格 → 坐标**吸附回原位**（C1 后菜单路径也享有此语义）。
4. `at` 不可解析（节点不可达）→ 走 `cid:` 兜底（口径变更，commit 列明）。

**commit**：`fix(canvas): 升格写路径统一到 planPromoteCenter（菜单/环升格补 cid 身份）`

### C2 · 守卫补齐（升格链的判别测试）

**目标**：把 §1.3 的空白补成判别测试。

1. `planPromoteCenter` 直测（放 `packages/react/tests/centers-promote.test.ts` 新文件）：is-root / not-found / 无 cid（两 op + bump）/ 有 cid（一 op、不 bump）/ `pos` 传入写入 x,y。
2. 写动作直测（`apps/canvas/tests/center-actions-*.test.tsx`，比照 attach-notice 夹具）：`onDemote` 清空后**连键一起删**（`centers`/`center_pos` 不留空数组）且坐标进历史；`onToggleParentLink` 写入并回读。
3. **阴性对照（自跑并恢复）**：改坏 `ensureNodeCid` 的"沿用不 bump"分支 → C1/C2 对应用例必红。

**commit**：`test(canvas,react): 升格链守卫——planPromoteCenter 直测 + 三个写动作直测`

### C3 · 嵌套跟随语义收口（钉住 + 文档化）

**目标**：把「子岛成员不随父中心移动」从"设计确认中"变成**显式契约**。

- 判别测试（`packages/react/tests/mapview-center-nested-drag.test.tsx` 新文件）：嵌套两岛夹具（父中心 P 岛含升格子中心 C）→ 拖 P：**P 岛成员盒位移、C 岛成员盒不动**；拖 C：反向。
- 文档：`docs/specs/2026-09-02-mm-md-protocol.md` §6.3 补一句（子岛独立坐标，父岛拖动不带动子岛）；CHANGELOG 记该决策与理由。

**commit**：`docs(specs)+test(react): 嵌套中心移动语义收口——子岛不随父岛拖动（判别测试钉死）`

### C4 · 中心可见性（轻量角标）

**目标**：升格后**看得见**（项目自身纪律引用：「设了方向必须看得见，否则用户无法判断快捷键是否生效」——`CHANGELOG.md` 预方向提示条）。

- 形态：节点**左上角**小圆点/菱形 + `data-center` + `<title>中心（doc#cid）</title>`，`pointerEvents: 'none'`；**不改**卡片几何/不占布局（推荐画在 MapView 节点层，与 `data-note-badge` 同族）。
- 判别测试（`packages/react/tests/mapview-center-badge.test.tsx`）：升格 → 出现；降格 → 消失；root（不可升格）→ 无；Canvas（`forceBackend='canvas'`）→ 无渲染，且 `canvas-degrade.test.tsx` **追加**一项损失（`data-center` 1 → 0）。
- 文案：`CANVAS_DEGRADE_NOTICE` 追加「/中心标记」（若与既有去重测试冲突，改测试的**导入用法**除外，断言语义不得变）。

**commit**：`feat(react,canvas): 中心可见性角标（左上 data-center + Canvas 损失清单补一项）`

### C5 · 森林布局缓存取证（只测不实现）

- 跑 `scripts/bench-islands-a6.mjs`（必要时小幅扩展用例矩阵：N ∈ {384, 1000, 3000} × 中心数 ∈ {0,1,3,8}），产出「布局帧耗时 vs 单树基线」表。
- **触发条款**：多中心布局耗时 > 单树 **1.5×** 且 > **16ms**（帧预算）才立项缓存批；否则记录数据、**不立项**。
- 报告贴原始输出（不许手抄）。

**commit**：`perf(kernel): 森林布局耗时取证（多中心 × 规模矩阵；触发条款未达则记录不立项）` 或与 C6 合并

### C6 · 收口

- `CHANGELOG.md` `[1.8.13]`：C1–C5 逐条（含 C1 的双轨缺陷与口径变更、C3 的决策、C4 的 Canvas 损失清单追加、C5 数据与判定）。
- 报告落 `outputs/2026-09-13-centers-phase2-report.md`；**然后停下**等放行。

---

## §3 决策点（按推荐执行，不必等确认）

| # | 决策点 | 推荐 |
|---|---|---|
| **C-A1** | 升格写路径 | **统一到 `planPromoteCenter`**（唯一写路径；同 `reattachEdge` 的先例） |
| **C-A2** | cid 补发范围 | **只给被升格节点**（惰性）；不做全库迁移 |
| **C-A3** | 嵌套跟随语义 | **不跟随**（钉住现状；理由见 §1.2） |
| **C-A4** | 角标位置/形态 | **左上**小圆点（右上=note 角标、右中=折叠钮，均已被占）；不引入新字形/不占布局 |
| **C-A5** | Canvas 模式角标 | **不渲染**（与 note 角标同族）+ 损失清单追加一项 + 文案追加 |
| **C-A6** | 缓存立项条款 | 耗时 > 单树 1.5× **且** > 16ms 才立项（否则只记录） |
| **C-A7** | `members` 管道串 / `collapsed` 落盘 | **本批不做**（前者需扩 micro-YAML parser；后者属 Section 侧语义变更，另裁） |

---

## §4 风险

1. **C1 改变既有行为**（升格开始写 `note.cid`）→ 老文档兼容靠协议透传键 + 1.3.1 序列化保真；报告需给出一次真实 round-trip 证据（升格 → 保存 → 重开 → 中心仍 cid 命中）。
2. **C4 视觉冲突**（与选中态/hover/拖拽光环叠加）→ 真浏览器截图核对四个态（普通/选中/拖拽中/降级 Canvas）。
3. **C3 判断若与现状不符** → 先报告再定（不许改期望值凑绿，见 §1.6 坑 4）。
4. **C5 数据可能支持"无需缓存"** → 那就**不立项**（记录数据即交付；不许为立项造需求）。
5. 三包测试数预期净增：C2 +6~8、C3 +2、C4 +3~4 → 目标 **1793 → 1804±2**。

---

## §5 交付与报告格式

- 逐任务：commit hash + 改动文件 + 分包测试数（实测）+ 新增用例数；**红证据原文**。
- C1：升格前后 `root.note.centers` / 节点 note 的**原始对照**（含 cid、next_cid 未 bump 的证据）+ 一次 undo 回滚证据。
- C3：判别测试断言原文（父岛动/子岛不动的盒坐标对照）。
- C4：四态截图路径 + `canvas-degrade` 追加断言原文。
- C5：bench 原始输出 + 触发条款判定结论。
- 门禁与预算实测（工具原样输出）；偏差与原因；然后停。

## §6 明确不做（本批）

- `members` 管道串 / `collapsed` 落盘（C-A7）；升格预览与快捷键（等摩擦清单背书）；detached 收件箱（既有裁决不做）；Canvas 侧的 Section/中心渲染（另立大图专项）；森林布局缓存**实现**（C5 只取证）。
