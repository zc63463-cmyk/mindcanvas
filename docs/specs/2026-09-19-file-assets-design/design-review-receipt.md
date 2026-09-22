# 设计回执：FILE-ASSETS-DESIGN

任务：MindCanvas 文件管理与图库增强设计｜日期：2026-09-19｜状态：**设计候选可复核**

---

## 1. 交付物

全部落在独占目录 `docs/specs/2026-09-19-file-assets-design/`（创建前不存在同任务产物，未使用 `-r2` 后缀）：

| 文件 | 对应任务书条目 | 主要内容 |
|---|---|---|
| `README.md` | §8-1 | 结论、现状/提案区分口径、方案推荐、范围、阅读顺序、DEC-1…DEC-5 |
| `current-state.md` | §8-2 | 能力矩阵（含画布 × 存储场景 × 原生接口）、调用链、源码锚点索引、R-01…R-18 风险与验证状态 |
| `shared-contracts.md` | §8-3 | 身份模型（I-1…I-9）、数据流、四个状态机、接口草案（含分层归属）、A/B/C 方案比较、迁移表 M1–M10 与回退策略 |
| `file-management.md` | §8-4 | 信息架构、逐项操作设计、删除当前文档的三阶段流程、5 组文字线框与文案表、检索/键盘/a11y、批量操作论证、既有/新增对照 |
| `asset-library.md` | §8-5 | 归属与筛选两维模型、发现与预览、懒加载/分页目标、插入与撤销、同名三选、四类删除、上传三态、缓存与代次、断图修复、自由画布缺口、SVG 安全边界、5 类线框 |
| `acceptance-and-backlog.md` | §8-6 | 能力降级表 G1–G12、F1–F5/A1–A7/X1–X2 联合验收（含故障注入与负控）、测试映射（真实文件名与现状断言）、P0–P2 六阶段拆包 |
| `design-review-receipt.md` | §8-7 | 本文件 |

本目录**未**新增 HTML 原型、未新增运行输出、未沿用旧轮证据编号。

---

## 2. 阅读的文件

### 2.1 直接完整读取（关键判断的锚点来源）

```text
docs/dispatch/2026-09-19-file-assets-design-dispatch.md
docs/dispatch/2026-09-19-file-assets-design-start.md
docs/dispatch/2026-09-19-delivery-close-final-acceptance.md
docs/roadmap/2026-09-15-open-items.md
apps/canvas/src/fileManagerShared.ts
apps/canvas/src/fileTreeModel.ts
apps/canvas/src/documentLifecycle.ts
apps/canvas/src/hooks/useDocumentActions.ts
apps/canvas/src/hooks/useDocumentSaveSession.ts（§1-§4，L20-160）
apps/canvas/src/MindmapStage.tsx（L780-930）
packages/react/src/edit/directoryHost.ts（L25-165、L200-410）
packages/react/src/edit/docLibrary.ts（L1-130、L300-320）
packages/react/src/chrome/assetHost.ts
packages/react/src/chrome/assetTypes.ts
packages/react/src/chrome/assetDiagnostics.ts
packages/react/src/chrome/idbAssetHost.ts
packages/react/src/chrome/workspaceAssetHost.ts
packages/react/src/chrome/AssetPanel.tsx（L20-140）
```

### 2.2 委托子代理调查后交叉核对

由三个只读探索任务完成结构梳理，其结论凡被本包当作事实引用者，均已在关键处由直接读取或定向检索复核：

```text
apps/canvas/src/FileManager.tsx / FileManagerModal.tsx / FileManagerTree.tsx
apps/canvas/src/FileManagerContextMenu.tsx / FileManagerChrome.tsx / canvasDocHost.ts
apps/canvas/src/hooks/ 全部 13 个文件（saveGuard / useAutoSave / useCanvasDegradeNotice /
  useDocumentActions / useDocumentLeaveRegistration / useDocumentSaveSession / useDocumentSwitch /
  useEdgeActions / useEntityPick / useExportActions / useFreeCanvasDocument / useUnsavedTransition /
  useRadialStage）
apps/canvas/src/draftFlush.ts / UnsavedPrompt.tsx / SidePanels.tsx
apps/canvas/src/FreeCanvasStage.tsx（结构与端口）
packages/react/src/edit/：directoryTypes.ts / handleStore.ts / document.ts / save.ts /
  draftSessions.ts / compositionGuard.ts
packages/react/src/chrome/：assetViews.tsx / assetIcons.ts / exportPng.ts / exportSvg.ts
packages/react/src/render/：assetRef.ts / nodeIcon.ts / NodeG.tsx / dropSensing.ts
packages/react/src/free-canvas/**（字面命中计数：asset / icon / media = 0）
docs/specs/2026-08-28-asset-gallery-design.md（既有图库设计，用于区分已有/新增）
```

