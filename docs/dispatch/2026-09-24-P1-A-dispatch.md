# P1-A 深度外派施工计划 + 启动 Prompt（文件导航与归档 + 容器一致化跟手项）

- 日期：2026-09-24
- 性质：**深度外派施工**（功能切片 + 单元测试 + 判别性负控 + 真浏览器人工旅程 + 回执；非复核）
- 立项依据：`docs/specs/2026-09-19-file-assets-design/acceptance-and-backlog.md` §5 P1-A
  （范围唯一权威）+ `2026-09-23-P0-C-review.md` §7-a（容器一致化 rider，**阻塞本包收口**）
  + `2026-09-22-P0-D-report.md` :405（弱匹配债务）+ `shared-contracts.md` :168（人工关联面板）
- 基线：分支 `main`，HEAD `fbf28fa`（docs-only）；产品树锚
  `apps` = `d6c61d70`、`packages` = `8d99bf47`
- 位次：P0-FIX-R1 已 ACCEPT 且 L-1 已闭环（`c2c0971` test + `fbf28fa` docs）→
  主控收口评审（docs-only，可与本包并行）→ **P1-A（本轮）** → P1-B。
- 本文件随主控提交入库；与 `2026-09-23-P0-FIX-R1-dispatch.md` 同体例：§1 盘点为主控
  2026-09-24 实读，施工方以实读为准（行号允许漂移，以 grep 内容为准）。

---

## 0. 前置表（为什么是现在）

| 前置 | 状态 | 证据 |
|---|---|---|
| P0 全链施工与复核闭环 | ✅ | P0-0/D/A/B/C + P0-FIX-R1 全部 ACCEPT；R1 复核 `2026-09-24-P0-FIX-R1-review.md` §7：L-1 已于 `c2c0971`/`fbf28fa` 闭环，lint 回到 1530 ≤ 1533 |
| 归档依赖的可靠移动 | ✅ | P0-A 交付 `moveFileSafe` + FileOpOutcome + 冲突三选（`packages/react/src/edit/directoryHost.ts`、`useFileOpOrchestration.ts` 在用） |
| 排序/收藏依赖的索引层 | ✅ | P0-D 交付：`docIndex.ts:128`（`compareRecent`：openedAt 降序、null 末尾）、`title` 字段（`:175`）、`starred` 按 docKey |
| 人工关联依赖的注册表 API | ✅ | `readWorkspaceRegistry`/`writeWorkspaceRegistry`（`packages/react/src/edit/handleStore.ts:281`）、`grantRelinkEvidence`（`docIndexCore.ts:387`，`via:'user-confirmed'`） |
| 容器一致化 rider 悬置 | ✅ 立项 | P0-C-review §7-a： FileManagerViews 两处手写样式 + 四条浮动条位置/消退策略统一；**未完成阻塞 P1-A 收口** |
| 门禁冻结基线 | ✅ | 2026-09-24 本机 gate:fast 实测：lint **1530/48/611**、depcruise **604/1842/0**、canvas **58/673**、react **162/1778**、kernel **75/708**、doc-index 75、budget 八项持平（bang 89/预算 90、bigFiles 4/4 顶格） |
| 逻辑层替代已被证伪 | ✅（教训） | P0-B 教训：真浏览器旅程是硬验收；R1-3 教训：键位监听不得挂 window 闭包 |

**停止点**：本包回执即停止，不自动进入 P1-B；资产改名（P1-B 停止点）与 P1-C 不在本包。

---

## 1. 施工面盘点（主控实读预研，2026-09-24）

### 1.1 已前置交付（**不得重复建设**；回执须逐条核对登记）

