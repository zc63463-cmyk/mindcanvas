# DELIVERY-CLOSE 首轮返修启动材料

你负责包 3 DELIVERY-CLOSE 的验收收口返修。工作区 <workspace>，HEAD 应为 a2ce72b；先核实，保留全部既有视觉/度量与包 1/2/3 成果。只做复核报告要求的范围，不重做已通过的类型补盲、预算拆分或保存/离开架构。

先读：
1. docs/dispatch/2026-09-19-delivery-close-review.md（本轮事实、DC-R1/R2/R3、修复出口）
2. docs/dispatch/2026-09-19-delivery-close-start.md
3. docs/superpowers/plans/2026-09-18-delivery-close.md，尤其 Task 4/5
4. docs/dispatch/2026-09-18-delivery-close-report.md
5. outputs/delivery-close-review-2026-09-19/browser-control.log、browser-negative.log 及 make-browser-controls.mjs

先复现，不反转断言：主控已在 main-DtzzbNKI.js 上确认，跳过 Undo + 重开旧自由画布数据时原 R1/R6 仍全部 PASS。此为验收假绿，不能直接宣称产品丢数据。

按三项收口：
- DC-R1：先保存确认完成，再 Undo；按节点身份精确核对旧/新标题。去掉“重开必须保留旧历史”的错误承诺。核对最后成功保存的单份快照；省略 Undo 的负控必须红。
- DC-R2：自由画布用非空连接夹具，改正面/背面、拖动，结构化核对最后成功 JSON 与重开后的实际内容、坐标及连接端点。读旧夹具的负控必须红；不以数量或字符串差异替代语义一致。
- DC-R3：补原计划内缺失的 Canvas 纯树后端身份/渲染检查、多中心/跨框边/嵌套框及升格拖动总览动态旅程、三主题绘制度量输入命中、SVG 对应字号颜色及 PNG 解码内容、LOD 两阈值来回缩放。保存导出件与能看见双方端点的截图。PNG 导出不能冒充 Canvas 后端。精确验收口径见复核报告，不新增产品功能或要求真实系统输入法自动化。

同时修复 CI 的无 remote 旧注释、回执不存在的输入文件链接、lint 算术表述，补混合文件的按块提交归属建议。保留首轮回执，追加返修章节并明确覆盖原错误结论。

测试与证据：正常路径通过；负控故意破坏正确行为时失败，恢复后再绿。负控只动独立副本或精确临时块并恢复，不改保护性预期。复用主控已通过的 gate/build 证据；纯验证/文档变更按影响复跑，无需无理由重复全仓测试。若改产品源码，先独立复现真实问题、最小修复，再完成受影响回归和最终 gate/build。记录最终实际 bundle，所有当前矩阵基于该产物。保留真实 OS IME/系统选择器、跨浏览器/触控/离线等明确限制，不冒充验证。

使用 pnpm 10.33.2。不放宽预算/契约，不删现有导出，不动禁区，不整树暂存；不 commit/push/pull/rebase/reset/stash，不发版、不启动第 4 项。交付更新后的原回执，列三项证据与剩余限制，然后停下等待主控复核。
