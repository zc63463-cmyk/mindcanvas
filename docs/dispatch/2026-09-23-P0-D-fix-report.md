# P0-D 收尾轮回执 · RunId `2026-09-23-P0-D-fix`

执行者：收尾轮执行者（非复核方、非施工方）。
范围：主控裁决的 N-1 修复（T1）、三条判别性负控（T2）、N-4 处置（T3）、门禁与回执（T4）。
**未启动 P0-A。** 停工待裁事项见 §5（三方矛盾）。

---

## 1. 基准锚定表

### 1.1 开工四条命令（原文抄录）

```
$ git rev-parse HEAD
a3a0c0c792a03855313d9acad0f40157c1df17e3
$ git rev-parse HEAD:apps
0ce15a9304db5fdfd7288dd8d5f9c540ec233f53
$ git rev-parse HEAD:packages
c771dd3bc061b917a195ecf03ac73129c431df71
$ git status --porcelain -- apps packages
（空输出）
```

四条**全部与期望逐字相符**，开工前置条件满足。

### 1.2 收工四条命令（原文抄录）

```
$ git rev-parse HEAD
037d1e260054926516abe31727ebb370451bef1a
$ git rev-parse HEAD:apps
5cf00165ac02ed401cdeca3556f7535cf8dd7c63
$ git rev-parse HEAD:packages
c771dd3bc061b917a195ecf03ac73129c431df71
$ git status --porcelain -- apps packages
（空输出）
```

### 1.3 防漂记录

| 时点 | HEAD | `HEAD:apps` | `HEAD:packages` | `status -- apps packages` |
|---|---|---|---|---|
| 开工 | `a3a0c0c` | `0ce15a9` | `c771dd3` | 空 |
| 收工 | `037d1e2` | `5cf0016` | `c771dd3` | 空 |

**说明（重要）**：

- `HEAD` 与 `HEAD:apps` 前进**仅因本轮的两次产品提交**（`071e478`、`037d1e2`），
  非并行活动所致。逐条对应见 §2。
- **`HEAD:packages` 全程未变**（`c771dd3` = 开工期望值）→ **`packages/react` 零改动**，
  符合派单硬性边界第 1 条（跨包契约不变更）。这是本轮的硬判据。
- 工作区收工时空输出 → 除本轮交付物外无遗留。

---

## 2. commit 清单

```
$ git log --oneline -3
037d1e2 test(p0-d): 三条判别性负控——ownScope 他区隔离、:236 的 failed 断言、M5 证据位矛盾存档
071e478 fix(p0-d): library 投影改为写后回读校验——配额失败不再谎报 projectionFailed=false
a3a0c0c docs(p0-d): 报告修订——…（本轮开工时的 HEAD，非本轮产生）
```

| commit | 类型 | `git show --stat` 摘要 |
|---|---|---|
| `071e478` | `fix(p0-d):` | `apps/canvas/src/docIndexProject.ts` +50/-1；`apps/canvas/tests/doc-index.test.ts` +162 → **2 files changed, 211 insertions(+), 1 deletion(-)** |
| `037d1e2` | `test(p0-d):` | `apps/canvas/tests/doc-index.test.ts` +164 → **1 file changed, 164 insertions(+)** |

改动文件**仅两个**，均在 `apps/canvas/` 内：`src/docIndexProject.ts`、`tests/doc-index.test.ts`。
与派单边界第 4 条（除这两个文件与回执文档外不改其他文件）**一致**。`routes.ts` 未碰。

---

## 3. T1 · N-1 修复（`071e478`）

### 3.1 缺陷复述（复核回执 §7 N-1，主控裁为必修 / P0-A 开工前置）

`projectLibrary`（`apps/canvas/src/docIndexProject.ts`）原先靠 `replaceAll` 抛错判定失败：

```ts
new DocLibrary().replaceAll(rows);
return true;
} catch {
  return false;   // 不可达
}
```

包侧 `DocLibrary.save`（`packages/react/src/edit/docLibrary.ts:107-119`）是两层 try/catch **自吞**：
配额失败时不抛、不返回、不说，整表丢掉。故 `catch` 不可达 →
`projectionFailed` 恒 `false` → `FileManager.tsx:550` 的 `ProjectionFailureNotice`
**永不显示**。复核用 `Storage.prototype.setItem` 打桩实证：
`{wroteNewData:true, projectionFailed:false}` 且 library 键值为 `null`。
**§6.3「不可回退且可查」在 library 投影路径上不成立。**

