# P0-FIX-R1 深度外派施工计划 + 启动 Prompt（资产身份/字节、重开解析、S2G 竞态）

- 日期：2026-09-23
- 性质：**深度外派施工**（缺陷修复 + 单元测试 + 判别性负控 + 真浏览器回归 + 回执；非复核）
- 立项依据：`docs/dispatch/2026-09-23-P0-C-review.md` §4（三缺陷源码机制经接管复核独立走通）
  + `docs/dispatch/evidence/2026-09-23-p0c-e2e/`（FAIL 态真浏览器原始证据）
- 基线：分支 `main`，HEAD `37e68f3`（docs-only；产品树锚仍为
  `packages` = `da74e4de`、`apps` = `d8cbdf85`）
- 位次：**P0-C 已（有条件）ACCEPT → 本包是 P0 收口前的必修包**；N1 两项必须先于 P1-B。
- 本文件已随主控提交入库；与 `2026-09-23-P0-C-dispatch.md` 同体例：§1 预研为主控
  2026-09-23 实读，施工方以实读为准（行号允许 1~5 行漂移，以 grep 内容为准）。

---

## 0. 前置表（为什么是现在）

| 前置 | 状态 | 证据 |
|---|---|---|
| 三缺陷机制经独立复核 | ✅ | P0-C-review §4：每个缺陷给出 4 跳以内的源码链，非脚本转述 |
| FAIL 态证据在库 | ✅ | `evidence/2026-09-23-p0c-e2e/N1N4-REOPEN.log`（15/24，a2BytesIsBlue=false、reopenImages=[]）、`F1F2-S2G-BLOCKED-run.log`、`F1F2-S2G-NOTE.md`（5 次 4 拦） |
| 真浏览器环境已探明 | ✅ | playwright 1.63.0 + chromium-1243 缓存命中；4 个 verify 脚本 + browserHarness 在 `tools/`，不进 CI |
| P0-C 门禁冻结基线 | ✅ | 复核本机顺序复跑：canvas 57/653、react 162/1748、kernel 75/708、lint 1533/48/610、budget 八项持平、build exit 0（产物 main-EMdokVhU.js） |
| 逻辑层替代已被证伪 | ✅（教训） | P0-B §7-8 用「归一化产物重新解析」替代真实旅程，真 Chrome 一跑即破。本包把浏览器全绿写成**硬验收** |

串行位次：P0-C → **P0-FIX-R1（本轮）** → 主控评审（P0 收口）→ P1-A。
**停止点**：本包回执即停止，不自动进入 P1；P0-C ②容器跟手项不在本包。

---

## 1. 施工面盘点（主控实读预研，2026-09-23）

### 1.1 R1-1 N1-ID-COLLISION：身份模型现状

| 事实 | 位置（实读） |
|---|---|
| `AssetItem` 身份只有 `id/name/kind/source?('upload'\|'builtin')/svg?`，**无存储来源字段** | `packages/react/src/chrome/assetTypes.ts:8-20` |
| IDB 上传项 id 直接取 `assets/${file.name}` | `idbAssetHost.ts:190-195`（uploadAssetDetailed 构造 item） |
| IDB 清单 = 静态 ∪ IDB 记录，按 id 去重（IDB 覆盖静态） | `idbAssetHost.ts:168-172`（`byId`） |
| 工作区清单 = fallback 清单 ∪ 磁盘扫描，**磁盘项按同 id 覆盖浏览器项**，且磁盘字节被预热进当前 scope 的 URL 缓存 | `workspaceAssetHost.ts:134-156`（`:154 byId`、`:142-146` 预热） |
| 归一化字节链：`normalizeToWorkspace → bytesOf → readAssetFile → host.resolveAssetState(item)` | `assetInsert.ts:178`、`:221-241` |
| 解析纯按 id 前缀：`isWorkspaceAssetRef` = `startsWith('assets/')` 且非 data/外链 | `assetHost.ts:262-264`；`workspaceAssetHost.ts:178` 据此分支，`:181` scope 缓存命中即返回 |
| `alreadyInWorkspace` 已改为调用方显式声明（P0-B），但**字节来源仍按 id 解** | `assetInsert.ts:57-65`（注释预警）、`:167-176` |
| 宿主是组合结构：`new WorkspaceAssetHost(new IdbAssetHost(DEMO_ASSETS,'/'), () => workspace, '', scopeOfGetter)` | `apps/canvas/src/MindmapStage.tsx:1089-1097` |
| 卡片落点徽章另有一套账本判据（app 层，ledger 优先，前缀仅兜底） | `MindmapStage.tsx:1124-1136`（`storeOf`，`:1132` 前缀兜底） |
| 卡片渲染：`AssetPanel.tsx:371 <AssetCard>` | `packages/react/src/chrome/AssetPanel.tsx`；徽章在 `assetViews.tsx:14,25` 经 `badgesFor(store)` |

