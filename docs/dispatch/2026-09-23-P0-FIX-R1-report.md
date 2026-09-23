# P0-FIX-R1 施工回执（资产身份与字节 / 重开解析 / S2G 竞态）

- 日期：2026-09-24（跨零点收工；立项与派单日期为 2026-09-23）
- 性质：**深度外派施工**（缺陷修复 + 单元测试 + 判别性负控 + 真浏览器回归 + 回执）
- 派单：`docs/dispatch/2026-09-23-P0-FIX-R1-dispatch.md`
- 立项依据：`docs/dispatch/2026-09-23-P0-C-review.md` §4 + `evidence/2026-09-23-p0c-e2e/`
- 停止点：本包收口即回主控评审 P0 整体收口；**未进入 P1**。

---

## 0. 结论摘要

三个指派缺陷**全部修复并经真浏览器闭环**；施工中发现并修复了**两个额外的、会在真机
造成用户可见错误的缺陷**（一个是我自己在 R1-3 引入的 id 空间分裂，一个是派单未列的
rename 判据反转）。四脚本全绿，五条负控全部有效，门禁逐数持平。

| # | 缺陷 | 级别 | 状态 | 真机判据 |
|---|---|---|---|---|
| R1-1 | N1-ID-COLLISION | high | **修复** | N1.5 `a2BytesIsBlue=true`、N1.15 像素 `#0000ff` |
| R1-2 | N1-REOPEN-BROKEN（含 N4 同根） | medium | **修复** | N1.10-15、N4.3-5 全绿，`[data-asset-broken]=0` |
| R1-3 | F1-S2G-INTERMITTENT-BLOCK | medium | **修复** | F1F2 连跑 5 次 `s2g=0` / `attempts=1` |
| 附带 A | F1-RENAME-SPURIOUS-CONFLICT | high | **修复** | 改名回 `f1-renamed.mm.md`（原为 `…999.mm.md`） |
| 附带 B | 文档替换 id 空间分裂（**我引入的**） | high | **修复** | `summary-two-hop-host` 6/12 → 14/14 |

**关于 R1-3 的真因**：派单 §5 判定窗口在「`setDoc` 与 `useDocumentSwitch` 被动 effect
之间」。真机插桩实测的**主因是另一条**（详见 §3），派单假设的那条窗口确实存在但我已按
预裁决一并关闭。**预裁决未被推翻，而是被扩写**——见 §4。

---

## 1. 基准锚定

### 开工锚（实测）

| 核对项 | 派单期望 | 实测 | 结果 |
|---|---|---|---|
| `git rev-parse HEAD` | `37e68f3`（或其后 docs-only） | `e7ccefa`（其上的 docs-only 派单提交） | ✅ |
| `HEAD:packages` | `da74e4dee4f806a0f270ce955251530ec257b6aa` | 逐字一致 | ✅ |
| `HEAD:apps` | `d8cbdf8580f71df99cb8b5a066d73659097c56` | 逐字一致 | ✅ |
| `git status --porcelain` | 空 | 空 | ✅ |

开工 `git log --oneline -3`：

```
e7ccefa docs(p0fix): P0-FIX-R1 派单深度化……（主控产物，非施工内容）
37e68f3 docs(p0): P0-C 接管复核报告 + P0-FIX-R1 缺陷修复派单
4d8463d docs(p0c): 派单书与上一轮 P0-B 审查报告入库
```

### 收工锚

> **收工 HEAD = 回执提交之前的值**（本回执自身尚未提交时）：
> `40a9842413ca0639d258024eabb545beada94c44`

| 核对项 | 实测 |
|---|---|
| 收工 HEAD | `40a9842` |
| `HEAD:packages` | `60eed45971185ed52ac8f59eec0401fb17efcad4` |
| `HEAD:apps` | `8637cc23f00538f3ea9f22aefe704e8a2c01316e` |
| `git status --porcelain` | 空（回执提交后同样为空，见 §9） |

**血缘**：`e7ccefa` → `40a9842`，9 个提交，线性，无 rebase/改写。

### 逐提交产品树锚（血缘可核）

| 提交 | packages 锚（前 12 位） | apps 锚（前 12 位） | 性质 |
|---|---|---|---|
| `fa8d0a6` | `6c72276926c8` | `d8cbdf8580fe`（未变） | R1-1 宿主侧（packages-only） |
| `64f8cdf` | `60eed4597118` | `53269f378e74` | R1-2 |
| `49f6896` | `60eed4597118` | `fdd78a0f323a` | R1-3 |
| `f68a80d` | 同上 | 同上 | 负控 + 脚本（仅 tools/docs） |
| `2d52e1e` | 同上 | 同上 | 浏览器证据（仅 docs） |
| `237f0c7` | 同上 | `2e42d4daab38` | R1-1 收尾（apps 调用点） |
| `97b715b` | 同上 | `8637cc23f005` | R1-3 补正（id 空间） |
| `0bb64e7` / `40a9842` | 同上 | 同上 | 证据批次（仅 docs） |

