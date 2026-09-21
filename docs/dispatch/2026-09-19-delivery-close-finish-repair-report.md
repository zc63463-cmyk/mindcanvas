# DELIVERY-CLOSE 深度收尾返修 · 执行回执 · 2026-09-19

> 输入：`docs/dispatch/2026-09-19-delivery-close-finish-review.md`（主控独立复核，DF-R1–R4）+ 原深度收尾计划。
> 工作区：`<workspace>`（唯一）。HEAD：**`a2ce72bf122574815bf1b9134253a7bd0349c038`（未变）**；分支 `main`。
> **未 commit / push / pull / rebase / reset / stash；未整树暂存；未发版；未提高预算；未覆盖他方文件；未启动图库/文件管理实现或第 4 项。**
> 工具：pnpm **10.33.2** · Node **v24.15.0** · Chromium（Playwright core）· 本轮独占预览端口 **5178**。
> 证据根目录：**`outputs/delivery-close-finish/20260919-03/`**（RunId `20260919-03`）。
> 主控证据目录 `outputs/delivery-close-owner-review-20260919-01/` 与上一轮 `…/20260919-02/` 均**只读、未覆盖**。
> **结论上限：可复核。** 不宣称主控放行、不宣称已发布。

---

## §0 摘要

| 项 | 结果 |
|---|---|
| DF-R1 | 新**完整候选 805 项**（746 tracked + 59 untracked，0 删除），立即复算 **0/0/0**；`.github/workflows/ci.yml`、`.githooks/pre-push`、`.dependency-cruiser.js` **已进候选**；旧候选 4 个漂移项的当前哈希已记录；旧 99 项 candidate 与 171 项 manifest **未覆盖** |
| DF-R2 | 句柄**创建时固定** scope/原文；主控探针 `readIdentityPreserved` / `writeIdentityPreserved` 由 **false → true**；新增专项探针 11 项全过（跨夹具切换 / 延迟 close / 双目的地隔离 / pending 不可读） |
| DF-R3 | 补 0.26 侧双向滞回（R4i）、手势活动窗口 LOD 冻结+释放收敛（R4h）、拖中心时**另一岛不动 + 视口不位移**（R3g2）；邻域检查改为**实际落点必须在 ±0.02 内**才算到达（R4e）；R4c 改用**真实阈值 0.26 / 0.5** |
| DF-R4 | **产品最小修复**：`canvasBackend.tsx` 的 `tracePath` 实现 `M/L/Q/C/Z` 几何指令。主控探针 **exit 1 → exit 0**；单元测试 4 条 **红 → 绿**；浏览器新增 R5d（跨度内无整列空白 + 连线细柱）；负控 `neg-canvas-links` **只**让 R5d 转红 |
| 正常矩阵 | **47/47 PASS，退出码 0**，实际加载 `main-Db31m2so.js`（含本轮产品修复的新 bundle） |
| 行为负控 | **6/6 各自只命中预定 caseId**（+1 连带：`neg-canvas` 因无画布连带 R5c/R5d）；全部 47 项固定集合一致；**环境失败 0** |
| 门禁 | `pnpm gate` **0** · `pnpm build` **0** · `pnpm analyze` **0**；测试 **2489**（12/622/**1502**/353，react +4 = 本轮新增路径测试）；depcruise 530 模块 / 1574 依赖 / 0 违规；lint 1541 warnings + 48 infos（0 error）；budget 全绿（any 0 / tsIgnore 0 / bang **89**/90 / asCast 31/31 / console 4/4 / todo 1/1 / defaultExport 2/2 / bigFiles 4/4） |
| 既有旅程 | `verify-save-lifecycle.mjs` **PASS** · `verify-mode-guard.mjs` **PASS**（同候选、同 bundle） |
| 未关闭 | DF-R1–R4 **全部关闭**；无新增产品阻断。范围外未做：DPR 改造、图片异步缓存、后端大重构、触控/跨浏览器/像素金图 |