### 3.2 修法（主控已裁：写后回读校验；归属 `apps/canvas`）

**约束遵守**：不改 `packages/react` 任何文件（`HEAD:packages` 全程 `c771dd3` 可证）；
不改 `DocLibrary` 签名；不动 `projectStarred` 的既有行为。

修复后（`docIndexProject.ts`，`rows.length === 0` 的 early return 之后）：

```ts
const lib = new DocLibrary();
lib.replaceAll(rows);

// 写后回读校验：必须用 DocLibrary.list()（:122）这个公开读取面
const expected = new Map<string, { name: string; ts: number }>();
for (const r of rows) {
  if (isRecord(r) && typeof r.id === 'string' && r.id !== '') {
    expected.set(r.id, { name: String(r.name), ts: Number(r.ts) });
  }
}
const read = lib.list();
if (read.length !== expected.size) return false;      // 整表没写进去 / 多写 / 少写
for (const e of read) {
  const want = expected.get(e.id);
  if (want === undefined) return false;               // 读回一条本次没打算写的 id
  if (e.name !== want.name) return false;             // 行内容被改写
  if (e.ts !== want.ts) return false;                 // 写失败留下的陈旧行
}
return true;
```

**比对逻辑的三处关键决策**（都是我实测踩过后定下的，写进代码注释）：

1. **用 `DocLibrary.list()` 而不是 `index.store.get(LEGACY_LIBRARY_KEY)`**：
   `store` 是**索引键**的端口，用它等于本包自己解析旧库格式；
   `list()` 是包侧公开读取面，读到什么就以什么为准。派单原话是「用 DocLibrary 的公开读取面（`list()`，:122）」。
2. **不能要求「读回条数 === `rows.length`」**：`list()` 走
   `load()` → `filter(isEntry).map(normalize)`，**畸形行（`null` / 缺 `id`）本来就读不出来**。
   修复初版我正是这么写的，结果**任何含畸形行的旧库在健康路径上也报 `projectionFailed: true`**
   （实测：`TRACE expectedIds=["好.mm.md"] read=["好.mm.md"]` 但按行数比就误报）。
   正确口径是「读回的**合法行**集合 == `rows` 里的合法行集合」，畸形行不计入 —— 这是
   包侧既有语义，不是缺陷。
3. **只比 `id` 集合不够，必须比 `ts`**：实测 `saveDoc(ts=1200)` 写失败时落盘仍是旧行
   `ts=1111`，`id` 集合完全一致，但「本次变更不可回退」必须被抓到。
   `name`/`ts` 是 §6.3 明文要求投影写对的三项中的两项（`id`/`name`/`ts = max(openedAt,savedAt)`）。
   **不展开比 `folder`/`tags`/`source`**：`DocLibrary.normalize`/`cleanFolder` 是包内私有，
   本包拿不到；逐字段比会把包侧归一化细节复制进本包 = 跨包耦合，违反主控「不改跨包契约」的裁定。

**失败通道如何点亮 `ProjectionFailureNotice`**（未新增任何通道，全部走既有链路）：

```
projectLibrary() return false
  → DocIndex.project(): `projectLibrary(this) && projectStarred(this)` 短路为 false
  → DocIndex.commit(): `this.projectionFailed = !projected` → true
  → projectionStatus() = { wroteNewData: true, projectionFailed: true }
  → useIndexWiring.ts:66,76 读取
  → FileManager.tsx:550 <ProjectionFailureNotice failed={projectionFailed} />
  → FileManagerViews.tsx:173-190 渲染 data-fm-projection-failed 可见提示
```

调用方 `docIndex.ts` 的 `commit()` 统一收尾，**未改签名、未改调用方**。

### 3.3 同步修测试（+4 条，既有 51 条零删除零弱化）

