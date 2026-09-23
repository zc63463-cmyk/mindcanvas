# P0-A 外派施工计划 + 启动 Prompt（第 1 轮）

- 日期：2026-09-23
- 性质：**外派施工**（实现 + 测试 + 回执；非复核）
- 目标包：**P0-A 文件操作：租约、目的地与反馈（L）**
- 基线：分支 `main`，HEAD `4693d9b`（已推送；产品树 `packages` = `c771dd3b`、`apps` = `61d46757`）
- 上游状态：P0-D 已收口（独立复核 ACCEPT-with-conditions 的 5 项条件中，代码/测试 3 项已闭环；契约勘误挂起至 P0-B 前；DS-10 已裁选项 (c)：旧键删除推迟至 P0-A 之后）

---

## 1. 为什么是现在

| 前置 | 状态 | 证据 |
|---|---|---|
| 复核条件 1（N-1 medium：library 投影配额失败静默） | ✅ 闭环 | `071e478` 写后回读校验（`docIndexProject.ts:102-107`） |
| 复核条件 2（两条判别性负控） | ✅ 闭环 | `037d1e2` + `780cda8`/`0af4e26`（NC-M7-scope 与「有既有条目+无证据」均钉住） |
| 复核条件 3（:236 `failed` 断言） | ✅ 闭环 | `037d1e2` |
| DS-10（旧键删除时序） | ✅ 已裁 (c) | `docs/dispatch/2026-09-23-ds10-old-key-deletion-ruling.md` |
| 契约勘误（规格侧） | ⬜ 挂起 | 阻塞 P0-B/P1-B，**不阻塞 P0-A** |

P0-A 的开工前置（N-1）已满足。DS-10 裁定对 P0-A 的直接约束：**P0-A 的改名/移动会制造新的旧键残留（每次改名旧库 +1 行），不删旧键；索引侧须正确认领**（注意 P0-D 的 M5 修复后行为：同作用域「有既有条目 + 无归属证据」→ 进历史池，不自动认领）。

---

## 2. 启动 Prompt（复制即用，全文自带判据，不依赖仓库内本文件）