| 能力 | 状态 | 位置（实读） |
|---|---|---|
| 「最近」唯一入口按 `openedAt` 降序、null 末尾、「未记录打开时间」、不回落 mtime | **已交付**（P0-D） | `fileTreeModel.ts:319-328`、`docIndex.ts:128`；打开推进接线 `FileManager.tsx:221` |
| 收藏按 docKey/lineageId（改名/移动不失配） | 已交付（P0-D） | `docIndex.ts:142,268,300` |
| 「创建副本」UI 入口 | 已有入口 | `FileManagerContextMenu.tsx`（`data-menu-duplicate`）——本轮只需核对 §3.3 语义完整性（『副本与原文档共用同一批图片』提示 + 新 `lineageId`），缺则补，不重写 |
| 可靠移动/冲突三选/部分成功 | 已交付（P0-A/B） | `moveFileSafe`、`useFileOpOrchestration.ts`、`FileOpPanels.tsx` |
| 统一错误码文案 | 已交付（P0-C，assetNotices.ts 为资产文案源；FM 侧文案沿用既有集中表） | `apps/canvas/src/assetNotices.ts` |

### 1.2 本轮剩余面（backlog §514 范围字段逐项）

| # | 项 | 现状锚点（实读） | 要点 |
|---|---|---|---|
| 1 | 当前文档高亮与状态行 | `FileManagerTree.tsx` **零 aria 属性**（grep=0）；无树内高亮 | 高亮判据按 docKey/lineageId，**不按路径**（负控 2）；状态行 `role="status"` |
| 2 | 搜索内部标题（限已索引文档） | 现搜索=前端过滤文件/目录名（`fileTreeModel.ts:148-168`）；索引 `title` 已在 | 范围明示 + 文案『仅搜索已记录的文档』；与文件名命中按 docKey 去重合并 |
| 3 | 排序依据可选 | 现固定「目录在前 + localeCompare」（`fileTreeModel.ts:135-142`） | 「名称 / 最近修改」二选，**列头写明依据**；仅作用于「全部目录」 |
| 4 | roving tabindex + tree 语义 + aria-current | 无 | 键位表按 `file-management.md` §6：↑/↓ 移动、→ 展开、← 折叠或回父级、Home/End、Enter 打开、F2 改名、Delete 删除、Esc 关面板；**焦点在重命名输入框内全部让位**（负控 1）；树 `role="tree"`、行 `role="treeitem"` + `aria-level`/`aria-expanded`/`aria-selected` |
| 5 | 「显示其他文件」 | `directoryTypes.ts:80-83` 只收录 `.mm.md`/`.md`；其余静默不出树 | 开关打开后灰显不可打开 + 悬停/点击提示『非导图文件，本应用不打开』；隐藏文件归入该组默认折叠 |
| 6 | 「改为归档」 | 全仓 `_归档` **零命中**；唯一路径=删除确认条旁次要动作（`file-management.md` §3.6 原文） | = `moveFileSafe(src → _归档/<name>)`，见预裁决 §3.1 |

### 1.3 三个 rider（跟手项，随本包交付）

| # | rider | 依据 | 现状锚点 |
|---|---|---|---|
| A | **容器一致化**：`FileManagerViews.tsx` 两处手写样式（`ProjectionFailureNotice`/`MigrateFailedNotice`，:178/:204 附近）对齐 `inlineBarStyle`；MindmapStage 四条浮动条（top 64/100/16 + scaleNotice 第四形态）位置与消退策略统一 | P0-C-review §7-a（验收=唯一事实源 + Playwright DOM 几何断言，脚本放 `tools/` 不进 CI） | `fileManagerShared.ts:61`（inlineBarStyle 唯一源）；`FileManagerViews.tsx:170-210`；`MindmapStage.tsx` 浮动条四处 |
| B | **人工关联面板**：列出注册表条目（`readWorkspaceRegistry`），用户确认后按 `via:'user-confirmed'` 写回，目录获得稳定 scopeId | `shared-contracts.md:168`、`acceptance-and-backlog.md:261` | 入口挂面板头部既有作用域区（StorageBar「🟢 工作区已连接 · 📁 <名>」，`FileManagerChrome.tsx`） |
| C | **P0-D 弱匹配债务**：历史池「关联到此工作区」的目标解析（先 `fullPath===h.key` 再 `name===h.name` 弱匹配）改为用户直接指定目标条目 | P0-D-report :405 原文 | 与 rider B 同一交互族；`name` 相等回退必须移除 |

