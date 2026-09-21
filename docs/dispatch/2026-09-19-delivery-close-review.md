# DELIVERY-CLOSE 独立复核 · 2026-09-19

结论：**工程门禁通过；交付收口暂不放行。** 发现三组 P2 验收问题，其中两组已用真浏览器阴性对照证实会假绿。本轮未发现据此可认定的新产品数据丢失缺陷；修复范围首先是验收脚本、证据与文档，不重做包 1/2。

输入：原实施计划、2026-09-19 启动材料、执行回执 §0–§10 与当前工作区。HEAD=a2ce72b。保留既有视觉/度量及包 1/2/3 全部修改；未提交、推送、暂存、pull/rebase/reset/stash。

## 1. 本轮独立通过项

证据目录：`outputs/delivery-close-review-2026-09-19/`。

| 检查 | 结果 | 日志 |
|---|---|---|
| pnpm gate | exit 0 | gate.log |
| 测试 | 2485 = free-canvas 12 + kernel 622 + react 1498 + canvas 353 | gate.log |
| 类型检查 | 四子项目通过；canvas 标准命令包含测试配置 | gate.log |
| 依赖 | 530 模块 / 1574 依赖，0 违规 | gate.log |
| lint | 0 error；1541 warnings + 48 infos = 1589 | gate.log |
| budget | any 0、tsIgnore 0、bang 89/90、asCast 31/31、console 4/4、todo 1/1、defaultExport 2/2、bigFiles 4/4 | gate.log |
| pnpm build | exit 0；main-DtzzbNKI.js，431.15 kB / gzip 139.80 kB | build.log |
| pnpm analyze | exit 0 | analyze.log |
| 真浏览器 R1/R6 原断言对照 | exit 0 / PASS；实际页面加载上述 bundle | browser-control.log |

已核对 typecheck、pre-push 回退、CI 的检查集合。未执行推送或远端 CI；本机结果不声称为 Linux/Node 22 CI 实测。

布局抽取辅助审计见 `inspect-extraction.cjs` / `extraction.json`：mindmap 原 36 个入口导出无减少，新增 LinkAnchor；frameLayout 原 20 个导出无减少，新增 layoutIslandLocal。LinkBuilder 保留 LayoutNode 参数。9 个抽出的连线函数体去注释格式化后与 HEAD 相同；23 个框辅助函数中 17 个函数体与 HEAD 相同，其余 6 个涉及当前工作区已有的深度度量透传，不能把它们与旧 HEAD 的不同直接认定为本包回归。当前 react 的草稿会话/组合保护导出仍保留。

以上是限定范围的源码核验及现有回归结果，不冒充已获得“包 3 开工前完整工作区快照逐值对照”。本轮未另跑性能基准、包 1/2 独立浏览器脚本或整个 R2–R5 矩阵；这些结果仍归执行者原回执所有。

## 2. DC-R1 / P2：Undo 断言既不验证保存之后，也无法识别撤销无效

位置：`tools/verify-release-123.mjs:217–226`；回执 §5 R1。

- Ctrl+Z 发生在显式保存之前，不能证明保存不清历史。
- `:has-text("叶子甲一")` 也匹配 `叶子甲一改`，所以不撤销也会通过。
- `afterUndo` 在再次编辑之后采集，名称与采样时点不一致。
- 原计划要求“保存不清 Undo”，不要求显式重开另一文档后沿用旧 Undo；回执把两者混写。

本轮阴性对照仅在独立副本省略 Ctrl+Z，不动产品与正式脚本。R1c 仍 ok=true，记录的标签含 `叶子甲一改`，整个保留的 R1/R6 集合仍 PASS。

修复出口：编辑 → 等待该次保存确认完成 → Undo → 精确断言同一节点恢复旧标题、编辑后标题消失。断言采样与动作时点一致；移除“重开保留旧历史”的多余承诺。跳过 Undo 的负控必须使该断言失败。R1 写出内容应核对最后一次已完成写入的单份快照，不能拼接全部历史写入掩盖最后快照错误。

## 3. DC-R2 / P2：自由画布重开一致性只比较数量，旧内容可蒙混通过

位置：`tools/verify-release-123.mjs:461–476`；回执 §5 R6。

- 保存判据仅检查 JSON 字符串非空、含 placements、与原始文本不同；格式化或 updatedAt 改变即可满足，不证明新坐标写出。
- 重开仅检查卡片数量，未比较位置、正反面正文、连接关系。
- 所有历史 JSON 拼接后做字符串比较，不是对最后成功快照做结构化验证。

本轮负控让内存句柄每次读取原始 JSON，忽略保存结果。原断言全部 PASS，同时独立观测：

