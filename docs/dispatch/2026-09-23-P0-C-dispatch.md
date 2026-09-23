# P0-C 外派施工计划 + 启动 Prompt（第 1 轮）

- 日期：2026-09-23
- 性质：**外派施工**（实现 + 测试 + 判别性负控 + 补验人工项 + 回执；非复核）
- 目标包：**P0-C 跨操作统一呈现（S）**
- 基线：分支 `main`，HEAD `0a09216`（产品树 `packages` = `da74e4de`、`apps` = `3c47bfd4`）
- 上游状态：P0-B 已收口（2026-09-23-P0-B-report.md；独立复核 ACCEPT，见 2026-09-23-P0-B-review.md）
- 本文件已随开工提交入库（修复 P0-B 审查发现 M-1：派单书不落档导致审计链断裂）

---

## 1. 为什么是现在（前置表）

| 前置 | 状态 | 证据 |
|---|---|---|
| P0-B 交付七项 | ✅ | 回执 §2 逐项 path:line；复核实测全部命中 |
| P0-B 门禁绿 | ✅ | 复核全量复跑：gate:fast exit 0（lint 1533/48/608）、react 1748、canvas 625、kernel **708（本控冻结实测）** |
| P0-B 负控判别力 | ✅ | 8 条全红；A1-LATE 由复核独立复现 |
| 勘误 E-1/E-2/E-3 | ✅ | `shared-contracts.md` §8（+110/-3，e597a90） |
| 遗留 L-2（§4.1 与 §5.2 的 P0-B 测试文件数不一致） | ⬜ 非阻塞 | 规格维护项，不属 P0-C 范围；P0-C 回执若触及可顺带申报 |
| 环境：playwright | ✅ **已变** | 浏览器缓存存在（chromium-1243）且 npm registry 可达——「不可用」是可修复缺口。P0-C **尝试补装并补验积压人工项**（§5） |

串行链位次：P0-0 → P0-D → P0-A → P0-B → **P0-C（本轮）** → 主控评审（P0 收口）→ P1-A/P1-B。P0-C 是 P0 阶段最后一个施工包，停止点即「P0 阶段结束，进入主控评审」。

---

## 2. 施工面盘点（主控预研，2026-09-23 实测）

P0-C 的问题定义（acceptance-and-backlog.md §5.2 P0-C）：P0-A/P0-B 各自交付了失败文案，但**两处可能出现措辞不一致、提示位置不同、重复实现**。实测现状：

- **P0-A 侧**：`packages/react/src/edit/fileOps.ts` 有 8 个 `FileOpErrorCode`（E-PERMISSION / E-NOT-FOUND / E-EXISTS / E-QUOTA / E-UNAVAILABLE / E-ABORT / E-IO / E-UNKNOWN）+ `Record<FileOpErrorCode, string>` 的穷尽表机制（漏一个码 → 编译失败）。
- **P0-B 侧**：`packages/react/src/chrome/assetStoreCopy.ts` 交付 `ASSET_STORE_BADGE` / `ASSET_PORTABILITY_COPY` / `formatAssetWriteNotice` / `formatDurability` 等；另有 `assetHost.ts` 侧 `AssetWriteResult` 的失败码（如 `idb-failed`、`E-ABORT`）。
- **不一致嫌疑点（实测 grep 命中）**：`MindmapStage.tsx` 存在散落硬编码：`:1291`（「上传失败，请重试。」）、`:3002`（「已在工作区 assets/ 保存了一份副本（…）」）、`:1311` `UNCONFIRMED_WRITE_NOTICE`、`:2982` `refusedNoticeOf`——文案事实源分散在 MindmapStage 组件体内而非统一表。
- **`assetNotices.ts` 不存在**（P0-C 新建，`apps/canvas/src/` 下）。
- `no-native-dialogs.test.ts` 已存在（扩展），`notices-consistency.test.tsx` 待新建。

> 盘点基于 2026-09-23 的 `0a09216`，施工方必须**以实读为准**，行号若漂移以 grep 内容为准（P0-B 教训 L-1：引用行号会漂 1~5 行）。

---

