# DELIVERY-CLOSE 深度收尾 · 执行回执 · 2026-09-19

> 输入：`docs/dispatch/2026-09-19-delivery-close-deep-finish-prompt.md`（启动 Prompt）+ `docs/superpowers/plans/2026-09-19-delivery-close-deep-finish.md`（T0–T7 主计划）。
> 工作区：`<workspace>`（唯一）。
> HEAD：**`a2ce72bf122574815bf1b9134253a7bd0349c038`（未变）**；分支 `main`；**未 commit / 未 push / 未 pull / 未 rebase / 未 reset / 未 stash / 未整树暂存 / 未发版 / 未改 git config**。
> 工具：pnpm **10.33.2** · Node **v24.15.0** · Chromium（Playwright core）· 本轮独占预览端口 **5176**。
> 证据根目录：**`outputs/delivery-close-finish/20260919-02/`**（RunId `20260919-02`；`20260919-01` 是同一日更早一次中断尝试，只留下 baseline，已保留未覆盖）。
> **结论上限：收尾候选可复核。** 本文不宣称主控放行，也不宣称已发布。

---

## §0 摘要

| 项 | 结果 |
|---|---|
| 候选指纹 | 开工 98 文件 → 收尾 **99 文件**；相对开工**只有 3 项申报差异**（见 §5.1），**产品源码零改动** |
| 发布矩阵（正常） | **42/42 PASS，退出码 0**，实际加载 `main-Dd5KCUJD.js`（与构建产物一致） |
| 行为负控 | **5/5 各自只让预定 caseId 转红**（`neg-undoredo`→R1e、`neg-stalejson`→R6d/R6f、`neg-canvas`→R5a/R5b、`neg-endpoints`→R3d、`neg-theme`→R2d），**期望值一律未改** |
| 冻结守卫负控 | 篡改输入清单副本 → **exit 3 且不产出 `results.json`** |
| 门禁 | `pnpm gate` **0** · `pnpm build` **0** · `pnpm analyze` **0**；测试 **2485**（12/622/1498/353）；depcruise 530 模块 / 1574 依赖 / **0 违规**；lint **0 error**（1541 warnings + 48 infos = 1589 = 基线）；budget 全绿（any 0 / tsIgnore 0 / bang **89**/90 / asCast 31/31 / console 4/4 / todo 1/1 / defaultExport 2/2 / bigFiles 4/4） |
| 既有浏览器旅程（同候选、同 bundle） | `verify-save-lifecycle.mjs` **PASS** · `verify-mode-guard.mjs` **PASS** |
| 未关闭项 | DC-R1/R2/R3 **均已关闭**；新增 1 条**非 DC 观察项**（Canvas 后端连线绘制，见 §6.1），未修复、未纳入断言 |

---

## §1 起点与归属（T0）

### 1.1 磁盘上的既有返修——逐项判定

| 已有产物 | 判定 | 依据 |
|---|---|---|
| `tools/verify-release-123.mjs`「返修版」（R1e 移到保存之后、R6 结构化核对、`?backend=canvas` 入口、R4 双向扫描） | **已存在 · 本轮复验** | 本轮逐条跑通并在其基础上补强；未重写既有能力 |
| `tools/lib/releaseAcceptance.mjs`（写盘账本 / 语义投影 / 导出解析 / 输入清单 / 指纹） | **已存在 · 但未接线** | 整脚本原先**没有** import 它；账本只在 Node 端存在，浏览器侧仍走「写入即入数组」的旧模型 → 本轮接线（§3） |
| `apps/canvas/tests/fixtures/release-123*.mm.md`、`release-123.mc.canvas.json` | 已存在 · 本轮新增 1 份 | 新增 `release-123-nested.mm.md`（框内成框，见 §4.3） |
| `apps/canvas/src/MindmapStage.tsx` 的 `?backend=canvas` 测试入口 | 已存在 · 只读核对 | `forceBackend` 在 `centerSpecs !== null` / `freeEdges.length > 0` 时**强制 SVG**，参数不得绕开能力边界；无参数时逐字保持旧行为（`MindmapStage.tsx:1233–1247`） |
| CI remote 说明、回执 lint 算术 | 已修 · 仅核对 | `.github/workflows/ci.yml:14–16` 已写明「远端**已配置**（origin）」；本报告与 §7 不再出现 `1591 = 1541 + 48` 类错误算术 |
| 视觉/度量（包 3 本体）、包 1/2 保存与离开实现 | 已复核 · 本轮未改 | 本轮**未修改任何产品源码**（§5.1 指纹可证） |

