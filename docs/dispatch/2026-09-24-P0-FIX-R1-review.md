# P0-FIX-R1 独立审查报告（接管复核）

- 审查对象：`docs/dispatch/2026-09-23-P0-FIX-R1-report.md` 及其提交族
  （`fa8d0a6` → `40a9842`，回执 `3f368c9`）
- 审查日期：2026-09-24
- 审查方式：**接管式独立复核**。锚点、产品代码、负控、门禁全部重做；四个真浏览器
  脚本（含 F1F2 连跑 5 次）由本审查在当次 build 产物上**亲自运行**，不认归档转述。
- 未修改任何施工产物；唯一写入是本报告（主控产物）。

---

## 0. 裁决

**P0-FIX-R1：ACCEPT（带一项必须闭环的小条件）。**

- 三个指派缺陷的修复在**代码层 + 单元层 + 真浏览器层**均由本审查独立证实；
  R1-3 对派单机制归因的反驳（键位 effect 陈旧闭包才是主因）**成立**，我已对照基线代码
  独立证实；派单假设的窗口也确实被一并关闭，预裁决方向被落实而非推翻。
- 两个附带项（rename 谓词反转 high、施工方自引入的 id 空间分裂 high）均核实为真问题、
  修复正确；越界申报理由（(p) 硬阻断）成立。
- 门禁六项我本机顺序复跑全绿；四浏览器脚本我亲跑全绿（N1N4 24/24、A1 14/14、
  dialogs 13/13、F1F2 5/5 且 s2g=0/attempts=1）。
- **唯一条件**：lint 总数 +1 属实（1534 vs 1533），且回执 §6 的归因（radialPreview
  名额重分配）经我双 worktree JSON 对比证明为**错误归因**——实际 4 条新告警全部在
  本包自己新增的测试行上。需修掉这 4 条（均为测试文件、可自动修复级）并对回执归因
  出勘误；详见 §6 L-1。该项不阻塞功能验收结论，但**闭环前 P0 不得宣告收口**。

---

## 1. 基准锚定（实测）

| 项 | 回执声明 | 本审查实测 | 结果 |
|---|---|---|---|
| 收工 HEAD | `40a9842`（回执提交前）/ 现 HEAD `3f368c9` | 一致 | ✅ |
| `HEAD:packages` | `60eed459…` | `60eed45971185ed52ac8f59eec0401fb17efcad4` | ✅ |
| `HEAD:apps` | `8637cc23…` | `8637cc23f00538f3ea9f22aefe704e8a2c01316e` | ✅ |
| 工作树 | 空 | 空（含我跑完 build/浏览器后） | ✅ |
| 血缘 | e7ccefa→40a9842 线性 9 提交 | 线性无改写 | ✅ |
| packages delta | 15 文件（8 src + 6 test + index.ts） | name-status 一致，+880/-38 | ✅ |
| apps delta | 12 文件（6 src + 6 test） | 一致，+949/-52 | ✅ |

R1-1 拆两笔（`fa8d0a6` packages 增量、`237f0c7` apps 调用点）且中间态两侧签名一致，
已用 `git show` 抽查属实。

## 2. 三项指派缺陷的代码核验

### R1-1 N1-ID-COLLISION — 修复正确，且实现质量高于最低要求

- `assetTypes.ts`：`AssetStore` 下沉到该模块（断环，depcruise 0 违规佐证）、
  `AssetItem.origin?` 增量字段；注释明确「读侧标注、永不入库」。
- **持久化白名单**：`idbAssetHost.toRecordFields` 显式列字段替代 `{...item}`，
  并配「记录里没有 origin」用例——这是施工方实测发现 `{...item}` 会静默写 IDB 后的
  正确处理，比派单要求多防了一层。
- 复合键 `assetEntryKey = origin\u0000id`（`assetHost.ts`），三处共用：
  IDB/工作区清单合并、`AssetPanel.assetPanelKey`（卡片 key/去重/收藏）。
  旧宿主无 origin 时退化为裸 id，兼容面保留。