**根因复述**：浏览器库项与磁盘项共用 `assets/<name>` id 命名空间；挂载后清单合并让磁盘项
顶替浏览器项（同 id），其红图字节又占据 scope 缓存；归一化按 id 前缀取字节 → 蓝图被
红图静默顶替。文档侧引用语法 `@img:assets/<name>` **不变**（它只表达工作区相对引用），
要修的是**图库运行时身份与解析路由**，不是文档语法。

### 1.2 R1-2 N1-REOPEN-BROKEN（含 N4）：解析链现状

| 事实 | 位置 |
|---|---|
| 归一化落盘直调 `w.writeAsset(name,data,mime)`，**绕过宿主写入口** | `assetInsert.ts:199-218`（writeNormalized） |
| 宿主自己的写入口会在写后登记 objectURL（归一化路径没有等价动作） | `workspaceAssetHost.ts:228-261`（`:253 urls.set(cacheKeyOf(mark, relPath), …)`） |
| `normalizeForInsert` 第 4 参已带 `host?: AssetHostV2`，但当前只用它读字节 | `assetInsert.ts:113-117`、调用点 `MindmapStage.tsx:2967-2972` |
| app 归一化成功后只记 ledger/弹提示，**不刷新清单、不预热缓存** | `MindmapStage.tsx:2977-2999` |
| 两个清单 effect 都不随文档切换重跑（deps 无 doc） | `MindmapStage.tsx:1317-1330`（deps `[assetHost, writeLedger, workspaceReady]`）、`:1346-1354`（deps `[assetHost]`） |
| 渲染端传的是**字符串版**解析：`(ref) => assetHost.resolveAsset(ref)` | `MindmapStage.tsx:2167` |
| 字符串版缓存 miss → fallback → IDB miss → 返回**必然 404 的 `baseUrl+id`** | `workspaceAssetHost.ts:159-163`、`idbAssetHost.ts:175-179` |
| 五态版已存在且明令「workspace 引用不回落站点根」、data: 直接 resolved，但渲染端没接 | `workspaceAssetHost.ts:173-188`（`:175` data:、`:185-187` 不回落） |
| NodeG 实体 ref 分支：`resolveAssetUrl?.(ref) ?? assetBaseUrl+ref.id`；onError 置 assetFailed 画 ✕ | `packages/react/src/render/NodeG.tsx:107-121`、`:138-196` |
| `resolveNodeIcon`（media/icon 路径）本会处理 data:，但**实体子节点 ref 不走它** → N4 同根 | `nodeIcon.ts:30-46`；NodeG.tsx:115-119 |
| prop 链路：MapView 声明 `resolveAssetUrl?: (ref)=>string\|undefined`，ref 稳定化后下传两处 | `MapView.tsx:266`、`:636-641`、`:2217`、`:2363` |
| scope 缓存原语：`ScopedObjectUrls.set` 同键先 revoke 旧值；LRU 200 | `assetObjectUrls.ts:47-67` |