| 用例 | 作用 |
|---|---|
| `仅 library 投影键写失败时也标为不可回退（回读校验，不谎报成功）` | **N-1 的正面验收**：只让 `mindcanvas.library.v1` 抛 `QuotaExceededError`、`starred.v1` 正常；断言 `projectionFailed === true` 且 library 键值不符合预期（`ts` 停在 1111 而非 1200） |
| `仅 library 投影键写失败：starred 那一路仍正常` | 钉住另一路成功；并**如实记录回读校验的粒度边界**（见下） |
| `library 投影写成功后回读校验通过（回读校验本身不误报失败）` | 对照组：证明回读校验不放宽成常态误报 |
| `回读校验覆盖**畸形旧行**` | 证明比对覆盖 `rows`（含畸形行），不只是索引条目 |

注入手法按派单要求参考回执 §7 ISO-A 探针（`Storage.prototype.setItem` 打桩），
**用完在 `finally` 里还原**（`Storage.prototype.setItem = real`），不污染同文件后续用例。

#### 3.3.1 记录一个**真实的可查性边界**（不只是"顺手测"）

`setStarred` 路径下回读**看不见** library 写失败：因为 `setStarred` 不推进任何时间
（收藏不是打开、也不是保存），而投影进 `library.v1` 的只有 `ts = max(openedAt, savedAt)`，
于是「写失败」与「写成功」的 library 行**逐字节相同**。实测：
`setStarred` 路径下 `projectionFailed` 保持 `false`，且落盘值确实未变。

这不是修复的缺陷，而是「该次变更的 library 投影本就是空操作」的必然结果 ——
§6.3 要查的是「本次变更**不可回退**」，内容没变就不存在不可回退。
故有内容变化的那一类（`saveDoc`）必须为 `true`，由第一个用例钉住；
无内容变化的那一类由第二个用例**显式断言 `false` 并注明理由**，避免后人误以为漏检。

---

## 4. T2 · 三条判别性负控（`037d1e2`）

### 4.0 自证方法（统一）

全部在**隔离副本** `/tmp/p0dfix-iso` 执行：`git archive HEAD | tar -x` 展开 +
软链 `node_modules`（根与四个包级）；**先验证副本为绿**（`58 passed`、exit 0）后才中性化；
中性化后跑、取 `$?`；跑完 `cp` 备份回填 + `sha256sum` 比对 + `cmp` 逐字节还原 + 重跑回绿。
隔离副本与临时文件**已删除**；被审仓库 `git status --porcelain -- apps packages` 收工为空。

### 4.1 负控 (a) NC-M7-scope —— ✅ 已自证

- **守点原文**（`apps/canvas/src/docIndexMigrate.ts:246-247`）：
  ```ts
  const ownScope = (a: AssetIndexEntry): boolean =>
    selfContained ? a.scopeId === BROWSER_SCOPE_ID : ctx.persisted && a.scopeId === ctx.scopeId;
  ```
- **用例**（`doc-index.test.ts`，`DocIndex · M4 / M7 / M8` 组内，2 条）：
  - `M7：他区已有同 assetKey 条目 → 不得复用（`ownScope` 的「他区不得复用」语义）`
  - `M7：他区条目存在时仍为本区新建条目（`ownScope` 只隔离他区，不阻断本区合法迁移）`
- **前置**：`LEGACY_ASSET_FAV_KEY = ['img:assets/b.png']`；
  `ctx = diskCtx('ws:aaaa')` / `adoptedCtx('ws:aaaa')`；
  注入 `d.assets = [{ assetKey:'assets/b.png', scopeId:'ws:OTHER', relPath:'assets/b.png',
  name:'b.png', starred:false, legacyKeys:[] }]`
  （注入方式以**实读** `DocIndex.assets` 访问器为准 —— 它是公开字段，正是迁移读的那个面）。
- **中性化内容**：`ownScope` → `const ownScope = (_a: AssetIndexEntry): boolean => true;`
  - 落盘校验：`grep -n "NC-A 中性化"` 命中 1 处；
    `grep -c "ctx.persisted && a.scopeId === ctx.scopeId"` → **0**。
- **命令与退出码**：`./node_modules/.bin/vitest run tests/doc-index.test.ts`
  → **`NC_A_EXIT=1`**，`Test Files 1 failed (1)`、`Tests 2 failed | 56 passed (58)`。
- **转红用例名**：上面两条**全部转红**。首条断言原文：
  ```
  FAIL  … > M7：他区已有同 assetKey 条目 → 不得复用（`ownScope` 的「他区不得复用」语义）
  AssertionError: expected 1 to be +0
   ❯ tests/doc-index.test.ts:1184:24
  ```
