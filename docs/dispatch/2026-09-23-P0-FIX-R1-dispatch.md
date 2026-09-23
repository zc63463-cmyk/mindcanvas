# P0-FIX-R1 外派施工计划 + 启动 Prompt（资产身份/字节、重开解析、S2G 竞态）

- 日期：2026-09-23
- 性质：**外派施工**（缺陷修复 + 测试 + 判别性负控 + 真浏览器回归 + 回执；非复核）
- 立项依据：`docs/dispatch/2026-09-23-P0-C-review.md` §4（三缺陷源码机制经独立复核成立）
  + `docs/dispatch/evidence/2026-09-23-p0c-e2e/`（真浏览器原始证据）
- 基线：分支 `main`，HEAD `4d8463d`（产品树 `packages` = `da74e4de`、`apps` = `d8cbdf85`）
- 位次：**P0-C 已（有条件）ACCEPT → 本包是 P0 收口前的必修包**；完成后回到主控评审，
  不得自动进入 P1。N1 两项**必须先于 P1-B**（断图恢复依赖资产身份与解析正确）。

---

## 0. 缺陷清单与修复顺序

| 项 | 缺陷 | 级别 | 地界 | 依赖 |
|---|---|---|---|---|
| R1-1 | `N1-ID-COLLISION`：同 id 形态导致插入字节取错存储（蓝图像被红图顶替） | high | `packages/react`（资产身份 + 归一化字节来源） | 无，先做 |
| R1-2 | `N1-REOPEN-BROKEN`（含 N4 同根）：归一化写不预热解析 + 渲染端用字符串版解析回落 baseUrl | medium | `packages/react` + `apps/canvas` 渲染接线 | R1-1（回归脚本要先能写对蓝字节） |
| R1-3 | `F1-S2G-INTERMITTENT-BLOCK`：同步簿记在 effect 内置位，打开即保存存在竞态窗口 | medium | `apps/canvas` | 独立，可并行编码但同一批提交 |

---

## 1. 启动 Prompt（复制即用）