---

## §1 起点、复现与来源

### 1.1 复现主控探针（**未覆盖主控证据**）

两个探针各复制一份到本轮独占目录，**只改输出路径与相对导入深度**，断言、期望值、退出码语义一字未动：

| 副本 | 与原件差异 | 复现结果（返修前） |
|---|---|---|
| `outputs/delivery-close-finish/20260919-03/repro/audit-copy.mjs` | `dest` 改本轮目录 + 导入深度 `../../../../` | `candidate.declared=99`；`drift` = CHANGELOG.md / 2026-09-18-delivery-close-report.md / tools/verify-release-123.mjs；`gateConfigs` 三项 `included=false`；`handleProbe.readIdentityPreserved=false`、`writeIdentityPreserved=false`、committed scope=`md:pure` —— **四项复核结论逐条复现** |
| `…/repro/canvas-path-probe-copy.mjs` | 输出文件改本轮目录 | **exit 1**；三类真实路径只调 `save/beginPath/beginPath/stroke/restore`，`moveTo/lineTo/quadraticCurveTo/bezierCurveTo` 计数 **0** |

> 说明：主控 prompt 允许直接运行原件，但那份 `audit.json` / `canvas-path-probe.json` 是主控固化证据；本轮选择**先复制再改输出路径**，确保「禁止覆盖主控或执行者固化证据」零风险。

### 1.2 归属与并发

- 未新建空白工作树；沿用当前完整未提交候选（视觉/度量 + 包 1/2 + 包 3 + 上一轮验收工具与夹具）。
- 开工时工作区与上一轮收尾指纹一致（HEAD 未变、无他方并发写入迹象）；本轮**只**改：`packages/react/src/render/canvasBackend.tsx`（产品）、`packages/react/tests/canvas-backend.test.tsx`（测试）、`tools/verify-release-123.mjs`、`tools/lib/releaseAcceptance.mjs`、`docs/**`。
- 5178 由本轮启动（`--strictPort`）；5175 / 5177 是**他方**服务，未动。

---

## §2 DF-R2 · 文件句柄身份（P2）红→绿

**复核结论**：`makeHandle(name, kind)` 只闭包捕 kind，`getFile()` / `createWritable()` 仍实时调用 `scopeOf(kind)`（读 `window.__fixtureKind`）→ 旧句柄跨夹具切换会读写新夹具。

**修复**（`tools/verify-release-123.mjs` 的浏览器注入，与 Node 端探针使用**同一份**注入源码）：

```js
const makeHandle = (name, kind) => {
  const scope = scopeOf(kind);            // ← 创建时固定
  const originalText = readOf(kind, scope); // ← 创建时固定（原文件内容）
  const readFrozen = () => {              // ← 只用冻结身份，不再看 __fixtureKind
    if (kind === 'json' && staleJson) return canvasJson;  // neg-stalejson 的读取覆盖必须保留
    const last = window.__ledger.latest(scope);
    return last !== null ? last.text : originalText;
  };
  const handle = { name, scope, originalText, getFile: async () => {…readFrozen()…}, createWritable: async () => {…begin(scope, name)…} };
  …
};
```

| 证据 | 返修前 | 返修后 |
|---|---|---|
| 主控 `audit.mjs` 的 `handleProbe` | `readIdentityPreserved=false` / `writeIdentityPreserved=false` / scope=`md:pure` | **`true` / `true` / `md:main`** |
| 本轮专项探针 `repro/handle-identity-probe.mjs`（真实注入 + vm） | — | **11/11 PASS，exit 0**：A1–A3 跨 `main→pure→nested` 仍读 MAIN；B1 write 未 close 时读到的仍是原文（pending 不可读）；B2 延迟 close 落 `md:main`；B3 该 scope 最后快照 = 延迟写入内容；B4 `md:pure` **零** committed；C1–C4 json 句柄读画布夹具、写入落 json、不影响 md、两 scope 各自计数 `1/1` |
| 浏览器侧 | — | 新增 **R1g**：真实页面里取 `__lastOpenHandle`，切 `__fixtureKind` 后同句柄读取一致、延迟 close 仍落 `md:main`、`md:pure`/`md:nested` 计数 0、探针后**复原原文**（不扰动后续旅程） |