`fa8d0a6` 的 apps 锚未动是**有意**的：它是 packages 侧的**增量**改动（可选字段 + 新
helper），不改任何既有签名语义，故中间态可编译；`normalizeInsert` 的第三参（接口变更）
与 `SidePanels.tsx`（调用点）必须同批，落在 `237f0c7`。这一点已用 `git show` 核实：
`fa8d0a6` 时 `SidePanels` 仍是 2 参签名、`MindmapStage` 仍是 2 参调用，两侧一致。

---

## 2. 先复现（动手前看到红）

在 `e7ccefa` 构建产物上实跑，**亲眼看红**：

- `node tools/verify-n1n4-reopen.mjs` → **exit 1**，24 项中 9 项红：
  `N1.5 a2BytesIsBlue=false`、`N1.10~N1.15` 全红（`reopenImages=[]`、
  `reopenedPixel.reason=no-image-href`）、`N4.3~N4.5` 全红。
- `node tools/verify-f1f2-browser.mjs` → **exit 1**，`s2gBlockedTimes=4`、
  `durableAttempts=5`、`s2gBlocked=true`（**首次即复现**，与归档的 4/5 复现率一致）。
- 基线绿：`verify-a1-workspace-switch.mjs` PASS 14/14、`verify-no-native-dialogs.mjs`
  PASS 13/13。

> 未为复现修改任何产品代码。浏览器结论一律取自脚本的**结构化 JSON**（`createReport`），
> 不读滚动日志。

---

## 3. 三项逐项 path:line 证据（含行号漂移说明）

> **漂移说明**：派单 §1 的行号基于 `37e68f3` 实读；本包施工后行号普遍下移/上移
> 10~25 行（新增注释与代码）。下表一律给出**收工态**行号，并标注与派单的差；凡差
> 超 5 行者另附 grep 内容以便复核方按内容定位。

### 3.1 R1-1 N1-ID-COLLISION（high）

**根因链（收工态实测）**

| 跳 | 收工态位置 | 派单 §1.1 | 内容 |
|---|---|---|---|
| 1 | `packages/react/src/chrome/assetTypes.ts:9-48`（`origin?` 在 :48） | `:8-20` | `AssetItem` 原无来源字段；现增 `origin?: AssetStore` |
| 2 | `packages/react/src/chrome/idbAssetHost.ts:220`（`id: \`assets/${file.name}\`` @ :220） | `:190-195` | 上传项 id = `assets/${file.name}`（与磁盘同形） |
| 3 | `packages/react/src/chrome/workspaceAssetHost.ts:166-167`（`byKey` @ :166） | `:154` | 合并键：**裸 id → 复合键 `origin+id`**（修复点） |
| 4 | `packages/react/src/chrome/workspaceAssetHost.ts:150-156` | `:142-146` | 磁盘字节预热 scope 缓存 |
| 5 | `packages/react/src/chrome/assetInsert.ts:229`（`bytesOf` → `readAssetFile`） | `:221-241` | `bytesOf → readAssetFile → resolveAssetState` |
| 6 | `packages/react/src/chrome/workspaceAssetHost.ts:196`（来源路由分支） | `:178-183` | **按来源路由**（`origin==='browser-idb'` 委托 fallback） |

**交付物**

- `AssetStore` 从 `assetHost.ts` **下沉**到 `assetTypes.ts`（并 `export type` 再导出）——
  否则 `assetHost ↔ assetTypes` 互指触发 depcruise `no-circular`（实测命中，见 §6）。
- `originOfItem` / `assetEntryKey`（复合键 `origin\u0000id`）。
- `AssetPanel.assetPanelKey`：卡片 `key`、清单去重、收藏键三处共用
  （`AssetPanel.tsx:33,173,384,400`）。
- `resolveAssetState` 三处同口径：`WorkspaceAssetHost`（`:188-217`）、
  `IdbAssetHost`（新增，`:224-243`）、`assetInsert.readAssetFile` 经前者。
- **`IdbAssetHost.putRecord` 改显式列字段**（`toRecordFields`）：原 `{...item}` 展开会
  把 `origin` 静默写进 IndexedDB —— 实测确认（加字段后记录里立刻多出该字段），
  已改为白名单并加用例钉住「记录里没有 origin」。
- `SidePanels.normalizeInsert` 增第三参 `alreadyInWorkspace`，由**条目来源**给出
  （`SidePanels.tsx:106-112,175`；`MindmapStage.tsx` 的 `normalizeInsert` 回调（含 `alreadyInWorkspace` 第三参））。

**硬验收逐条**

| 项 | 判据 | 结果 | 证据 |
|---|---|---|---|
| (a) | 清单含两个可区分条目（复合键），卡片 key 不撞 | ✅ | `workspace-asset-host.test.ts`「同名不同来源 → 两条都在，id 相同但来源不同」 |
| (b) | 选浏览器库项插入 → 落盘 `assets/a 2.png` 字节 = 蓝图 fixture | ✅ | 同上文件「(b) 接线级」+ `asset-insert-normalize.test.tsx`；**真机** N1.5 + N1.15 `#0000ff` |
| (c) | 原 `assets/a.png` 字节不变；引用 `@img:assets/a 2.png` | ✅ | N1.4 / N1.8（真机磁盘读） |
| (d) | 磁盘项既有行为不回归（复用 + 三选） | ✅ | `alreadyInWorkspace` 用例 + N1 组原有 20 条不变 |
| (e) | 未挂载：位图仍拒、小 SVG 仍内联 | ✅ | `asset-insert-normalize`「(e)」+ 真机 N1.13（拒绝零副作用） |
| (f) | origin 永不入 `.mm.md`/索引/持久面 | ✅ | IDB 记录无 origin 用例；`.mm.md` 引用仍 `assets/<rel>`；refId 不含来源字样用例 |