```text
你是 MindCanvas P0-FIX-R1 的**施工执行者**。任务：修复三个已经过独立复核定性的缺陷，
交付单元测试、判别性负控、真浏览器回归与回执。做完范围即停，交回回执。

仓库："/Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5"
（外层目录名「temp workbase」中间是空格；所有 shell 路径加双引号。真正的 git 仓库是
该子目录，分支 main。）

═══════ 一、基准锚定（第一步；首尾各一次） ═══════

  git rev-parse HEAD                    → 期望 4d8463d（或其后 docs-only 提交）
  git rev-parse HEAD:packages           → 期望 da74e4dee4f806a0f270ce955251530ec257b6aa
  git rev-parse HEAD:apps               → 期望 d8cbdf8580f71df99cb8b5a066d73659097c56
  git status --porcelain                → 应为空

产品树锚不符即停工报告。收工锚按 DS-10/P0-B/P0-C 同款：回执写「收工 HEAD = 回执提交
之前的值」，以产品树锚 + 血缘为准。

═══════ 二、R1-1：N1-ID-COLLISION（high） ═══════

**复现（先跑，亲眼看到红）**：
  构建产物后起 vite preview（5175），运行：
    node tools/verify-n1n4-reopen.mjs
  当前应复现 N1.5 ok=false（a2BytesIsBlue=false）。

**已证实的机制（复核已走通，不必重新猜；以实读为准，行号允许漂移）**：
  - idbAssetHost.ts:192 浏览器库项 id = `assets/${name}`，与磁盘引用同形态；
  - workspaceAssetHost.ts listAssets 合并清单时 byId 以同 id 用磁盘项覆盖 IDB 项，
    且磁盘字节被预热进当前 scope 的 URL 缓存；
  - assetInsert.ts normalizeToWorkspace → bytesOf → readAssetFile → host.resolveAssetState
    按 isWorkspaceAssetRef（assetHost.ts:262，纯前缀）命中 scope 缓存 → fetch 回磁盘字节。

**修复要求（必须同时满足，不接受只修一半）**：
  1. 清单层面：浏览器库项与工作区同名磁盘项必须是**两个可区分条目**（用户要能选中
     「库里那张」）；不允许靠 id 前缀或 `item.id === 'assets/…'` 推断来源
     （assetInsert.ts:59-63 的注释早已警告，现把结构修对）。
  2. 字节层面：归一化复制时，字节必须来自**被选中条目的真实后端**——浏览器库条目
     从 IDB 记录（或其 objectURL）取，磁盘条目才从工作区读；任一路径不得因为 id 同形
     而读到另一个存储的字节。
  3. 公开接口按「只增量、不删既有签名」演进（AssetHostV2 同款纪律）；需要来源溯源时
     在 AssetItem/解析结果上**加字段/加方法**，不得改既有字段语义。
  4. P0-B 的既有判据不动：`NormalizeEnv.alreadyInWorkspace` 仍由调用方显式给出；
     FileOpErrorCode 域、三态、同名策略（keep-both/replace/cancel）语义不变。

**验收（自动化）**：
  - 新增/扩展 packages/react 单测：挂载工作区（磁盘红 assets/a.png）+ 浏览器库蓝 a.png
    并存时：(a) 清单含两个可区分条目；(b) 选浏览器库项归一化 → 落盘「a 2.png」字节
    逐字节=蓝；(c) 磁盘原 a.png 字节不变；(d) 选磁盘项归一化仍走复用/既有路径；
    (e) 未挂载工作区时浏览器库项行为不回归。
  - 真浏览器：`node tools/verify-n1n4-reopen.mjs` 中 N1.3/N1.4/N1.5 全绿
    （a2BytesIsBlue=true）。

**判别性负控（六要素按 P0-B/P0-C 同款，全程 stdout 归档）**：
  中性化「来源判定」（例如让字节解析重新退化为按 id 前缀命中工作区缓存）→
  (b) 的蓝字节断言必须转红；落盘 grep 计数先于跑测；真实 exit code 独立行；
  cwd=packages/react；备份 + cmp + sha256 还原（禁用 git checkout）；回绿。

═══════ 三、R1-2：N1-REOPEN-BROKEN + N4 同根（medium） ═══════

**已证实的机制**：
  1. assetInsert.ts writeNormalized 直调 WorkspaceWriter.writeAsset，绕过
     WorkspaceAssetHost.writeToDisk（后者会把 objectURL 记入 scope 缓存）；
     MindmapStage normalizeInsert 成功后也未刷新清单/预热缓存；
  2. listAssets 两个 effect 不随文档切换重跑（依赖里没有 doc）；
  3. MindmapStage.tsx:2167 渲染端调的是**字符串版** resolveAsset，缓存 miss 一路
     回落到必然 404 的 baseUrl+id；五态版 resolveAssetState 已规定 workspace 引用
     「不回落站点根」、data: 直接 resolved，但渲染端没接；
  4. N4.3-4.5 同根：实体子节点的 `@draw:data:` 不经 nodeIcon.resolveNodeIcon
     （它本会处理 data:），同样在字符串版解析上 404。

**修复要求（架构可自选，但必须覆盖全部四点）**：
  1. 归一化写入后，新 ref 在**同一会话内立即可解析**——经宿主显式登记新写入的
     objectURL（给宿主加增量方法，例如「资产已写入工作区」通知面），或令归一化经宿主
     写入口落盘；不允许在应用层私造第二份 URL 表。
  2. 渲染端改用五态解析：resolved → 渲染 href；pending → 保持上一帧/不渲染但不标断图；
     unresolved → 按 reason（no-scope/missing/wrong-scope/external/unavailable）给可
     区分的呈现；**workspace 引用任何情况下不得回落 baseUrl 站点根路径**。
     data:/builtin: 的既定语义保持（N4 实体子节点必须恢复）。
  3. 文档切换（含「新建→打开」）后引用必须解析到真实字节，不依赖「恰好挂载期列过
     清单」这一偶然前提；但也不允许用每次渲染触发 I/O 的方式硬刷。
  4. 五态呈现不得回退 P0-B 的诊断口径（assetDiagnostics 的缺失诊断继续有效）。

**验收（自动化）**：
  - packages/react 单测：(a) 归一化写后不经 listAssets，同会话解析新 ref = blob/data；
    (b) 模拟文档切换后解析仍 resolved；(c) 五态 reason 各自映射不串；
    (d) `@draw:data:` 实体子节点解析为 data 自身；(e) workspace 缺文件给 missing
    而非站点根 URL。
  - 真浏览器 verify-n1n4-reopen.mjs：N1.10-N1.15、N4.3-N4.5 全绿（reopenImages 非空、
    reopenedPixel 蓝图、[data-asset-broken]=0）；对照实验（不经插入会话直接打开）
    继续保持绿，防止修复只对插入路径生效。
  - A1 回归：`node tools/verify-a1-workspace-switch.mjs` 保持 14/14。

**判别性负控**：
  建议两条（可按实读调整，但判别目标不可换）：
  (i) 中性化「归一化写后的缓存登记」→ 同会话解析用例转红；
  (ii) 渲染端重新接回字符串版回落（或让 data: 不走特判）→ (d)/五态用例转红。
  六要素与归档纪律同 R1-1。

═══════ 四、R1-3：F1-S2G 间歇拦截（medium） ═══════

**机制**：saveGuard.canWriteDoc 要求 syncedSourceRef === doc.source；两个切换置位点在
useDocumentSwitch 的 useEffect（:86/:90）里，effect 提交前的窗口内「打开→编辑→保存」
被判不同步而拒绝。重按可存，无数据丢失，但属用户可见假失败。

**修复要求**：把「该树确属该文档」的置位做成**与文档替换同事务的同步簿记**
（打开/新建/另存为等所有改 doc.source 的入口都要覆盖，含不经 applyDoc 的替换路径；
useDocumentSwitch 的 effect 可保留为幂等兜底，但不得是唯一置位点）。不得用放宽
canWriteDoc 等值判据的方式「修」（那会废掉 S2G 防误写本身）。

**验收**：
  - 用假时钟的单测：source 替换后**不 flush effect**，立即编辑+请求保存 → 必须真实
    发出写盘（当前会被 blocked 拒绝）；既有 save-lifecycle / save-guard 用例零弱化。
  - 真浏览器：`node tools/verify-f1f2-browser.mjs` **连续 5 次**运行
    s2gBlockedTimes=0 且 durableAttempts=1（5 次原始 stdout 全归档）；
    F1③.2-③.7 在每次运行都进入并通过（F1③.1 文案若仍观测不到，维持 unconfirmed，
    不冒充）。

**判别性负控**：把置位重新挪回「仅 effect 内」→ 上述假时钟用例必须转红。

═══════ 五、硬边界（越界即打回） ═══════

  - 不做 P1-B 内容：懒加载、删除、引用查询、orphan 治理、断图修复 UI 一律不做；
  - 不改 P0-C 文案事实源的键与文案（assetNotices.ts）；若五态呈现确需**新**文案，
    在 assetNotices.ts 增量加键并被 notices-consistency 扫描覆盖，不得就地硬编码；
  - 不新增操作入口；不碰 FileManagerTree 行内动作的守卫空缺（那是 P0-C §8-b 裁定项）；
  - 容器一致化（P0-C ② re-scope 项）**不在本包**，等 P1-A 前的跟手项；
  - 公开接口只增量不删签名；packages→apps 依赖方向不得反向。

═══════ 六、门禁（冻结基线，逐数持平；只增不减） ═══════

  pnpm gate:fast → exit 0（lint 1533 warnings / 48 infos / 610 files，只降不升）
  pnpm build → exit 0
  node scripts/check-code-budget.mjs → exit 0（八项：bang 89/90、asCast 31、console 4、
    todo 1、defaultExport 2、bigFiles 4、any 0、tsIgnore 0；零上升）
  kernel 75/708（本包不改 kernel；不符即停工）
  react 162/1748（只增不减）
  canvas 57/653（只增不减）
  doc-index 75 不得回归
  **kernel flake 纪律（P0-C-review L-4）**：若全量出现任何 1 failed，必须记录
  文件名+用例名并连跑刻画（至少 5 次给通过率），不得以「偶发」略过。

═══════ 七、证据与纪律 ═══════

  1. 证据随提交入库：负控脚本+全程 stdout、真浏览器 5 次 F1F2 与 1 次 N1N4/A1 的 JSON
     归档到 docs/dispatch/evidence/2026-09-23-p0fix-r1-*/（N1N4 通过态留档，覆盖
     P0-C 那份 FAIL 证据而非删除它——FAIL 证据是本包立项依据，保留）。
  2. 负控六要素：落盘 grep 计数 → 转红原文（用例名+断言+expected/received）→
     真实 exit code（code=$? 独立行）→ cwd 按包路由 → 备份+cmp+sha256 还原
     （禁 git checkout）→ 回绿；只变异生产代码，期望不动。
  3. 真浏览器脚本仍是探明性工具、**不进 CI**（保持 tools/ 不被 lint/budget/vitest
     扫描的现状，勿为方便把它们搬进 tests/）。
  4. 逻辑层单测**不得替代**真实旅程（P0-B §7-8 替代被证伪的教训）；两者都要。
  5. macOS bash 3.2：${var} 后接全角字符必须加花括号；Python 变异脚本不得含非 ASCII
     字节字面量。
  6. 未覆盖如实列 unconfirmed：真实 OS FS / 系统选择器 / 跨刷新 IDB / F1③.1 文案 /
     F2.3 与第⑤条 / 跨浏览器，沿用 P0-C SUMMARY §6 口径，不冒充。
  7. 提交粒度：R1-1、R1-2、R1-3 各自独立提交，负控证据、浏览器证据、回执分批，
     message 说清「为什么」；回执提交在最后。

═══════ 八、交付物与停止点 ═══════

  1. 代码 + 单测提交（packages/react 与 apps/canvas，按三项分批）；
  2. 负控证据 + 真浏览器回归证据入库；
  3. 回执 docs/dispatch/2026-09-23-P0-FIX-R1-report.md：基准锚定表、三项逐项
     path:line 证据、负控六要素、门禁逐数（命令/退出码/原文/对照基线）、真浏览器
     逐次结果、未覆盖清单、提交 sha+stat；
  4. 回执提交后 git status --porcelain 为空。
  停止点：本包收口即回主控评审 P0 整体收口；**不自动进入 P1**。
```

---

## 2. 主控备注（不属 prompt 正文）

- **为什么 R1-1 必须先于一切**：它是静默错字节——用户明确选择的图片被另一个存储的
  同名文件顶替，且系统提示「已保存副本」。P1-B 的断图恢复若建立在错误的资产身份上，
  会把错图当合法资产治理。
- **R1-2 的设计取舍空间**：宿主增量通知面 vs 归一化改走宿主写入口，两条路都允许；
  取舍标准写在 prompt（不得在应用层私造第二份 URL 表 / 不得每渲染触发 I/O）。
- **不要被「刷新后正常」带偏**：跨刷新恢复依赖挂载期 listAssets，恰好掩盖了同会话
  缺口；验收以同会话「插入→新建→打开」旅程为准，P0-C 的对照实验是必要不充分条件。
- **本包最大风险是门禁数对但旅程仍红**：P0-B 的教训就是逻辑层替代失效。本派单把
  真浏览器全绿写进硬验收（不是附注），复核方将亲自重跑 N1N4 与 F1F2×5。