### 2.3 定向检索（用于核实具体断言，未整文件读取）

```text
apps/canvas/tests/file-manager-tree.test.tsx / file-manager-dialogs.test.tsx /
  save-destination.test.tsx（用例标题）
packages/react/tests/directory-host.test.ts（用例标题）
packages/react/src/chrome/assetIcons.ts（INLINE_SVG_LIMIT）
packages/react/src/render/MapView.tsx（resolveAssetUrl / assetBaseUrl / onAssetDrop / onAssetFiles）
apps/canvas/src/MindmapStage.tsx（onAssetFiles / onAssetDrop / isMissing 接线核对）
apps/canvas/src/**、apps/canvas/src/*.tsx（isMissing / onInsertAs / onAssetDrop 命中）
packages/react/src/render/svgTint.ts（导出符号）
apps/canvas/tests + packages/react/tests 文件清单
```

---

## 3. 修改的文件

**产品侧：零修改。**

```text
git status --porcelain 行数：开工前 123 → 交付后 124
新增条目：?? docs/specs/2026-09-19-file-assets-design/   （本包唯一新增）
```

未修改：产品源码、测试、门禁配置、验收工具、旧回执、固化清单、旧证据、`tools/graph-engine/`、`_tmp*`、`.codebuddy/`、`.cursor/`、`.codebase-memory/`、他方服务。未执行 `pull/rebase/reset/stash`，未提交、未暂存、未推送、未发布。

---

## 4. 未运行项（明确清单）

| 未做 | 说明 |
|---|---|
| 未运行任何测试 | 本包不重跑全仓门禁；2489 测试与 gate/build/analyze 结论沿用 20260919-03（来源见 `current-state.md` §1），**不写成本轮实跑** |
| 未运行浏览器脚本 / 探针 | 未启用预览服务，未占用端口 |
| 未做性能测量 | `asset-library.md` §2.4 的懒加载/分页指标是**拟定目标**，明确标注「本包未测量」 |
| 未做真实目录改名/删除/迁移试验 | 未在真实工作目录上验证 R-01/R-02/R-04；未扫描用户磁盘 |
| 未迁移任何数据 | 迁移表 M1–M10 是设计，不是执行记录 |
| 未验证跨浏览器 | Firefox / Safari 对 File System Access API 与 IDB 持久化的行为标为「未验证」（G11） |
| 未验证触控 / 真实 OS 输入法 / 离线 | 保持 DELIVERY-CLOSE 的既有未覆盖口径，列为人工验收项，不用替身冒充 |
| 未复算 808 项候选 | 引用 `outputs/delivery-close-finish/20260919-04/candidate.json` 作为起点边界，不重新复算、不改旧清单 |
| 未核对自由画布 `.mc.canvas.json` 完整格式 | 只确认其宿主与入口，资产字段设计留给 P1-C |

---

## 5. 设计局限

1. **行号会漂移**。工作树含 123 条未提交变更，本包交付后若有他方改动同一文件，`路径:行号` 可能失效；正式实现时请以符号名回查（锚点表已同时给符号名）。
2. **18 条风险线索未实测**（R-01…R-18）。凡标【线索】者均为读码推导，`current-state.md` §5 每条附了复核办法。**任何一条都不得在未经实测的情况下写成已确认缺陷。**
3. **接口草案未经编译**。`shared-contracts.md` §4 的类型是设计语言，未过 TypeScript 编译，也未做类型层冲突检查；P0-0 落地时会暴露命名与依赖方向的细节问题。
4. **迁移表未验证实际数据量**。未统计真实环境里 `mindcanvas.library.v1` / `mindcanvas.starred.v1` 的条目规模与脏数据形态；「无法确定归属」的实际比例未知。
5. **引用扫描成本未测量**。「完整检查引用」需要一次作用域遍历 + 每篇文档抽引用；在 2000 文件上限（`directoryHost.ts:57-61`）下的耗时未测。
6. **同名同内容判定是近似的**。首期只比 `size` + `lastModified`，存在「同大小同时间戳但内容不同」被误判为同内容的可能；精确比对接 P1。
7. **四类删除的 UI 分区是设计建议**，未做可用性测试；误触风险靠位置分离控制，未量化。
8. **`objectURL` LRU 上限 200 是建议值**，未测量；太小会导致重复解码，太大则不省内存。
9. **自由画布的资产语义只给了契约与缺口**，未设计具体字段与 UI；该部分在 P1-C 前不得被当作已完成设计。
10. **未验证与外部工具（如 Obsidian）的引用兼容**。设计明确「不静默改写未知外链」，但未实测外部工具对这些引用的解释。