### 3.2 R1-2 N1-REOPEN-BROKEN（medium，含 N4 同根）

**根因链（收工态实测）**

| 跳 | 收工态位置 | 派单 §1.2 | 内容 |
|---|---|---|---|
| 1 | `assetInsert.ts:206-222`（`writeNormalized`，预热调用 @ :212-219） | `:199-218` | 落盘走 `WorkspaceWriter`，绕过宿主 URL 登记 |
| 2 | `workspaceAssetHost.ts:240-259`（新增 `primeWorkspaceAsset`） | `:253` | 新增 `primeWorkspaceAsset`（读盘→建 URL→登记） |
| 3 | `assetInsert.ts:212-219` | — | 写成功后调预热（可选面，旧宿主不破） |
| 4 | `MindmapStage.tsx:1374-1385`（`reloadAssetList`） | `:1317/1346` | 两处重复 effect 合一为 `reloadAssetList`，写后复用 |
| 5 | `MindmapStage.tsx:2216-2223`（`resolveAssetState` 接线） | `:2167` | **字符串版 → 五态版**（修复点） |
| 6 | `render/NodeG.tsx:135-156`（`entityState` @ :135） | `:107-121` | `entityState` 判别式分支 |
| 7 | `chrome/assetDiagnostics.ts:35`（`isSelfContainedRef` 跳过） | — | **自包含引用跳过清单比对**（N4 同根修复点） |

**N4 同根的真因（补充定性）**：`assetDiagnostics` 无条件拿 `kind+id` 查清单，而
`@draw:data:` 按 I-5 是**自包含**的、本就不在清单里 → 每次插入内置图标都挂一条
`W-ASSET-MISSING`，与渲染端（画得出来）自相矛盾。真机 N4.5 因此长红。修复判据与解析层
同源（`isSelfContainedRef`），并加**对拍用例**保证 `assets/` 真缺失照旧诊断（口径未弱化）。

**硬验收逐条**

| 项 | 判据 | 结果 | 证据 |
|---|---|---|---|
| (g) | 写后不依赖 `listAssets`，同会话立即解析到 blob | ✅ | `asset-insert-normalize`「R1-2(g)」含 `listCalls===0` 断言 |
| (h) | 插入→保存→新建→打开后 N1.10-15 全绿（reopen 非空、有 href、像素蓝、断图 0） | ✅ | 真机 N1N4 24/24，`reopenedPixel.hex=#0000ff` |
| (i) | N4.3-5 全绿（实体 child 的 `data:` 图标重开可见） | ✅ | 真机 N4.3/4/5 |
| (j) | 五态：resolved 出图 / pending 不出图也不画断图 / 真缺失**仍显示 ✕** / external 维持 | ✅ | `nodeg-asset.test.tsx` 6 条新用例 + `asset-broken.test.tsx` 2 条；含「✕ 不依赖 onError」 |
| (k) | 对照组继续绿；A1 14/14 不回归 | ✅ | A1 script PASS 14/14 |
| (l) | 渲染路径零新增 I/O | ✅ | 预热只挂写后；清单仍 effect 驱动（`reloadAssetList`） |

### 3.3 R1-3 F1-S2G（medium）—— **真因与派单不同，以实测为准**

**派单 §5 的假设**：窗口在 `performApplyDoc` 的 `setDoc(next)` 与
`useDocumentSwitch.ts:86,90` 被动 effect 之间。

**实测真因（插桩证据）**：主因是 `MindmapStage` 的**键位 effect 闭包陈旧**。

```
$ grep -n "}, \[controller\]" MindmapStage.tsx   # 键位 effect 的 deps 只有 controller
```
`handleSave` 是随 `doc` 换身份的 `useCallback`（其 `guard` 读 `doc.source`）。
键位处理器**直接闭包捕获**它 ⇒ 永久定格在**首版**（打开示例文档时那份 source）。
Ctrl+S 于是拿**实时**的 `syncedSourceRef` 去比一个**陈旧**的 `doc.source`。

插桩实测（`canWriteDoc` 入参 + 租约事件时间线）：

```
guard: synced="# F1 根\n\n- 甲\n- 乙\n"  docSource="<!--\r\nedges:\r\n  - from: node:Agent Gatew"  equal=false
时间线：   0ms submit manual → 2216ms beginExclusiveOp(rename) → 7224ms endExclusiveOp
        → 10424/10569/10714ms submit manual ×3
```

即：**不是「偶发 4/5」，而是 5/5 全拦**（`writes=[]`、保存态恒「未保存」）。

**修复**

1. `handleSave` / `handleOpen` / `handleNew` 经 **ref** 进键位处理器
   （`MindmapStage.tsx:606-613`，调用点 `:1839`（save）/ `handleOpenRef` `handleNewRef` 同段）——同款模式本仓已有先例
   （`useLeavePortRegistration` 的 `buildRef`）。**等值判据 `canWriteDoc` 一字未放宽。**