### 1.2 并发与来源

- 开工时 `outputs/delivery-close-finish/20260919-01/baseline.json`（16:07:22）与本次开工指纹（16:36:22）逐文件比较：**只有 `tools/lib/releaseAcceptance.mjs` 一项不同**，且原因是前一次尝试的 baseline 恰好落在该文件最后一次写盘**之前**（自序问题），不是他方并发修改。
- 除此之外**无未归属变化**；未丢弃、未覆盖任何既有成果。

### 1.3 服务与环境

- 5175 上有**他人遗留**的 `vite preview`（PID 33432，启动时间早于本轮）。按纪律**未停止**它；本轮改用**独占**端口 **5176**（`--strictPort`，PID 26364，本轮启动、收尾已停）。
- 开工时产品源码没有任何文件晚于 `apps/canvas/dist/index.html`，构建新鲜度守卫通过。

---

## §2 DC-R1 · 保存后 Undo 与导图文件级保真

**原缺口（独立复核）**：Ctrl+Z 发生在显式保存**之前**；`:has-text("叶子甲一")` 也匹配 `叶子甲一改`；`afterUndo` 采样时点与动作不一致；核对是「拼接全部历史写入」而非最后一份快照。

| 环节 | 状态 | 证据 |
|---|---|---|
| 保存**之后**再 Ctrl+Z | 已有 | R1e 在 `saveViaClick()` 之后执行 |
| 按 nodeId 精确核对（旧标题回退、新标题消失） | 已有 + **本轮加固** | R1b 断言 `nodeTextById(leafId) === '叶子甲一改'` **且** 无任何节点文本含旧标题却不含新标题（消除子串误判）；R1e 断言 `=== '叶子甲一'` 且标签集合内无 `叶子甲一改` |
| 保存确认 = **本次新的已完成写入** | **本轮新增（T1）** | 账本契约：保存前记 `committedCount`，保存后 `waitForFunction(count > before)`；不再靠 `writes.length >= 1`、固定睡眠或历史「已保存」文本 |
| 单份成功快照（不拼接历史） | 已有 + **本轮接线** | `lastWriteText()` 只读 `ledger.latest(scope)`（`close()` 成功才入账） |
| 重开保真（不要求沿用旧 Undo 历史） | 已有 + **本轮加固** | R1f 从快照解析 `###` 标题，断言重开标签**含该标题**且**不含另一版本标题** |

**正常证据（`normal/results.json`）**

```text
R1c save={scope:"md:main", before:0, after:2, newCommit:true, state:"✓ 已保存"}
    bytes=286  快照含「叶子甲一改」+「一级分支的描述」+「背面标题」
R1d 保存前后世界变换逐值相同（不 reset/fit）
R1e afterUndo="叶子甲一"，labels 内无「叶子甲一改」；tAfterUndo 与保存前同一 transform
R1f refTitle="叶子甲一"、otherTitle="叶子甲一改"（重开标签含前者、不含后者）
```

**有效负控（`controls/neg-undoredo/`）**

```text
exit=1  FAIL  failedCaseIds=["R1e"]  passed=41/42  envFailures=0
R1e detail: {"undoExecuted":false,"afterUndo":"叶子甲一改","labels":[...,"叶子甲一改",...]}
```
只省略 Ctrl+Z（期望值不变），保护性断言转红且**只**它转红 → 断言有鉴别力。