### 1.3 R1-3 F1-S2G：文档替换与簿记现状

| 事实 | 位置 |
|---|---|
| 守卫谓词：精确等值 `synced === docSource`，synced=null 即不同步 | `apps/canvas/src/hooks/saveGuard.ts:17-19` |
| 两个读点：手动保存、自动保存 | `useDocumentActions.ts:194`、`useAutoSave.ts:85` |
| 三个写点：controller 创建、switch effect 首挂跳过、switch reset 后 | `MindmapStage.tsx:278`、`useDocumentSwitch.ts:86,90`（**useEffect，commit 后才跑**） |
| **文档替换的唯一定义性入口**是 `performApplyDoc`（打开/新建/最近/文件库/工作区/拖入全经此处），hook options 已持有 `syncedSourceRef` | `useDocumentActions.ts:121-147`（`:101` 入参、`:126 beginDocument`、`:135 setDoc(next)`） |
| save / saveAs 的 commit **不改 `doc.source`**（只写 savedSource/handle/ts）→ 不产生新的同步写点 | `useDocumentActions.ts:219-225`、`:281-288` |
| 启动期两处直 `setDoc` 发生在 StageContent 之前（首挂路径，由写点①②覆盖） | `MindmapStage.tsx:324`、`:329` |

**竞态机制**：`performApplyDoc` 的 `setDoc(next)` 与「reset 树 + 置位 synced」之间隔着
一次 React 提交 + 被动 effect；「打开→立刻编辑→Ctrl+S」（自动化/快键/IME 下真实存在，
归档 5 次 4 拦）落在置位之前 → 整次保存被拒。**注意不能简单把置位前移到 setDoc 旁**：
那时树还是旧文档的，置位会让守卫放行一次「旧树写新目的地」的错误保存。正确目标是
**把「树属于新文档」这件事做成与替换同事务的同步事实，窗口长度归零**。

### 1.4 既有测试与浏览器夹具

- 归一化测试在**应用层**（历史归属）：`apps/canvas/tests/asset-insert-normalize.test.tsx`
  （462 行，20 个 it，describe：N1 挂载落盘/同名保留两份 :102、N1⑤未挂载拒绝 :213、
  N4 内置 child :242、纯函数面 :307、N4 渲染层 SP3 :428）。
- 宿主测试在包层：`packages/react/tests/workspace-asset-host.test.ts`（487 行）、
  `idb-asset-host.test.ts`（205）、`asset-host.test.ts`（211）；渲染：
  `nodeg-asset.test.tsx`（256）、`asset-broken.test.tsx`（83）。
- 浏览器脚本（端口 **5175**，`--strictPort`）：`tools/verify-n1n4-reopen.mjs`
  （退出码 0=全过；JSON 字段 `checks.*.ok`、`reopenImages`、`reopenedPixel`、
  `cardsBeforeInsert`）、`verify-f1f2-browser.mjs`（字段 `out.s2gBlockedTimes`、
  `out.durableAttempts`、`out.s2gBlocked`）、`verify-a1-workspace-switch.mjs`、
  `verify-no-native-dialogs.mjs`。
- 新鲜度硬闸：脚本启动即 `checkSnapshotFresh()`（`tools/lib/snapshotCheck.mjs`）并
  `assertLoadedBundle`——**必须先 vite build 再跑**，页面实际加载的 bundle 与产物
  不一致会直接失败。产物是结构化 JSON（`createReport`），结论以 JSON 为准，不看屏幕滚动。

---

## 2. 预裁决（施工方可用代码实证反驳，但须在回执写明）

> 依据本项目「预裁决-实证反驳」机制：以下为给定方向；若实读证明某条不成立，
> 允许调整，但必须在回执「预裁决反驳」节给出反例代码与替代方案的判别证据。