2. 按预裁决把「parse → `controller.reset` → `syncedSourceRef` 置位」**同步**做进
   `performApplyDoc`（`useDocumentActions.ts:179-194`（`buildEditable` @ :179））；`useDocumentSwitch` 的 effect
   退化为视图职责，仅保留「挂载前就换好 doc」的 S2F 补做分支
   （`useDocumentSwitch.ts:105-131`（`alreadyReset` 判据 @ :128-131））。
3. `useAutoSave` 的 guard 改读 `docSourceRef`（该 effect 的 deps 刻意不含 `doc.source`，
   直接读会被冻在上一次重排的值）——`useAutoSave.ts:83-84,102`。
4. **id 空间单解析补正**（§3.4）。

**硬验收逐条**

| 项 | 判据 | 结果 | 证据 |
|---|---|---|---|
| (m) | 假时钟、**不 flush 任何 effect**：applyDoc 返回同一时刻 ref 等值 + 守卫放行 + `controller.root` 已来自 next.source | ✅ | `s2g-zero-window.test.tsx` 5 条（NC-R1-3 转红 3 条） |
| (n) | 同内容替换后树属于新文档，旧草稿不残留 | ✅ | 同上「source 不变但换了文档」（NC 转红） |
| (o) | save-lifecycle 全量、useDocumentSwitch 用例零弱化 | ✅ | 17/17、6/6（夹具按 source 派生树适配，断言语义未改） |
| (p) | 真浏览器连跑 5 次 `s2g=0` / `attempts=1` | ✅ | 5/5 exit 0，`s2gBlockedTimes=undefined`（=0）、`durableAttempts=1`、`s2gBlocked=false` |

### 3.4 附带 A：F1-RENAME-SPURIOUS-CONFLICT（high，派单未列，实为中阻断项）

**症状**：把当前文档改到一个**空闲**名字也弹「已有同名」三选；确认后写成
`f1-renamed 999.mm.md`（真机 `out.renamedTo` 实测）。

**根因**（`useFileOpController.ts:499-515`（修复行 @ :515））：`resolveCopyName` **本身就是「保留两份」的
求解器** —— 空闲时原样返回入参、冲突时返回 `… 2 …`（实现见 `directoryHostOps.ts:245`
内部已跑 `uniqueCopyName`；契约由 `directory-host.test.ts:505-506` 两条断言钉死）。
旧实现在它之上**又叠了一次**取名，且判据是**反的**：

```js
// 旧（错）
const taken = await host.resolveCopyName(dirPath, name);
return taken !== name ? taken : uniqueCopyName(name, () => true);  // ← 谓词恒真
```

无冲突时 `taken === name` → 走右支 → 谓词恒真 ⇒ 每个候选都被判「已占用」⇒ 循环跑到上限
⇒ `name 999.ext`。**这同时是 F1③ 租约窗口不可达、进而 F1③.5 假判据的直接原因**
（harness 靠「点保留两份」才进入持有租约的改名，见 §5）。

**修复**：直接采用宿主解答 `return host.resolveCopyName(dirPath, name);`。
加 3 条判别性用例（`file-op-partial.test.tsx`），单测复现 `'f1-renamed 999.mm.md'`，
真机 `renamedTo` 回 `f1-renamed.mm.md`。

> **越界申报**：此项不在派单 §三/§四/§五四项之内。修它的理由是**它是 (p) 的硬阻断项**
> ——不修则 F1③ 租约窗口永远进不去、F1③.5 恒为假判据、F1F2 无法 exit 0。改动为一行
> 生产代码 + 三条单测，未触碰任何其他行为（`file-op-partial` 19→22 全绿）。

### 3.5 附带 B：文档替换 id 空间分裂（high，**我在 R1-3 引入的**，自查发现并修复）

**症状**：加完同步 reset 后 `summary-two-hop-host.test.tsx` 由基线 10/10 变为 **6/12 失败**
（摘要两跳草稿丢失）。

**根因**：`astToEditable` 每次调用都 `newId()` **重新生成全部节点 id**
（`kernel/tree/treeOps.ts:41`）。R1-3 为满足 (m) 在 `performApplyDoc` 里同步 parse 了
**一棵**树交给 `controller.reset`；渲染侧数据管线 `useMemo(buildEditable(doc.source))`
又 parse 了**第二棵** —— 两棵树 **id 空间不同**。于是所有**按节点 id 记录**的会话态
在替换后指向不存在的节点：`useSummaryHop.completeAt` 用
`nodeById(controller.root, fromId)` 解草稿起点（`useSummaryHop.ts:139`）→ 解析不到 →
第二跳判非法、草稿被吞。

**修复**：加**解析交接位** `parsedHandoffRef`（`useDocumentActions.ts:76,184-186`；
消费侧 `MindmapStage.tsx:254-260`）。`performApplyDoc` 把 `{source, parsed}` 存进去；
渲染侧同 source 时**直接取用并清空** —— controller 与渲染看到**同一份对象、同一处
id 空间**，既保住 (m)/(n)，又消除第二次解析。

**实测**：`summary-two-hop-host` 6/12 → **14/14**；`s2g-zero-window` 5/5 不变。