### 1.4 明确排除（**禁止入本轮**；发现强耦合不可避免时停下上报，不得自行扩围）

- 文件夹移动、跨目录复制、批量操作（`file-management.md` §6 论证）。
- 资产改名、自动垃圾回收（P1-B 停止点）；自由画布（P1-C 未设计）。
- 撤销功能（DS-13：归档即替代）；自动同名重绑（I-2/I-9）。
- `file-management.md` §6 中 backlog §514 未选入的增强：上下文菜单键盘化（Shift+F10/role=menu）、
  拖放提示条与 🚫 落点、筛选（只看未保存/失联）、命中「N 项匹配」计数、
  「移动到…」「重新定位」「在系统文件管理器中显示」三个菜单项——**登记为 backlog 未排期项，本轮不做**。

---

## 2. 权威输入（施工方必读，按此顺序）

1. `docs/specs/2026-09-19-file-assets-design/acceptance-and-backlog.md` §5 P1-A（:508-519）+ §6 收口判据（:560-572，全 8 条适用）
2. `docs/specs/2026-09-19-file-assets-design/file-management.md` §3.6（归档）、§6（键盘/a11y/排序/搜索细化）、§8.1（UD-2/UD-3）
3. `docs/specs/2026-09-19-file-assets-design/shared-contracts.md` :154/:168（unassociated 语义与人工关联）
4. `docs/dispatch/2026-09-23-P0-C-review.md` §7-a（rider A 验收原文）
5. `docs/dispatch/2026-09-22-P0-D-report.md` :400-406（rider C 债务原文）
6. `docs/dispatch/2026-09-24-P0-FIX-R1-review.md` §7（位次与门禁锚）

---

## 3. 预裁决（允许执行者以代码实证反驳；反驳须在回执 §预裁决记录「原裁决 → 反证 → 新裁决」）

### 3.1 归档 = 一次可靠移动，不是新存储概念

`改为归档` 编排 = `moveFileSafe(src → _归档/<name>)`，**复用** P0-A 互斥域、FileOpOutcome、
冲突三选与部分成功面板；不新增索引字段、不新增存储键、不新写平行编排器。
`lineageId` 不变（同一文档），收藏/最近随既有 docKey 迁移语义自然保持。
`_归档/` 在树中按**普通目录**呈现（不隐藏、不特殊渲染）。
当前文档被归档 → 走 F2 既有离开决策器（等同「移动当前文档」分支，不新写分支）。
⚠️ 自检点：若 directory-host 扫描对 `_` 前缀有特殊过滤（`directoryTypes.ts`/`directoryHost` 需核实），
以代码为准并在回执登记反驳。

### 3.2 归档入口两处、同一编排

删除确认条旁次要动作（§3.6 原文位置）+ 右键菜单「改为归档」；两者调同一编排函数。

### 3.3 排序切换不动「最近」

排序依据可选仅作用于「全部目录」视图；「最近」固定 `openedAt`（UD-2 用户已确认，不可动摇）。

### 3.4 标题搜索无新扫描

只消费 docIndex 既有 `title` 字段；不加文件读取、不加扫描；未索引文档不参与且文案明示。

### 3.5 键盘状态机独立纯函数模块

roving tabindex 状态机放**新文件**（如 `fileTreeKeyboard.ts`，纯函数、可单测）；
树组件只消费；让位拦截在重命名输入框的按键层。**禁止挂 window 级监听**（R1-3 陈旧闭包教训）。

### 3.6 容器一致化 = 统一位置系统 + 消退策略参数化，不是抹平语义