```text
jsonReadCount: 2
reopenedEqualsLastWrite: false
reopenedEqualsOriginal: true
最后写出 pl_demo_a.transform: x=200, y=180
重开读取 pl_demo_a.transform: x=80, y=120
R6c.ok: true
result: PASS
```

正常对照为 reopenedEqualsLastWrite=true / reopenedEqualsOriginal=false。负控证明验收识别能力不足，并非宣称正常产品会读取旧内容。

修复出口：使用包含非空连接的固定夹具，编辑正反面并拖动；解析最后成功 JSON，按稳定 placement/edge 身份比较预期内容、坐标与端点。重开后核对实际模型或可观测 UI，再次保存的语义数据也可辅助证明。重开读旧夹具的负控必须失败；只看数量、长度或字符串不同不算通过。

## 4. DC-R3 / P2：计划内矩阵尚有缺口，不能将 SVG 的 PNG 下载当成 Canvas 后端验收

位置：`tools/verify-release-123.mjs:18`、R2–R5；回执 §5。

1. 没有切换/强制 Canvas 后端的步骤。普通小夹具运行 SVG；MapView 默认 svg，Canvas 为独立后端。脚本头称“Canvas 仅做纯树夹具检查”，回执称“Canvas 渲染后端导出仅断言下载非空”，均没有对应证据。PNG 文件格式不等于 Canvas 渲染后端。
2. R3 只计数框壳/行/挂出节点及全页面 path；跨簇 span 算出但未进入成功条件。原计划的嵌套框、跨框边、升格/拖动/总览、框内编辑与挂出避让、边端点检查未完成。已有 centers 截图中中心甲在视口外，不能据此人工核验双方端点。
3. R2 仅以 `root >= branch >= leaf` 加描述存在判绿，等字号也能通过；没有绘制/度量/输入命中一致性检查。R5 SVG 只统计至少三种字号、PNG 只看字节数，没有按对应节点/主题比较字号与颜色。
4. R4 在 k≈0.53/0.27 等待稳定后重复采样，证明静止状态稳定；没有跨阈值来回缩放的旅程，不能覆盖计划的邻域缩放闪烁。

修复出口仍以原 Task 4 为范围，不要求新增产品功能：补真实 Canvas 纯树入口及后端身份断言；补上述动态几何与命中旅程；按主题对应节点检查字号/色彩，保存导出件并解码 PNG 验证尺寸/有效绘制（不要求本轮建立跨平台像素金图）；在两阈值两侧采样缩放过程并确认 full 恢复。对跨中心边按语义身份定位端点，截图让双方同时可见。不能仅通过改回执为“未覆盖”同时继续宣称五任务全部完成。

真实系统选择器、真实 OS 输入法、触控/跨浏览器/离线仍可作为已声明限制；这些限制与可在当前浏览器完成的矩阵不同。不要求自动化真实系统能力。

## 5. 顺手纠正的文档项（不单列产品阻断）

- `.github/workflows/ci.yml:15` 仍称未配置 remote，当前 `git remote` 返回 origin；原 Task 5 明确要求纠正。
- 回执首行引用不存在的 `2026-09-18-delivery-close-prompt.md`，实际为 `2026-09-19-delivery-close-start.md`。
- 回执 §7 的 `1591 = 1541 + 48` 算术不成立；仅修事实，不改历史实测数字来凑结论。
- 补既有视觉/度量与保存/离开/结构抽取的混合文件提交边界，原 §9 只列包 3 大组及引用包 1/2 回执，尚不足以指导按块归属；只给建议，不执行暂存或提交。

## 6. 证据与返修纪律

`make-browser-controls.mjs` 从正式脚本生成独立副本，保留 R1/R6 原断言，剔除无关 R2–R5；增加只记录、不参与 PASS 的读取观测。`browser-negative.mjs` 仅改两处动作：省略 Undo、JSON 读取始终返回原始夹具。正常对照和负控各运行一次，均 exit 0 / PASS，后者正是缺陷证据。副本截图位于独立 outputs 子目录，不覆盖执行者截图。

本轮新增仅复核文档及 outputs 下审计脚本/日志；未改产品源码、正式验收脚本或原回执。复核预览服务已停止。

返修先复现本轮假绿，再补正确断言：正常路径绿、破坏路径红，保持保护性期望。原包 1/2 正式回归不得降级。若只改验证/文档，复跑受影响浏览器及必要检查即可；若因新断言发现产品问题，先最小复现、限定修复，并重跑受影响门禁。最终回执区分正常 PASS、预期失败的负控、系统能力限制。等待主控复核，不提交、不推送、不发布、不启动第 4 项。