---

## 6. 主控已确认的产品决策与剩余模块决策

| 编号 | 事项 | 已确认裁决 | 所在文件 |
|---|---|---|---|
| DEC-1 | 自由画布是否纳入工作区与文件面板 | 首期不纳入 | `README.md` §6 / `file-management.md` D1-D1 / `asset-library.md` D2-D1 |
| DEC-2 | 「最近」是否拆成两项 | 不拆；单一「最近」按 `openedAt` 排序，`savedAt`/mtime 仅展示 | `README.md` §6 / `file-management.md` D1-D2 |
| DEC-3 | 是否提供「改为归档」替代永久删除 | 提供（P1-A 切片） | `file-management.md` D1-D3 |
| DEC-4 | 删除资产是否允许在引用范围未知时进行 | 允许 + 显式警告 | `asset-library.md` D2-D5 |
| DEC-5 | 索引层是否向用户暴露 | 不暴露 | `file-management.md` D1-D5 |
| DEC-6 | 内置图标是否与上传素材共用收藏与搜索 | 共用 | `asset-library.md` D2-D2 |
| DEC-7 | 同名探测是否做内容精确比对 | 首期只比 size + lastModified | `asset-library.md` D2-D3 |
| DEC-8 | 「从素材库隐藏」是否需要独立视图 | 需要 | `asset-library.md` D2-D4 |
| DEC-9 | 删除后是否要「撤销」 | 不提供，用归档替代 | `file-management.md` D1-D4 |
| DEC-10 | 旧键删除时序（迁移完成后何时清理） | 保留一个版本周期，由主控决定删除时点 | `shared-contracts.md` §6.3 |

**本包自行决定并记录假设的事项**（不再回头确认）：文档内部标题与文件名不自动同步；仅大小写差异的改名拒绝而非静默加序号；文件夹移动/跨目录复制/批量操作不进首期且已给论证；四类删除的入口位置；上传三态文案措辞。`ScopeId` 的持久化不再作为未说明的假设，已在 `shared-contracts.md` 明确为 P0-0 必须落实的元数据契约。

---

## 7. 假设清单（设计成立的前提，若不成立需回看对应章节）

| # | 假设 | 影响的章节 |
|---|---|---|
| A-1 | 工作区文档的资产引用继续以**工作区根**为解析基准（既有事实，本设计固化） | `shared-contracts.md` I-4、`file-management.md` §3.4、`asset-library.md` §4.8 |
| A-2 | `localStorage` 仍是索引层的合适介质（条目量级为「篇数/张数」） | `shared-contracts.md` §4.7 |
| A-3 | 浏览器无法提供 inode 级文件身份，因此身份策略必须包含「显式重新定位」 | `shared-contracts.md` §5 末段 |
| A-4 | `DocumentSaveSession` 的既有语义（token / 清脏判据 / failed 不 commit）**不修改** | 全包；`file-management.md` §3.3 |
| A-5 | 现有 `AssetHost` 方法签名保持，三态能力经新增可选方法获得 | `shared-contracts.md` §4.5 |
| A-6 | 自由画布与导图可继续使用不同文档格式与不同宿主 | `asset-library.md` §7 |
| A-7 | 索引层的迁移必须惰性且不删旧键，回退即删新键 | `shared-contracts.md` §6.3 |

---

## 8. 状态声明

- 本包只做调查与设计。**未提交、未暂存、未推送、未发布**。
- **未实施**：无任何功能代码、无迁移脚本、无门禁改动。
- **未启动下一开发包**：`acceptance-and-backlog.md` §5 的 P0-0…P2-A 是待评审的拆包建议，需主控批准后才可外派；其中 P0-0（契约冻结）是唯一串行前置。
- **未重开 DELIVERY-CLOSE**：其结论与保留限制按原样引用并标注来源，不重复返工、不改旧证据。
- 到达状态：**设计候选可复核**。在此停止，等待主控评审。
- 主控裁决（2026-09-19）：DEC-1 不纳入自由画布；DEC-2 不拆最近视图；DEC-3 提供归档；DEC-4 允许在引用范围未知时删除但必须显式警告；DEC-5 不向用户暴露索引层。