**R1-1（身份与字节路由）**
1. 给 `AssetItem` **增量加**存储来源字段（建议复用既有 `AssetStore` 类型，
   如 `origin?: 'browser-idb' | 'workspace-assets'`；builtin 继续由 `source==='builtin'`
   表达）。**IDB 不做迁移**：来源在 `listAssets` 读侧标注（IDB 记录→browser-idb，
   磁盘扫描→workspace-assets）。
2. `WorkspaceAssetHost.listAssets` 合并键改为**复合键（来源+id）**：同名时浏览器项与
   磁盘项**都是可选中的独立卡片**；React 卡片 key 用复合键（排查 `AssetPanel.tsx:371`
   一带的 key，禁止同 key 覆盖）。
3. 解析**按来源路由而非 id 前缀**：origin=browser-idb 的项一律委托 fallback 取字节
   （即使 id 是 `assets/` 形态）；origin=workspace-assets 才查 scope 缓存/磁盘。
   `readAssetFile/resolveAssetState/resolveAsset` 三处同口径。
4. 文档语法零改动：`origin` 是**运行时图库概念，永不写入文档/索引/缓存键之外的持久面**
   （URL 不入文档的 I-3 纪律同样适用于 origin）；文档引用仍是 `assets/<rel>`。
5. `alreadyInWorkspace` 仍由调用方显式声明；ledger 徽章判据不动。

**R1-2（写后可解析 + 五态渲染）**
1. 在 `AssetHostV2` **增量加**一个可选方法（命名自定，如
   `primeWorkspaceAsset(relPath: string): Promise<boolean>`）：`WorkspaceAssetHost`
   实现为 `w.readAssetFile(relPath)` → `urls.set(cacheKeyOf(this.scopeMark(), relPath),
   createObjectURL(file))`，幂等（set 自带旧值 revoke）；无工作区/读失败返回 false，
   **不得因此把已成功的插入改判 refused**（磁盘事实成立，降级为同 P0-B 的 best-effort）。
2. `assetInsert.writeNormalized` 成功后经第 4 参 host 调该方法；host 无此方法时行为同今
   （可选面，旧宿主不破）。
3. 渲染端改接五态：把 MindmapStage:2167 的字符串解析换成基于 `resolveAssetState` 的
   **判别式结果**并贯穿 MapView/NodeG 的 prop 类型：`resolved`→渲染 href；
   `pending`→不渲染图片也**不**画断图、后续重渲染自然补上；`unresolved`
   （missing/wrong-scope/no-scope/unavailable 的 workspace 引用）→ **保留 ✕ 资产缺失
   用户信号**，但不得再发起一次必然 404 的加载；data:/builtin: 语义同今（N4 实体
   child 由此恢复）；external 维持非托管现状。
4. 禁止每渲染触发 I/O：预热只挂写后路径，清单刷新维持 effect 驱动。
5. `assetDiagnostics` 的缺失诊断口径不得弱化；既有 nodeg-asset/asset-broken 用例只做
   适配性修改，不得删断言。

**R1-3（零窗口同步）**
1. 在 `performApplyDoc` 内**同步**完成「parse next.source → `controller.reset(editable)`
   → `syncedSourceRef.current = next.source`」，使 applyDoc 一旦返回 true，
   「树属于新文档 + 守卫放行」同时成立，不依赖任何 effect 提交时机。
2. `useDocumentSwitch` 的 effect 退化为**视图职责**（setEntities/收起/fit），删除其中
   的同步置位（保留首挂路径②与 controller 创建处①）；同内容替换（source 逐字相同）
   现在也会同步 reset——如与既有用例冲突，先核对「换了文档就该换树」的 R2 语义，
   不允许回退到 effect 置位。
3. 严禁放宽 `canWriteDoc` 的等值判据（那会废掉防误写本身）；save/saveAs 不加写点
   （它们不改 source，已实证）。