唯一事实源落地为 `fileManagerShared.ts` 扩展或新共享 notice 样式模块；
四条浮动条统一**位置系统**与**消退策略的显式参数**；「错误类常驻、成功类自动消退」的语义差异
必须保留（不得把错误条改成自动消退制造假安心）。倾向把浮动条组件挪出 MindmapStage
（3220 行，bigFiles 顶格），缓解持续膨胀（R1-review L-2 既有登记）。

### 3.7 人工关联只加 UI 与 user-confirmed 写回，不改判定链

scopeIdentity 判定链（P0-0 契约冻结）零改动；面板写回走 `writeWorkspaceRegistry`
+ `via:'user-confirmed'`（`grantRelinkEvidence` 既有）。

### 3.8 弱匹配移除的边界

历史池关联目标必须用户点选；`fullPath` 精确命中可保留为免点选快捷路径（须留 relinkEvidence 记账）；
`name` 相等回退**必须删除**。

### 3.9 新逻辑进新模块

bigFiles 4/4 顶格（>600 行生产文件预算）；`FileManager.tsx` 现 561 行、`MindmapStage.tsx` 3220 行。
键盘模型/归档编排/标题搜索过滤/共享 notice 样式各自落新模块或既有小文件，
**禁止把任何文件推过 600 行**（预算必破）。

### 3.10 「在系统文件管理器中显示」不做

Web 无标准 reveal API → 不出该项（规格原文「若平台支持，否则不显示」）。
若施工方探明标准能力探测路径，可实证反驳。

---

## 4. 负控（判别性；六要素纪律：变异落盘硬校验 → 转红 exit≠0 → 备份还原 cmp+sha256 → 回绿）

规格原文三条（`acceptance-and-backlog.md` :518）+ 本轮补充：

| # | 负控 | 中性化方式（示例） |
|---|---|---|
| 1 | 焦点在重命名输入框内，方向键**不得**移动树焦点 | 注释掉输入框层的按键拦截 → 键盘用例转红 |
| 2 | 两个同名不同目录文件**不得**同时高亮 | 把高亮判据从 docKey 改回路径比对 → 转红 |
| 3 | `openedAt === null` 条目**不得**出现在按打开时间排序前部 | P0-D 已有实现的须核对既有覆盖：已覆盖则登记不重复建设；未覆盖则补 |
| 4 | 归档落点冲突必须走三选，不得静默覆盖 | 中性化冲突判定分支 → 转红 |
| 5 | 归档失败（权限/失联）→ 失败路径 + 树不出现幽灵条目 | 中性化 outcome 失败分支 → 转红 |
| 6 | 「显示其他文件」中不支持文件点击必须提示，不得静默或尝试打开 | 中性化灰显点击处理 → 转红 |
| 7 | rider-A 唯一事实源：故意在某浮动条硬编码位置值 → 事实源断言（引用计数/glob）转红 | 参照 P0-C notices 一致性守卫做法 |

**硬性判据**（收口判据 §6-2）：负控与正例同一份正确期望；转红=命令退出非零并记录真实退出码；
常态必红反例不得进默认门禁；禁止 `it.fails`/反转断言/宽泛 skip。

## 5. 测试与真浏览器验收

- 扩展 `apps/canvas/tests/file-manager-tree.test.tsx`、`file-manager-dialogs.test.tsx`；
  新增 `tests/file-manager-keyboard.test.tsx`、`tests/file-manager-archive.test.tsx`（规格 :517 原文）。
- rider-A 几何断言：Playwright 脚本（`tools/verify-fm-containers.mjs` 命名可自定），
  断言四条浮动条 + 三条内联条的实际几何（位置/层叠/消退行为），`vite build` 产物上跑，不进 CI。
- 真浏览器人工旅程（backlog :519 停止点）：a11y 键盘走查（方向键全键位 + 输入框让位 +
  aria-current 变化）+ X1 导图部分的归档旅程（归档 → 树中 `_归档/` 可见 → 从归档再打开）。
