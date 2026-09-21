# MindCanvas 深度收尾外派启动 prompt

你负责 MindCanvas 的 DELIVERY-CLOSE 最终验收收尾。工作区唯一指向 `<workspace>`。不是 Forgejo bridge，不读取或修改 Forgejo 项目、容器、回执。

本任务授权你实施现有验收缺口的补强、必要的最小产品修复、运行验证并交回执；不授权提交、推送、发版、开启图库/文件管理功能实现。请持续执行至本轮候选可复核，不在每个任务间反复问确认。

先读：
1. `docs/superpowers/plans/2026-09-19-delivery-close-deep-finish.md`（本轮执行主计划，T0–T7）
2. `docs/dispatch/2026-09-19-delivery-close-review.md`（DC-R1/R2/R3 的独立复核事实）
3. `docs/superpowers/plans/2026-09-18-delivery-close.md`（原目标，尤其 Task 4/5）
4. `docs/dispatch/2026-09-18-save-lifecycle-review.md` 的最终放行结论、`docs/dispatch/2026-09-19-mode-guard-review.md` 的第四轮放行结论
5. `docs/dispatch/2026-09-18-delivery-close-report.md`、`docs/specs/2026-09-18-depth-visual-hierarchy-design.md` 的最新修订、当前正式验收脚本与 4 个 release-123 夹具

重要起点：计划形成时 HEAD=a2ce72b，但当前未提交工作区已包含视觉/度量、包 1/2/3，以及一版新增的发布矩阵返修。不要从 HEAD 另开空白 worktree 丢掉这些成果，也不要照旧复核逐项重复改代码。先逐项判定“已有待复验/真实缺口/不在范围”。CI remote 说明及 lint 算术已修，核验即可。开工重新实测状态，遇到并发变化保留并归属。

按主计划串行完成：

T0/T1：建立唯一 RunId 和候选源码/驱动/夹具/构建配置指纹。所有证据写 `outputs/delivery-close-finish/<RunId>/`，正常、每个负控、截图、导出分目录。运行前校验输入清单，不一致停止该运行；修改后另建清单。写盘替身仅在 close 成功后加入 committed，文件身份固定在 handle 上，重开读取最后成功快照。

T2/DC-R1：编辑→显式保存确认→Undo，按 nodeId 精确检查旧/新标题。单份成功快照验证标题/描述/note/背面；重开保真单独检查，不要求重开保留旧 Undo。省略 Undo 的负控保持正确预期，必须命中目标失败。

T3/DC-R2：已有非空连接自由画布夹具，UI 改正面/背面、翻面、拖动；按 uuid 核对最后成功 JSON，屏幕位移按 viewport 换算世界坐标；重开检查实际 UI 内容/位置/端点，再存比较语义。读旧夹具的负控必须失败，不能仅靠数量/字节数/字符串不同判绿。

T4/T5/DC-R3：补完并复核三主题实际 token/绘制度量/输入命中；嵌套框、框内编辑、挂出避让、跨框/跨中心边的语义端点、升格/拖动/总览；两个 LOD 阈值来回缩放与滞回；真实 Canvas 纯树后端身份和节点绘制/命中；SVG 对应节点字号颜色、PNG 解码及有效节点内容，并保留导出原件。已有 backend 参数入口须保留默认行为及复杂文档强制 SVG 的保护。

特别禁止：当前 neg-theme/neg-endpoints 修改预期值，只能算断言自检。行为负控必须保持预期不变，扰动独立渲染/导出副本中的样式或端点；不要在正常产品中保留错误行为。省略 Undo、返回旧文件、不启用 Canvas 可作为对应行为负控。负控异常退出/缺元素超时不自动算命中，必须指向预定业务检查。

T6：最后一次产品/正式测试修改后跑一次最终 gate/build/analyze；同一候选产物顺序跑发布矩阵、verify-save-lifecycle、verify-mode-guard，记录实际加载 bundle。相关证据通过后，只在新变更/失败/未决问题需要时补跑，不无理由反复全仓测试。系统文件选择器、真实 OS IME、触控/跨浏览器/离线和跨平台像素金图如实保留限制，不让这些限制替代可完成的浏览器矩阵。

T7：交 `docs/dispatch/2026-09-19-delivery-close-finish-report.md`，并给原回执追加本轮章节。列原缺口→修复/已有成果→正常证据→有效负控→限制、门禁退出码/数量、候选指纹、导出原件、混合文件提交建议和服务清理。完成全部写入后生成并逐项复算新 manifest，保留旧固化材料。

保护边界：包 1/2 的慢保存不误清新 dirty、目的地切换、下载不自动离开、IME/隐藏草稿、端口代次、异步互斥、失败重试/放弃均不能回退。FlushResult 不能用真值把 'failed' 当成功。不提高预算、不扩大排除、不删具名导出、不大规模重构、不动禁区。

使用 pnpm 10.33.2。默认单写入执行者；不擅自派多个 agent 共改工作树。不 commit/push/pull/rebase/reset/stash，不整树暂存，不发布，不改 git config，不启动图库/文件管理实现或第 4 项。必要隔离必须包含当前完整候选，不以旧 HEAD 冒充。

完成后停在回执等待主控复核；结论上限“收尾候选可复核”。若存在必跑阻断，明确尚未关闭的 DC 编号及复现，继续完成独立可做部分后交接；不通过缩小宣称、放松断言或隐藏失败制造完成。