4. 允许的替代方案：把 reset+置位放进 **useLayoutEffect** 段与视图 effect 拆开，
   但必须用「不等待任何 effect 提交」的确定性测试证明零窗口；证明不了就用方案 1。

---

## 3. 启动 Prompt（复制即用，全文自带判据）

```text
你是 MindCanvas P0-FIX-R1 的**施工执行者**。任务：修复三个已经过独立复核定性的缺陷
（资产身份与字节、重开解析、S2G 竞态），交付单元测试、判别性负控、真浏览器回归与
回执。做完范围即停，交回回执。

仓库："/Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5"
（外层目录名「temp workbase」中间是空格，不是斜杠；所有 shell 路径必须加双引号。
真正的 git 仓库是该子目录，分支 main。）

权威输入（必须实读，不得只看转述）：
  docs/dispatch/2026-09-23-P0-C-review.md            §4（机制）、§6（finding）
  docs/dispatch/2026-09-23-P0-FIX-R1-dispatch.md     本派单（§1 盘点、§2 预裁决）
  docs/dispatch/evidence/2026-09-23-p0c-e2e/         FAIL 态原始证据（保留勿删）

═══════ 一、基准锚定（第一步；首尾各锚一次） ═══════

  git rev-parse HEAD                    → 期望 37e68f3（或其后 docs-only 提交）
  git rev-parse HEAD:packages           → 期望 da74e4dee4f806a0f270ce955251530ec257b6aa
  git rev-parse HEAD:apps               → 期望 d8cbdf8580f71df99cb8b5a066d73659097c56
  git status --porcelain                → 应为空
  git log --oneline -3

产品树锚不符即停工报告。收工按 DS-10/P0-B/P0-C 同款：回执写「收工 HEAD = 回执提交
之前的值」，以产品树锚 + 血缘为准。

═══════ 二、先复现（亲眼看到红，再动手） ═══════

  ( cd apps/canvas && ./node_modules/.bin/vite build )
  ( cd apps/canvas && ./node_modules/.bin/vite preview --port 5175 --strictPort & )
  node tools/verify-n1n4-reopen.mjs
    期望 FAIL：N1.5 ok=false（a2BytesIsBlue=false）、N1.10~N1.15 红、N4.3~N4.5 红。
  node tools/verify-f1f2-browser.mjs
    大概率复现 out.s2gBlocked=true（归档复现率 4/5）。复现不到就连跑至累计 5 次，
    如实记录每次 JSON；不得为了复现修改产品代码。
  浏览器结论以脚本输出的**结构化 JSON** 为准（createReport 产物），不要凭滚动日志下结论。

═══════ 三、R1-1：N1-ID-COLLISION（high） ═══════

机制（已复核，以实读为准，行号会漂）：
  assetTypes.ts:8-20 无来源字段 → idbAssetHost.ts:192 id=assets/<name>
  → workspaceAssetHost.ts:154 磁盘项同 id 覆盖浏览器项 + :142-146 红图字节预热 scope 缓存
  → assetInsert.ts:178,221-241 bytesOf 经 resolveAssetState
  → workspaceAssetHost.ts:178-183 按 isWorkspaceAssetRef 前缀命中缓存 → fetch 回红图。

按派单 §2 R1-1 预裁决施工，硬性验收：
  (a) 挂载工作区且磁盘有红 assets/a.png，浏览器素材库有蓝 a.png：清单含**两个可区分
      条目**（复合键），卡片 key 不撞、两张卡都可点选；
  (b) 选**浏览器库项**插入：落盘「assets/a 2.png」字节逐字节=蓝图 fixture；
  (c) 原 assets/a.png 字节不变；文档引用 `@img:assets/a 2.png`；
  (d) 选**磁盘项**的既有路径行为不回归（alreadyInWorkspace 复用、keep-both 三选）；
  (e) 未挂载时浏览器库位图仍被拒绝、小 SVG 仍可内联；
  (f) origin 永不写入 .mm.md、索引或文档相关持久面（grep 自证）。
测试归属：来源标注/解析路由的宿主级用例加到 packages/react/tests/
  workspace-asset-host.test.ts 与 idb-asset-host.test.ts；归一化集成继续加到
  apps/canvas/tests/asset-insert-normalize.test.tsx（沿用既有 N1 describe 与假主机风格，
  不得另起平行夹具）。
负控 NC-R1-1：把字节解析重新退化为「只按 id 前缀路由」（或令浏览器项不带来源）→
  (b) 的蓝字节断言必须红。六要素见 §六。

═══════ 四、R1-2：N1-REOPEN-BROKEN + N4 同根（medium） ═══════

机制：assetInsert.ts:199-218 直写 WorkspaceWriter、绕过 workspaceAssetHost.ts:253 的
URL 登记；两个清单 effect（MindmapStage.tsx:1317/1346）不随文档切换跑；
MindmapStage.tsx:2167 用字符串版 resolveAsset，miss 后回落必然 404 的 baseUrl+id
（NodeG.tsx:139-207 onError→✕）；五态 resolveAssetState（workspaceAssetHost.ts:173-188）
渲染端没接；实体 child 的 @draw:data: 不经 nodeIcon.ts:34 的 data: 特判，N4 同根。

按 §2 R1-2 预裁决施工，硬性验收：
  (g) 归一化写后**不依赖 listAssets**，同一会话内新 ref 立即解析到 blob/data；
  (h) 「插入→保存→新建→打开」后 N1.10-N1.15 全绿：reopenImages 非空、有 <image href>、
      reopenedPixel=蓝、[data-asset-broken]=0；
  (i) N4.3-N4.5 全绿：实体 child 的 data: 图标重开后可见；
  (j) 五态行为：resolved 出图；pending 不出图也不画断图；workspace 引用真缺失时
      **仍显示 ✕ 资产缺失**（不得因隐藏 404 而吞掉缺失信号）；external 维持现状；
  (k) 对照组（不经插入直接打开同磁盘状态）继续绿；A1 脚本 14/14 不回归；
  (l) 不在渲染路径新增 I/O（预热只在写后；清单仍由 effect 刷新）。
测试归属：NodeG 五态呈现加到 nodeg-asset.test.tsx / asset-broken.test.tsx（只适配
  不弱化）；写后预热的宿主级用例加到 workspace-asset-host.test.ts；集成继续
  asset-insert-normalize.test.tsx。
负控（建议两条）：
  NC-R1-2a：跳过写后预热 → (g) 同会话解析用例红；
  NC-R1-2b：渲染端接回字符串版回落（或令 data: 失去特判）→ (i)/(j) 对应用例红。

═══════ 五、R1-3：F1-S2G 零窗口（medium） ═══════

机制：performApplyDoc（useDocumentActions.ts:121-147）是所有文档替换的唯一定义入口，
但「reset 树 + syncedSourceRef 置位」在 useDocumentSwitch.ts:86,90 的**被动 effect**
里；置位前的保存被 saveGuard.ts:17 拦截。注意：不得只把置位前移（那时旧树会被写进
新目的地）。

按 §2 R1-3 预裁决：在 performApplyDoc 内同步 parse→reset→置位（hook options 已持有
syncedSourceRef，:101）；useDocumentSwitch 的 effect 只留视图职责。硬性验收：
  (m) 确定性单测（假时钟、**不 flush 任何 effect**）：applyDoc(next) 返回 true 的
      同一时刻：syncedSourceRef.current === next.source、canWriteDoc(...) === true、
      controller.root 已来自 next.source（序列化文本以 next 内容开头，无旧节点残留）；
  (n) 同内容替换（重开 source 逐字相同的文档）后树同样属于新文档，旧草稿不残留；
  (o) 现有 save-lifecycle 657 行全部用例、useDocumentSwitch 相关用例零弱化；
  (p) 真浏览器：verify-f1f2-browser.mjs **连续 5 次**，每次 out.s2gBlockedTimes=0 且
      out.durableAttempts=1；5 份 JSON 全部归档（F1③.2-③.7 每次都进入并通过；
      F1③.1 文案仍观测不到就维持 unconfirmed，不冒充）。
负控 NC-R1-3：把置位/reset 挪回「仅被动 effect」→ (m) 必须红。

═══════ 六、负控执行纪律（本仓血泪条款，逐条照做） ═══════

  1. 变异只动**生产代码**，期望断言一字不改；变异后先 grep 确认标记在盘
     （计数=期望）再跑测，未落盘即判本次无效重来；
  2. 转红贴用例名 + 断言行 + expected/received 原文；退出码独立行捕获
     （code=$? 单独一行，禁止写进命令替换同一行）；
  3. cwd 按包路由：packages/react 的测试 cwd=packages/react，canvas 的 cwd=apps/canvas
     （跑错包出 "No test files found" 也算 exit 1，那是假红）；
  4. 还原用 /tmp 备份 + cmp + shasum -a 256 字节校验（**禁用 git checkout**——
     CRLF 工作树会被改写 EOL）；观测用例文件一并备份并 cmp；还原后回绿记 passed 数；
  5. 禁止 it.fails / 反转断言 / catch 后报 PASS / 宽泛 skip；
  6. 每条负控六要素独立成节，脚本**全程 stdout（含落盘计数行）**归档到
     docs/dispatch/evidence/2026-09-23-p0fix-r1-negative-controls/；
  7. 每个测试套件最终全量必须绿；负控之间互不污染（一条还原干净再做下一条）。

═══════ 七、硬边界（越界即打回） ═══════

  - 不做 P1-B：懒加载/删除/引用查询/orphan/断图修复 UI；
  - 不改文档引用语法（@img:assets/… 不变）；origin 是运行时概念不入文档；
  - 不改 P0-C 文案事实源的既有键与文案；五态呈现若确需**新**文案，在 assetNotices.ts
    增量加键并被 notices-consistency.test.tsx 扫描覆盖，禁止就地硬编码；
  - 不新增操作入口；不碰 FileManagerTree 行内守卫空缺（P0-C §8-b）；
  - 容器一致化（P0-C ② re-scope）不在本包；
  - 公开接口只增量：AssetHostV2/AssetItem 加可选字段/方法，不删不改既有签名语义；
    依赖方向 apps/canvas → packages/react 不得反向；
  - tools/verify-*.mjs 是探明脚本**不进 CI**，不得搬进 tests/ 或改成门禁项；
  - MindmapStage.tsx 已 3150 行（bigFiles 4/4 顶格），本包对它的改动净行数近持平，
    逻辑优先沉到 packages/react 与 hooks。

═══════ 八、门禁（冻结基线，逐数持平；只增不减） ═══════

  pnpm gate:fast → exit 0（lint 1533 warnings / 48 infos / 610 files，只降不升）
  pnpm build → exit 0（canvas 产物重建；vite chunk>500kB 警告非错误）
  node scripts/check-code-budget.mjs → exit 0（any0/tsIgnore0/bang89(预算90)/
    asCast31/console4/todo1/defaultExport2/bigFiles4，零上升）
  kernel 75/708（本包不改 kernel；不符即停工）
  react 162/1748（只增不减）
  canvas 57/653（只增不减）
  doc-index.test.ts 75 不得回归
  kernel flake 纪律（P0-C-review L-4）：任何一次 1 failed 都要记录文件名+用例名，
  连跑至少 5 次给通过率，禁止写「偶发、忽略」。

═══════ 九、真浏览器回归（硬验收，不是附注） ═══════

  顺序：build → preview:5175 → 依次跑四个脚本。结论只认 JSON 与退出码。
    node tools/verify-n1n4-reopen.mjs            exit 0，全部 checks ok（含 N1.5 蓝字节、
                                                 N1.10-15、N4.3-5、N1.13 拒绝零副作用）
    node tools/verify-a1-workspace-switch.mjs    PASS 14/14
    node tools/verify-f1f2-browser.mjs           连跑 5 次全 exit 0 且 s2g=0/attempts=1
    node tools/verify-no-native-dialogs.mjs      PASS 13/13
  每份 JSON 归档 evidence/2026-09-23-p0fix-r1-e2e/（F1F2 五份分别命名 run1..run5）；
  P0-C 的 FAIL 证据**保留不删**（它是本包立项依据，修后证据与之并列形成前后对照）。
  未覆盖如实列：真实 OS FS/系统选择器手势/跨刷新 IDB（harness 替身限制）/F1③.1 文案/
  F2.3 与第⑤条/跨浏览器，沿用 P0-C SUMMARY §6 口径。

═══════ 十、提交与回执 ═══════

  提交粒度：R1-1、R1-2、R1-3 各自独立提交（产品+单测同批），负控证据、浏览器证据、
  回执分批；message 说清「为什么」，前缀用 fix(p0fix)/test(p0fix)/docs(p0fix)。
  回执 docs/dispatch/2026-09-23-P0-FIX-R1-report.md 必含：
    - 基准锚定表（首尾 HEAD + 两产品树锚 + status）；
    - 三项逐项 path:line 证据（含与本派单 §1 行号的漂移说明）；
    - 预裁决反驳节（无反驳也要显式写「全部采纳」）；
    - 负控六要素 + 归档路径；门禁逐数表（命令/退出码/原文/基线对照）；
    - 浏览器四脚本逐次结果（F1F2 五次 JSON 文件名 + 关键字段）；
    - 未覆盖清单（如实，unconfirmed 不得标 satisfied）；提交 sha+stat。
  回执提交后 git status --porcelain 必须为空。
  停止点：本包收口即回主控评审 P0 整体收口；**不自动进入 P1**。
```

