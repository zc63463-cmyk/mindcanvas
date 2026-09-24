# 集成回执：codex/workspace-wip 并入 main（异地开发合并测试）

- 日期：2026-09-25（WorkBuddy 会话执行；合并发起人：蒋指导）
- 基线：`main @ 50903a3`（S5-R2 ACCEPT 收口、P0-A/B/C/D、DS-10、P0-FIX-R1、P1-A 在列）
- 合入线：`codex/workspace-wip @ eb7270d`（原主工作区 2026-09-21 快照，Windows 线）
- 合并基点：`8126308`（公开基线）
- 结果分支：`codex/integrate-20260925`；合并提交 `78aa8d9`
- 合并状态：**20 个冲突全部解决**（11 content + 9 add/add）；提交后工作树干净、无残留冲突标记

## 一、冲突解决口径（逐文件核对，非机械取边）

**19 个取 main 侧**，核对依据分五类：

| 依据 | 涉及文件（摘要） |
|---|---|
| 逐机制包含 wip 全部内容（grep 计数逐一命中） | `forest.ts`（islandMeasure / depthBase / measureDepthBase / e.depthBase 全 5:5）、`useDocumentSwitch.ts`（DocumentSaveSession / `session?.beginDocument` 全套 + R1-3 交接位演进） |
| main 代码注释明示取代旧设计 | `useDocumentSaveSession.ts`（「归一化 `SaveDestination` …旧实现的 `destination` 只有句柄」） |
| wip 独有行 = 被取代的旧形态 | `mindmap.ts`（6 行，格式化）、`useAutoSave.ts`（1 行 deps）、`useDocumentActions.ts`（2 行 import/deps）、`MindmapStage.tsx`（102 行；关键符号 preDirHint / uploadToGallery / commandNotice / assetHostRef 在 main 树均有归属） |
| 符号已迁至拆分模块 | `directoryHost.ts`（SCAN_SKIP_DIRS / ASSETS_DIR / writeAsset / ensureAssetsDir / iterate → `directoryHostAssets/Constants/Ops.ts`） |
| 旧块迁移另有归属 | `MindmapStage.tsx`（discardAsk / confirmDiscard 已由 `UnsavedPrompt.tsx` 流程取代；preDirHint 保留） |
| 测试随实现取 main（wip 独有行 0） | `mode-guard` / `no-native-dialogs` / `save-destination` / `unsaved-transition` / `useAutoSave` 五个测试 |
| 文档/工具取 main | `README` / `CHANGELOG` / `public-import.md` / `shared-contracts.md` / `releaseAcceptance.mjs`（含 decodeURIComponent 便携修复）/ `verify-release-123.mjs` |

**1 个取 wip 侧**：`docs/dispatch/2026-09-21-summary-node-s5-report.md` —— wip 版含公开归档横幅 + `<local-path>` 占位（符合公开仓脱敏口径），同时修正 main 侧未脱敏的实路径（`E:/Development/...`）。

## 二、合并净效果

- **vs main：+36 文件 / +5255 −3**
  - 12 篇私有线 dispatch 文档（base-integrate 报告、S1–S5 各评审报告等）
  - 23 个 `tools/graph-engine/` 文件（可选 Python 子工具）
  - 1 处脱敏替换（上述 s5 报告）
- **vs wip 快照：298 个差异文件保留 main 侧演进版本**（36 + 298 = 334，与两侧快照差异总数一致）
- 逐文件核对未发现「wip 独有而 main 缺失」的机制；门禁复跑（下节）为该判定的最终证据

## 三、门禁复跑（合并结果树）

（运行中，结果回填）

| 门禁 | 基线（Mac 实机 09-24） | 合并结果 | 判定 |
|---|---|---|---|
| install --frozen-lockfile | — | 运行中 | — |
| typecheck | 通过 | — | — |
| kernel 测试 | 75 文件 / 708 例 | — | — |
| react 测试 | 162 / 1778 | — | — |
| canvas 测试 | 62 / 740 | — | — |
| lint | 1529 warnings / 48 infos | — | — |
| depcruise | 622 模块 / 1903 依赖 / 0 违规 | — | — |
| budget | 8 项全过 | — | — |
| build | exit 0 / `main-DQeEtSpE.js` | — | — |

## 四、遗留事项（供评审）

- 本次为**合并测试**：结果分支未推送；是否推送/并入 main 由主控决定。
- README「当前分支」段与 CHANGELOG 仍写「workspace-wip 尚未整合」——本合并使其过时，建议 P1-A 评审收口时顺手更新（本批未改，避免超范围）。
- P1-A 状态仍为「已交付、待主控评审」，与本次合并无关（两件事）。
- 冲突解决为机械核对 + 语义判断的混合；13 个代码/测试文件的解决依据已分类记录于 §一，建议复核抽查 `forest.ts`、`useDocumentSaveSession.ts`、`MindmapStage.tsx` 三个代表文件。
