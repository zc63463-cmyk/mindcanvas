# 2026-09-15 · 观察项 / 待办清单（open items）

> 来源：L / F / F5 / R6 / P1 / S2F / S2G 各批判复与本轮对话，按「可随时立项」粒度收拢。
> 每项含来源锚点（立项时回读原文）；完成一项即在表内划掉并注批次号。

| # | 项 | 来源锚点 | 建议处置 | 量级 |
|---|---|---|---|---|
| O1 | canvas 测试不在 tsc 范围（门禁盲区：`tsconfig` include 只含 `src`，测试类型错误仅靠运行期暴露） | S2G 执行报告 + 复核实测 `apps/canvas/tsconfig.json:11` | 先探底（一次 `tsc --noEmit` 覆盖 tests，看既有错误量）再决定是否纳入 gate | 半小时探底 |
| O2 | 「保存中」指示闪一帧（守卫拦截发生时） | S2G 报告 §偏差 #3 | 检查点从 `runSave` 任务内移到之前（位置调整，逻辑不变）；并入任意小批 | 微 |
| O3 | `NoteGrowthPanel` 孤儿组件（零生产渲染点，仅两常量被消费） | `docs/specs/2026-09-14-node-card-flip-markdown-design.md:123` | 记录保留 or 收编（ADR-0004 冻结导出面，删除需评估） | 小 |
| O4 | 宿主侧 `jumpToAnchor` 无 jsdom 测试（纯函数级可测） | L 批复核（2026-09-13，`outputs/2026-09-13-text-links-report.md` 同批）；canvas tests 内 0 命中 | 补 1–2 条判别钉 | 小 |
| O5 | F §7-2：`placeSubtreeIncremental` delta 平移优化（与 `shiftTree` memo **同族风险**） | `outputs/2026-09-14-forest-layout-cache-report.md` §7-2；F5 已转正不变量矩阵 `packages/kernel/tests/layout-forest-shift-invariance.test.ts` | **做时必须先过 shift 不变量矩阵**；收益 ~1–2ms | 中 |
| O6 | F §6.2：编辑嵌套升格子岛时祖先升格岛误 miss（投影层级对齐） | 同上报告 §6.2 | 只影响命中率、不影响正确性；等真实痛点再立 | 中 |
| O7 | node-card P2 剩余切片：表格 / 图片（前置论证 §1.2-1）/ 导出背面（export 选面） | 设计稿 §8-P2 | 随 P2 主批（背面编辑）之后按需排期 | 中 |
| O8 | node-card P3：`type:'card'` + 「未知 type 降级纪律」ADR | 设计稿 §11-Q1 / §8-P3 | 触发条件未达（卡需参与布局时）；备查 | 大 |
| O9 | （可选）推送包装器入库 | 本会话多次重建 `tmp-push.ps1`（pnpm PATH 注入 + 重试 + 远端真值复核） | 可固化进 `tools/`；也可维持临时 | 微 |
| O10 | 关闭 note 面板后的布局过渡窗口内点击落空（「note 预留」移除 → 森林重排，~40px 级多帧位移 → hit-test miss） | P2 复核（2026-09-15）+ `outputs/2026-09-15-p2-back-edit-report.md` §偏差5 | 产品侧**不做兜底**（真实用户「关闭→移动→点击」间隔天然覆盖该窗口）；测试侧 `waitForStablePos` + `clickNodeFlushed` 已落（P2 e2e）；收到真实用户反馈再议 | 备查 |

## 不动作清单（备查）

- `tools/graph-engine/`：历史未跟踪目录，纪律 = 不动、不提交。
- 已接受边界（非待办）：S2G §边界清单 5 条（同内容文档互切视为同步 / 拦截后不自动重试 / 另存后原文档继续被拦 / 解析失败不置位 / 通知策略）；F 批 §6.2/§7 相关条目见 O5/O6。
