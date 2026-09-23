# DS-10 实施批 · 外派施工计划 + 启动 Prompt（第 1 轮）

- 日期：2026-09-23
- 性质：**外派施工**（实现 + 判别性负控 + 回执）
- 目标：DS-10 旧键残留回收——按复审裁定实现逐行判据 (b')，含 F3-部分成功排除
- 基线：分支 `main`，HEAD `49fcf26cff91d0f5e4cc99ff4018d6f3eee74a06`（已推送；产品树 `packages` = `27b2909c1ebe9bcf049d3998e52a56109d26b0ac`、`apps` = `284402420f23666b9702b8aface15a8d5da79ab5`）
- 裁定依据：`docs/dispatch/2026-09-23-ds10-rejudgement.md`（本批范围的唯一权威）；原裁定 `docs/dispatch/2026-09-23-ds10-old-key-deletion-ruling.md` 与 `docs/dispatch/2026-09-23-P0-D-review.md` §5 为背景判据

---

## 1. 启动 Prompt（复制即用，全文自带判据）

```text
你是 MindCanvas DS-10 实施批的施工执行者。任务：按主控复审裁定实现旧库旧键残留的
逐行回收（判据 (b')），含 F3-部分成功排除，交付判别性负控与回执。做完范围即停。

仓库：/Users/xin020/Desktop/temp/workbase/mindcanvas-portable-20260921/mindcanvas-s5
（外层 mindcanvas-portable-20260921 只是便携打包目录，不是 git 仓库；真正的仓库是上面这个
子目录，分支 main。路径含空格，所有 shell 命令的路径必须加引号。）

═══════ 一、基准锚定（第一步就做，首尾各锚一次） ═══════

本工作树有「基准漂移」事故史。开工：

  git rev-parse HEAD          → 期望 49fcf26cff91d0f5e4cc99ff4018d6f3eee74a06
  git rev-parse HEAD:packages → 期望 27b2909c1ebe9bcf049d3998e52a56109d26b0ac
  git rev-parse HEAD:apps     → 期望 284402420f23666b9702b8aface15a8d5da79ab5
  git status --porcelain      → 应为空

产品树锚是稳定判据，不符即停止并报告。收工回执里再锚一次；两次不一致要显式说明
（本批自己的提交会改动产品树，收工锚变化是正常的，但必须能归因到本批提交）。

═══════ 二、任务（唯一权威：docs/dispatch/2026-09-23-ds10-rejudgement.md） ═══════

实读裁定书全文 + 以下代码锚点（以实读为准，行号可能已漂）：

  apps/canvas/src/docIndexProject.ts   projectLibrary:41-152（被取代行当前在 :87-90 原样保留）
                                        projectStarred:162-192（claimed 计算现成可复用）
  apps/canvas/src/docIndexSupport.ts   relocateEntries:72-100（明文形态认领的来源）
  apps/canvas/src/docIndexMigrate.ts   :95-130,160-180（前缀形态 mindcanvas.library.v1#X 认领的来源）
  apps/canvas/src/docIndexCore.ts      collectStarredKeys:393-410；legacyKeys 纪律 :156-160
  apps/canvas/tests/doc-index.test.ts  现有投影用例（幂等/孤儿行/source 8 条/畸形行）是行为约束

实现判据 (b')：在 projectLibrary 行集构建中，移除满足
  X ∈ ⋃ legacyKeys（双形态：明文 X，或 mindcanvas.library.v1#X）
  ∧ X ∉ { legacyIdOf(e) : e ∈ docs }
  ∧ X 可解析（在 byId 内，非 opaque）
的旧库行。

F3-部分成功排除（裁定 §3，硬约束）：move 目标已写、源删除失败时源文件仍在盘上，
旧行是其降级视图唯一代表——此类源键不得删除。机制自定（消费操作结果 / 投影期显式
跳过未消解 partial 键均可），但不得「盲删 + 文档备注」。

附带项（裁定 §5）：starred 侧前缀不对称——M5 用 mindcanvas.starred.v1#X 认领而
projectStarred 的 claimed 是明文查找，导致「M5 迁入后取消收藏且从未改名」的旧键被
保守保留。实现双形态认领助手时应让 starred 侧复用同一助手；若不做，回执中明示。

═══════ 三、必须守住的六条不变量（裁定 §4，逐条实读验证后兑现） ═══════

1. 孤儿行（从未认领）保留；
2. 畸形/损坏行保留（opaqueRows 路径与 :236 的 failed 断言不受影响）；
3. 尚未迁移的旧键不被投影破坏；
4. 幂等：纯 migrate() 不碰旧库；投影连续两次行集一致；首次清理后稳定；
5. 降级视图一行一文档（同一逻辑文档不再两行）；
6. F3-部分成功的源行保留。

═══════ 四、写入纪律（N-1 口径） ═══════

library.v1 现有写入口：投影 replaceAll + N-1 写后回读校验（docIndexProject.ts:99-148）、
DocLibrary.save 单行 upsert。本批若新增针对性删除，必须走既有公开读取/写入面，
并把新路径纳入回读校验的 expected 行集口径；不得引入绕过 N-1 校验的第三写路径。

═══════ 五、判别性负控（五条，全做；六要素纪律） ═══════

1. 中性化删除判据 → 被取代旧行重现（残留复现）→ 必须转红；
2. 删除判据扩到孤儿行 → 孤儿行丢失 → 必须转红；
3. 删除判据扩到畸形行 → 必须转红；
4. F3-部分成功源行被删 → 必须转红；
5. 投影跑两次行集不一致（幂等破坏）→ 必须转红。

六要素（每条独立成节，缺一即无效）：
  中性化内容 / **落盘 grep 计数校验**（未落盘的变异不得计为已证明转红）/
  转红用例原文（用例名 + 断言行 + expected/received）/ 真实退出码（单独一行 code=$?，
  不得与命令替换同行——本机 bash 3.2 会污染 $?）/ 还原（备份 + cmp 字节校验，
  **不得用 git checkout**——工作树 CRLF 会被改写 EOL；记录还原 sha256）/ 回绿读数。

证据入库约定（.gitignore 已有 !docs/dispatch/evidence/**/*.log 否定规则）：
  原始日志 + SUMMARY.md（机器可核表格，六要素逐条）落
  docs/dispatch/evidence/2026-09-23-ds10-impl-negative-controls/，与回执同批提交。
  提交前用 git ls-files <目录> 确认 .log 计数等于期望（P0-A 曾在此虚报「已入库」）。

═══════ 六、门禁（当前基线，只减不增 / 只增不减） ═══════

  pnpm gate:fast → exit 0；lint 基线 **1536 warnings / 48 infos**（P0-A 后的新基线；
    只允许下降且必须说明原因，禁止 biome-ignore 等手段压制）
  node scripts/check-code-budget.mjs → exit 0（bigFiles 4 / asCast 31 / bang 89 / console 4 /
    todo 1 / defaultExport 2 / any 0 / tsIgnore 0，零上升）
  pnpm build → exit 0
  kernel 708 passed（预期不动 kernel；若实测不符，报告并停止）
  react 全量 → 1676 passed（P0-A 收口读数，只增不减）
  canvas 全量 → 589 passed（54 files，只增不减；既有用例零删除零弱化）
  doc-index.test.ts → 67 passed 零回归 + 本批新增

禁止：it.fails / 反转断言 / catch 后报 PASS / 宽泛 skip / 删除或弱化既有断言。

═══════ 七、硬性纪律 ═══════

1. 基准防漂：开工/收工各锚一次（§一）。
2. 证据随提交入库：负控证据与回执同批提交（S5 教训 #1）。
3. 提交粒度：实现 / 测试 / 负控证据 / 回执分开；message 说清为什么。
4. macOS bash 3.2：$var 后接全角字符必须 ${var}；Python bytes 字面量不允许非 ASCII。
5. 不冒充：无浏览器/IME 需求（本批纯逻辑 + jsdom），但若用到任何未实测路径，如实列未覆盖清单。
6. 停止点：不做 P0-B、不做契约勘误、不改 migrate 语义、不顺手重构投影其余部分。

═══════ 八、交付物 ═══════

1. 实现 + 测试提交（按逻辑项分批）；
2. 负控证据目录（§五约定）；
3. 回执 docs/dispatch/2026-09-2x-DS10-impl-report.md：基准锚定表 / 判据实现说明
   （path:line）/ 六条不变量逐条验证证据 / 五条负控六要素表 / 门禁逐数表 /
  starred 附带项处置（做了或明示未做及理由）/ 未覆盖清单 / 提交列表（sha + stat）；
4. 收工 git status --porcelain 为空。
```

---

## 2. 主控备注（不属 prompt 正文）

- **范围边界**：本批只动 `docIndexProject.ts` 的行集构建与（如选该机制）编排层的 partial 信号。`docIndexMigrate.ts` 的 migrate 语义、索引写入口纪律都在排除面。
- **P0-B 无冲突**：P0-B 的资产投影（assetindex/fav）与 library 行集无交互，串行安全；本批不必为 P0-B 预留任何钩子。
- **回执中最重要的两段**：六条不变量的逐条验证证据（尤其幂等与 F3 排除），以及 starred 附带项的处置声明。
