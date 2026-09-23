# P0-B 判别性负控 · 实测汇总（机器可核）

- 日期：2026-09-23
- 执行者：P0-B 施工包
- 方法：`/tmp/p0b-nc/nc.sh` 六要素流程（①中性化 → ②**落盘 grep 计数校验** → ③跑测并单独捕获退出码
  → ④转红原文 → ⑤备份还原 + `cmp` 字节校验 → ⑥回绿读数）
- 还原方式：备份 + `cmp`（**不用** `git checkout` —— 工作树 CRLF 会被改写 EOL）
- cwd 由测试文件位置决定（`packages/react` / `apps/canvas` 各有自己的 vitest 配置与 `tests/`）

本目录的 `.log`（转红态）与 `-restore.log`（回绿态）是每一条的**原始输出**。

| # | 编号 | 中性化了什么 | 落盘校验 | 转红退出码 | 转红读数 | 回绿读数 | 还原 sha256 |
|---|---|---|---|---|---|---|---|
| 1 | A1-LATE | 去掉「迟到结果」的 epoch/scope 校验（`isCurrent` 恒 `true`） | `NEUTRALIZED(A1-LATE` ×1 | **1** | 1 failed / 32 passed (33) | 33 passed | `5dd03724` |
| 2 | A1-CACHEKEY | 缓存键退回只有 `id`（R-07 旧实现，无作用域前缀） | `NEUTRALIZED(A1-CACHEKEY` ×1 | **1** | 2 failed / 31 passed (33) | 33 passed | `2d3a6898` |
| 3 | A2-SILENT-REPLACE | 同名静默替换（删掉整个三选分支，直接按原名覆盖） | `NEUTRALIZED(A2-SILENT-REPLACE` ×1 | **1** | 4 failed / 29 passed (33) | 33 passed | `5dd03724` |
| 4 | A3-ITEM-ONLY | 沿用「只返回 `AssetItem`」的现状接口（IDB 写失败也报 `written`） | `NEUTRALIZED(A3-ITEM-ONLY` ×1 | **1** | 1 failed / 14 passed (15) | 15 passed | `d461b20f` |
| 5 | A3-SESSION-AS-SAVED | 把 `session-only` 显示为「已保存」 | `NEUTRALIZED(A3-SESSION-AS-SAVED` ×1 | **1** | 1 failed / 19 passed (20) | 20 passed | `d8f27b35` |
| 6 | SP1-SIZE-MTIME | 把三选的跳过判据从「显式字节已比对」换成「未提供该项即视为已比对」（等价于用 `size`+`mtime` 判同内容，CE-03） | `NEUTRALIZED(SP1-SIZE-MTIME` ×1 | **1** | 1 failed / 32 passed (33) | 33 passed | `5dd03724` |
| 7 | SP2-NO-ACCOUNTING | epoch 变化后什么都不做（`isWriteConfirmed` 恒 `true`，不记账） | `NEUTRALIZED(SP2-NO-ACCOUNTING` ×1 | **1** | 2 failed / 6 passed (8) | 8 passed | `4aacc33d` |
| 8 | SP3-CHILD-BUILTIN | `SidePanels` child 分支直接写 `item.id`（CE-05 旧实现，内置图标序列化成 `builtin:`） | `NEUTRALIZED(SP3-CHILD-BUILTIN` ×1 | **1** | 1 failed / 19 passed (20) | 20 passed | `60efac4d` |

## 两轮「假绿 / 假红」的处置记录（重要，两处都是本轮实测抓出来的）

1. **第一轮的 1–6 条「转红」全部无效（假红）**：脚本把 `packages/react` 的用例放到
   `apps/canvas` 的 cwd 里跑，vitest 报 `No test files found` 并以 exit 1 退出 ——
   退出码看着像「转红」，实际什么都没执行。**这正是纪律 (b) 要防的那种假证据**：
   只看退出码不看读数就会把它当成判别力证明。
   修法：`nc.sh` 增加 `pkg` 参数（cwd 按测试文件所属包），并核对转红读数的 passed 数
   与回绿读数同量级。修正后 1–6 条的转红读数与回绿读数都落在同一测试文件上。

2. **SP3 第一轮真·不转红（exit 0，20 passed）**：原 N4 三条用例**直接调**
   `normalizeForInsert` —— 它们证明「归一化函数会把内置图标内联」，
   却证明不了 `SidePanels` 的 child 分支**调用了它**。中性化 child 分支后函数用例照旧全绿。
   修法：在 `asset-insert-normalize.test.tsx` 末尾新增一组**渲染层**用例（驱动真实
   `SidePanels`：切「内置图标」Tab → 选「子分支」→ 点卡片 → 读 controller 收到的引用 id），
   断言 `added[0].id` 不以 `builtin:` 开头。重跑后 SP3 转红（1 failed / 19 passed，exit 1）。

结论：本包 8 条负控**全部实际转红并如实记录退出码**，每条都有回绿读数与 `cmp` 字节校验过的还原 sha256。

## 纪律声明

- 未使用 `it.fails` / 反转断言 / `catch` 后报 PASS / 宽泛 `skip`；
- 每条中性化都**先在盘上用 grep 计数确认**（见「落盘校验」列），未落盘的变异不计为「已证明转红」；
- 退出码单独一行捕获（`code=$?`，不与命令替换混写 —— 本机 bash 3.2 会污染 `$?`）；
- 还原用备份 + `cmp` 字节校验，记录还原后 sha256 与回绿 passed 数；
- **负控与正例使用同一份正确期望**：每条只改生产实现，测试文件的期望一字未动。