- **按来源路由**（核心修复点）：`WorkspaceAssetHost.resolveAssetState` 对
  `origin==='browser-idb'` 委托 fallback；`IdbAssetHost.resolveAssetState` 对声明
  browser-idb 却缓存 miss 的项返回 `unresolved/unavailable`，不再回落必然 404 的
  `baseUrl+id`；磁盘项才走 scope 缓存/`missing`。
- `SidePanels` 第三参 `alreadyInWorkspace = item.origin === 'workspace-assets'`，
  MindmapStage 透传；`storeOf` 先读 `item.origin`，前缀判据降为兜底。
- 文档语法零改动：refId 仍是 `assets/<rel>`，delta 内无解析语法改动。

### R1-2 N1-REOPEN-BROKEN（含 N4）— 修复正确，N4 第二根因属实

- `AssetHostV2.primeWorkspaceAsset?` 增量面；`WorkspaceAssetHost` 实现为
  读盘→objectURL→按当前 scope 登记，幂等（`ScopedObjectUrls.set` 自带 revoke）、
  无工作区/读失败返回 false 且 `assetInsert.writeNormalized` 不因此改判 refused。
- 渲染端 MindmapStage:2216 区域改接五态；MapView 增 ref 稳定化的
  `resolveAssetState` 透传；NodeG 的分支语义正确：
  `pending`→不占位不画断图；`unresolved`→保留 `✕ 资产缺失`占位且**不发起 404 加载**；
  `resolved`→正常出图；宿主未实现时逐字回落旧字符串契约。
- **N4 同根的补充定性我独立证实**：旧 `assetDiagnostics` 无条件拿 kind+id 查清单，
  `@draw:data:` 按 I-5 自包含、本就不在清单 → 每次插入内置图标挂一条 W-ASSET-MISSING
  （与渲染端画得出来自相矛盾）。修复加 `isSelfContainedRef` 跳过，并用对拍用例保证
  `assets/` 真缺失仍出诊断（口径未弱化）——这是派单未预见但符合同一原则的正确延伸。
- 两个重复清单 effect 合一为 `reloadAssetList`，写后显式复用；渲染路径无新增 I/O。

### R1-3 — 施工方对派单机制归因的反驳**成立**（我独立证实）

我用 `git show e7ccefa:apps/canvas/src/MindmapStage.tsx` 核对基线代码：

- 键位 effect 订阅在 `window.addEventListener('keydown')`，deps 确为 **`[controller]`**
  （eslint-disable 注释在）；effect 体内 `case 'save'` 直接 `void handleSave()`。
- `handleSave` 是 `useDocumentActions` 的 `useCallback`，deps 含 `doc`，其
  `guard: () => canWriteDoc(syncedSourceRef.current, doc.source)` 读**闭包捕获的**
  `doc.source`。
- 结论：effect 只在首渲染订阅一次 → Ctrl+S 永久调用**首版** handleSave →
  实时 syncedSourceRef 比陈旧 source → 必然不等。这是**确定性 5/5**，不是派单假设的
  提交间隙偶发。施工方的插桩时间线与该机制一致。派单所指的 setDoc→effect 窗口
  确实也存在，现被同一修复一并关闭。**反驳有效，且按「预裁决-实证反驳」机制在
  回执 §4 显式记录，程序合规。**

修复四点均核实：① save/open/new 三 handler 经 ref 进键位处理器；
② performApplyDoc 内同步 `buildEditable → reset → syncedSourceRef 置位`
（解析失败 fail-closed 置 null）；③ useDocumentSwitch effect 退化为视图职责 +
S2F 首挂补做分支，resetSourceRef 消费后即清；④ useAutoSave guard 改读 docSourceRef。
`canWriteDoc` 等值判据一字未放宽。

### 两个附带项

