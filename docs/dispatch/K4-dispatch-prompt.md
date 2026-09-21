# K4 外派执行任务书：编辑器交互 + 插件运行时 + 快速注释编辑

> 用法：将本文件全文喂给执行 agent（Claude Code / Codex / deepseek-harness 等），工作目录设为仓库根（`<workspace>`）。任务书自包含全部上下文。

---

## 你的角色

你是 mindcanvas 仓库的工程执行 agent，负责 **K4 阶段**：在 K3 已交付的渲染层（三主题 + 玻璃 chrome + 翻卡 + dirty-flag 调度）之上，构建**编辑器交互闭环**（增删改/折叠/快捷键/撤销重做/保存）与**插件运行时实装**，并交付 R15 快速注释的编辑能力。这是从「能看」到「能用」的一步。

## 项目背景（1 分钟）

- K0-K3 全部验收通过：kernel 225 测试（协议/树/TreeOp/布局，零 DOM）、react 40 测试（三主题令牌/渲染核心/翻卡/调度）
- **编辑管线已就位**：kernel 有 `applyOp(root, op)` / `invertOp` / `OpHistory`（op 序列 + 逆操作 undo/redo）——所有编辑必须走 TreeOp，**禁止直接改树内存**
- 参考源 knowledge-canvas（`<local-path>`，只读）有完整编辑交互实现（treeOps 增删改、折叠、快捷键、大纲联动、富文本感知搜索、beforeunload 守卫、saveGate）——本阶段从它**提炼交互清单与行为语义**，在 mindcanvas 新架构上重写（旧代码不搬运，行为对齐）
- R15（spec §5.5）：`note.qa` 快速注释——K4 交付其增删改编辑

## 必读文档（开工前按序读完）

1. `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` 的 **K4 段** + 风险对策（MapView 重写防丢功能的「现有交互清单」策略）
2. `docs/specs/2026-08-27-mindmap-forgejo-sync-design.md` **§5.5**（qa 快速注释 + 存储四件套）与 **§4.6**（微内核 + 插件）与 **§4.5**（扩展缝）
3. `docs/dispatch/K3-report.md` —— K3 渲染层边界与设计决策（尤其 FrameScheduler、MapView 点选命中、翻转卡）
4. kernel API：`applyOp` / `invertOp` / `OpHistory` / `serializeMm` / `parseMm` / 六注册表（K0 已有 `createKernelRegistries`）/ Plugin 基类（K0 已有生命周期自注销测试）
5. 参考源交互清单（只读提炼）：`<local-path>`、`src/components/EditorShell.tsx`、`src/state/history.ts`、`src/state/unsaved.ts`

## 任务清单（T1-T7 按序执行，每任务一个 commit）

### T1 · 编辑交互闭环（`packages/react/src/edit/`）

- **增删改**：新建子节点 / 删除（含确认与子树回收）/ 编辑文本 / 编辑 note（含 qa）——全部经 `applyOp`，配 `invertOp` 入 `OpHistory`
- **折叠/展开**：节点折叠状态渲染（布局层已有 collapsedIds 支持，复用）
- **快捷键**：Tab（新建子）/ Enter（新建同级）/ Delete（删除）/ Ctrl+Z / Ctrl+Shift+Z（撤销重做）/ F2（编辑）——先做这 6 个，其余列对照表
- **大纲联动**（左侧 outline 视图 + 画布双向选择同步，可选若时间盒允许，标注为 P1 项）
- 行为语义对照参考源（编辑后的焦点/滚动位置/空节点处理等细节），差异记录进报告

### T2 · 保存与往返闭环（local-first，不接 Forgejo）

- 序列化：`serializeMm(editableToAst(root))` → `.mm.md` 文本
- 保存：File System Access API（支持则「保存到文件」，不支持则「下载 .mm.md」）；`beforeunload` 守卫（有未保存变更时提示）
- **往返闭环验收**：导出文本 → `parseMm` 重新导入 → 布局渲染一致（UI 级 round-trip）
- 明确不接 Forgejo / 轮询 / 409 合并——那是 forgejo-bridge 插件的事