**限制**：Undo 走 UI 级 `Control+z`（Chromium 键盘事件），不是 OS 级输入法/硬件键盘验证；「保存不清 Undo」只在本夹具与本视口下验证。

---

## §3 验收基础设施可信化（T1）

| 项 | 实现 | 证据 |
|---|---|---|
| 写盘替身 = **账本** | `createWriteLedger()`（`tools/lib/releaseAcceptance.mjs`）：`begin` 发**尝试编号**；`write()` 只记 pending；`close(finish)` 先 `await` 完成、**成功才入 committed**；失败抛出不入账；`getFile` 只读 `latest(scope)` | 每次运行先跑 Node 端自检，落 `<out>/ledger-selfcheck.json`（正常与 5 个负控目录各一份，**7 步全 ok**）：`pending 不可读` / `issued 只是尝试编号` / `两个 pending 都不进 committed` / `延迟 close 期间不可读、完成后可读` / `reject close 如实抛出` / `reject close 不新增成功记录` |
| 浏览器侧**真的用同一份** | 页面里 `new Function("return "+WRITE_LEDGER_SOURCE)()`；`WRITE_LEDGER_SOURCE` 固定为**求值即得实例**的表达式 | 启动自检 `assertInjectionReady()`：账本 / 两个 picker 替身任一缺失即 **envFail → exit 3**（本轮首次跑就靠它暴露了「账本被当成工厂函数」的接线错误，见 §5.3） |
| 显式保存语义 | 保存前捕获完成序号 → 等待本次新完成写入 + UI 非 saving | R1c/R3f/R6c/R6e 的 `save.newCommit===true` |
| 证据目录独占 | `--out=<dir>`；截图 `shots/`、导出原件 `exports/`、结果 `results.json`、账本自检 | 正常目录与 5 个负控目录各自独立，**不共享**同名截图/导出件 |
| 结构化结果 | `cases[]`（稳定 caseId / 期望写在 name / 实际在 detail）+ `summary{total,passed,failed,failedCaseIds,envFailures,result,exitCode}` + `bundle{expected,loaded}` + `pageErrors` | 见各 `results.json` |
| 未捕获异常不伪装 PASS | `page.on('pageerror')` + 页内 `window.addEventListener('pageerror')` → `R0` | `R0` 在正常与全部负控中均为 `ok=true`（`pageErrors: []`） |
| 运行输入冻结 | `--inputs=<file>`：脚本 + 共享 helper + 5 份夹具 + 产物入口 bundle（11 项）逐项复算；不一致**停止该运行**（exit 3） | `inputs.sha256`（首行写 reason，变更后重建并保留旧清单）；篡改副本 → **exit 3 且不产出 `results.json`** |
| 深度语义投影 | `semanticCanvas()`（placements + edges 按 uuid 排序，**显式豁免**写入即变的 `createdAt/updatedAt`）；夹具只含 `native` 卡，其他 kind 不套用 | R6e `proj2 === proj1` |

---

## §4 DC-R2 / DC-R3

### 4.1 DC-R2 · 自由画布语义往返

**原缺口**：保存判据只看「JSON 非空 / 含 placements / 与原文本不同」；重开只看卡片数量；比较的是拼接字符串。