- **F1-RENAME-SPURIOUS-CONFLICT（越界 high）**：旧
  `taken !== name ? taken : uniqueCopyName(name, () => true)` 我逐字核到——
  空闲名走右支、谓词恒真 → 跑到上限 `… 999`。修复直接采用 `resolveCopyName`
  （其本身即保留两份求解器，directory-host 契约测试已钉），+3 单测。
  「不修则 F1F2 租约窗口不可达、(p) 无法验收」的越界理由成立，改动面仅一行生产代码。
- **id 空间分裂（自引入 high）**：`astToEditable` 每次 `newId()` 重建全树（已核
  treeOps），同步 reset 自 parse 一棵、渲染 useMemo 再 parse 一棵 → 按 id 的会话态
  失效。`parsedHandoffRef` 单解析交接的设计正确（同 source 取用即清、fail-closed
  分支不交接）；我定向复跑 `summary-two-hop-host` **14/14**、s2g-zero-window 5/5。

## 3. 门禁（本审查 2026-09-24 04:52–05:00 顺序复跑，机器 load 18.9）

| 门禁 | 结果（我实测） | 基线 | 判定 |
|---|---|---|---|
| budget | exit 0；any0/tsIgnore0/**bang 89**/asCast31/console4/todo1/defaultExport2/bigFiles4 | 八项零上升 | ✅ |
| kernel | **75/708**（19.35s） | 75/708 | ✅ |
| react | **162/1778**（133.8s） | 162/1748 | ✅ +30 |
| canvas | **58/673**（94.2s） | 57/653 | ✅ +1/+20 |
| doc-index | **75** | 75 | ✅ |
| gate:fast | exit 0；depcruise **604/1842/0 violations**；lint **611 files / 1534 / 48** | 1533/48/610 | ⚠️ 见 §6 L-1 |
| build | exit 0；`main-DMVIuY4l.js 515.56 kB`（与回执产物同名同大小） | exit 0 | ✅ |

高负载下全套一次过；回执登记的 benchmark-layout / frame-outline-host 负载敏感 flake
本轮未现（隔离稳定、与本包改动零重叠，定性维持）。

## 4. 真浏览器（本审查亲跑，非读归档）

当次 `vite build` → `vite preview:5175`（snapshotCheck 硬闸通过，页面实际加载
main-DMVIuY4l.js 与产物一致）：

| 脚本（我的日志） | 退出码 | 关键字段 |
|---|---|---|
| verify-n1n4-reopen | **0** | `a2BytesIsBlue=true`、reopen pixel `hex=#0000ff`、reopenedPixel `#0000ff`、reopenImages 非空、result PASS（24/24） |
| verify-a1-workspace-switch | **0** | result/pass PASS（14/14） |
| verify-no-native-dialogs | **0** | PASS（13/13） |
| verify-f1f2-browser ×5 | **0×5** | 每份显式 `s2gBlockedTimes: 0`、`durableAttempts: 1`、`s2gBlocked:false`、`renamedTo:"f1-renamed.mm.md"` |

f1f2 脚本的探测修正（8s 空等→300ms 短探）我核过 diff：旧等待确实在等一个只由
rename 假冲突才会出现的框，8s 又必然吃掉 5s 租约窗口使 F1③.5 成假判据；修正是对的。
P0-C 的 FAIL 证据原样保留，前后对照成立。

## 5. 负控（五条）

- 5 份归档全部含 `red_exit_code=1`；变异对象均为生产代码；落盘计数
  `nc_marker_count=1`；cwd 按包路由；还原用备份+cmp+sha256（禁 git checkout）。
- 我额外核：当前 `MindmapStage.tsx` sha256 =
  `c8aa803c32aa44d6f2c54fb5828b51b00bd3baea3e13b54e48d3aefd670e7318`，
  与 NC-R1-3b 还原值逐字节一致；`grep -rn "NC-R1" packages/react/src apps/canvas/src`
  零残留。
- 抽读 NC-R1-3b 全文：键位改回直接闭包 → stage-render:109 转红 1/6、还原回 6/6，
  判别真实。