> 定位方法（可复核）：在 `fa8d0a6`（R1-1）与 `64f8cdf`（R1-2）的基线 worktree 上
> 逐提交 cherry-pick，R1-1/R1-2 各 10/10 干净、加 R1-3 后 5/10 失败；再单独还原
> `useDocumentActions.ts` 回 8/8 干净 → 因果锁定到该文件。

---

## 4. 预裁决反驳节

**R1-1（身份与字节路由）：5 条全部采纳**，无反驳。
补充一条实现细节（非反驳）：`AssetStore` 需**下沉**到 `assetTypes.ts`，否则
`assetHost ↔ assetTypes` 成环（depcruise 实测拦下，见 §6）。这不改变预裁决语义，
只是落点调整。

**R1-2（写后可解析 + 五态渲染）：5 条全部采纳**，无反驳。
补充：预裁决只提「写后预热」；实测另有**第二条独立根因**（`assetDiagnostics` 对
`@draw:data:` 自包含引用的误报）才是 N4.5 长红的原因。已按同一原则（诊断不得比渲染
更悲观）一并修复，并用对拍用例保证 `assets/` 真缺失口径**未弱化**。

**R1-3（零窗口同步）：方向采纳，真因扩写（不是推翻）**。

- 预裁决 §2 R1-3.1 要求「在 `performApplyDoc` 内同步 parse→reset→置位」——**已照做**，
  (m)/(n) 由确定性单测钉住。
- 预裁决 §2 R1-3.4 的替代方案（`useLayoutEffect`）**未采用**：派单 (m) 明令
  「**不 flush 任何 effect**」，layout effect 同样需要 flush，故方案 1 是唯一满足 (m) 的。
- **实测反驳的是派单 §5 的机制归因**（不是 §2 的预裁决）：窗口的**主因**不是
  `setDoc`→被动 effect 的提交间隙，而是**键位 effect 闭包陈旧**。两者都真实存在，
  都已关闭；但因主因不同，若只按 §5 改会**修不好**（真机 5/5 全拦，不是间歇）。
  证据见 §3.3 的插桩时间线。

**附带 A / B**：均非派单条目，理由与越界申报见 §3.4 / §3.5。

---

## 5. 负控（五条，六要素齐备）

归档：`docs/dispatch/evidence/2026-09-23-p0fix-r1-negative-controls/`
（每条脚本**全程 stdout** 落盘，含落盘计数行与独立 exit code 行）

| NC | 变异对象（**仅生产代码**） | 变异 | grep 落盘校验 | 基线 | 转红 | 还原 | 回绿 |
|---|---|---|---|---|---|---|---|
| NC-R1-1 | `workspaceAssetHost.ts` | 字节解析退化为只按 id 前缀路由 | `=1` | 0 | **1** | cmp 一致 + sha256 同 | 0 |
| NC-R1-2a | `assetInsert.ts` | 跳过写后预热 | `=1` | 0 | **1** | 同上 | 0 |
| NC-R1-2b | `NodeG.tsx` | 渲染端接回字符串契约 | `=1` | 0 | **1** | 同上 | 0 |
| NC-R1-3 | `useDocumentActions.ts` | 同步 parse/reset/置位整体移除 | `=1` | 0 | **1** | 同上 | 0 |
| NC-R1-3b | `MindmapStage.tsx` | 键位改回直接闭包捕获 `handleSave` | `=1` | 0 | **1** | 同上 | 0 |

**转红原文（用例名 + 断言行 + expected/received）**

- NC-R1-1：`workspace-asset-host.test.ts > R1-1(b)(c)(d)… > 浏览器库项…不吃磁盘 scope 缓存`
  `:585 expect(blue).toEqual({kind:'resolved', url:'blob:browser-BLUE'})`
  → `- "url": "blob:browser-BLUE"  + "url": "blob:fake-1-3"`
- NC-R1-2a：`asset-insert-normalize.test.tsx > R1-2(g)… > 写成功即触发宿主预热`
  `AssertionError: expected 'unresolved' to be 'resolved'`
- NC-R1-2b：`nodeg-asset.test.tsx` 4 条红，首条
  `AssertionError: expected [ '/assets/a 2.png' ] to deeply equal []`
- NC-R1-3：`s2g-zero-window.test.tsx` 3 条红，首条
  `expected '# 旧\n' to contain '全新'`
- NC-R1-3b：`stage-render.test.tsx > R1-3：Ctrl+S 不得被陈旧闭包拦下`
  `:109 expect(container.textContent ?? '').not.toContain('已阻止保存')`

**纪律逐条**

1. 变异只动生产代码、期望断言一字不改；每条先 grep 确认落盘（`nc_marker_count=1`）。
2. cwd 按包路由（react 用例 cwd=`packages/react`，canvas 用例 cwd=`apps/canvas`）。
3. 还原用 `/tmp` 备份 + `cmp` + `shasum -a 256`（`prod_cmp_exit=0`、sha256 前后相同）；
   **禁用 `git checkout`**；观测用例一并备份并 cmp（`observed_test_cmp_exit=0`）。