| 要求 | 状态 | 证据 |
|---|---|---|
| 最后 committed JSON 可解析、按 uuid 精确核对 front/back/face/transform/端点 | 已有 + 本轮接线 | R6c：3 placements、`pA.front.body`、`pB.face==='back'`、`pB.back.body`、`edgePairs` 与原夹具一致 |
| **屏幕位移换算世界位移（÷ scale）** | **本轮加固** | R6b2 先把 scale 从 **1 推离到 1.4993**（3×wheel −90，以卡甲为锚）；R6c 断言 `aTransform.x === origA.x + 120/1.4993`，实测 **140.03721730301692** vs 期望 **140.03721823464508**（差 7e-8 ≪ 容差 1 世界单位）。若沿用「120 屏幕像素当 120 世界单位」，此处会是 180 → 差 40，**必然失败** |
| 重开核对真实 UI（文本/翻面/相对位置） | 已有 + **本轮加固** | R6d：`reopenedScale=1.4993`；屏幕相对位移 (−419.76, −194.89) ÷ scale = 世界 (−279.96, −129.98) == 期望 (−279.9628, −129.9814) |
| 按 **edgeUuid** 核对端点 | **本轮新增** | R6d 用 `getScreenCTM` 把每条 `[data-fc-edge][data-fc-edge-uuid]` 的端点换算到屏幕，逐条比对卡中心：`ed_r123_1`→甲/乙、`ed_r123_2`→乙/丙，端点与卡中心差 **0.02px**（容差 2px） |
| 再存语义一致 | 已有 + 本轮投影 | R6e `semanticCanvas(j2) === semanticCanvas(last)` |
| **读来源**（不得退回旧夹具） | **本轮新增** | R6f：清空读取日志后的重开读取 `allEqualLastCommitted=true` 且 `anyEqualToOriginal=false` |

**有效负控（`controls/neg-stalejson/`）**：`exit=1`，`failedCaseIds=["R6d","R6f","R6e"]`；R6f `allEqualLastCommitted=false / anyEqualToOriginal=true`，R6d 读回**原始夹具**（正面全为「本轮改前」、世界相对位移 −360/−170）。这正是复核证实的旧假绿形态——现在被识别。

**限制**：语义投影只对 `native` 卡成立（helper 已注明）；系统文件选择器手势仍为内存句柄替身；R6 的换算只在 scale≈1.4993 下验证，其他 scale 未逐一遍历。

### 4.2 DC-R3 · 三主题 / 动态几何 / LOD

| 固定 caseId | 本轮实现 | 正常证据 |
|---|---|---|
| VIS-THEME | R2g 按**标签**定位三主题（经典/贴纸/玻璃）并核对 `aria-pressed` **身份**；R2a 断言每主题实测字号 == **该主题 token 声明值**（classic 13/12/9、sticker 14/13/10、glass 13/12/9）且严格阶梯 | R2a 全绿；R2c 双击命中且编辑框字号 == 绘制字号（≤10%，跨档差 25%） |
| VIS-THEME 颜色 | R2h：叶标题 ≠ `CHROME.textMuted`；**glass 亮度更高**（实测 `rgb(211,215,224)` 通道和 650 > muted 493）；`desc` 恒用 muted（实测 `rgb(152,162,179)`） | R2h 全绿（DEPTH-VIS-1.1 L1/L2/L4） |
| GEO-FRAME | R3i：框壳**包含所属行**、同壳相邻行/挂出行两两不重叠（>0.5px² 即红）、**外部卡不压框壳**（同一视口变换下比较） | 1 壳 / 3 行（2 普通 + 1 挂出）/ `rowsInsideShell=true` / 两类重叠均为空 |
| GEO-FRAME 嵌套框 | **新增夹具 + R3j**：`release-123-nested.mm.md`（外框与内框都声明 `frame`） | 2 个壳（壳根分别为「外框」「内框」）、各自行完整落在自己壳内、行互不重叠、`duplicatedRowIds=[]`（无节点被两壳重复当行） |
| GEO-EDGE | R3d 用「起/终最近节点唯一性」钉端点归属（不靠魔法容差），并按要求先 `fitView()` 让**双端同时可见**后截图 | `match.startDist=0 / endDist=0`（端点正好落在两端点盒内），`bothVisible=true` |
| GEO-CENTER | R3e 升格（角标按 id）、R3f 落盘含 `centers` 与坐标、R3g 整岛跟移（≥6 成员 ±5px，含嵌套中心成员）、R3h k<0.35 出岛卡（含嵌套迷你卡）且回 full 收起 | 全部 ok=true |
| VIS-LOD | R4a/R4b 单向档位序列不反向；R4c 确实跨越两阈值；R4d 回 full 可读；R4e 阈值邻域静止采样落定后一致；R4f 检测器自检 | 全部 ok=true |
| **滞回带** | **本轮新增 R4g**（真实 wheel）：先站 0.56，再降到带内 | 实测 `h1 k=0.4931→full`、`h2 k=0.4685→detail`、`h3 k=0.4860→detail`、`h4 k=0.5026→full` —— **同一个 k∈[0.48,0.5) 因来向不同得到不同档位**，`LOD_HYSTERESIS=0.02` 语义被真实旅程钉住 |