```text
你是 MindCanvas P0-A 的**施工执行者**。任务：实现「文件操作：租约、目的地与反馈」
并交付自动化测试、判别性负控与回执。做完范围即停，交回回执。

仓库：/Users/xin020/Desktop/temp/workbase/mindcanvas-portable-20260921/mindcanvas-s5
（外层 mindcanvas-portable-20260921 只是便携打包目录，不是 git 仓库；真正的仓库是上面这个
子目录，分支 main。路径含空格，所有 shell 命令的路径必须加引号。）

═══════ 一、基准锚定（第一步就做，做完写进回执） ═══════

本工作树历史上有过「基准漂移」事故（复核读到旧代码下结论）。你必须首尾各锚一次：

  git rev-parse HEAD                    → 期望 4693d9b（或其后的 docs-only 提交，但产品树锚必须一致）
  git rev-parse HEAD:packages           → 期望 c771dd3bc061b917a195ecf03ac73129c431df71
  git rev-parse HEAD:apps               → 期望 61d46757fbf5eb6cbd3c5b213294f4c4beae7369
  git status --porcelain                → 应为空
  git log --oneline -3

产品树锚（HEAD:packages / HEAD:apps）是稳定判据：若与期望不符，停止并报告，
不要在错的基准上开工。收工时的回执里再锚一次，两次不一致要显式说明。

═══════ 二、范围（acceptance-and-backlog.md §5.2 P0-A 七项，逐项交付） ═══════

权威判据（必须实读原文，不得只看转述）：
  docs/specs/2026-09-19-file-assets-design/acceptance-and-backlog.md §3（F1/F2/F3/F5）、§5.2 P0-A
  docs/specs/2026-09-19-file-assets-design/shared-contracts.md（§3.5.1 竞态、§6.2.1 归属证据）
  docs/specs/2026-09-19-file-assets-design/file-management.md（改名/移动/删除的产品规则）
  docs/dispatch/2026-09-23-ds10-old-key-deletion-ruling.md（旧键不删；P0-A 残留的处置约束）

① 操作租约：beginExclusiveOp/endExclusiveOp、physicalWritesInFlight、
   每个 await 后的归属校验、条件释放；
② 目的地显式化与 rebindDestination（单一事实源，I-20）；
③ 当前文档改名/移动的完整编排（含 I-14 前置：改名前至少一次成功落盘）；
④ renameFileSafe/moveFileSafe/removeFileSafe/removeDirSafe + FileOpOutcome；
⑤ 删除当前文档的 F2 流程（草稿/组合输入/离开决策器同族）；
⑥ 连同失败/冲突/部分成功反馈一起交付：错误码→文案、内联冲突三选、
   部分成功三选（含撤销副本的保护与重试删源的外部修改复查）；
⑦ 创建副本（duplicate）。

排除（本轮明确）：不做文件夹移动；不做跨目录复制；不做批量；不做自由画布；
不改离开决策器；不做引用扫描（P1-B）。

═══════ 三、文件与接口归属（原则 1–4，acceptance-and-backlog §5.1） ═══════

- 原则 1：操作自身的失败反馈随该操作所在包交付（不外挂到 P0-C）。
- 原则 2：没有消费者的空实现不做——每个类型/方法必须被真实生产路径调用（不只被测试调用）。
- 原则 3：FileOpError/FileOpOutcome 等公共结果类型放 packages/react/src/edit/fileOps.ts
  （新增），经 packages/react/src/index.ts 再导出；不得放 apps/canvas 后要求包反向依赖。
- 原则 4：MindmapStage.tsx / FileManager.tsx / SidePanels.tsx 由本包独占修改。

计划文件面（以实读为准调整，调整须在回执申报）：
  packages/react/src/edit/fileOps.ts（新增：FileOpError/FileOpOutcome/错误码）
  packages/react/src/edit/directoryHost.ts（*Safe；修 removeEntry?. 静默成功）
  packages/react/src/index.ts（导出面）
  apps/canvas/src/hooks/useDocumentSaveSession.ts（租约 + rebindDestination + 物理写计数）
  apps/canvas/src/hooks/useDocumentActions.ts（编排）
  apps/canvas/src/FileManager.tsx + FileManagerModal.tsx（UI、前置校验、冲突与部分成功面板）
  apps/canvas/src/MindmapStage.tsx（openWorkspaceFile/workspacePath 同步）

═══════ 四、测试 ═══════

新增：
  packages/react/tests/file-ops.test.ts（FileOpOutcome 纯函数层）
  apps/canvas/tests/rename-current-doc.test.tsx
  apps/canvas/tests/file-op-partial.test.tsx
  apps/canvas/tests/file-op-lease.test.tsx
扩展：
  apps/canvas/tests/save-destination.test.tsx、useAutoSave.test.tsx、
  file-manager-tree.test.tsx、file-manager-dialogs.test.tsx、unsaved-transition.test.tsx
  packages/react/tests/directory-host.test.ts
纪律：新测试放包各自 tests/ 下，kebab-case；jsdom 文件首行 // @vitest-environment jsdom。

═══════ 五、判别性负控（本包核心，不可省略） ═══════

F1/F2/F3/F5 的全部负控（acceptance-and-backlog.md §3 每项的「负控」行），专项三条：
  (a) 去掉租约 → 断言「等待空闲期间新保存进入」的场景必须失败；
  (b) 把 waitForIdle 当物理写静默 → 断言 busy-physical 拒绝路径必须失败；
  (c) 无条件删除副本/源 → 断言保护分支必须失败。

负控执行纪律（本仓前轮有「假绿」事故，逐条遵守）：
  1. 中性化必须**先在盘确认**（grep 计数符合期望）再跑测；未落盘的变异不得计为「已证明转红」；
  2. 转红用例贴**原文**（用例名 + 断言行 + expected/received）+ **真实退出码**
     （退出码单独一行捕获：code=$?，不得与命令替换混在同一行——本机 bash 3.2 会污染 $?）；
  3. 还原用**备份 + cmp 字节校验**（不得用 git checkout——工作树 CRLF 会被改写 EOL），
     还原后重跑回绿，记录回绿时的 passed 数；
  4. 不引入 it.fails / 反转断言 / catch 后报 PASS / 宽泛 skip；
  5. 每条负控独立成节：中性化内容 / 落盘校验 / 转红原文 / 退出码 / 还原 sha256 / 回绿读数。

═══════ 六、门禁（冻结基线，逐数持平；只增不减） ═══════

  pnpm gate:fast → exit 0（lint：Found 1541 warnings. Found 48 infos，逐数持平）
  pnpm build → exit 0
  node scripts/check-code-budget.mjs → exit 0（八项零上升）
  kernel 全量 → 708 passed（P0-A 不改 kernel；若实测不符，报告并停止）
  react 全量 → **必须实跑**（本包改 packages/react：新增 fileOps.ts + 改 directoryHost.ts；
    P0-D 回执称 1639 passed 但独立复核未复算——以你的开工实测为基线记录，收工只增不减）
  canvas 全量 → 开工实测基线（P0-D 收口时 465 passed），收工只增不减；
    既有用例零删除零弱化
  定向：P0-D 的 doc-index.test.ts 60 passed 不得回归

═══════ 七、M 层（人工）项的处置 ═══════

本机 playwright 未安装（tools/ 下 18 个 verify-*.mjs 全部不可运行），真实 IME /
真实权限撤回/真实手势不具备条件。对 F1 第③条与 F2 IME 的人工结果：
  - **如实标注「需人工执行，未由本机验证」**，给出可执行的人工测试脚本
    （前置/动作/可观察结果，逐条对齐 §3 的「可观察」列）；
  - 不得用合成事件冒充真实 IME，不得把 unverifiable 包装成 satisfied。

═══════ 八、硬性纪律 ═══════

1. 基准防漂：开工/收工各锚一次（§一）；期间若发现 HEAD 前进，以产品树锚为准并说明。
2. 证据随提交入库：回执与测试/负控证据**同批提交**，不得留到「下一轮」
   （S5 教训：证据晚入库 = 不可核）。
3. 派单书与派单消息二选一已由主控保证：本 prompt 全文自带判据；你也可读仓库内
   docs/dispatch/2026-09-23-P0-A-dispatch.md（已入库）。
4. macOS bash 3.2：$var 后紧跟全角字符会解析进变量名，必须 ${var}；
   Python bytes 字面量不允许非 ASCII（中文注释会 SyntaxError，且可能静默导致变异未落盘）。
5. 提交粒度：每个逻辑项单独提交；message 说清「为什么」；回执提交在最后。
6. 未运行项如实列「未覆盖清单」，不冒充已验证。
7. 停止点：**不自动进入 P0-B/P1**；做完范围即停。

═══════ 九、交付物 ═══════

1. 代码 + 测试提交（§三/§四文件面，按逻辑项分批）；
2. 回执 docs/dispatch/2026-09-2x-P0-A-report.md，含：
   - 基准锚定表（开工/收工 HEAD + 两个产品树锚 + status）；
   - 范围七项逐项交付情况（path:line 级证据）；
   - 负控实测（按 §五.5 的六要素逐条）；
   - 门禁逐数表（命令 + 退出码 + 实测输出原文 + 与冻结基线对照）；
   - M 层人工项脚本与「未验证」声明；
   - 未覆盖清单（如实）；
   - 提交列表（sha + stat）。
3. 回执提交后，工作区 git status --porcelain 应为空。
```

---

## 3. 主控备注（不属 prompt 正文）

- **DS-10 与 P0-A 的耦合**：P0-A 每次改名会在旧库留一条老路径行（`docIndexProject.ts:86-92` 并集语义有意保留）。这是裁定 (c) 接受的代价，**不是缺陷**；但 F5（改名后收藏跟随 `lineageId`）的用例要顺带验证索引侧认领正确（P0-D 的 M5 修复后：「有既有条目 + 无证据」进历史池、不认领——这是 §6.2.1 合规行为，不是回归）。
- **react 包门禁**：P0-D 轮次只跑了 canvas 全量，react 全量的 1639 读数未经独立复算。本轮 P0-A 改 react 包，**必须实跑 react 全量**并记录基线。
- 若施工中发现范围需要调整（如 `*Safe` 签名连锁），在回执中申报，不得静默扩围。