### 2.1 返修过程中的一次真实回归（如实记录）

DF-R2 重构最初把 `staleJson` 覆盖从 `getFile` 里丢了，导致 `neg-stalejson` **转为 PASS**（旧假绿负控失效）。本轮在冻结清单下跑负控时**立即发现**（`neg-stalejson => result=PASS`），随即把读取口径收敛到 `readFrozen()`（同时保留「冻结身份」与「stale 覆盖」两个语义），并据此**重建清单、整批重跑**。这正说明负控是承重的：它抓住了验收改动自身引入的鉴别力退化。

---

## §3 DF-R3 · 计划内约束补口（P2）红→绿

| 复核指出的缺口 | 本轮实现 | 实测证据（正常） |
|---|---|---|
| ① 只覆盖 0.5 附近滞回，0.26 侧未验 | 新增 **R4i**：detail 档滞回带 `[0.24, 0.26)`（`LOD_DETAIL_K − LOD_HYSTERESIS`） | `d0 k=0.3022→detail`、`d1 k=0.2530→**detail**`（从上方下来停在带内）、`d2 k=0.2336→skeleton`、`d3 k=0.2466→**skeleton**`（从下方上来停在带内）、`d4 k=0.2672→detail` —— **同一 k∈带内因来向不同得不同档** |
| ② 手势冻结未成为条件 | 新增 **R4h**：页内派发一次大幅 wheel（`deltaY=900`），只等两帧就读 HUD（样本确定落在 120ms 冻结窗口内） | `before k=0.7994 lod=full` → `during k=0.1894（已跨两阈值）lod=**full**（冻结）`，`elapsedMs=17.7 < 120` → 释放后 `k=0.1894 lod=skeleton`（按当前 k 收敛） |
| ③ 拖中心未保护另一岛 | **R3g2**：同批采样乙岛 4 个成员 + 世界变换 | 乙中心/乙框内一/乙框内二/乙挂出一 `Δ=(0,0)`（≤1px）；`translate(635.2433936022253 280.7927677329625) scale(0.611961057023644)` **逐值不变** —— 排除「整体视口平移冒充岛位移」 |
| ④ 邻域落点未纳入条件（near05 实测 0.5349 越过自身目标仍 PASS） | **R4e 重写**：预算内未落到 `目标 ±0.02` 即 `reached=false` → 判红并如实报告未到达 | `near05 kAtStart=0.5148 / reached=true / steps=7`；`near026 kAtStart=0.2776 / reached=true / steps=11`；两者 8 次采样档位与标签集合落定后一致 |
| ⑤ R4c 用 `minOut<0.35` 松散近似声称跨两阈值 | **R4c 改用真实阈值**：`minOut < LOD_DETAIL_K(0.26)` 且 `maxIn ≥ LOD_FULL_K(0.5)` | `minOut=0.1325`、`maxIn=4.5726` |
| 常数核对 | 脚本顶部固定 `LOD_FULL_K=0.5` / `LOD_DETAIL_K=0.26` / `LOD_HYSTERESIS=0.02`，与 `geometry.ts` 逐值一致并注明「变更须同步核对」 | R4g/R4i 的带边界由常数算出（`[0.48,0.50)`、`[0.24,0.26)`） |

已通过的字号/导出/嵌套框/端点检查**原样保留**，未新增触控、跨浏览器或像素金图要求。

---

## §4 DF-R4 · Canvas 连线落笔（**已授权的最小产品修复**）

### 4.1 红 → 绿