常数核对：`geometry.ts` 实测 `LOD_FULL_K=0.5`、`LOD_DETAIL_K=0.26`、`LOD_HYSTERESIS=0.02`（与计划一致，未硬套旧值）。

**行为负控（本轮从「改期望值」改为「扰动独立副本」）**

| 负控 | 机制 | 结果 |
|---|---|---|
| `neg-theme` | 在**独立导出 SVG 副本**里把「分支甲」字号 +4（正常导出件、产品、期望值都不动） | `exit=1`，**只** R2d 红；`perturbApplied=true`，副本 `fontSize=16` vs 画布 12；扰动未命中会走 envFail(exit 3) 而非算命中 |
| `neg-endpoints` | 把跨框边目标端点写进**独立夹具副本**（`cid:c4`→`cid:c3`），期望对仍是 甲内框子一→乙挂出一 | `exit=1`，**只** R3d 红；`endpoints.match=null` |

### 4.3 DC-R3 · 真 Canvas 后端与导出

| 要求 | 实现 | 正常证据 |
|---|---|---|
| 用纯树夹具强制 Canvas，断言 HUD 后端 + 表面存在 + **无 SVG 节点层** | R5a | `backend="canvas"`、`canvasEls=1`、`svgNodes=0`（不看「有没有 canvas 元素」就下结论） |
| **指定区域**有有效绘制 | R5b：画布像素找墨迹带，要求墨迹横跨 ≥30% 画布**且至少 3 条分离带** | `ink=12046`、bbox x∈[681,1128]、5 条列带各自有墨、1 条行带；`totalNodes="9 / 9"` |
| **命中至少一个已知节点并核对身份** | R5c：每带的卡中心双击 → 读编辑浮层文本 → 必须命中夹具已知节点，且命中身份**跨越 ≥2 个 depth 档** | 5 次命中：`甲叶二 / 乙叶一 / 纯树根 / 分支甲 / 分支乙`，`depthsHit=[0,1,2]`（三档全中） |
| 三主题 SVG 逐节点字号 + 颜色 | R2d 用 helper `svgNode` 解析导出件，与画布计算样式比对 | 三主题 × 3 节点全绿（字号差 <0.51，颜色经 `normalizeFill` 归一后相等） |
| PNG 解码 + **有效节点内容** | R2e：`parsePngHeader` 解签名/IHDR；`svgViewBox`+`svgNode` 把节点世界盒**精确映射**到 PNG 像素（PNG = 导出 SVG 的 scale=2 栅格化）；背景取**导出件自身的 canvas 色**（不再把「深色」写死，classic 浅底下旧口径会退化成恒真） | classic：root ratio 0.995 / branch 0.999 / leaf 0.095，各区域去重色 ≥2；`signature=true`、2934×320 |
| 导出原件落盘、不与负控互相覆盖 | `exports/release-123-theme{N}-{themeId}.svg/.png`（负控件带 `-perturbed` 后缀、写进自己的目录） | R2f |

**有效负控（`controls/neg-canvas/`）**：不加速 `?backend=canvas` → `backend="svg"`、`canvasEls=0`、`svgNodes=9`，R5a/R5b 转红（R5c 因无候选点连带失败，属连带而非环境异常）。

---

## §5 门禁、指纹与复算

### 5.1 候选指纹（开工 / 收尾两次比较）

`baseline.json`（98 文件）→ `candidate.json`（99 文件），**逐文件 SHA256**：

```text
changed: tools/lib/releaseAcceptance.mjs, tools/verify-release-123.mjs
added:   apps/canvas/tests/fixtures/release-123-nested.mm.md
gone:    （无）
HEAD:    a2ce72b → a2ce72b（未变）
```