## 3. 启动 Prompt（复制即用，全文自带判据，不依赖仓库内本文件）

```text
你是 MindCanvas P0-C 的**施工执行者**。任务：实现「跨操作统一呈现」并交付自动化
测试、判别性负控、（可行的）人工项补验与回执。做完范围即停，交回回执。

仓库："/Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5"
（注意：外层目录名是「temp workbase」——**中间是空格，不是斜杠**；历史派单书写成
temp/workbase 是错的。所有 shell 命令的路径必须加双引号。外层只是便携打包目录，
真正的 git 仓库是上面这个子目录，分支 main。）

═══════ 一、基准锚定（第一步就做，做完写进回执） ═══════

本工作树历史上有过「基准漂移」与「回执 HEAD 自指」事故。你必须首尾各锚一次：

  git rev-parse HEAD                    → 期望 0a09216（或其后 docs-only 提交，但产品树锚必须一致）
  git rev-parse HEAD:packages           → 期望 da74e4dee4f806a0f270ce955221530ec257b6aa
  git rev-parse HEAD:apps               → 期望 3c47bfd41c0a3797064105cc72e0facc8ebf23f4
  git status --porcelain                → 应为空
  git log --oneline -3

产品树锚（HEAD:packages / HEAD:apps）是稳定判据：若与期望不符，停止并报告，
不要在错的基准上开工。收工时再锚一次；回执提交后 HEAD 会再前进（回执自身是
提交）——按 DS-10/P0-B 同款处理：回执里写「收工 HEAD = 回执提交之前的值」并
声明「以产品树锚 + 血缘为准」，必要时补一个收工锚更新提交。

═══════ 二、范围（acceptance-and-backlog.md §5.2 P0-C，S 包） ═══════

权威判据（必须实读原文，不得只看转述）：
  docs/specs/2026-09-19-file-assets-design/acceptance-and-backlog.md §5.2 P0-C、§5.1 原则
  docs/specs/2026-09-19-file-assets-design/shared-contracts.md（错误码与文案相关章节）
  docs/dispatch/2026-09-23-P0-B-report.md（P0-B 交付的文案事实源清单，§2 ⑦）
  docs/dispatch/2026-09-23-P0-A-report.md（P0-A 交付的 FileOpOutcome 文案层）

只做**统一呈现**，四项：
  ① 错误码 → 文案的唯一映射表 assetNotices.ts（apps/canvas/src/，新增）；
  ② 提示位置与停留时间的一致化（提示条容器统一）；
  ③ no-native-dialogs 守卫；
  ④ 重复点击禁用的一致化。

**排除（硬边界，越界即打回）**：
  - 不补救前面已交付的无反馈危险操作（原则 1）；
  - 不新增操作入口；
  - **不改 P0-A/P0-B 的判定逻辑**（fileOps.ts 的 FileOpErrorCode 域、assetStoreCopy.ts
    的现有键与语义都只读不改；若发现两域确需映射，在 assetNotices.ts 层做映射，
    不动上游）；
  - 不做懒加载/删除/引用查询（P1-B）。

═══════ 三、文件与接口归属（原则 1–4） ═══════

计划文件面（以实读为准调整，调整须在回执申报）：
  apps/canvas/src/assetNotices.ts（新增：唯一文案事实源）
  apps/canvas/src/FileManagerChrome.tsx（提示条容器一致化）
  apps/canvas/src/MindmapStage.tsx（散落硬编码文案迁移到 assetNotices.ts：
    实测嫌疑点 :1291/:1311/:3002/:2982，行号以 grep 为准）
  packages/react/src/chrome/AssetPanel.tsx（复用同一文案键；只改文案取用方式，
    不改判定）
  apps/canvas/tests/notices-consistency.test.tsx（新增）
  apps/canvas/tests/no-native-dialogs.test.ts（扩展）

归属纪律：文案统一后，apps/canvas 与 packages/react 不得各自硬编码同一错误码的
两套说法；公共文案键如需放共享层，放 packages/react 并经 index.ts 再导出（原则 3），
但 assetNotices.ts 按规格放 apps/canvas/src/——两者取舍在回执中说明理由。

═══════ 四、测试 ═══════

新增：apps/canvas/tests/notices-consistency.test.tsx
  - 同一错误码在 FileManager 侧与资产侧产生**同一文案**（两处调用同一映射表）；
  - 穷尽性：映射表覆盖两个域的全部错误码（漏码 → 用类型穷尽 or 用例计数钉死）。
扩展：apps/canvas/tests/no-native-dialogs.test.ts（守卫扩展）
纪律：kebab-case；jsdom 文件首行 // @vitest-environment jsdom；
既有用例零删除零弱化。

═══════ 五、判别性负控（本包核心，不可省略） ═══════

按 acceptance-and-backlog.md §5.2 P0-C：
  (a) 断言未捕获 Promise 拒绝数为 0（中性化：去掉统一错误处理 → 必须转红）；
  (b) 两处文案表不是各自硬编码（中性化：让一侧绕过 assetNotices.ts 私写一份
      文案 → 「同一错误码两处同文案」的用例必须转红）。

负控执行纪律（本仓前轮有「假绿」「假红」事故，逐条遵守）：
  1. 中性化必须**先在盘确认**（grep 计数）再跑测；未落盘的变异不得计为已证明；
  2. 转红用例贴原文（用例名 + 断言行 + expected/received）+ **真实退出码**
     （退出码单独一行捕获：code=$?，不与命令替换混写）；
  3. cwd 按测试文件所属包路由（P0-B 事故 ③：跑错 cwd 报 No test files found
     也 exit 1，是假红不是判别力）；
  4. 还原用**备份 + cmp 字节校验**（禁用 git checkout 回滚源码——P0-B 事故 ④），
     还原后回绿并记录 passed 数；
  5. 不引入 it.fails / 反转断言 / catch 后报 PASS / 宽泛 skip；
  6. 每条负控六要素独立成节，**nc 脚本全程 stdout（含落盘计数行）一并归档**
     到 evidence 目录（P0-B 审查发现 L-4：原始 stdout 未归档，靠转述）；
  7. 测试期望与负控共用同一份正确期望：只改生产实现，期望不动。

═══════ 六、门禁（冻结基线，逐数持平；只增不减） ═══════

  pnpm gate:fast → exit 0（lint 基线 1533 warnings / 48 infos / 608 files，只降不升）
  pnpm build → exit 0
  node scripts/check-code-budget.mjs → exit 0（八项零上升：bang 89/90、asCast 31、
    console 4、todo 1、defaultExport 2、bigFiles 4、any 0、tsIgnore 0）
  kernel 全量 → 75 files / 708 passed（P0-C 不改 kernel；不符即报告停止）
  react 全量 → 162 files / 1748 passed 基线，只增不减
  canvas 全量 → 56 files / 625 passed 基线，只增不减
  定向：doc-index.test.ts 75 passed 不得回归
  首次开工时若实测与上表不符：以你的开工实测为基线记录，并在回执说明差异。

═══════ 七、人工项补验（本轮新增任务，先探明再承诺） ═══════

背景：P0-A/P0-B 两轮的「playwright 不可用」经主控实测**不成立为硬约束**——
浏览器二进制缓存存在（~/Library/Caches/ms-playwright/chromium-1243），npm registry
可达（实测 npm view playwright@1.58.2 正常返回）。缺的只是 node_modules 里的包。

步骤（每步失败都要如实记录，失败不阻塞 P0-C 主体范围）：
  1. 探明：在仓库根执行 pnpm add -D playwright@1.58.2（或 npm i -D --no-save
     仅探明）。装不上（网络/权限）→ 如实记录「补验失败，维持 unconfirmed」，主体范围照常交付；
  2. 若装上：先跑 smoke（launch + setContent），确认 chromium 缓存版本匹配；
     缓存不匹配则 playwright install chromium（下载量大小先报告再决定）；
  3. 补验清单（P0 收口前最后窗口，逐项出证据）：
     - P0-B A1 人工：真实浏览器连续切工作区 + 迟到结果（无闪烁/无错图）；
     - P0-B N1/N4：真实「保存 → 关闭 → 重开」旅程（归一化产物指向蓝图字节）；
     - P0-A F1 第③条、F2 IME（IME 若不可行保持 unconfirmed，不冒充）；
     - no-native-dialogs 的真实验证（confirm/alert/prompt 零调用）。
  4. 每条补验：脚本入库（tools/ 或 apps/canvas/e2e/，命名与既有 verify-*.mjs 一致
     的话遵循同风格）+ 输出留档 evidence/ + 回执单列「补验结果」节；
     补验脚本**不得**进 CI 门禁（探明性质，失败不转红主门禁）。
  5. pnpm add 若改 package.json/pnpm-lock.yaml：属于环境探明产物，正常提交并在
     回执申报（这不是「静默扩围」，是 §七 授权范围）。

═══════ 八、硬性纪律 ═══════

1. 基准防漂：开工/收工各锚一次；HEAD 前进以产品树锚 + 血缘为准并说明。
2. 证据随提交入库：回执与测试/负控/补验证据**同批提交**。
3. 派单书已入库：docs/dispatch/2026-09-23-P0-C-dispatch.md（本文件）；prompt
   与其一致，冲突时以规格 acceptance-and-backlog.md 原文为准。
4. macOS bash 3.2：$var 后紧跟全角字符会解析进变量名，必须 ${var}；
   Python bytes 字面量不允许非 ASCII（中文注释 SyntaxError 曾静默导致变异未落盘）。
5. 提交粒度：每个逻辑项单独提交；message 说清「为什么」；回执提交在最后。
6. 未运行项如实列「未覆盖清单」，不冒充已验证；M 层人工项绝不标 satisfied。
7. 停止点：**P0 阶段施工到此为止**。做完范围即停，交回回执，不自动进入 P1。
   P0-C 收口后由主控评审决定 P0 整体收口与 P1 排期。

═══════ 九、交付物 ═══════

1. 代码 + 测试提交（§三/§四文件面，按逻辑项分批）；
2. （若 §七 探明成功）playwright 补验脚本与证据提交；
3. 回执 docs/dispatch/2026-09-2x-P0-C-report.md，含：
   - 基准锚定表（开工/收工 HEAD + 两产品树锚 + status）；
   - 范围四项逐项交付情况（path:line 级证据；行号漂移以 grep 内容为准）；
   - 负控实测（六要素逐条 + nc 全程 stdout 归档）；
   - 门禁逐数表（命令 + 退出码 + 实测输出原文 + 与冻结基线对照）；
   - 补验结果（成功项给证据；失败项如实 unconfirmed，不阻塞主体）；
   - 未覆盖清单（如实）；
   - 提交列表（sha + stat）。
4. 回执提交后，工作区 git status --porcelain 应为空。
```