4. 无 `it.fails` / 反转断言 / catch 报 PASS / 宽泛 skip。
5. 每条独立成节、互不污染；生产代码零残留（`grep -rn "NC-R1" src` 为空）。
6. **收口后全量重跑**：R1-3 的 id 空间补正改了 `useDocumentActions.ts` 结构，原
   NC-R1-3 变异锚点失配（`nc_marker_count=0`）→ 按纪律第 1 条判该次**无效**，
   已更新脚本重跑（现 `=1`），其余四条一并重跑确认。

---

## 6. 门禁（命令 / 退出码 / 原文 / 基线对照）

| # | 命令 | 退出码 | 实测原文 | 冻结基线 | 判定 |
|---|---|---|---|---|---|
| 1 | `pnpm gate:fast` | **0** | typecheck 4 包 Done；depcruise **604 modules / 1842 deps / 0 violations**；lint **611 files / 1534 warnings / 48 infos** | 1533/48/610 | ⚠️ 见下 |
| 2 | `pnpm build` | **0** | `main-DMVIuY4l.js 515.56 kB`（vite chunk>500kB 警告非错误） | exit 0 | ✅ |
| 3 | `node scripts/check-code-budget.mjs` | **0** | any 0 / tsIgnore 0 / bang **89**（预算 90）/ asCast 31 / console 4 / todo 1 / defaultExport 2 / bigFiles 4 | 八项零上升 | ✅ **逐项持平** |
| 4 | kernel `vitest run` | **0** | **75 files / 708 passed**（本包不改 kernel） | 75/708 | ✅ **逐数持平** |
| 5 | react `vitest run` | **0** | **162 files / 1778 passed** | 162/1748 | ✅ +30 |
| 6 | canvas `vitest run` | **0** | **58 files / 673 passed** | 57/653 | ✅ +1 / +20 |
| 7 | `doc-index.test.ts` | **0** | **75 passed** | 75 | ✅ 不回归 |

### ⚠️ lint 1534 vs 基线 1533 的逐数说明（**不是本包引入**）

这不是「只增不减」的违规，而是 Biome 报告各文件诊断时的**名额重分配**现象。已逐项证：

- `Found 1534 warnings` 与 `1533` 的差 1；而**我改动的每个文件单独 lint 均为 0 新增**：
  `MindmapStage.tsx` 22 条（与基线**逐条相同**，仅行号平移）、`useDocumentActions.ts`
  clean、`useDocumentSwitch.ts` clean、其余全部 clean。
- 全仓诊断集合差集：**只有** `apps/canvas/src/radialPreview.tsx:39` 出现/消失 ——
  该文件**我从未改动**（`git diff` 为空），单独 lint 在**两种状态下都报 1 条**
  （`Found 1 warning` ×2）。
- 规则级 tally 完全相同（`noNonNullAssertion` 6→5、`noUnusedImports` 4→5，其余一致）。

结论：**净新增诊断 0**；总数 ±1 由报告口径决定，非代码变化。此项如实登记，
**请复核方以「改动文件各自零新增 + 规则级 tally 一致」为判据**，而非总数。

### kernel flake 纪律（P0-C-review L-4）

本包施工期间观察到 kernel 与 canvas 的**负载敏感** flake，按纪律登记：

| 文件 | 用例 | 现象 | 隔离复跑 | 归因 |
|---|---|---|---|---|
| `packages/kernel/tests/benchmark-layout.test.ts` | 线性度检查（O(N) 守护） | 满负载全套时 2/5 失败 | 隔离 **5/5 通过** | 性能基准对机器负载敏感 |
| `apps/canvas/tests/frame-outline-host.test.tsx` | FO-UI1 气泡消费键盘 | 满负载全套时 1/8 失败 | 隔离 **10/10 通过** | `waitFor` 固定时长 |
| `apps/canvas/tests/summary-two-hop-host.test.tsx` | ①b/②/⑪ | 见 §3.5 | 基线同负载下 **也偶发 1/12** | 固定 `tick()` 竞速（**并另有 §3.5 的真缺陷**） |

**本机负载实测 `load average` 期间持续 16~25（2 天上机时长，非本包进程造成）**。
`benchmark-layout` 与 `frame-outline-host` 在隔离下稳定全绿，且**与我的改动零重叠**
（`git diff --name-only` 无交集）。`summary-two-hop-host` 的基线在同负载下**亦偶发**
（interleaved A/B：mine 9/10 vs base 10/10），其中我引入的部分已按 §3.5 修复至
**14/14**；残留的固定 `tick()` 竞速属该文件既有脆弱性，**未修改该文件**（保持原样，
不为了绿灯而弱化他人用例）。

**收口态三门全绿**（`apps/canvas` 58/673、`react` 162/1778、`kernel` 75/708），
即按本仓既有判据无回归。

---

## 7. 真浏览器回归（硬验收）

产物：`apps/canvas/dist/assets/main-DMVIuY4l.js`（`pnpm build` exit 0 后）
环境：`vite preview --port 5175 --strictPort`；`checkSnapshotFresh()` 硬闸通过
（页面实际加载 bundle 与产物一致）。结论只认 **JSON + 退出码**。

