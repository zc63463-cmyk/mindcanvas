# MindCanvas 最终定向补口：DF-R5

工作区 `<workspace>`。先读 `docs/dispatch/2026-09-19-delivery-close-finish-repair-review.md`，它是最新裁决。DF-R1、DF-R3 已关闭，DF-R4 当前绝对路径输出修复认可；不要按旧 prompt 重做这些事项。

本次只修验收替身的**同格式另存为目的地隔离**，沿用当前未提交候选，不提交、不推送、不发版，不启动图库/文件管理实现。主控探针显示：旧文件 A 与另存为文件 B 都属于 md:main，写 B 后 A 也读出 B SAVED。不是要求重写产品保存协调器。

复现入口为 `outputs/delivery-close-owner-review-20260919-02/same-format-probe.mjs`，它 import 同目录 audit.mjs 并重新执行正式注入。请先复制这两个文件到你的独占目录，仅改 import/输出路径，避免覆盖主控证据；正确期望当前应 exit 1。

实现要求：

1. 区分 fixture 来源、实际 fileId/destinationId 与 handle 对象；两个不同 Markdown 文件不能共用存储身份，同名不同文件也不能合并。重新打开同一文件的新 handle 应读回同一 committed，不能每次 picker 都造空文件。
2. 保留创建时固定归属、pending 不可读、close 成功才入账、失败不推进成功快照的契约。旧 handle 跨夹具仍读旧文件。
3. 对正式注入新增断言：A/B 各自最后快照；B 的后续 auto 不改 A；A pending/失败不改 B；换 handle 重开同一文件仍读最新成功快照。在真实浏览器加对应保存/另存为旅程。
4. 补行为负控：只中性化 destinationId 隔离，正确预期不变，必须命中目标失败。保留既有 stale-json 负控，避免再次被读取重构吞掉。
5. 新建唯一 RunId、输入/候选/交付清单。所有驱动与 helper 定稿后冻结，逐项复算；不覆盖 20260919-02/03 或主控目录。文档说明 R5b 是指标替换、R5c 实际仅要求 ≥2 depth；勘误见最新复核，不覆写旧回执。

只改工具/测试/文档时不机械重跑全仓 gate/build。完成专项红→绿、相关负控与最终正常浏览器矩阵；其余已通过且候选未变的证据可以明确引用。若确实需要产品改动，先复现实际缺陷并限定范围，再补受影响门禁。

持续执行直到该项可复核，结束交独占新回执，列实际修改、保护性探针、正常/负控、候选与限制，然后停下等主控复核。不要再宣称跨 md/json 就等于两个同格式目的地隔离。
