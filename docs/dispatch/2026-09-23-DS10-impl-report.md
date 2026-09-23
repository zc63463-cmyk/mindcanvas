# DS-10 实施批 · 施工回执

- 日期：2026-09-23
- 性质：**施工回执**（实现 + 判别性负控 + 证据）
- 范围权威：`docs/dispatch/2026-09-23-ds10-rejudgement.md`（复审裁定）；
  派单书 `docs/dispatch/2026-09-23-DS10-impl-dispatch.md`
- 停止点遵守：不做 P0-B、不做契约勘误、未改 `migrate` 语义、未顺手重构投影其余部分

---

## 1. 基准锚定表（开工 / 收工各一次）

| 锚 | 开工（本批第一步） | 收工 | 一致？ |
|---|---|---|---|
| `git rev-parse HEAD` | `4c8c1aa7e6f98eb94ac76c91126e23af75da3409` | `1c29e4f7558c7a6fbf3821baa3bc55f6bc9c653a` | 变化（归因见下） |
| `git rev-parse HEAD:packages` | `27b2909c1ebe9bcf049d3998e52a56109d26b0ac` | `27b2909c1ebe9bcf049d3998e52a56109d26b0ac` | **一致**（未动包） |
| `git rev-parse HEAD:apps` | `284402420f23666b9702b8aface15a8d5da79ab5` | `9ac8350d11d98351ceb3b67fb05b57684b36f7da` | 变化（归因见下） |
| `git status --porcelain` | 空 | 空 | 一致 |

### 1.1 开工 HEAD 与派单书期望值的差异（如实报告，非本批引入）

派单书期望开工 HEAD = `49fcf26cff91d0f5e4cc99ff4018d6f3eee74a06`，
实测 = `4c8c1aa7e6f98eb94ac76c91126e23af75da3409`。**产品树锚一致**（`packages` / `apps`
两者都与期望逐字相符），故判定为**良性差异**，未停止。实证：

- `git merge-base --is-ancestor 49fcf26 HEAD` → 成立（`49fcf26` 是 `HEAD` 的祖先）；
- `49fcf26`（12:33:02）= DS-10 复审裁定书本身；
  `4c8c1aa`（12:34:57）= 其后一条 **docs-only** 提交（DS-10 实施批派单书）。
- 即：派单书写「基线 49fcf26」时，它**自己**就是紧接着的那一条提交；
  两者之间无任何产品代码改动（`HEAD:packages` / `HEAD:apps` 与期望值逐字相符可证）。

### 1.2 收工锚变化的归因

`HEAD:apps` 由 `284402420f…` 变为 `9ac8350d…`，**全部**归因于本批 3 条提交
（`db9ac72`、`a083730`、`5a595a6`），且仅涉及 `apps/canvas`。
`HEAD:packages` 未变 —— 本批未改任何包侧代码（N-1 的「不得动包侧契约」纪律保持）。

---

## 2. 判据实现说明（path:line）

### 2.1 判据 (b')（裁定 §2）

实现在 `apps/canvas/src/docIndexProject.ts` 的行集构建中
（`projectLibrary` 的 byId 保留循环，**`docIndexProject.ts:121-132`**）：

```ts
const currentIds = new Set(index.docs.map(legacyIdOf));
const claimedKeys = new Set(index.docs.flatMap((e) => e.legacyKeys));
/** 该行是否可被 (b') 回收：被认领 ∧ 非当前投影 id ∧ 非未消解 partial 源 */
const superseded = (id: string): boolean =>
  !currentIds.has(id) &&                                                    // ②
  claimForms(LEGACY_LIBRARY_KEY, id).some((f) => claimedKeys.has(f)) &&      // ①
  !sourceStillPresent(index, id);                                           // ③(F3)
for (const [id, item] of byId) {
  if (seen.has(id)) continue;
  if (!superseded(id)) rows.push(item as (typeof rows)[number]);
}
```

三条判据与裁定 §2 定义逐条对应：