- 收口后因锚点失配重跑 NC-R1-3 的纪律执行有记录（§5 第 6 条），符合「未落盘即无效」。

## 6. 发现（分级）

| # | 发现 | 级别 | 处置（裁决） |
|---|---|---|---|
| L-1 | **lint +1 的归因不实且告警在本包新增代码上**。我建 e7ccefa 临时 worktree 双树跑 biome JSON 做多集合对比：`radialPreview.tsx` **零变化**；真实差异为——本包新增测试行带来 4 条：`stage-render.test.tsx:18` 未用导入 `fireEvent`（FIXABLE）、`asset-broken.test.tsx:98`、`asset-diagnostics.test.ts:81`、`nodeg-asset.test.tsx:270` 各 +1 noNonNullAssertion；MindmapStage 因 ref 修复**消掉** 3 条 useExhaustiveDependencies（39→36）。规则级实测：noUnusedImports 26→27、noNonNullAssertion 1394→1397、useExhaustiveDeps 39→36，净 **+1**。回执 §6 所称「radialPreview 名额重分配、改动文件各自零新增、规则 tally 6→5/4→5」与实测三个方向都对不上 | low（问题本身，测试-only 可自动修）+ 回执归因错误需勘误 | **必修闭环**：删 1 个未用导入、消 3 个测试 `!`（改显式判空），使 lint 回到 ≤1533；同时对回执 §6 出勘误更正归因。预算脚本只计生产 src，故 budget 不受影响——但派单 §八「lint 只降不升」字面被突破，不得用错误归因带过 |
| L-2 | MindmapStage 净 +70 行（3150→3220），未达派单「近持平」软约束；bigFiles 仍 4/4 未破预算，构成中注释占大头已如实拆解 | low | 接受（软约束已如实上报、未辩护为持平）；P1 接线批次注意该文件持续膨胀 |
| L-3 | `summary-two-hop-host` 固定 `tick()` 竞速在基线负载下亦偶发（1/12），施工方未改写他人用例换绿 | low | 接受；登记为既有测试脆弱性，P1 择机把固定 tick 改确定性等待 |
| L-4 | stage-render 测试 stderr 有 React「Cannot update a component while rendering a different component」告警（NC 日志的基线/回绿段都在） | low（信息） | 既有现象（基线即有），非本包引入；建议 P1 排查渲染期跨组件 setState |
| L-5 | 真 OS FS / 系统选择器 / 跨刷新 IDB / F1③.1 文案 / F2.3 / 第⑤条 / 跨浏览器仍 unconfirmed | 信息 | 回执 §8 已如实；跨刷新 IDB 旅程建议列入 P1 图库批次的探明项 |

## 7. 收口判据（主控结论）

1. 功能与质量：**通过**（三指派 + 两附带，代码/单测/真机三证齐备，负控有分辨力）。
2. P0 宣告整体收口前的剩余动作：
   (a) **L-1 必修**：4 条测试 lint 清零 + 回执 §6 勘误（建议同一小批，复核只看
       lint 回到 ≤1533 与四文件 diff）；
   (b) P0-C ② 容器一致化跟手项仍悬置（P1-A 启动前并入）；
   (c) kernel 负载敏感 flake 根因未定位（不阻塞，但 P1 期间再遇须按刻画纪律记录）。
3. 位次：完成 (a) 后可开 P0 整体收口评审 → P1-A；N1 两缺陷已先于 P1-B 清除，
   P1-B 的资产身份前提成立。

## 8. 复核声明

- 未修改任何施工产物；临时 worktree（/tmp/r1-base-wt）用后已移除；preview 服务已停。
- 浏览器结论取自我本机 2026-09-24 05:00 后当次 build 的实跑 JSON/退出码，
  与归档证据相互独立、结论一致。
- 未运行项：真实 OS FS、跨刷新 IDB、Firefox/Safari（沿用回执 §8 未覆盖口径）。