- **还原校验**：`cp` 回填 → `sha256sum` =
  `226a05e007197fcd82053a7cf693467cce7407f17a3ea9931792939f6b36a79e`（与备份同）→
  `cmp` 报告 identical → `grep -c "NC-A 中性化"` → 0 → 重跑 **`58 passed`、exit 0**。
- **对照复核结论**：复核 §3.2 实测中性化 `ownScope` 后 **51/51 全绿、exit 0**（守卫未被钉住）。
  本轮补测后中性化**必红**（2 条）。**守点已钉住。**

### 4.2 负控 (c) `:236` 的 `failed` 断言 —— ✅ 已自证

- **守点原文**（`apps/canvas/src/docIndex.ts:520-522`）：
  ```ts
  } catch {
    return { kind: 'corrupt' };
  }
  ```
  配套实现 `docIndexMigrate.ts:155-156`：`corrupt` → `result.failed += 1`（失败条目留在旧库）。
- **改动**：`doc-index.test.ts:245` 用例内补一行
  `expect(r.failed).toBeGreaterThan(0);`（契约 §6.2 M5「失败条目留在旧库并**标『未迁移』**」）。
  既有四条断言（`migrated===0`、`unchanged===0`、旧键原文保留、`listDocs()` 为空）**一条未改**。
- **中性化内容**：`readJSON` 的 `corrupt` 分支折叠成 `absent`
  （`return { kind: 'corrupt' };` → `return { kind: 'absent' }; // NC-C 中性化`）。
  - 落盘校验：`grep -n "NC-C 中性化"` 命中 1 处；`grep -c "kind: 'corrupt'"` → **0**。
- **命令与退出码**：同命令 → **`NC_C_EXIT=1`**，`Tests 1 failed | 57 passed (58)`。
- **转红用例名**：`旧库键无法解析时迁移不崩：不删旧键、不误报成功`。断言原文：
  ```
  AssertionError: expected 0 to be greater than 0
   ❯ tests/doc-index.test.ts:258:22
      258|     expect(r.failed).toBeGreaterThan(0);
  ```
- **还原校验**：`sha256sum` =
  `9f858af4bf36c04ee1e9e0d80d3e8ae77f2d5718db9b6ec3fc1019e18ecf90b3`（与备份同）→
  `cmp` identical → `grep -c "NC-C 中性化"` → 0 → 重跑 **`58 passed`、exit 0**。
- **对照复核结论**：复核 §4.1 NC-1 实测中性化后 **51/51 全绿、exit 0**（该用例四条断言全部依然成立）。
  补断言后必红。**守点已钉住。**

### 4.3 负控 (b) 「有既有条目 + 无证据 → 不得认领」 —— ⚠️ **未完成：触发三方矛盾，已停工待裁**

自证**未能执行**，因为该用例在**未中性化的当前代码下就无法成立**：
实测 `migrated=1`、`historyPool=0`、`legacyKeys` 被写入（即**认领发生了**）。
派单边界第 7 条要求「发现三方矛盾：并列原文与行号，停工待裁决，不自行择一」，
故我**没有**把断言写成「必须不认领」以迎合回执，也**没有**把它删掉——
而是把**实测行为**写成一条明确标注「记录矛盾、不是守点」的用例存档。详见 §5。

**这一条不能自证，就不算完成。** 我在 §8 未做清单里复述。

---

## 5. 停工待裁：M5 的归属证据位三方矛盾

### 5.1 三方原文并列

**① 契约 `shared-contracts.md:861`（§6.2 M5 行）**：
> `| M5 | mindcanvas.library.v1 条目 | 键存在 | DocIndexEntry | **分批惰性**：每条独立判定；**只有具备 §6.2.1 证据的才绑定 `scopeId`/`relPath`**，否则进历史池 | 逐条 try/catch；失败条目留在旧库并标「未迁移」 | 是（按 `docKey` upsert） |`

**② 契约 `shared-contracts.md:875`（§6.2.1 表第 2 行）**：
> `| 旧键能与某路径命中，但该 scopeId 是 legacy adoption 新生成的（无历史证据） | 证据不足 | 进历史池，UI 标「未关联的工作区记录」 |`