| 阶段 | 证据 |
|---|---|
| **红**（修复前） | 主控探针 exit 1，三类路径几何指令 0；新增 4 条单元测试 **AssertionError**（`expected ['save','beginPath',…(3)] to deeply equal […(4)]` 等） |
| **修复** | `packages/react/src/render/canvasBackend.tsx`：`Ctx2D` 增补 `moveTo/lineTo/quadraticCurveTo/bezierCurveTo/closePath`；`tracePath` 改为**有界解析** `M/L/Q/C/Z`（空格与逗号分隔都吃；未知/相对指令**不落笔也不抛错**，静默跳过）；文件头边界声明同步更正（已接入 MapView；触发口径是**布局节点总数 > `CANVAS_AUTO_NODES`(50000)**，不是视口可见数） |
| **绿** | 主控探针 **exit 0**：`M 10 10 L 80 80 → moveTo(10,10),lineTo(80,80)`；`Q → quadraticCurveTo(40,60,80,80)`；`C → bezierCurveTo(20,30,60,70,80,80)`。单元测试 **9/9 通过** |

### 4.2 浏览器连线验证 + 负控

真实 Canvas 后端（`?backend=canvas` + 纯树夹具 + 适配视图）：

| caseId | 判据 | 正常实测 | 负控 `neg-canvas-links` 实测 |
|---|---|---|---|
| R5a | HUD 后端=canvas、有 `<canvas>`、**无** SVG 节点层 | `backend=canvas`、`canvasEls=1`、`svgNodes=0` | 不变（负控不动后端） |
| R5b | 画布尺寸 + 墨量 ≥2000px + 横跨 ≥30% 画布 | `ink=223065`、`spanW=1321`、HUD 连线 8 | 不变 |
| **R5d** | **跨度内无整列空白**（相邻节点被线连通）+ **≥10 条连线笔画量级的细柱** | `spanEmpty=0`、`thinCols=19`、`thinInk=76`（走廊每列 4px，节点卡列 ≥18px） | **`spanEmpty=19`、`thinCols=0` → 红（唯一红项）** |
| R5c | 坐标命中并核对节点身份（≥2 不同节点、跨 ≥2 depth 档） | 命中 `乙叶二/乙叶一/乙叶三/分支乙` 等，`depthsHit` ≥2 | 连带红（无画布 → 0 候选） |

负控机制：只把 `CanvasRenderingContext2D.prototype` 的 `lineTo/quadraticCurveTo/bezierCurveTo` 打成空函数（`roundRect`、`fillText` 照旧）→ 节点卡与文字仍绘制，**只有连线不落墨**。期望值与正常导出件不动。

### 4.3 一处判据替换（说明理由，非放宽）

R5b 原先含「至少 3 条**分离**墨迹带」——那是在连线尚未落笔时可用的**代理指标**（用来代替「三档节点都被画出」）。连线落笔后节点列已被树线连通（实测由 5 条带变成 1 条连通行、`rowRuns=1`），该代理指标**必然失效**。本轮**不再用它**，改由 R5c「按坐标命中并核对节点身份（跨 ≥2 depth）」直接证明多档节点被画出（比数带子更直接），R5b 只保留仍然成立的条件（尺寸/墨量/跨度）。**没有放宽容差、没有删检查、没有改期望值**。

---

## §5 DF-R1 · 新候选清单与差异

### 5.1 旧候选的四个问题（复核结论）与处置

| 问题 | 处置 | 验证 |
|---|---|---|
| 候选声明脚本哈希 `24d3ab92…` ≠ 正式运行冻结清单 `9c7b1635…`（候选生成早于驱动定稿） | 新候选在**全部运行文件定稿后**生成；本轮清单与运行同源 | `df-r1-diff.json` 的 `oldDrift` 四项在新候选里 `nowMatchesNew=true` |
| `CHANGELOG.md` 与原交付回执也和候选哈希不符 | 同上，且本轮**文档收尾后**单独固化交付清单（§5.4） | 同上 |
| `EXCLUDE` 的 `/^\./` 把 INCLUDE 明确列入的 `.github/`、`.githooks/` 再排除 | 新作用域用显式 `FC_INCLUDE`/`FC_EXCLUDE`，**不按前导点排除** | `gateConfigs` 三项 `inOldCandidate=false → inNewCandidate=true`，declared == actual |
| 只是 `git status` 差异集，不足以证明「别的都没动」 | 改为 **`git ls-files`（全部 tracked，含删除项）∪ `git ls-files --others --exclude-standard`** 按作用域过滤 | 804 项；`deleted: 0` |