即：**产品源码（`apps/*/src`、`packages/*/src`）零改动**；全部差异都是验收工具与夹具，均已在本报告申报。除申报项外**没有未归属变化**。

### 5.2 门禁（`gates/`）

```text
pnpm gate    → exit 0   （typecheck ×4 Done；测试 12/622/1498/353 = 2485；
                          depcruise 530 模块 / 1574 依赖 / 0 违规；
                          lint 1541 warnings + 48 infos = 1589，0 error；
                          budget 全绿：any 0、tsIgnore 0、bang 89/90、asCast 31/31、
                          console 4/4、todo 1/1、defaultExport 2/2、bigFiles 4/4）
pnpm build   → exit 0   （main-Dd5KCUJD.js 431.27 kB / gzip 139.86 kB —— 与改动前同名同内容）
pnpm analyze → exit 0
```

**产物未变**：构建前后入口 bundle 名与哈希一致（`main-Dd5KCUJD.js`），因此本轮全部浏览器证据（含负控）与门禁产物同源。测试计数与复核基线一致（2485），**未删除/合并任何用例**。

### 5.3 本轮实际发现并修正的问题（只动验收工具）

1. **账本被当成工厂函数**：`WRITE_LEDGER_SOURCE` 原为 `(function createWriteLedger(){…})`，页面里求值得到的是**函数本身**，`ledger.latest` 不存在 → 夹具读取链整体失效（症状：全程显示内置示例的 25 个节点）。修正为求值即得实例，并加启动自检 `assertInjectionReady()`（缺失即 envFail/exit 3），使这类接线错误**不可能静默混过**。
2. **json 读取回退错用 md 夹具**：`readOf` 曾对所有 kind 回退到 `fixtureOf()`，导致「上一轮 fixtureKind=pure」时画布夹具被当成纯树文本读取（症状：R6 卡片数 0）。修正为 json 恒回退到画布夹具。
3. **滚轮落点在目标附近来回越界**：固定步长在 k≈0.5 时会在 0.4947↔0.5107 循环不收敛（滞回旅程卡死）。改为步长随距离自适应、下限 4 格。
4. **嵌套框夹具语义写错**：首版只给内层节点写了 `frame`，外层不是框 → 只有 1 个壳（探针 `repro/r3j-probe.mjs` 实测）。补上外层 `frame` 后得到 2 个壳；并据此**修正断言口径**：产品把嵌套框的壳放在**外壳旁边**（挂出外包络不属于 `[data-frame-shell]` 的盒），因此断言改为「各自成壳 + 行在各自壳内 + 行互不重叠 + 无重复成行」，**不是**硬套「内壳被外壳几何包含」。
5. **R6 换算在 scale=1 下无鉴别力**：实测默认 `viewport.scale=1`，旧断言（120±16 世界单位）与正确写法同值。改为拖动前把 scale 推到 1.4993，并在 scale≠1 下比较（见 §4.1），另加 `R6b2` 显式把关。

以上 5 项**全部只改验收工具/夹具**；没有为了让断言变绿而放宽容差、提高预算或删除检查。

### 5.4 清单与复算

- `inputs.sha256`：运行输入冻结清单（11 项），首行记录 reason；驱动脚本变更后**重建并保留旧清单**（旧内容见 §5.1 指纹与 git 历史外的 `prefreeze*/`）。
- `manifest.sha256` + `recompute-receipt.txt`：由 `verify-manifest.mjs` 生成与复算；**清单自身、复算回执、生成器脚本**三者排除并在回执首部说明；`missing/mismatched/extra` 三项在回执中列出。

---

## §6 未关闭项与限制

### 6.1 未关闭观察项（**非** DC-R1/R2/R3 阻断，本轮未修复、未纳入断言）

**O-C1 · Canvas 后端不绘制连线（代码审阅发现）**