| 裁定条件 | 实现 | 依据 |
|---|---|---|
| ① `X ∈ ⋃ legacyKeys`（**双形态**） | `claimForms(LEGACY_LIBRARY_KEY, id)` = `[`mindcanvas.library.v1#X`, `X`]`，任一命中即认领 | 明文形态来自 `relocateEntries`（`docIndexSupport.ts:80-83`）；前缀形态来自 M5（`docIndexMigrate.ts:180`） |
| ② `X ∉ { legacyIdOf(e) : e ∈ docs }` | `!currentIds.has(id)` | `legacyIdOf`（`docIndexCore.ts`） |
| ③ `X` 可解析（在 `byId` 内，非 opaque） | 循环只遍历 `byId`；opaque 行走单独循环、原样附着 | 该循环**结构上**排除 opaque 行 |

**双形态认领助手**（新增，`docIndexCore.ts:161-211`）：
`ClaimForm`（`:175`）/ `claimForms(prefix, value)`（`:178`）/ `isClaimed(legacyKeys, forms)`（`:188`）/
`rowClaimed(...)`（`:193`）/ `stripClaimPrefix(prefix, key)`（`:208`）。前缀形态只切**第一个** `#`
（旧库键自身不含 `#`，而旧键可为路径含 `#`）。

### 2.2 F3-部分成功排除（裁定 §3，硬约束）

**机制**：取裁定允许的「投影期显式跳过未消解的 partial 键」。

| 环节 | path:line | 说明 |
|---|---|---|
| 登记处（存储） | `docIndexSupport.ts:115-172`（`PartialResolutionStore:122` / `PARTIAL_SOURCES_KEY:134` / `unresolvedPartialSources:137` / `notePartialSource:149` / `clearPartialSource:161`） | `PARTIAL_SOURCES_KEY` 是**索引键**，非旧库键 |
| 投影期判定 | `docIndexProject.ts:235-261`（`sourceStillPresent`，:`261` 为查询行） | 逐行查该键是否在未消解集合内 |
| 类上公开面 | `docIndex.ts:379-390`（`notePartialSource` / `clearPartialSource`） | 两个薄委托：写存储 + 重写投影 |
| 编排层产生信号 | `hooks/useFileOpOrchestration.ts` `settle()` 的 `partial` 分支 | `onPartialSource?.(sourcePath)` |
| 生产接线（登记） | `MindmapStage.tsx`（`onPartialSource`） | 必须在 `onRebound`（`relocateDoc` 认领）**之前** |
| 消费方消解 | `useFileOpController.ts` `resolvePartial` 的四条出路 | 三条消解 / 一条（重试删源**仍失败**）不消解 |

**为什么不做「消费操作结果就删」**：`partial` 的四条出路里有三条
（保留两份 / 撤销新副本 / L4 复查发现外部改动）**源文件本来就该留着**，
「拿到 partial 就删」会在那三种**正确**出路下丢掉代表。而「未消解」是一个
持续状态，只有消费者知道它何时结束。裁定明确禁止「盲删 + 文档备注」，本实现不是。

### 2.3 写入纪律（N-1 口径，裁定 §4）

- 未新增第三写路径：登记/消解走 `docIndexSupport.ts` 的公开纯函数 +
  `DocIndex.store`（同 `readJSON` 的公开端口）与 `DocIndex.project()`。
- **未纳入 expected 行集口径的原因（如实说明）**：未消解集合是 `mindcanvas.docindex.*`
  索引键，**不是** `library.v1` 旧库键；投影从不重写它，N-1 的 `expected` 由 `rows`
  派生（`docIndexProject.ts:175-182`）。F3 排除只改变 `rows` 的**构成**，
  于是 `expected` 自动跟随 —— 回读校验仍然完整覆盖本批新路径，无需额外口径。

### 2.4 附带项（裁定 §5）：starred 前缀不对称 —— **已做**

`projectStarred` 的 `claimed` 判定改为复用同一双形态助手
（`docIndexProject.ts:226-231`）：M5/M6 的 `mindcanvas.starred.v1#<key>` 前缀形态
现在能被认出，不再被保守保留。原先删去的 `claimed` 变量（明文 `flatMap`）
即该不对称的来源。

---

## 3. 六条不变量逐条验证证据

用例均在 `apps/canvas/tests/doc-index.test.ts` 的
`describe('DS-10 · 旧库旧键逐行回收（判据 (b\')）')` 组内；**逐条对应裁定 §4**。