---

## 4. 主控备注（不属 prompt 正文）

- **P0-C 小而关键**：范围只有四项，但它是「P0 阶段结束」的门闩——文案统一做不好，P1-B 的断图修复（复用同一文案层）会放大混乱。判别性负控 (b)（两处不得各自硬编码）是本包质量核心。
- **人工项补验是本轮的隐藏主菜**：playwright 环境缺口经实测可修复。若补验成功，P0-A/P0-B 积压的 4 类 unconfirmed（A1 人工、N1/N4 重开、no-native-dialogs 真实验证、F1③/F2 部分）一次清账；若网络在施工窗口内不可用，如实维持 unconfirmed 并把「环境修复」单列为下一轮主控动作。**不要让补验任务挤压主体四项**——补验失败不阻塞验收，主体缺失才阻塞。
- **风险预判**：`MindmapStage.tsx` 已 3149 行（bigFiles 预算 4/4 顶格）。本包迁移硬编码文案会触碰该文件——只做「取用方式」改动（组件内 → 查表调用），不做逻辑改动，净行数应近于持平；若 typecheck/lint 因之大面积波动，先怀疑自己的改法而不是门禁。
- **给复核方的锚**：收工时预期 lint ≤ 1533、react ≥ 1748、canvas ≥ 625、kernel = 708；产品树锚只应被 P0-C 自己的提交改变。