### T3 · 插件运行时实装（`apps/canvas` 组合入口）

- kernel 六注册表在 react 侧实装：渲染器注册（节点/连线渲染器按 kind/主题注册）、note 键语义注册（links/groups/qa）、布局注册（六布局入 LayoutRegistry）
- **纯文本版构建产物**：`apps/canvas` 仅组合 kernel + 内置渲染——产出无插件可运行的构建（渐进增强「纯内核三规则」的验收：空注册表也能跑）
- Plugin 生命周期自注销在 react 侧生效（K0 kernel 测试已有；react 侧验证卸载清理 DOM/事件）

### T4 · R15 快速注释编辑

- 翻转卡面板新增 qa 编辑区：查看 / 新增 / 编辑 / 删除（输入框 + 回车提交 + 删除按钮）
- 画布侧：点选有 qa 的节点 → 注释卡浮现（K3 交互骨架）；**新增注释 → 注释卡即时出现**
- 编辑写回 `note.qa`（经 TreeOp updateNote，若 op 缺失见硬约束 2）

### T5 · 插件样例验证（轻量）

- 用六注册表实现一个「最小实验插件」演示组合能力（如：注册一个自定义 kind 渲染角标 / 或注册一个布局）——证明插件面真实可用，产物记录在报告，不追求功能完成度

### T6 · 性能与回归

- 681 节点编辑操作（增删改/折叠/撤销重做）流畅性：操作响应 < 100ms 目标（单帧预算）
- undo/redo 正确性测试（树状态序列对比）
- kernel 225 + react 既有 40 测试全绿

### T7 · 交付与交互对照表

- `docs/dispatch/K4-report.md`：门禁勾选 + **交互对照表**（参考源现有交互清单 vs mindcanvas 实现状态：已实现 / P1 后续 / 明确不做及理由）+ 快捷键表 + T3 插件样例说明 + 性能数值
- 用户痛点清单（如发布后补充）：追加为对照表验收行

## 硬约束（违反任意一条即返工）

1. **编辑必须走 TreeOp**：禁止直接修改渲染树内存；undo/redo 必须经 `OpHistory`
2. **kernel 接触面仅限 TreeOp 扩展**：若编辑所需 op 缺失（如 updateNote），允许扩展 kernel `TreeOp` 联合类型 + `invertOp` + 单测——**除此以外 kernel 源码零改动**（225 测试保持全绿）
3. 组件逻辑不写死视觉值（K3 纪律延续）；新增视觉一律走 TokenSet
4. 禁永续 rAF / 轮询（FrameScheduler 纪律延续）
5. 不接 Forgejo / 网络同步（本阶段纯 local-first）；参考源只读提炼，不复制旧代码
6. 只做 T1-T7；不做「顺手优化」

## 验收门禁（完成后逐项确认）

- [ ] `pnpm -r build && pnpm -r test` 全绿（kernel 225 保持 + react 测试增长）
- [ ] **UI 往返闭环**：画布编辑 → 导出 `.mm.md` → 重新导入解析 → 渲染一致（有自动化测试或实录步骤）
- [ ] 增删改 + 撤销/重做（Ctrl+Z / Ctrl+Shift+Z）可用且树状态正确
- [ ] 折叠/快捷键（6 个）可用；交互对照表入库
- [ ] R15：qa 查看/新增/编辑/删除可用，写回 `note.qa` 且 round-trip 不丢
- [ ] 纯文本版构建（kernel + 内置渲染，无插件）可运行
- [ ] T5 插件样例注册/卸载可验证（自注销）
- [ ] 681 节点编辑响应 < 100ms；git log 呈 `K4: TX ...`

## 遇到问题时的规则

- 参考源行为与 mindcanvas 架构冲突 → 以新架构为准，交互差异记入对照表（标注「有意不同」及理由）
- 痛点清单若由用户补充 → 立即追加为对照表验收行，按优先级实现（P0 必做 / P1 后续）
- 单点阻塞超过 30 分钟 → 写 `docs/dispatch/K4-blockers.md`，跳过继续