---

## 9. 自检对照（任务书 §8 完成标准）

| 要求 | 落实位置 |
|---|---|
| 所有关键流程同时有成功、取消、失败和部分成功 | `file-management.md` §5.2/§5.3/§5.5；`asset-library.md` §4.3/§5.4；`shared-contracts.md` §3.2–3.4 |
| 所有新能力明确属于哪种画布/存储场景 | `current-state.md` §2.4 矩阵；`asset-library.md` §1.2 归属表；`acceptance-and-backlog.md` §6 第 3 条判据 |
| 每项推荐有理由和兼容影响 | `shared-contracts.md` §5 比较表与理由；`file-management.md` §7、`asset-library.md` §9 对照表 |
| 验收能区分正确实现与典型错误 | `acceptance-and-backlog.md` §3 每项的「负控」列 |
| 遗留未知项有调查办法及建议 | `current-state.md` §5「复核办法」列；`design-review-receipt.md` §5 |
| 不用「待定」掩盖核心契约 | 核心契约在 `shared-contracts.md` 全部定值；未定项集中为 DEC-1…DEC-10 并各给推荐 |
| 不因排版/命名反复停工 | 假设与自主决定记录在 §6、§7 |
| 非必要问题自行给推荐并记录假设 | 同上 |
| 真正影响方向的用户偏好集中列出 | `README.md` §6（DEC-1…DEC-5）+ 本文件 §6（DEC-6…DEC-10） |
| 最终状态写为「设计候选可复核」 | 本文件标题与 §8 |

---

## 10. 勘误与后续修订（FILE-ASSETS-CONTRACT-CLOSE，2026-09-19 追加）

> **本小节是追加内容。上文（§1–§9）为 FILE-ASSETS-DESIGN 交付时的历史声明，按原样保留，不作修改。** 凡下文与上文冲突，以 `../2026-09-19-file-assets-contract-close/contract-delta.md` 与修订后的各设计文档为准。

### 10.1 本回执中被更正的表述

| 位置 | 原文（历史） | 更正 | 依据 |
|---|---|---|---|
| §6 表头 | 「开放决策（需主控裁定，本包已给推荐）」把 DEC-1…DEC-10 混列 | DEC-1…DEC-5 实为**用户已确认**（UD-1…UD-5）；DEC-6…DEC-10 是**设计者建议**（DS-x），不得使用「用户已确认」表头 | `../2026-09-19-file-assets-contract-close/baseline.md` §6 |
| §7 A-7 | 「回退即删新键」 | **错**。删除新键只在「迁移尚未产生新写入」时无损；升级后已有新写入时必须依靠**降级投影**（`shared-contracts.md` §6.3、I-21） | CD-09 |
| §6 DEC-2 | 「不拆；单一最近按 `openedAt` 排序」 | 方向正确，但需补：旧条目无真实打开时间时 `openedAt` 为 `null`，条目排末尾并显示「未记录打开时间」，**不得回落 mtime** | UD-2 |
| §6 DEC-3 | 「提供（P1-A 切片）」 | 需补：归档**依赖 P0-A 的可靠移动**，移动未落地前不得当作可用补救路径；归档是应用操作，不是系统回收站 | UD-3 |
| §8 | 「P0-0（契约冻结）是唯一串行前置」 | P0-0 范围已收窄为**身份与存储基础**（不含 `rebindDestination`/`uploadAssetDetailed`/`*Safe` 等无消费者方法的空实现）；串行链变为 P0-0 → P0-D → P0-A → P0-B → P0-C → P1-A → P1-B → P2-A | `p0-0-implementation-plan.md` §2、CD-11…CD-15 |
| §3 阅读顺序 | 未提本轮目录 | 追加 `../2026-09-19-file-assets-contract-close/` 五份文档 | — |

### 10.2 本回执中仍然成立、且在补正中未被推翻的声明

- 未修改产品源码/测试/门禁/验收工具；未迁移数据；未提交/推送/发布（该轮如此）。
- 所有【线索】未被写成已确认缺陷；本轮进一步把其中的 CE-01 明确标注为**逻辑反例（未实跑）**。
- 不重开 DELIVERY-CLOSE；O3/O4 未记为完成。
- 「设计候选可复核」为该轮终态；本轮终态为「**契约补正与 P0-0 实施计划可复核**」。

### 10.3 补正后的终态

见 `../2026-09-19-file-assets-contract-close/review-receipt.md`。