- 收口判据 §6 全 8 条适用；「未验证项如实标注」（触控拖拽、真实 IME 等沿用既有口径）。

## 6. 门禁与回执

- 门禁冻结基线（2026-09-24 本机实测，逐数比对）：budget 八项（bang 89/90、bigFiles 4/4…）、
  canvas **58/673**、react **162/1778**、kernel **75/708**、doc-index **75**、
  lint **1530 warnings/48 infos/611 files**（只降不升）、depcruise **604/1842/0 violations**、`pnpm build` exit 0。
- 提交前缀 `feat(p1a)/test(p1a)/docs(p1a)`；代码与文档分轨；工作树收工时为空。
- 回执体例同前批：基准锚定（HEAD 与 `apps`/`packages` 子树锚）、逐项交付证据、
  负控六要素归档（`docs/dispatch/evidence/2026-09-24-p1a-negative-controls/`）、
  真浏览器证据（`evidence/2026-09-24-p1a-e2e/`）、门禁原文、未覆盖清单、硬边界自查。
- kernel 负载敏感 flake：再遇必须记录失败文件+用例名并连跑刻画（R1-review L-4 纪律），不得以「偶发」略过。

---

## 7. 启动 Prompt（可复制全文发车）

> 你是 P1-A 施工方（文件导航与归档 + 容器一致化跟手项）。这是一轮深度外派施工：
> 功能切片 + 单元测试 + 判别性负控 + 真浏览器人工旅程 + 回执。**不是复核，不修改他人用例换绿。**
>
> ## 仓库与锚定
> - 仓库：`/Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5`（分支 `main`）。
> - 开工基线：HEAD `fbf28fa`（docs-only）；产品树锚 `apps`=`d6c61d70`、`packages`=`8d99bf47`。
>   开工时若 HEAD 不是 `fbf28fa`，以产品树锚为准，接受其后的 docs-only 主控提交（如 P0 收口评审文档）；
>   **任何产品树（apps/packages）增量都必须来自你本包**。
> - 开工自检：`git status --porcelain` 必须为空；记录 `git rev-parse HEAD HEAD:apps HEAD:packages`。
>
> ## 权威输入（按序必读）
> 1. 派单书：`docs/dispatch/2026-09-24-P1-A-dispatch.md`（范围/预裁决/负控/门禁的唯一权威，本 prompt 是其摘要）
> 2. `docs/specs/2026-09-19-file-assets-design/acceptance-and-backlog.md` §5 P1-A + §6 收口判据
> 3. `docs/specs/2026-09-19-file-assets-design/file-management.md` §3.6、§6、§8.1
> 4. `docs/specs/2026-09-19-file-assets-design/shared-contracts.md` :154/:168
> 5. `docs/dispatch/2026-09-23-P0-C-review.md` §7-a；`docs/dispatch/2026-09-22-P0-D-report.md` :400-406
>
> ## 范围（backlog §514 六项剩余 + 三 rider；盘点明细与「已前置交付勿重建」清单见派单书 §1）
> ① 当前文档高亮与状态行（判据按 docKey，负控：同名不同目录不得同时高亮）
> ② 搜索内部标题（限已索引文档，消费 docIndex 既有 title，无新扫描）
> ③ 排序依据可选（仅「全部目录」，列头写明依据；「最近」固定 openedAt 不动）
> ④ roving tabindex + tree 语义 + aria-current（键位表按 file-management §6；重命名输入框焦点让位）
> ⑤ 「显示其他文件」（灰显不可打开 + 点击提示）
> ⑥ 「改为归档」（= moveFileSafe 移入 `_归档/`，入口：删除确认条旁 + 右键，同一编排）
> rider-A 容器一致化（FileManagerViews 两处对齐 inlineBarStyle + MindmapStage 四浮动条位置/消退统一；
>   验收=唯一事实源守卫 + Playwright DOM 几何断言脚本，tools/ 下不进 CI）
> rider-B 人工关联面板（readWorkspaceRegistry 列条目 → 用户确认 → via:'user-confirmed' 写回）
> rider-C 移除历史池 name 弱匹配，关联目标改用户点选（fullPath 精确命中可留作快捷路径）
>
> ## 禁止
> 文件夹移动/跨目录复制/批量操作；资产改名；撤销；自动重绑；上下文菜单键盘化/拖放提示/筛选/命中计数
> （backlog 未选入，登记后续）；改 scopeIdentity 判定链；任何文件推过 600 行（bigFiles 4/4 顶格）；
> 挂 window 级键位监听（R1-3 教训）；修改他人用例换绿；重开已收口契约。
>
> ## 纪律
> - 负控六要素（派单书 §4 七条）：变异先 grep 落盘计数 → 转红记真实退出码 → 备份还原 cmp+sha256
>   （**禁 git checkout**，CRLF 工作树会被改写）→ 回绿与全量一致。禁止 it.fails/反转断言。
> - 门禁逐数比对冻结基线：budget 八项持平（bang 89/90、bigFiles 4/4）、canvas 58/673、
>   react 162/1778、kernel 75/708、doc-index 75、lint 1530/48/611 只降不升、depcruise 604/1842/0、build exit 0。
>   顺序单跑，不并发（kernel flake 刻画纪律：再遇必记文件+用例名）。
> - 真浏览器人工旅程是硬验收（P0-B 教训）：a11y 键盘走查 + X1 归档旅程，`vite build` 产物上跑，
>   证据入 `docs/dispatch/evidence/2026-09-24-p1a-e2e/`；负控归档入 `evidence/2026-09-24-p1a-negative-controls/`。
> - 提交前缀 feat(p1a)/test(p1a)/docs(p1a)，代码与文档分轨。
> - 预裁决可实证反驳（派单书 §3.1-3.10），反驳须在回执记录「原裁决 → 反证 → 新裁决」；
>   其余歧义停下上报，不得自行扩围或改正确期望。
>
> ## 停止点
> 回执（`docs/dispatch/2026-09-24-P1-A-report.md`）提交即停；不进入 P1-B，不做资产改名。
> 回执须含：基准锚定、§1.1 已交付项核对登记、六项+rider 逐项证据、负控归档索引、
> 真浏览器证据、门禁原文与基线逐数对照、未覆盖清单、硬边界自查。