### 5.2 新旧候选对比

```text
旧（20260919-02/candidate.json）： 99 项（仅 git status 差异）
新（20260919-03/candidate.json）：805 项（746 tracked + 59 untracked，0 删除）
新增 706 项分布：packages 403 / docs 168 / apps 95 / scripts 16 / tools 15 / 根配置 6 / 门禁配置 3
保留但哈希变化 4 项：CHANGELOG.md、docs/dispatch/2026-09-18-delivery-close-report.md、
                      tools/lib/releaseAcceptance.mjs、tools/verify-release-123.mjs
消失项：0
立即复算：declared 805 / recomputed 805 / missing 0 / mismatched 0 / extra 0 → exit 0
```

> 计数随「文档定稿后重建」自然增长：候选在**本回执写入磁盘之后**再生成，本回执自身（`docs/dispatch/…-repair-report.md`）也在候选内（+1 项，`docs` 桶 167→168）。

**作用域（可独立重建）**：`apps/**`、`packages/**`、`tools/**`（除 `tools/graph-engine/`）、`scripts/**`、`docs/**`、`.github/**`、`.githooks/**`、`.dependency-cruiser.js`、`biome.json`、`tsconfig*.json`、`package.json`、`pnpm-lock.yaml`/`pnpm-workspace.yaml`、`CHANGELOG|README|CONTRIBUTING.md`；排除 `node_modules/`、`dist/`、`coverage/`、`tools/graph-engine/`、`_tmp*`、`.codebase-memory/`、`.cursor/`、`outputs/`。
重建命令：`git ls-files -z` + `git ls-files -z --others --exclude-standard` → 按上述规则过滤 → 逐项 SHA256；或直接 `node tools/lib/releaseAcceptance.mjs full-candidate --out=<file>`，复算 `… verify-candidate --file=<file>`。

### 5.3 运行资产的覆盖边界（如实声明）

- 仓库**没有任何 `.css` / `.scss` / `.less`**（`git ls-files` 实测 0 个；样式全部走 token 化的内联样式）。
- 实际视觉/运行资产是 `apps/canvas/index.html`、`apps/canvas/radial.html`、`apps/canvas/public/**`（`demo-assets/board.svg`、`demo-assets/demo-diagram.svg`、`icon.svg`、`manifest.webmanifest`）——**全部在候选内**。夹具 5 份也在候选内。
- **构建产物**（`apps/canvas/dist/index.html` + 实际加载的 `dist/assets/main-*.js` / `radialSurface-*.js`）由**运行输入冻结清单 `inputs.sha256`** 覆盖（11 项，含入口 bundle）。候选（源码/配置）+ 运行输入清单（产物）合起来才是完整可重建方案。

### 5.4 交付清单（文档收尾后单独固化）

`manifest.sha256` + `recompute-receipt.txt` 由 `verify-manifest.mjs` 生成与逐项复算；清单自身、复算回执、生成器脚本三者排除并在回执首部说明。旧 171 项 manifest 与旧 99 项 candidate **未覆盖、未修账**。

---

## §6 门禁与最终候选

