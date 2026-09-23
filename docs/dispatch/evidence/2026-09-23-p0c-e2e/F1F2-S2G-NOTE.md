# F1/F2 补充记录：S2G 同步守卫间歇拦截（归档日志之外的一次复现）

归档的 `F1F2-BROWSER.log` 来自一次**未被拦截**的运行（`durableAttempts=1`，无 finding）。
本文件记录同一脚本在**其他运行**中复现到的观察，供复核独立复算时对照。

## 观察：`F1-S2G-INTERMITTENT-BLOCK`

- **现象**：真实浏览器里「打开工作区文档 → 编辑 → Ctrl+S」，首次保存偶尔被拦截，
  界面出现「已阻止保存：当前画布内容与文档不同步（防误写）。改动未丢失——请用「另存为」…」；
  此时磁盘源码仍是**打开时的原文**；再次 Ctrl+S 可成功落盘。
- **复现**（同一 harness、同一产物，连续 3 次）：`cmd`
  ```bash
  node tools/verify-f1f2-browser.mjs   # 连跑
  ```
  结果样本：`attempts=5 s2g=4` / `attempts=4 s2g=3` / `attempts=1 s2g=None`
  （`attempts` = 脚本为达成 durable 的编辑+保存重试次数；`s2g` = 被守卫拦截的次数）。
- **机制（源码）**：`apps/canvas/src/hooks/saveGuard.ts:17 canWriteDoc` 要求
  `syncedSourceRef === doc.source` **精确等值**；该簿记在
  `apps/canvas/src/hooks/useDocumentSwitch.ts:86,90`（effect，deps `[doc.source]`）
  与 `apps/canvas/src/MindmapStage.tsx:278`（controller 创建）置位。
  「打开 → 立刻编辑」时 effect 可能尚未提交 → 簿记未更新 → 整次保存被拒。
- **影响**：用户可见的假失败（提示被阻止、需再按一次），**非数据丢失**。
- **判定**：medium；不阻塞 P0-C 主体范围。归档日志那次未触发属正常（间歇性）。

## 复核建议

连跑 `node tools/verify-f1f2-browser.mjs` 3~5 次，观察 JSON 里
`durableAttempts > 1` 或 `s2gBlockedTimes > 0`，即可独立复现该间歇拦截。