| # | 不变量 | 用例（行号） | 断言要点 | 负控 | 结果 |
|---|---|---|---|---|---|
| 1 | 孤儿行保留 | `不变量 1：孤儿行（从未被认领）一律保留` (`:1700`) | `ids` 含 `孤儿.mm.md`、不含被取代旧行 | NC2 转红 | ✅ |
| 2 | 畸形行保留 | `不变量 2：畸形行保留…` (`:1760`) | `kept` 长 3、`kept[1]===null`、`kept[2]==={name:'缺 id'}`；`migrate().failed > 0` | NC3 转红 | ✅ |
| 3 | 未迁移键不被破坏 | `不变量 3：尚未迁移的旧键不被投影破坏` (`:1719`) | `readLib()` 含 `未迁移.mm.md`；索引**不**凭空建条目 | NC2 转红 | ✅ |
| 4 | 幂等 | `不变量 4：幂等——投影连续两次行集一致…` (`:1734`) | 连续两次投影 `id` 行集相等；`migrate()` 前后旧库**逐字节**不变 | NC5 转红 | ✅ |
| 5 | 降级视图一行一文档 | `不变量 5：改名后旧行被回收…` (`:1681`) | 改名后 `readLib()` 恰为 `['新名.mm.md']`、长度 1 | NC1 转红 | ✅ |
| 6 | **F3-部分成功的源行保留** | `★不变量 6（F3-部分成功）…` (`:1820`) | 登记后源行**在**；`clearPartialSource` 后源行**不在**；且**先证**未登记时确会被回收（该行确实满足 (b')） | NC4 转红 | ✅ |

补充两条（覆盖实现的关键分叉）：

- `★双形态认领：前缀形态（M5 迁移）同样触发回收` (`:1783`) —— 前缀形态被认出。
- `★starred 侧前缀不对称已消除（裁定 §5 附带项）` (`:1859`) —— 旧收藏键不再残留。

**幂等与 F3 两条的额外说明**（派单书点名「回执中最重要的两段」）：

- **幂等（不变量 4）**：用例刻意用**行集**（`id` 有序列表）而非字节做口径 ——
  `saveDoc` 会推进 `ts`，字节必然变，用字节比对是错的判据。同时验证
  `migrate()` 前后旧库**逐字节不变**，对应「纯 `migrate()` 不碰旧库」。
  NC5 证明该口径有判别力：破坏幂等后 `:1750` 断言转红。
- **F3 排除（不变量 6）**：用例先跑一次**无 partial 登记**的基线，断言源行
  **确会被回收** —— 这一步很关键：它证明该行真的满足 (b') 全部三条，
  于是后面的「登记后保留」不是「因为没满足判据而碰巧留下」。
  NC4 单独关掉 F3 排除后恰好这一条转红，证明该排除是被真判的。

---

## 4. 五条负控六要素表

原始日志与机器可核表已入库（与回执同批提交）：
`docs/dispatch/evidence/2026-09-23-ds10-impl-negative-controls/`
（`SUMMARY.md` + 10 份 `.log` = 5 条转红态 + 5 条回绿态）。

| # | 编号 | 中性化内容 | 落盘 grep 校验 | 转红用例（断言行） | expected / received | 退出码 | 回绿 | 还原 sha256 |
|---|---|---|---|---|---|---|---|---|
| 1 | NC1 | (b') 认领条件恒假（从不回收） | `NEUTRALIZED(NC1)` ×1 | 不变量 5 `:1695` | `['新名.mm.md']` / `['新名.mm.md','旧名.mm.md']` | **1** | 75 passed | `dea33fb4…` |
| 2 | NC2 | 去掉「已被认领」（判据扩到孤儿行） | `NEUTRALIZED(NC2)` ×1 | 不变量 1 `:1715` | 含 `孤儿.mm.md` / 丢失 | **1** | 75 passed | `dea33fb4…` |
| 3 | NC3 | 畸形行不再附着（扩到全部旧行） | `NEUTRALIZED(NC3)` ×1 | 不变量 2 `:1775` | `kept` 长 3 / 少行 | **1** | 75 passed | `dea33fb4…` |
| 4 | NC4 | 去掉 F3 partial 排除 | `NEUTRALIZED(NC4)` ×1 | 不变量 6 `:1850` | 含 `源.mm.md` / `['目标.mm.md','孤儿.mm.md']` | **1** | 75 passed | `dea33fb4…` |
| 5 | NC5 | 每次投影重放原行（非幂等） | `NEUTRALIZED(NC5)` ×1 | 不变量 4 `:1750` | 行集一致 / 多一行 | **1** | 75 passed | `dea33fb4…` |

**核对口径**：提交前用 `git ls-files <目录>` 确认 11 项入库、其中 `.log` **10** 份
（P0-A 曾在此虚报「已入库」）。五条还原后 sha256 相同，且
`git diff HEAD -- apps/canvas/src apps/canvas/tests` 为空。

`NC4 只转红 1 条`是**期望形状**而非判别力不足：它单独关掉 F3 排除、其余判据不动，
只有专测该不变量的用例会红；NC1/NC2/NC5 红面更大，是因为它们影响的判据更宽
（分别关掉全部回收 / 放宽到孤儿行 / 破坏幂等）—— 红面大小与被针对的判据宽度一致。

---

## 5. 门禁逐数表（开工基线 → 收工实测）

| 门禁 | 开工基线 | 收工实测 | 判定 |
|---|---|---|---|
| `pnpm gate:fast` | exit 0 | **exit 0** | ✅ |
| lint warnings | 1536 | **1536** | ✅ 持平（未用 biome-ignore 等手段压制） |
| lint infos | 48 | **48** | ✅ 持平 |
| `check-code-budget.mjs` | exit 0 | **exit 0** | ✅ |
| bigFiles | 4 | **4** | ✅ 零上升 |
| asCast | 31 | **31** | ✅ 零上升 |
| bang | 89 | **89** | ✅（预算 90） |
| console / todo / defaultExport / any / tsIgnore | 4 / 1 / 2 / 0 / 0 | **4 / 1 / 2 / 0 / 0** | ✅ 零上升 |
| `pnpm build` | exit 0 | **exit 0** | ✅ |
| kernel | 708 passed | **708 passed** | ✅ 未动（符合预期） |
| react | 1676 passed | **1676 passed** | ✅ 只增不减（本批未动包） |
| canvas | 589 passed (54 files) | **597 passed (54 files)** | ✅ 只增不减（589 + 8 新增，**既有零删除零弱化**） |
| `doc-index.test.ts` | 67 passed | **75 passed** | ✅ 67 零回归 + 8 新增 |
| free-canvas（附带核实） | 12 passed | **12 passed** | ✅ 未动 |

### 5.1 实现过程中的两次真实回归（如实记录，已修正）

第一次跑 doc-index 是在**实现中途**，曾出现 7 条红。两项根因均已定位并修正，
**不是**靠放宽断言过的：

1. **判据谓词写反**：我把 `if (seen.has(id)) continue;` 重写成
   `if (seen.has(id) || !superseded(id)) rows.push(...)` —— 逻辑取反，
   导致「已被索引表达的当前行」再被推一次 → `library.v1` 出现重复行 →
   N-1 回读 `read.length !== expected.size` 判失败 → `project()` 短路
   （`projectLibrary(false) && ...`）使 `projectStarred` 根本不跑 → 收藏投影为空。
   修正为 `if (seen.has(id)) continue; if (!superseded(id)) rows.push(...)`。
2. **预算两项超限**（自己在提交前用 `check-code-budget.mjs` 抓到）：
   `asCast` 31→32（一处多余的 `as PartialResolutionStore` 断言，改为正确声明
   `ProjectionState.store` 的读写两面类型即可去掉）、
   `bigFiles` 4→5（`docIndex.ts` 涨到 617 行）。后者通过把 F3 的存储实现移到
   `docIndexSupport.ts`、类上只留两个薄委托方法来消除。两项均已回到 31 / 4。

---

## 6. starred 附带项处置（裁定 §5）

**已做**（非「明示未做」）：`projectStarred` 的认领判定改为复用与 library 侧
同一套双形态助手（`docIndexProject.ts:226-231`），消除「M5 用前缀认领而投影只做
明文查找」的不对称。回归用例：
`★starred 侧前缀不对称已消除（裁定 §5 附带项）`（`doc-index.test.ts:1859`）。

原实现里的 `claimed`（`docs.flatMap(e => e.legacyKeys)` 的明文集合）已删除——
它正是该不对称的载体。

---

## 7. 未覆盖清单

本批为**纯逻辑 + jsdom**，无浏览器 / IME 需求。未实测路径如实列出：

1. **真实磁盘上的 partial 时序未端到端跑过**：`onPartialSource` 的接线在
   `MindmapStage.tsx`（React 组件内），本批的用例只覆盖索引层与
   `docIndexSupport` 的**存储语义**，未在真实 `FileSystemFileHandle` 上触发一次
   「目标已写、源删除失败」。编排层 `settle` 的 partial 分支已有既有用例覆盖
   （`file-op-*`，本批未改其语义），但「partial → onPartialSource → 投影跳过」
   这条**跨层**链路的端到端未跑。
2. **`onPartialResolved` 的四条出路未逐一端到端验证**：四条分支的调用点在
   `useFileOpController.resolvePartial`，其行为由既有 P0-A 用例覆盖；
   本批新增的只是「顺带调一次消解」。消解**之后**投影的行集变化由不变量 6 用例覆盖。
3. **配额/写失败下的 partial 登记降级**：`notePartialSource` / `clearPartialSource`
   的 `catch` 分支（写失败 → 保持/退化为未登记）未造用例 —— 该分支方向保守
   （不误删磁盘数据），但没有实测。
4. **多键同时未消解**：用例只覆盖单键；集合语义（数组）天然支持多键，但未实测。
5. **`stripClaimPrefix` 无生产调用点**：作为双形态助手的完整接口一并导出，
   当前仅 `claimForms`/`isClaimed` 被消费。属于「提供而未用」，如实标注。

---

## 8. 提交列表（sha + stat）

| sha | 类型 | message 首行 | stat |
|---|---|---|---|
| `db9ac72` | 实现 | `feat(ds10): 旧库旧键逐行回收——判据 (b') + F3-部分成功排除` | 4 files, +203 / −10 |
| `5a595a6` | 实现 | `feat(ds10): 编排层 partial 源键信号——onPartialSource / onPartialResolved` | 3 files, +66 / −8 |
| `a083730` | 测试 | `test(ds10): 六条不变量的判别性用例（75 passed = 67 既有零回归 + 8 新增）` | 1 file, +250 |
| `1c29e4f` | 证据 | `docs(ds10): 五条判别性负控原始证据入库（S5 教训 #1：证据随提交）` | 11 files（SUMMARY.md + 10 `.log`） |
| `46af988` | 格式 | `style(ds10): projectStarred 收尾大括号换行（纯格式，无语义变化）` | 1 file, +2 / −1 |

> `46af988` 是 `db9ac72` 的一处**纯格式**修补（`out.add(k)` 与循环收尾 `}` 同行，
> 编辑残留），无逻辑改动，`doc-index` 75 passed 不变，budget / lint / tsc 均复测持平。
> 列为独立提交而非改写历史，是为了让「哪一条提交动了什么」保持可核。

提交粒度按派单书 §七.3「实现 / 测试 / 负控证据 / 回执分开」；message 均说明**为什么**。

收工 `git status --porcelain` **为空**（本回执为最后一条提交）。

---

## 9. 纪律自检

- ✅ 基准防漂：开工/收工各锚一次，差异已归因（§1.1 / §1.2）；
- ✅ 证据随提交入库（S5 教训 #1），并以 `git ls-files` 核对 `.log` 计数；
- ✅ macOS bash 3.2：`$var` 后接全角字符处用 `${var}`；Python 脚本无非 ASCII 字节字面量；
- ✅ 未使用 `it.fails` / 反转断言 / `catch` 后报 PASS / 宽泛 `skip` / 删除或弱化既有断言；
- ✅ 未用 `biome-ignore` 等手段压制 lint；lint 持平基线；
- ✅ 未以「盲删 + 文档备注」处理 F3（裁定 §3 明文禁止）；
- ✅ 不冒充：未覆盖项如实列于 §7。