---

## 8. 诱惑性错法预警（主控给执行者的先手提醒）

1. **把「最近」顺手重排或回落 mtime** —— UD-2 用户已确认；P0-D 已交付，动了就是回归。
2. **归档做成新存储概念/新索引字段/新编排器** —— 它就是一次移动；多造的每一层都是无消费者实现（收口判据 §6-6）。
3. **给 `_归档/` 做树中隐藏或特殊渲染** —— 普通目录；特殊化是语义蔓延的开端。
4. **复制 MindmapStage 浮动条样式做「第五份拷贝」** —— rider-A 要的是唯一事实源，不是第六处重复。
5. **统一消退时把错误条也改成自动消退** —— 错误常驻是语义，不是 bug（P0-C 文案批次同原则）。
6. **键位监听挂 window** —— R1-3 刚修完的陈旧闭包车祸现场；绑树容器 + 输入框层让位。
7. **往 FileManager.tsx / MindmapStage.tsx 里堆逻辑** —— bigFiles 顶格，破预算即门禁红；新逻辑进新模块。
8. **顺手「优化」scopeIdentity 判定链** —— P0-0 契约冻结；rider-B 只加 UI 与 user-confirmed 写回。
9. **拿「aria 属性加了」冒充键盘走查** —— 交互级证据（focus 断言/人工走查记录），不是属性存在性。
10. **负控用 it.fails 或反转断言凑数** —— 收口判据 §6 三条硬性判据明令禁止；六要素缺一即无效组。