- 位置：`packages/react/src/render/canvasBackend.ts` 的 `tracePath()`（文件内自述「骨架：M 开路径，坐标绘制留主循环接入时补全」）——它只对 `M/m` 调用 `ctx.beginPath()`，**不产生任何线段/曲线指令**；`drawScene` 的 `case 'path'` 随后 `stroke()` 一个空路径 → 实际不落墨。文件头的「未接入 MapView 主渲染循环」说明也已把该骨架列为待接。
- 影响面：仅当显式 `?backend=canvas` 或**可见节点 > 50 000** 自动降级时。此时节点卡与文字会绘制，**树边/自由边不显示**。
- 本轮处置：**不修复**（属于 Canvas 后端渲染实现，超出「最小修复验收断言暴露的产品缺陷」与本轮授权边界，且计划明确不新增功能/不大规模重构）。R5 的断言只覆盖「后端身份 + 节点绘制 + 坐标命中」，**不声称** Canvas 连线已验证。
- 建议：作为独立事项立项（`tracePath` 补 M/L/Q/C 指令 + `CanvasSurface` 的 DPR/尺寸口径 + 端到端像素对照），由主控决定是否纳入下一批。

### 6.2 如实保留的限制

| 限制 | 说明 |
|---|---|
| 真实系统文件选择器 / 保存对话框手势 | 由内存句柄替身顶替（无头不可自动化）；**不**声称操作了系统选择器或真实磁盘 |
| 真实 OS 输入法候选框 | 本矩阵不覆盖；合成 `CompositionEvent` 验证见 `verify-mode-guard.mjs` |
| 触控 / 跨浏览器 / 离线 | 不覆盖（仅 Chromium 无头） |
| 跨平台像素金图 | 不做。PNG 只做「解码成功 + 宽高合理 + 逐节点区域与**导出背景**不同」；不建立逐像素基线，容许抗锯齿差异 |
| PNG ↔ Canvas 后端 | 两条**独立**证据链，不互为替代（PNG 来自 SVG 后端栅格化） |
| R6 换算 | 仅在 scale≈1.4993 下验证，其他 scale 未逐一遍历 |
| 语义投影适用范围 | `semanticCanvas` 只对 `native` 卡定义；夹具仅含 native，其他 kind 未套用 |
| 性能 | 本轮**未**改布局/度量/缓存实现，故未重跑基准，引用旧同机测量并注明候选差异（产品源码零改动） |
| CI | 未推送，本机结果**不**代表 Linux/Node 22 的远端 CI 实测 |

---

## §7 提交建议（**只给建议，未暂存、未提交**）

工作区分组建议（每条独立可提交；同一文件跨组时按块归属或整体并入主组）：