```text
pnpm gate    → exit 0  （typecheck ×4；测试 12/622/1502/353 = 2489；
                        depcruise 530 模块 / 1574 依赖 / 0 违规；
                        lint 1541 warnings + 48 infos，0 error；
                        budget：any 0、tsIgnore 0、bang 89/90、asCast 31/31、
                        console 4/4、todo 1/1、defaultExport 2/2、bigFiles 4/4 —— 全部在预算内）
pnpm build   → exit 0  （main-Db31m2so.js 431.71 kB / gzip 140.05 kB；
                        radialSurface-MAh6VJbY.js 228.76 kB —— 与修复前同名同内容）
pnpm analyze → exit 0
```

- **测试数 2485 → 2489**：`apps/canvas 353` 与 `kernel 622`、`free-canvas 12` 不变，`react 1498 → 1502` = 本轮新增的 4 条 Canvas 路径几何测试。**没有删除或合并任何既有用例。**
- **产物变化**：`main-Dd5KCUJD.js → main-Db31m2so.js`（+0.44 kB）—— 本轮产品修复的必然结果；全部浏览器证据都是在新产物上重跑的。
- **既有保护未回退**：`verify-save-lifecycle.mjs` PASS、`verify-mode-guard.mjs` PASS（含慢保存不误清 dirty、另存为目的地、下载不自动离开、IME 组合、端口代次、异步互斥、提交失败重试等既有回归）。
- 本轮未改布局/度量/缓存实现，故未重跑性能基准（引用旧同机测量）。

---

## §7 负控汇总（固定集合 / 目标红项 / 连带红项 / 环境错误）

**固定集合**：正常与全部负控的 caseId 集合**完全一致**（47 项，顺序也相同）：

```text
R1a R1b R1c R1d R1e R1f R1g | R2g R2a R2b R2c R2d R2e R2h R2f
R3a R3b R3i R3j R3c R3d R3g R3g2 R3e R3f R3h
R4a R4b R4c R4d R4e R4f R4g R4i R4h
R5a R5b R5d R5c | R6a R6b R6b2 R6c R6d R6f R6e | R0
```

| 负控 | 机制（期望值一律不变） | 退出码 | 目标红项 | 连带红项 | 环境错误 |
|---|---|---|---|---|---|
| `neg-undoredo` | 运行期省略 Ctrl+Z | 1 | **R1e** | 无 | 0 |
| `neg-stalejson` | json 读取恒返回原始夹具 | 1 | **R6d / R6f** | R6e（再存写回旧内容，语义投影不一致） | 0 |
| `neg-canvas` | 不加速 `?backend=canvas`（回 SVG） | 1 | **R5a / R5b** | R5d、R5c（无画布 → 无墨迹/无候选点） | 0 |
| `neg-endpoints` | 跨框边目标端点写进**独立夹具副本**（`cid:c4`→`cid:c3`） | 1 | **R3d** | 无 | 0 |
| `neg-theme` | 扰动**独立导出 SVG 副本**的字号（+4） | 1 | **R2d** | 无 | 0 |
| `neg-canvas-links` | 只把路径几何指令打成空函数（节点卡/文字照旧） | 1 | **R5d** | 无 | 0 |
| `freeze-guard`（tamper） | 输入冻结清单副本里 `verify-release-123.mjs` 哈希改全 0 | **3** | 输入冻结守卫（打印 mismatched 明细后停止，**不产出 results.json**） | — | — |

每个负控都附带机制有效性证据（如 `neg-stalejson` 的 `allEqualLastCommitted=false / anyEqualToOriginal=true`、`neg-canvas-links` 的 `spanEmpty=19, thinCols=0`、`neg-theme` 的 `perturbApplied=true`），**没有把环境异常算作命中**。

---

## §8 未覆盖与限制（如实保留）

