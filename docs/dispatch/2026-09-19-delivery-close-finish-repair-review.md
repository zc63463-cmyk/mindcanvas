# DELIVERY-CLOSE RunId 20260919-03 独立复验

结论：**DF-R1、DF-R3 关闭；DF-R4 的当前绝对路径绘制修复认可。仅剩 DF-R5（DF-R2 的同格式目的地隔离补口），暂不整体放行。** 不重开包 1/2，不重做已通过矩阵，不启动新功能实现。

对象：HEAD `a2ce72bf122574815bf1b9134253a7bd0349c038` 的当前未提交候选；执行者证据 `outputs/delivery-close-finish/20260919-03/`。本轮独立证据 `outputs/delivery-close-owner-review-20260919-02/`。

## 1. 本轮实际执行

| 项 | 结果与证据 |
|---|---|
| 完整候选复算 | 新增本复核文档之前，805/805，missing/mismatched/extra=0；3 个门禁配置已包含。`audit.json` |
| 运行输入复算 | 11 项匹配；当前驱动、helper、夹具、入口产物一致 |
| 交付清单独立逐项复算 | 197/197，missing/mismatched/extra=0；未调用会覆盖执行者复算回执的脚本 |
| 正常浏览器矩阵 | **47/47 PASS，exit 0**，实际加载 `main-Db31m2so.js`，page error 0；`normal/results.json`、`normal.log` |
| 正式 Canvas 单元测试 | `pnpm --filter @mindcanvas/react exec vitest run tests/canvas-backend.test.tsx`，**9/9 PASS，exit 0** |
| 当前真实路径函数定向执行 | M/L、Q、C、Z 正确发出对应坐标指令；`audit.json:pathCalls` |
| 跨夹具旧句柄 | 正式注入源码 main→pure 后仍读 MAIN FILE，已修复 |
| 同格式目的地 | 正确期望探针 **exit 1**，B 写入污染 A 的 mock 读取；见下节 |

本轮审阅了六个原负控的机制和结果：正常/各负控同为 47 项固定集合，环境失败 0。**未独立复跑六组负控、全仓 gate/build/analyze、包 1/2 浏览器脚本**；这些仍是执行者固化证据，不冒充主控本轮实跑。

## 2. 唯一返修阻断：DF-R5 / P2，同格式另存为共用账本身份

代码：`tools/verify-release-123.mjs:237`，`scopeOf(kind)` 与 `showSaveFilePicker`。

`makeHandle()` 已在创建时固定 scope，关闭了跨夹具切换串档。但 scope 仍只有 `md:<fixtureKind>`，未区分同一夹具的两个不同目的地。专项探针的“双目的地”实际选 md 与 json，未命中同格式另存为。

主控执行正式浏览器注入函数，操作如下：

1. 打开句柄 A：`release-123.mm.md`，写 `A SAVED`，成功 close。
2. 另存为句柄 B：`release-123-saved.mm.md`，写 `B SAVED`，成功 close。
3. 分别读取 A 与 B。

```text
A.name=release-123.mm.md       A.scope=md:main
B.name=release-123-saved.mm.md B.scope=md:main
expected: A=A SAVED, B=B SAVED
actual:   A=B SAVED, B=B SAVED
AssertionError: Saving B must not overwrite the committed snapshot read through original handle A
exit 1
```

证据：`audit.mjs/json`、`same-format-probe.mjs/log`、`same-format-probe-exit.txt`。这是**验收文件系统替身的问题**，不能据此声称产品真的覆盖了旧文件。

修复只需区分三层身份：夹具来源、实际文件目的地、句柄对象。以稳定 fileId/destinationId 存储内容；两个不同文件即便同格式甚至同名也独立；重新打开同一文件时的新 handle 必须读回同一份 committed。不要简单地“每次 picker 分配新文件”，否则会破坏已通过的保存→重开链。

验收出口：A/B 同为 Markdown，分别写出后仍各读自己的内容；B 后续 auto 写不影响 A；A 写入 pending/失败不影响 B；同一个文件换 handle 重开读最新成功快照；既有跨夹具/延迟 close/跨类型隔离与 stale-json 负控保持。使用真实注入函数，在浏览器补一条对应旅程。中性化 fileId 隔离后，该正确期望必须红。

## 3. DF-R1、DF-R3、DF-R4 的裁决边界

- **DF-R1 关闭**：805 项当前候选确实匹配，不再只有 status 差异；隐藏配置已覆盖。旧 `fingerprint()` 仍保留过滤缺陷，但正式流程已改用 `full-candidate`，不以未使用旧入口为新阻断。本次新增复核文档会成为已知 extra，不代表执行者源代码事后漂移；下轮候选正常纳入新材料即可，旧清单不覆盖。
- **DF-R3 关闭**：新 R3g2、R4e/h/i 与实际正常结果一致，保护另一岛/视口、真实落点、0.26 滞回、活动窗口冻结。R4h 使用浏览器内合成 wheel 且实测 <120ms，不将其夸大为所有设备的手势覆盖。
- **DF-R4 当前输出范围认可**：生产代码只增加路径接口和解析，M/L/Q/C/Z 的绝对指令坐标实测正确，原“空路径 stroke”已修。连线省略负控原件仅 R5d 红，机制有效。R5d 是固定夹具的列墨迹判据，不等于所有布局/端点语义的完整像素验证。
- **R5b 调整认可但措辞需准确**：连线落笔会连通原先分离的墨迹带，旧代理判据确实应替换；这是有理由的验收指标替换，不能同时说“未改期望值/未删检查”。R5c 当前保证命中 ≥2 个 depth，而非三个 depth 全部逐区绘制已证。回执按实际条件写即可，不再要求另立全覆盖专项。

## 4. 非阻断备注：不支持的小写命令没有真正被跳过

`canvasBackend.tsx` 遇到小写命令仅 `continue`，没有清掉上一条 cmd。例如当前真实函数收到 `M 1 2 l 30 40 L 50 60`，实际发出 `moveTo(1,2), moveTo(30,40), lineTo(50,60)`；与“相对命令不落笔”的注释不符。

目前场景生成器输出约定的绝对命令，因此**不以此重开 DF-R4 或扩大本轮产品修复**。后续接入外部路径前应修正该保护或明确输入前置条件；本轮文档不承诺支持任意 SVG 路径。

另有回执编辑残留不需重测：§4.2 的 `neg-canvas-links` 列把 R5c 写成“连带红”，实际该负控仅 R5d 红；R5c 连带红属于 `neg-canvas`。§5.1 仍有 804 项，最终正确数量为 805。旧报告保持原样，在新回执勘误即可。

## 5. 最小下一步

只返修 DF-R5 的工具与对应旅程，新增唯一 RunId 并保留旧 805/197 材料。无需修改产品源码或无理由重跑全仓门禁；复跑受影响 R1/R3/R6、另存为隔离负控与 stale-json 控制，最终正常矩阵确保同一候选不回退。若发现必须改产品，再按实际影响增加门禁。

本轮最终产品源码与正式工具未改；此前复核报告/启动 prompt 已恢复至候选中的原字节并再次复算 805/805。新结论仅写本文件，避免改写历史裁决。独占服务 PID 80912 已停止，5184 无监听；未动他方服务。未提交、推送或发布。