1. **视觉/度量基线（包 3 本体）**：`packages/react/src/theme/{tokens,types}.ts`、`render/{geometry,NodeG,MapView,domMeasure,sceneBuilder}.ts`、`chrome/{DescBlock,GrowthCommentPanel}.tsx`、`chrome/noteSizing.ts`、`demo/pipeline.ts`、`tests/{node-card-style.test.tsx,ranked-measure.test.ts,visual-rank.test.ts}`、`packages/kernel/src/layout/{measure,branching,layouts}.ts`、`packages/kernel/tests/measure-depth.test.ts`。
2. **保存生命周期（包 1）**：`apps/canvas/src/hooks/{useDocumentSaveSession,useFreeCanvasDocument,useAutoSave,useDocumentActions}.ts`、`apps/canvas/src/documentLifecycle.ts`、`tests/{save-lifecycle,save-destination,free-canvas-save-lifecycle,useAutoSave,useDocumentActions}.test.tsx`、`package.json` 中 `demo-flip`/fixture 相关块。
3. **离开保护（包 2）**：`apps/canvas/src/{UnsavedPrompt.tsx,draftFlush.ts}`、`hooks/useUnsavedTransition.ts`、`hooks/useDocumentLeaveRegistration.ts`、`packages/react/src/edit/{compositionGuard,draftSessions}.ts`、`chrome/{NoteBackEditor,NotePopover}.tsx`、`edit/OverlayEditor.tsx`、`free-canvas/NativeCard.tsx`、`tests/{unsaved-transition,mode-guard,free-canvas-leave,leave-entry-matrix,note-back-leave}.test.tsx`。
4. **类型门禁**：`apps/canvas/tsconfig.test.json`、`apps/canvas/package.json` 的 `typecheck` 块、`.githooks/pre-push`、`.github/workflows/ci.yml`、`tests/no-native-dialogs.test.ts`。
5. **结构拆分**：`packages/kernel/src/layout/{mindmap,frameLayout,forest}.ts`、新增 `layout/{linkGeometry,frameHangGeometry,frameIslandGeometry,frameTreeGeometry}.ts`、`packages/react/src/render/domMeasure.ts` 的 `WeakMap` 块。
6. **验收工具（含本轮深度收尾）**：`tools/verify-release-123.mjs`、`tools/lib/releaseAcceptance.mjs`、`tools/verify-save-lifecycle.mjs`、`tools/verify-mode-guard.mjs`、`apps/canvas/tests/fixtures/release-123*.mm.md`、`release-123.mc.canvas.json`（新增 `release-123-nested.mm.md`）。
7. **文档**：`README.md`、`CONTRIBUTING.md`、`CHANGELOG.md`、`docs/roadmap/2026-09-15-open-items.md`、`docs/specs/2026-09-18-depth-visual-hierarchy-design.md`、`docs/dispatch/*`、`docs/superpowers/plans/*`。

**混合文件提示（按块归属）**：
- `apps/canvas/src/MindmapStage.tsx` 同时含「视觉 rank 接线」与「`?backend=canvas` 验收入口」→ 建议整体并入组 1，并在提交信息写明两端；`FreeCanvasStage.tsx`/`App.tsx` 跨保存与离开两组 → 建议整体并入组 2 并在信息中列出离开登记块。
- `packages/react/src/index.ts` 同时含视觉导出与包 2 新增导出（`draftSessions`/`compositionGuard`）→ 建议整体并入组 2，或按块拆：视觉导出归组 1、草稿会话导出归组 2。
- `CHANGELOG.md` 含四组说明 + 本轮验收工具条目 → 建议与组 7 一起提交，**不要**拆到各组造成同一文件多次改动。
- 明确**不入库**：`_tmp_93540_*`、`_tmp_fe-frame-visual.mm.md`、`tools/graph-engine/`、`.cursor/`、`.codebase-memory/`、`outputs/`（证据目录按既有纪律保留在工作区）。

---

## §8 服务与清理

| 项 | 处置 |
|---|---|
| 5176（本轮启动的 `vite preview`，PID 26364） | **已停止**（收尾执行） |
| 5175（他人遗留的 `vite preview`，PID 33432） | **未停止**（非本轮启动；仅记录其存在，避免端口冲突） |
| 共享缓存 / 其他任务资源 | 未删除、未改动 |
| 临时脚本 | `repro/r3j-probe.mjs`、`repro/r6-zoom-probe.mjs` 为**可复跑定向探针**，保留在本轮证据目录（只读、不参与 PASS/FAIL）；无其他临时文件残留 |

---

## §9 停止条款遵守

- 未 commit / push / pull / rebase / reset / stash；未整树暂存；未发版、未升版本号、未改 git config。
- 未启动图库 / 文件管理功能实现，未启动第 4 项 Agent 验证。
- 未动 `tools/graph-engine/`、`_tmp_93540_*`、`.codebuddy/`、`.cursor/`、`.codebase-memory/`。
- 未提高预算、未扩大排除项、未删除具名导出、未大规模重构、未改禁区。
- 只按块修改「验收工具 + 夹具」；产品源码逐字未动（§5.1）。
- 单写入执行者串行操作候选；未派多个 agent 共改工作树；隔离只做只读探针，未以旧 HEAD 冒充候选。

**结论：收尾候选可复核。** 交给主控，等待复核裁决。