**③ 实现 `apps/canvas/src/docIndexMigrate.ts:105-109`（M5 的 existing 查找）**：
```ts
const existing = index.docs.find(
  (e) =>
    e.scopeId === ctx.scopeId &&
    (e.relPath === key || e.legacyKeys.includes(`${LEGACY_LIBRARY_KEY}#${key}`)),
);
```
命中即 `adoptDoc`（`:133-150`）——**全程不调用 `hasOwnershipEvidence`**。

**④ 复核回执 `2026-09-23-P0-D-review.md:270-278`**：
```
[NC3-b] 有既有条目 + 无证据  => migrated=1 pool=0   ← 被错误认领（守卫在此判别）
```
> 而真正能被该守卫判别的场景（**b：同作用域已有条目 + 无历史证据**）**默认套件里没有任何用例覆盖**。
> 建议补一条 NC（… 把 ctx 换成 `adoptedCtx('ws:aaaa')` 并预置同区条目）。

### 5.2 实测（我的命令与结果）

隔离/工作区实测（`ctx = {scopeId:'ws:aaaa', persisted:true, hasHistoryEvidence:false, handleStoreAvailable:false}`，
预置同区条目 `ws:aaaa::研发/架构.mm.md`，旧库键 `研发/架构.mm.md`）：

```
C_CTX    {"scopeId":"ws:aaaa","persisted":true,"hasHistoryEvidence":false,"handleStoreAvailable":false}
C_RESULT {"migrated":1,"unchanged":0,"failed":0,"historyPool":0}
C_DOCS_AFTER [{"k":"ws:aaaa::研发/架构.mm.md","lk":["mindcanvas.library.v1#研发/架构.mm.md"]}]
C_POOL   []
```

即：**实现认领了**（`migrated=1`、`legacyKeys` 写入、历史池空），
与 ①② 的「无证据 → 不绑定、进历史池」**相反**，与 ④ 的「被错误认领」**一致**。

代码面佐证：`grep -n hasOwnershipEvidence apps/canvas/src/docIndexMigrate.ts` → 仅 **:187（M6）、:265（M7）**，
**M5 一次都没用**。`hasOwnershipEvidence` 在 M5 路径上**根本不在判据里**。

### 5.3 为什么我没有自行择一

- 若按 ①② 断言「必须不认领」→ 该用例在**当前实现**下必红；而本轮门禁要求全绿。
  更重要的是：M5 不查证据位**可能是有意为之** —— `existing` 命中意味着
  「这条文档已经在本作用域里以**真实身份**存在过」（`docKey` 含作用域、`relPath` 是真实路径），
  与 M6/M7 凭旧键**字符串**猜归属不是同一类推理。这属于**设计意图**判断，不是执行者能定的。
- 若按 ③ 断言「认领」→ 等于把复核指出的问题单方面判成「不是问题」，那是主控的裁决权。
- 故三种改法我都无权单方面决定 → 按边界第 7 条**停工、并列原文、交回主控**。

### 5.4 待裁问题（请主控择一）

1. **M5 应否调用 `hasOwnershipEvidence`？** 若「应」，实现有缺陷（`docIndexMigrate.ts:105-150` 需补证据位判定）；
   若「不应」（`existing` 命中即足够证据），则**契约 §6.2 M5 行与 §6.2.1 表第 2 行需要勘误**以匹配实现。
2. 无论哪种，**负控 (b) 的断言方向要按裁决重写**，届时我再补做它的分辨力自证。

### 5.5 顺带证伪复核的一处归因（T3 相关）

复核 §3.2 末段把「`:422` 用例名实不符」归因于「场景 b 缺测」。**该归因在当前代码下不成立**：
`:422` 的绿色来自 M5「无 existing 则不造条目」（`docIndexMigrate.ts:110-132`），
而**场景 b 根本不经过 `hasOwnershipEvidence`**（§5.2 grep 证据）。
即便把场景 b 补测上，也**钉不住** `hasOwnershipEvidence`；它能钉住的是 M5 的
「作用域 + relPath 精确命中」这一支。真正判定 `hasOwnershipEvidence` 的是 M6/M7 路径，
而 M6 侧已有 `M6：证据充分但命中条目属于**别的**作用域` 等用例覆盖。

---

## 6. T3 · N-4 处置（选了哪条 + 理由）

**选择：②（保留名字，用新用例补齐它名字所指的守点）—— 但执行中撞上 §5 的矛盾，只完成了一半。**

- 派单推荐 ②（「守点优先于名字」），我按 ② 走。
- 复核给 ② 指定的补齐手法是「用 T2(b) 的新用例补齐」。实测表明**这条路在当前代码下走不通**：
  `:422` 名字所指的守点是「归属证据不足 → 不自动绑定」，而 M5 路径**不消费证据位**（§5.2），
  故无法用 M5 的场景补出它名字所指的守点。
- **`:236` 那一半已完成**（复核对 N-4 的第二处位置：名含「不误报成功」但不断言 `failed`）
  —— 见 §4.2，`failed` 断言已补且自证转红。**名实已相符。**
- **`:422` 那一半未完成**，且我认为它应并入 §5 的裁决：先定 M5 是否该查证据位，
  再决定 `:422` 是「改名」还是「补测」——若 M5 改为查证据位，则 ② 可行；
  若 M5 维持现状，则 `:422` 只能走 ①（改名，如「唯一同名 + 无既有条目：不建条目进历史池」）。
- **我未擅自改名**（①），因为改名会抹掉复核指出的「名实不符」这条证据；
  也**未把断言写成必然成立的形式**去凑绿色。

---

## 7. 门禁逐数（基线 vs 本轮）

| # | 命令 | 基线退出码 | 本轮退出码 | 本轮实测输出（原文） | 判定 |
|---|---|---|---|---|---|
| 1 | `pnpm gate:fast` | **0** | **0** | depcruise `✔ no dependency violations found (575 modules, 1735 dependencies cruised)`；lint `Checked 582 files in 488ms` / `Found 1541 warnings.` / `Found 48 infos.`；budget `✅ 全部指标在预算内（债务未增长）` | ✅ 逐数相符 |
| 2 | `pnpm build` | **0** | **0** | `apps/canvas build: ✓ 260 modules transformed.` / `main-DI3_Rm-1.js 471.37 kB │ gzip: 152.84 kB` / `✓ built in 206ms` / `Done` | ✅ 通过 |
| 3 | `node scripts/check-code-budget.mjs` | **0** | **0** | 八项见下表 | ✅ 未放宽 |
| 4 | `apps/canvas` 全量 `pnpm test` | 49 files / **456 passed** | **49 files / 463 passed** | `Test Files 49 passed (49)` / `Tests 463 passed (463)` | ✅ 净增 7 |

### 7.1 budget 逐数

| 指标 | 冻结基线 | 本轮 | 判定 |
|---|---|---|---|
| any | 0/0 | 0/0 | 持平 |
| tsIgnore | 0/0 | 0/0 | 持平 |
| bang | 89/90 | 89/90 | ↓1 优于 |
| asCast | 31/31 | 31/31 | 持平 |
| console | 4/4 | 4/4 | 持平 |
| todo | 1/1 | 1/1 | 持平 |
| defaultExport | 2/2 | 2/2 | 持平 |
| bigFiles | 4/4 | 4/4 | 持平 |

**八项全部持平或优于，零上升。** lint `1541 warnings / 48 infos / 582 files` 与冻结基线**逐数相同**。

### 7.2 测试净增说明

`456 → 463`（**+7**），全部在 `tests/doc-index.test.ts`（`51 → 58`，**+7**）：
N-1 修复 +4 条（§3.3 表）、T2 负控 +3 条（§4.1 两条 + §4.3 存档一条）。
**既有 51 条零删除、零弱化**；未使用 `it.fails`、未反转断言、未 `catch` 后报 PASS、未加宽泛 `skip`。

`mode-guard.test.tsx`（复核 §7 N-5 记录的夹具时序竞态）：本轮全量跑**一次即全绿**，
未复现红；我未改该文件（边界第 4 条）。

---

## 8. 自复核发现（分级 + verified/unconfirmed）

### verified（有命令 / 行号 / 退出码）

| 级 | 发现 | 证据 |
|---|---|---|
| — | `projectLibrary` 修复后 library-only 配额失败**可查** | `projectionFailed: true`；用例转红自证见 §3.3 |
| **medium** | **M5 不消费归属证据位**（§5 三方矛盾） | `grep -n hasOwnershipEvidence docIndexMigrate.ts` → 仅 :187/:265；实测 `migrated=1` |
| low | 回读校验对 `setStarred`（不推进 `ts`）的 library 写失败**不可见** | §3.3.1 实测；已写成显式断言 + 注释，防后人误改 |
| low | 复核 §3.2 对 `:422` 名实不符的**归因不成立** | §5.5；M5 不经过证据位 |
| info | 复核给出的 NC-M7-scope 设计里 `migrated === 0` 只在**无证据**作用域成立 | §4.1；有证据作用域下走的是 `BROWSER_SCOPE_ID` 新建分支（`docIndexMigrate.ts:281`）。我按实际形态分两条用例钉住，未改实现对齐直觉 |

### unconfirmed（未核实，如实列出）

| # | 事项 | 为什么未核 |
|---|---|---|
| 1 | `packages/react` 全量测试 | 本轮未跑（`pnpm test` 是 workspace 递归，我只跑了 `apps/canvas` 全量如派单 T4 所指定）。**未在本轮改 `packages` 任何文件**，风险低但未验 |
| 2 | 真实浏览器 localStorage 配额行为 | jsdom 无真实配额，用 `Storage.prototype.setItem` 打桩；「打桩行为与真实浏览器一致」是**假设** |
| 3 | `playwright` 真实浏览器验收 | 本机 `node_modules` 下无 playwright；P0-D **仍无任何浏览器证据**（延续复核 §8） |
| 4 | 真实 IndexedDB / M9 写侧 | jsdom 无 `indexedDB`；M9 写侧本身未实现，未核 |
| 5 | 复核 §7 N-5 `mode-guard.test.tsx` 的 flaky 根因 | 本轮全量一次全绿，未复现、未定位 |
| 6 | R2-4（无 `scopeEpoch` 订阅）/ R-A（无新写入回退） | 延续复核 §8，未核 |

---

## 9. 未做清单

1. **负控 (b) 未完成**（§4.3）：三方矛盾未裁前无法写出正确方向的断言，**其分辨力自证也未做**。
2. **N-4 的 `:422` 一半未做**（§6）：等 §5 裁决后决定 ① 改名还是 ② 补测。
3. **契约勘误（条件 4）未做**：两个 `AssetIndexEntry` / `kind` 取值域属规格侧，派单明确不在本轮范围。
4. **DS-10 未做**：派单明确由主控决定，本轮只提供 §5 的输入。
5. **P0-A 未启动**（派单硬性要求）。
6. **`packages/react` 全量测试未跑**（§8 unconfirmed #1）。
7. **`routes.ts` 等边界外文件一律未碰**（边界第 4 条）。

---

## 10. 延续声明（派单边界第 8 条，原文照录，不削减）

> **不宣称 P0-D 完全闭环**

具体到本轮：N-1 修复后，§6.3「不可回退且可查」**仅在 library 投影路径、且仅对
「本次变更确有 library 内容变化」的那一类**恢复可查性（§3.3.1 记录了另一类）；
契约缺口（条件 4，两个 `AssetIndexEntry` / `kind` 取值域）与 **DS-10 仍开放**；
§5 的 M5 归属证据位矛盾是本轮**新提出、未解决**的待裁项。

---

## 11. 边界与合规声明

- **未 push / 未 merge / 未 deploy / 未发布**；只在本地 `main` 上提交两个产品 commit + 本回执。
- **`packages/react` 零改动**：`HEAD:packages` 开工收工同为 `c771dd3`，硬证据。
- **未改 `DocLibrary` 签名**、未改跨包契约、未动 `projectStarred` 既有行为。
- 改动文件**仅** `apps/canvas/src/docIndexProject.ts` 与 `apps/canvas/tests/doc-index.test.ts`
  （+ 本回执文档）；`routes.ts` 等一律未碰。
- 三条负控的中性化全部在**隔离副本** `/tmp/p0dfix-iso` 执行，跑完 `sha256sum` + `cmp`
  **逐字节还原**并重跑回绿；隔离副本与全部临时探针文件**已删除**。
- 被审仓库收工 `git status --porcelain -- apps packages` **空输出**。
- 未引入 `it.fails` / 反转断言 / `catch` 后报 PASS / 宽泛 `skip`。
- **零新依赖、零 DDL、零新端点**；未启动 P0-A。
- **未改任何 `shared-contracts.md`**（契约勘误属规格侧）。
- 发现矛盾按边界第 7 条**停工待裁**，未自行择一（§5）。