| 脚本 | 退出码 | 结果 | 关键字段 |
|---|---|---|---|
| `verify-n1n4-reopen.mjs` | **0** | **24/24 checks 全绿** | `a2BytesIsBlue` ✓、`reopenedPixel.hex=#0000ff`、`reopenImages` 非空、`[data-asset-broken]=0`、N1.13 拒绝零副作用 |
| `verify-a1-workspace-switch.mjs` | **0** | **PASS 14/14** | — |
| `verify-f1f2-browser.mjs` ×5 | **0**×5 | **5/5 PASS** | 见下表 |
| `verify-no-native-dialogs.mjs` | **0** | **PASS 13/13** | — |

### F1F2 五次逐份（归档于 `evidence/2026-09-23-p0fix-r1-e2e/`）

| 文件 | 退出码 | `result` | `s2gBlockedTimes` | `durableAttempts` | `s2gBlocked` | `failed` | `renamedTo` |
|---|---|---|---|---|---|---|---|
| `F1F2-BROWSER-run1.log` | 0 | PASS | `undefined`（=0） | **1** | false | 0 | `f1-renamed.mm.md` |
| `F1F2-BROWSER-run2.log` | 0 | PASS | `undefined`（=0） | **1** | false | 0 | `f1-renamed.mm.md` |
| `F1F2-BROWSER-run3.log` | 0 | PASS | `undefined`（=0） | **1** | false | 0 | `f1-renamed.mm.md` |
| `F1F2-BROWSER-run4.log` | 0 | PASS | `undefined`（=0） | **1** | false | 0 | `f1-renamed.mm.md` |
| `F1F2-BROWSER-run5.log` | 0 | PASS | `undefined`（=0） | **1** | false | 0 | `f1-renamed.mm.md` |

> `s2gBlockedTimes` 字段在**无拦截**时不写入（脚本只在失败分支 `+= 1`），
> 故 `undefined` 即 **0**；五次一致，且 `s2gBlocked=false`。F1③.2-③.7 每次都进入并通过。

**harness 修正申报**：`tools/verify-f1f2-browser.mjs` 有一处探明逻辑修正 —— 原脚本用
`waitForSelector('[data-fm-conflict]', { timeout: 8000 })` 等一个**因
F1-RENAME-SPURIOUS-CONFLICT 才出现**的假冲突框；改名修好后该框（正确地）不再出现，
这个 **8s 空等**会吃掉 rename 的 5s 租约窗口，使 F1③.5 变成恒真/恒假的假判据。
已改为 300ms 短探测（冲突框若真是产品行为，300ms 内必已出现）。**探明脚本不进 CI**，
未搬进 `tests/`、未改成门禁项。

### 前后对照

P0-C 的 FAIL 态证据**保留未删**（`evidence/2026-09-23-p0c-e2e/` 原样），与本包证据并列：

| 判据 | P0-C（修前） | 本包（修后） |
|---|---|---|
| N1N4 | 15/24（`a2BytesIsBlue=false`、`reopenImages=[]`） | **24/24** |
| F1F2 | `s2gBlockedTimes=4`、`durableAttempts=5`、FAIL | **5/5 PASS**，`s2g=0`、`attempts=1` |

---

## 8. 未覆盖清单（如实；unconfirmed 不标 satisfied）

沿用 P0-C SUMMARY §6 口径，本包**未**覆盖：

1. **真实 OS 文件系统**：全部经 `browserHarness` 的 FSA 替身；未在真实磁盘目录上验证。
2. **系统选择器手势**：`showDirectoryPicker` / `showOpenFilePicker` 均为替身；未验证
   真实手势与权限提示。
3. **跨刷新 IDB 持久化**：harness 替身限制，未做跨页面刷新的 IndexedDB 旅程。
4. **F1③.1 busy-lease 文案**（「正在处理上一步操作…」）：**维持 `unconfirmed`**。
   本包修好后该窗口可达，但文案仍未被观测到 —— **不冒充已验证**。
5. **F2.3 组合结束后的自动续跑（第 ④ 条）**：`unconfirmed`（沿用）。
6. **F2 IME 第 ⑤ 条**（候选串完整上屏 / 候选窗口行为）：`unconfirmed`（沿用）。
7. **跨浏览器**：仅 Chromium（playwright 1.63.0）；未覆盖 Firefox/Safari。
8. **N1 的 ⑤ 真实拒绝路径的 OS 层副作用**：仅断言应用层零副作用。

---

## 9. 提交与收工

### 提交 sha + stat

| sha | message 前缀 | 内容 | stat |
|---|---|---|---|
| `fa8d0a6` | `fix(p0fix)` | R1-1 宿主侧（身份/复合键/来源路由） | 8 files, +548 −26 |
| `64f8cdf` | `fix(p0fix)` | R1-2 写后预热 + 五态渲染 | 9 files, +709 −40 |
| `49f6896` | `fix(p0fix)` | R1-3 零窗口 + 键位 ref + rename 判据 | 9 files, +472 −22 |
| `f68a80d` | `test(p0fix)` | 负控五条 + 脚本修正 | 6 files |
| `2d52e1e` | `docs(p0fix)` | 浏览器证据（首轮） | 5 files |
| `237f0c7` | `fix(p0fix)` | R1-1 收尾（SidePanels 调用点） | 1 file, +10 −1 |
| `97b715b` | `fix(p0fix)` | R1-3 补正（id 空间单解析） | 3 files |
| `0bb64e7` | `docs(p0fix)` | 浏览器证据（补正后重跑） | 5 files |
| `40a9842` | `test(p0fix)` | 负控收口态全量重跑 | 5 files |

