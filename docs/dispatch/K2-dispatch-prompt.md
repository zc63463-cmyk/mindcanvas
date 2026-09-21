# K2 外派执行任务书：headless 树与布局引擎移植

> 用法：将本文件全文喂给执行 agent（Claude Code / Codex / deepseek-harness 等），工作目录设为本仓库根（`<workspace>`）。本任务书自包含全部上下文。

---

## 你的角色

你是本仓库的工程执行 agent，负责执行 **K2 阶段**：把参考源 knowledge-canvas 的树操作与布局引擎移植进 `packages/kernel`，并提炼**可重放操作形态（TreeOp）**。K0（注册表/实体/插件基座）与 K1（协议层 93 测试）已验收——你的地基已就绪。本阶段「移植为主、一处新设计」（TreeOp），成功标准是 headless 内核在纯 Node 环境全绿 + 500+ 节点性能达标。

## 必读文档（开工前按序读完）

1. `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` 的 **K2 段** + 「风险与对策」
2. `docs/dispatch/K1-report.md` —— K1 移植边界与工程决策（尤其 NodeNext 构建与 noUncheckedIndexedAccess 处理）
3. `docs/research/2026-08-27-mindmap-kernel-oss-research.md` §3 —— 布局算法谱系（自研引擎与 RT→Walker→Bucheim→van der Ploeg 谱系同构，O(N) 方向正确）
4. 参考源（只读）：`<local-path>`（treeOps / history）与 `src\layout\`（mindmap / layouts / cull / nodeLayout / relations / minimap）

## 任务清单（T1-T6 按序执行，每任务一个 commit）

### T1 · 树操作移植（`packages/kernel/src/tree/`）

- 移植参考源 `src/state/treeOps.ts`（ast↔editable/查找/增删）到 `src/tree/`，保持纯函数
- **不移植**：`poll.ts` / `pollCoordinator.ts` / `saveGate.ts` / `unsaved.ts`（依赖 BroadcastChannel / beforeunload / forgejo——浏览器与应用层，属 K4 或不移植），K2-report 记入未移植清单

### T2 · TreeOp 可重放操作形态（本阶段唯一新设计）

- 把树变更提炼为**操作对象**：`addChild / removeNode / moveNode / updateText / updateNote` 等（以 treeOps 现有能力为准，不臆造）
- `applyOp(root, op): root` 纯函数；op 携带全部参数（不依赖闭包/时序）——**CRDT 留缝**（K2 报告中说明：将来 Loro/Yjs 同步只需把 op 序列喂给 CRDT）
- 移植 `history.ts` 并以 **op 序列 + 逆操作** 实现 undo/redo（保持参考源对外行为；若参考源 history 是快照式，移植后在其上包一层 op 化 API，两种机制并存入报告说明）

### T3 · 布局引擎移植（`packages/kernel/src/layout/`）

按依赖判定移植范围，预期：

- `mindmap.ts`（buildLayoutTree / annotateTree / collectLayout / placeSubtree / 子树高度缓存）+ `layouts.ts`（六布局）+ `cull.ts`（视口裁剪）+ `relations.ts`（note.rel 关系边几何）——纯逻辑，整体移植
- **`nodeLayout.ts` 的文本度量是本阶段关键防线**：若其实现依赖 DOM（measureText 等），**必须抽象为注入接口** `MeasureFn`——kernel 提供字符宽度估算的默认实现，精确 DOM 度量由 `packages/react` 将来注入。kernel 内**零 DOM 依赖**是硬约束
- `minimap.ts` 若偏渲染（依赖视口概念），暂缓移植并记录；纯几何部分可提取
- 接线：`registerBuiltinLayouts(registries)` 把六布局种入 K0 的 LayoutRegistry

### T4 · 随迁测试

- 移植参考源 `tests/` 中依赖 `src/state/treeOps|history` 与 `src/layout/*` 的测试文件（K1-report 未移植清单里的 state/layout 相关项，本轮消化），修 import 后全绿
- 依赖 forgejo/components/浏览器 API 的测试继续不移植，更新差额账目

### T5 · 基准测试（500+ 节点）

- 新增 `packages/kernel/tests/benchmark-layout.test.ts`：合成 500 / 1000 / 2000 节点平衡树
  - 断言布局完成时间上限（宽松阈值防 flaky，如 2000 节点 < 500ms）
  - **线性度检查**：节点数 ×2 → 时间比率 < 3（O(N) 行为守护，对齐参考源 A1 优化结论）
  - 结果数值写入 K2-report（供 K3 对照「不劣于现值」）

### T6 · 交付自查与报告

- `docs/dispatch/K2-report.md`：门禁打勾 + 移植清单（源→目的地）+ **未移植清单及原因** + TreeOp 设计说明（op 集、undo/redo 机制、CRDT 留缝论证）+ MeasureFn 抽象决策 + 基准数值

## 硬约束（违反任意一条即返工）

1. 移植代码**逐字忠实**——疑似 bug 只记录不改（K1-report 的冲突记录格式沿用）
2. `packages/kernel` 依赖图保持：零运行时依赖、零 react、**零 DOM API**（MeasureFn 抽象是本阶段新增的纯净性要求）
3. TreeOp 是唯一允许的新接口设计；布局/树逻辑不重新发明
4. K0/K1 全部测试必须继续绿（接线不许破坏既有语义）
5. 不修改 knowledge-canvas 参考源任何文件
6. 只做 T1-T6；不做「顺手优化」

## 验收门禁（完成自查后逐项确认）

- [ ] `pnpm install && pnpm -r build && pnpm -r test` 全绿（预期 kernel 测试数显著增长：K0/K1 的 119 + 移植 + 新增）
- [ ] 纯 Node 环境全绿（vitest 默认 node 环境，即证明 headless）
- [ ] 基准：2000 节点布局 < 500ms 且线性度检查通过，数值入报告
- [ ] TreeOp：`applyOp` 纯函数 + undo/redo 单测（op 序列重放与逆操作）
- [ ] MeasureFn 注入生效：kernel 默认估算实现可跑，DOM 依赖为零
- [ ] 六布局注册入 LayoutRegistry 有单测
- [ ] git log 呈现 `K2: TX ...` 分步提交

## 遇到问题时的规则

- 参考源与文档冲突 → 以参考源代码为准，记录冲突
- 依赖判定拿不准（如 minimap 是否可移植）→ 先尝试纯逻辑提取，失败则暂缓并记录
- 单点阻塞超过 30 分钟 → 写 `docs/dispatch/K2-blockers.md`，跳过继续
