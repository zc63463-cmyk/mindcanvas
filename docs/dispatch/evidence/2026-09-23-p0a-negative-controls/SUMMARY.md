# P0-A 判别性负控 · 实测汇总（机器可核）

- 日期：2026-09-23
- 执行者：P0-A 施工包
- 方法：`/tmp/p0a-nc/nc.sh` 六要素流程（中性化 → **落盘 grep 计数校验** → 跑测并单独捕获退出码
  → 转红原文 → 备份还原 + `cmp` 字节校验 → 回绿读数）
- 还原方式：备份 + `cmp`（**不用** `git checkout` —— 工作树 CRLF 会被改写 EOL）

本目录的 `.log` / `-restore.log` 是每一条的**原始输出**（转红态与回绿态各一份）。

| # | 编号 | 中性化了什么 | 落盘校验 | 转红退出码 | 转红读数 | 回绿读数 | 还原 sha256 |
|---|---|---|---|---|---|---|---|
| 1 | NC1 | 去掉租约对 `submit` 的拦截（模拟「只清定时器、不取租约」） | `NEUTRALIZED(NC1)` ×1 | **1** | 9 failed / 34 passed (43) | 43 passed | `ba22e0c5…` |
| 2 | NC2 | 把 `waitForIdle` 当物理写静默（判据换成 `isSaving()`） | `NEUTRALIZED(NC2` ×2 | **1** | 1 failed / 19 passed (20) | 20 passed | `ba22e0c5…` |
| 3 | NC3 | 移除编排层的 `rebindDestination`（R-01 旧实现） | `NEUTRALIZED(NC3)` ×1 | **1** | 3 failed / 17 passed (20) | 20 passed | `1598678a…` |
| 4 | NC4 | 去掉 I-14 前置（改名前不要求落盘） | `NEUTRALIZED(NC4)` ×1 | **1** | 3 failed / 17 passed (20) | 20 passed | `1598678a…` |
| 5 | NC5 | 跳过 L4 外部修改复查 + 绕过 L3 副本保护 | `NEUTRALIZED(NC5` ×2 | **1** | 2 failed / 17 passed (19) | 19 passed | `33608f6b…` |
| 6 | NC5b | L3 **渲染层**：无条件渲染「撤销新副本」 | `NEUTRALIZED(NC5B` ×1 | **1** | 2 failed / 11 passed (13) | 13 passed | `3d4df484…` |
| 7 | F2-a | 先删再询问（把删除提到 dirty 判定之前） | `NEUTRALIZED(F2A` ×1 | **1** | 13 failed / 8 passed (21) | 21 passed | `1d8ee773…` |
| 8 | F2-b | 「放弃修改」后仍保存一次（文件会被重建） | `NEUTRALIZED(F2B` ×1 | **1** | 2 failed / 19 passed (21) | 21 passed | `1d8ee773…` |
| 9 | F3-a | 把 partial 当 failed 呈现（丢「两份」事实） | `NEUTRALIZED(F3A` ×1 | **1** | 12 failed / 7 passed (19) | 19 passed | `1598678a…` |
| 10 | F3-b | 盲目重试：删源前重建目标（覆盖新副本） | `NEUTRALIZED(F3B` ×1 | **1** | 2 failed / 17 passed (19) | 19 passed | `33608f6b…` |
| 11 | F5 | 收藏身份不搬运（键回退为 fullPath 的旧实现） | `NEUTRALIZED(F5)` ×1 | **1** | 6 failed / 61 passed (67) | 67 passed | `1507bf89…` |

## 两轮「假绿」的处置记录（重要）

第一轮有两条负控**没有转红**，说明当时的用例判别力不足。两处都已定位并修好用例后重跑：

1. **NC2 第一轮 exit 0**：原「物理写在途 → busy-physical」用例制造的是**当前会话**的在途写，
   `isSaving()` 也能命中 → 中性化后仍绿。补了一条覆盖 `waitForIdle` 覆盖不到的跨会话场景
   （切文档后旧会话物理写仍在途，此刻 `isSaving()` 已为 false），重跑转红。
2. **NC3 第一轮 exit 0**：原夹具的 `onRebound` **自己**调用 `rebindDestination`，
   于是「目的地是否换到新路径」只能观察到夹具行为。改为由编排层直接重绑
   （与生产接线分工一致）并加显式断言后，重跑转红 3 条。
3. **专项 (c) 第一轮只转红 L4**：L3 保护是**状态层 + 渲染层**两段，原用例只驱动
   `discard-copy-changes`，证明不了界面收起了 `undo-copy`。补 `file-op-panels.test.tsx`
   渲染契约用例后，NC5b 转红。

结论：本包 11 条负控全部**实际转红并如实记录退出码**，且每条都有回绿读数与字节校验过的还原 sha256。

## 纪律声明

- 未使用 `it.fails` / 反转断言 / `catch` 后报 PASS / 宽泛 `skip`；
- 每条中性化都**先在盘上用 grep 计数确认**（见「落盘校验」列），未落盘的变异不计为「已证明转红」；
- 退出码单独一行捕获（`code=$?`，不与命令替换混写 —— 本机 bash 3.2 会污染 `$?`）；
- 还原用备份 + `cmp` 字节校验，记录还原后 sha256 与回绿 passed 数。