| 限制 | 说明 |
|---|---|
| 真实系统文件选择器 / 保存对话框手势 | 内存句柄替身（无头不可自动化）；DF-R2 只声称**替身**身份语义，不声称产品保存协调器串档 |
| 真实 OS 输入法候选框 | 本矩阵不覆盖（合成 `CompositionEvent` 见 `verify-mode-guard.mjs`） |
| 触控 / 跨浏览器 / 离线 | 不覆盖（仅 Chromium 无头） |
| 跨平台像素金图 | 不做。R5d 用「整列空白 + 细柱」结构判据，不做逐像素基线 |
| Canvas 后端其它能力 | 本轮**只**修路径几何（树线/梁线/箭头）。**未做**：DPR 改造、图片异步缓存、文本布局重构、连线避障寻路、命中检测重构（命中走既有坐标通道） |
| Canvas 触发面 | 显式 `?backend=canvas` 或**布局节点总数 > 50000** 的自动降级；含中心/自由边的文档由产品壳强制 SVG，**这些文档不丢自由边** |
| R4h 冻结窗口 | 以 120ms 空闲释放为契约、页内两帧内采样；窗口内若采样超时会判红（本轮实测 17.7ms）。不同机器负载下的裕度未逐台验证 |
| 滞回与邻域 | 只在当前夹具与视口路径上验证；未穷举所有 k 轨迹 |
| 语义投影 | `semanticCanvas` 只对 `native` 卡定义（夹具仅含 native） |
| 性能 | 未改布局/度量/缓存 → 未重跑基准，引用旧同机测量 |

---

## §9 提交建议（**只给建议，未暂存、未提交**）

在上一轮 7 组建议基础上，本轮新增/变化的归属：

1. **产品修复（DF-R4）** → 归入「视觉/度量基线」组：`packages/react/src/render/canvasBackend.tsx`（`tracePath` 几何 + `Ctx2D` 扩面 + 文件头边界声明）。建议提交信息写明「Canvas 后端连线落笔；触发口径 = 布局节点总数 > 50000」。
2. **测试** → 同组或独立 `test(react)`：`packages/react/tests/canvas-backend.test.tsx`（+4 条路径几何回归，react 1498→1502）。
3. **验收工具** → 归入「验收工具」组：`tools/verify-release-123.mjs`（DF-R2 句柄身份、DF-R3 三处约束、R5d 连线判据、`neg-canvas-links`）、`tools/lib/releaseAcceptance.mjs`（`fullCandidateList`/`verifyFullCandidate` + CLI）。
4. **文档** → 归入「文档」组：本回执、`docs/dispatch/2026-09-18-delivery-close-report.md` 追加章、CHANGELOG 的验收工具条目。
5. **明确不入库**：`_tmp_*`、`tools/graph-engine/`、`.cursor/`、`.codebase-memory/`、`outputs/**`（证据目录按既有纪律留在工作区）。
6. 混合文件按块归属说明沿用上一轮回执 §7（`MindmapStage.tsx` / `App.tsx` / `FreeCanvasStage.tsx` / `packages/react/src/index.ts` / `CHANGELOG.md`）。

---

## §10 服务、清理与停止条款

| 项 | 处置 |
|---|---|
| 5178（本轮 `vite preview`） | **已停止**（收尾执行） |
| 5175 / 5177（他方服务） | 未动 |
| 主控证据 `outputs/delivery-close-owner-review-20260919-01/` | **只读**：两个探针均为副本，原件与 `audit.json` / `canvas-path-probe.json` 未被覆盖 |
| 上一轮证据 `outputs/delivery-close-finish/20260919-02/` | **只读**：99 项 candidate 与 171 项 manifest 保留未覆盖 |
| 临时脚本 | `repro/` 下 4 个定向探针（audit 副本、canvas-path 副本、句柄身份、R5 连线剖面）与 `df-r1-candidate-diff.mjs` 均为**可复跑证据**，保留在本轮目录；无其它临时文件残留 |

**停止条款**：未 commit / push / pull / rebase / reset / stash；未整树暂存；未发版、未升版本号、未改 git config；未提高预算或扩大排除；未删除具名导出；未覆盖他方文件；未启动图库/文件管理实现或第 4 项；单写入执行者串行操作候选源码，未派多个 agent 共改工作树。

**结论：可复核。** 交主控复核。