---

## 4. 主控备注（不属 prompt 正文）

- **修复顺序的工程理由**：R1-1 是 R1-2 真浏览器验收的前提（字节不对，重开出图也是
  错图）；R1-3 独立，可在同批内任意时刻编码。三项可以分提交但必须同批回执。
- **最大风险不是门禁、是旅程**：逻辑层全绿而真实旅程红的剧本已经演过一次。本派单把
  「build→四脚本→F1F2×5」写成与单测同级的硬验收；复核方将亲自重跑 N1N4 与 F1F2×5，
  并核对浏览器实际加载 bundle 的 sha 与本次 build 产物一致（snapshotCheck 已内置）。
- **R1-1 的诱惑性错法**：只在 `assetInsert.readAssetFile` 里特判「同名时从 fallback
  取字节」。这会修好 N1.5 但留下双身份清单（用户仍无法选中磁盘项/徽章与解析继续
  分叉）。验收 (a) 与卡片 key 检查就是防这个半修。
- **R1-2 的诱惑性错法**：在 MindmapStage 私建一张 `refId→objectURL` 的应用层 Map。
  这违反「URL 只在宿主与渲染层之间」的归属，且跨工作区/释放语义会再造一遍
  ScopedObjectUrls 已解决的问题。预热必须经宿主增量方法。
- **R1-3 的诱惑性错法**：把置位提前到 setDoc 同一行而不提前 reset——零拦截但可能
  旧树写新盘。(m) 的三条并列断言（ref 等值 + 守卫放行 + 树已换新）专门拦这种假修。
- **预算敏感点**：新逻辑优先放 packages/react（宿主/NodeG）与 hooks；MindmapStage
  只做接线，净行数近持平；新增 as/any 会直接顶爆 budget，禁止。