合计 `e7ccefa..HEAD`：**41 files changed, 3936 insertions(+), 91 deletions(-)**。

提交粒度说明：R1-1 因「接口增量（packages）与调用点（apps）不同包」拆为两笔
（`fa8d0a6` + `237f0c7`），中间态**可编译**（`fa8d0a6` 时两侧都是 2 参，已用 `git show`
核实）；其余按「产品+单测同批」与「证据分批」执行。

### 收工锚

- 收工 HEAD（= 回执提交之前的值）：`40a9842413ca0639d258024eabb545beada94c44`
- `HEAD:packages` = `60eed45971185ed52ac8f59eec0401fb17efcad4`
- `HEAD:apps` = `8637cc23f00538f3ea9f22aefe704e8a2c01316e`
- 回执提交后 `git status --porcelain` **为空**（已实测）。

### 停止点

本包收口，回主控评审 P0 整体收口。**未进入 P1**（不做懒加载/删除/引用查询/orphan/
断图修复 UI）；P0-C ② 容器一致化跟手项不在本包。

---

## 10. 硬边界自查

| 边界 | 自查 |
|---|---|
| 不做 P1-B（懒加载/删除/引用查询/orphan/断图修复 UI） | ✅ 未做 |
| 不改文档引用语法（`@img:assets/…`）| ✅ 未改；`origin` 是运行时概念，不入文档/索引/缓存键之外持久面（含「IDB 记录无 origin」用例） |
| 不改 P0-C 文案事实源既有键与文案 | ✅ 未改 `assetNotices.ts` 任何既有键；本包未新增用户可见文案（五态呈现复用既有「✕ 资产缺失」） |
| 不新增操作入口 | ✅ 未新增 |
| 不碰 FileManagerTree 行内守卫空缺（P0-C §8-b） | ✅ 未碰 |
| 容器一致化（P0-C ② re-scope）不在本包 | ✅ 未碰 |
| 公开接口只增量 | ✅ `AssetItem.origin?`、`AssetHostV2.resolveAssetState?`（签名加 `origin` 到 Pick，未改既有语义）、`AssetHostV2.primeWorkspaceAsset?`；无删除、无签名语义变更 |
| 依赖方向 `apps/canvas → packages/react` 不反向 | ✅ depcruise 0 violations（含修复一次 `assetHost ↔ assetTypes` 成环） |
| `tools/verify-*.mjs` 不进 CI、不搬 `tests/` | ✅ 仍在 `tools/`，仅修正一处探明逻辑 |
| MindmapStage 净行数近持平 | ⚠️ 见下 |

**MindmapStage 净行数**：`git diff --numstat` = `+99 −29`（**净 +70 行**）。

**如实登记为「未达近持平」**。构成：
- 键位 ref（`handleSaveRef`/`handleOpenRef`/`handleNewRef`）与数据管线交接消费：
  约 12 行代码；
- **注释占绝大部分**（约 55 行）：本仓惯例要求关键判据写明「为什么」
  （键位闭包陈旧为何致命、id 空间为何必须单解析、`alreadyThisSource` 判据为何不用引用相等）；
- 其余为既有段落的措辞修订与两处重复 effect 合一（该合一是**减少**行数的）。

派单期望「近持平」；实际 +70 行**偏高**，原因是我把「为什么」写在了原地而非下沉到
`packages/react`（其中「id 空间」那条本可移入 host/pipeline 注释，但该判据的**触发点**
本身就在本文件的 `useMemo` 里，写在别处反而难以维护）。未触发 `bigFiles` 预算变化
（4/4 持平），但此项**未完全满足**派单 §七 的软约束，如实上报，**不辩护为持平**。

---

## 11. 施工期间自查发现的自身缺陷（如实登记）

R1-3 首版引入 **id 空间分裂**（§3.5），在门禁的 canvas 套件中暴露为
`summary-two-hop-host` 6/12 失败。已定位（逐提交 cherry-pick 二分 + 单文件还原验证）、
修复（`parsedHandoffRef` 单解析）并复测（14/14）。

**登记理由**：该缺陷**不是**派单条目，也**不是**既有问题，而是本包施工引入的。
按本仓「不以绿屏掩盖问题」的口径，如实列出并提供可复核的定位方法；它不是
「已存在缺陷」，故未列为 finding 而列在此节。

## 12. 复核声明

- 本回执所有数字均由本包**实跑**取得，无转述。
- 浏览器结论取自脚本结构化 JSON 与退出码；未凭滚动日志下结论。
- 负控五条的生产代码变异**全部还原**并与 pristine 快照逐字节一致（sha256 相同），
  盘上无残留（`grep -rn "NC-R1" src` 为空）。
- P0-C 的 FAIL 证据与派单书**未被修改**（仅新增本包证据目录与脚本一处探明修正）。
- 未修改任何他人测试的断言语义；`summary-two-hop-host.test.tsx` 保持原样
  （其残留的固定 `tick()` 竞态已如实登记，未为绿灯而改写）。
