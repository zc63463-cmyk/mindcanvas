# K4 交付报告（2026-08-27）

> 本文件是 K4 阶段（编辑器交互闭环 + 保存往返 + 插件运行时 + R15 快速注释 + 插件样例 + 性能回归）的交付自查与总结。
> 执行依据：K4 任务书、`docs/roadmap/2026-08-27-kernel-refactor-roadmap.md` K4 段、spec §4.5/4.6/5.5、参考源 knowledge-canvas（只读提炼交互清单，不复制代码）。

## 验收门禁（逐项确认）

- [x] `pnpm -r build && pnpm -r test` 全绿
  - test：kernel **225 tests / 31 文件**保持全绿 + react **65 tests / 15 文件**（K4 新增 25：editor-controller 8 / roundtrip 4 / qa 4 / runtime 4 / demo-plugin 2 / edit-perf 3）
  - typecheck / build：三包全过
- [x] **UI 往返闭环**：编辑 → 导出 `.mm.md` → 重导解析 → 渲染一致——`tests/roundtrip.test.ts` 自动化：编辑增删改/note/qa → `serializeMm` → `parseMm` → 再 serialize **逐字节一致**（数据无损）；qa 透传键 round-trip 不丢
- [x] 增删改 + 撤销/重做（Ctrl+Z / Ctrl+Shift+Z）可用且树状态正确——`edit-perf.test.ts` 快照序列对比：s0→s1→s2→s3 逐步 undo 还原 / redo 重放，逐字节比对
- [x] 折叠/快捷键（6 个必做）可用；交互对照表入库（见 §三）
- [x] R15：qa 查看/新增/编辑/删除可用，写回 `note.qa` 且 round-trip 不丢（QaEditor 测试 + roundtrip.test qa 透传断言）
- [x] 纯文本版构建（kernel + 内置渲染，无插件）可运行——`createReactRegistries` 内置种子 + 零插件默认可用；`apps/canvas` vite build 通过；无插件配置全部测试绿
- [x] T5 插件样例注册/卸载可验证（自注销）——DemoPlugin 组合能力 + `unload` 后注册项全部释放（`demo-plugin.test.ts` / `runtime.test.ts`）
- [x] 681 节点编辑响应 **1.41ms 中位数**（< 100ms 目标，含 relayout 重排成本）；git log 呈 `K4: TX ...` 分步提交

**git log（K4 分步）**

```
8c53609 K4: T6 性能与回归——681 节点编辑+relayout 中位数 1.41ms + undo/redo 快照序列对比
6afe3ed K4: T5 插件样例验证——DemoPlugin 组合能力 + 自注销测试
3f7444b K4: T4 R15 快速注释编辑——QaEditor + QaCard + annotation 令牌
82b07de K4: T3 插件运行时实装——createReactRegistries + PluginHost 生命周期自注销
7d8267f K4: T2 保存与往返闭环——saveMarkdown + beforeunload + UI round-trip
4334a3c K4: T1 编辑交互闭环——EditorController（全编辑经 TreeOp+OpHistory）
```

## 一、架构决策记录

1. **编辑一律走 TreeOp**（硬约束 1）：`EditorController` 全部变更经 `OpHistory.apply(op)`（add-child / remove-node / move-node / update-node），undo/redo 经逆操作，禁止直接改树内存。折叠/选中/编辑态是瞬时状态（不进 op 历史，参考源同语义）。
2. **updateNote 无需扩展 kernel**（硬约束 2 触发判定为否）：`TreeOp.update-node` patch 已含 `note`，qa 经 `note.qa` 透传键（`Note` 索引签名承载）——kernel 225 测试零改动全绿。
3. **插件样例放 react 包**：DemoPlugin 属 react 运行时组合面（随包发布），apps/canvas 消费导入（避免 canvas→react 测试跨包耦合）。
4. **注册表覆盖语义**：`Registry.register` 同 key 覆盖 = 替换（不保留被覆盖内置值）；插件 unload 释放自己条目后回落为空（K5 镜子可精化为「恢复旧值」——已记录为 K5 候选）。

## 二、快捷键表

| 快捷键 | 动作 | 状态 |
|---|---|---|
| Tab | 新建子节点（自动进入编辑） | ✅ 已实现 |
| Enter | 新建同级节点（自动进入编辑） | ✅ 已实现 |
| Delete / Backspace | 删除节点（confirm 确认 + 子树回收） | ✅ 已实现 |
| F2 | 编辑文本（内联输入框；Enter 提交 / Esc 取消 / blur 提交） | ✅ 已实现 |
| Space | 折叠 / 展开选中节点 | ✅ 已实现 |
| Ctrl+Z | 撤销 | ✅ 已实现 |
| Ctrl+Shift+Z / Ctrl+Y | 重做 | ✅ 已实现 |
| Ctrl+S | 保存（local-first；下载/FS Access） | ✅ 已实现 |
| Shift+Tab | 缩进（move-node 上移） | ⏳ P1 |
| 方向键 ↑↓←→ | 节点导航 | ⏳ P1 |
| ? | 快捷键帮助面板 | ⏳ P1 |
| Ctrl+[ / Ctrl+] | 折叠/展开 | ⏳ P1 |
| Ctrl+D / Ctrl+F / Ctrl+0 | 大纲开关 / 搜索 / 重置缩放 | ⏳ P1（部分参考源） |

## 三、交互对照表（参考源 knowledge-canvas 现有交互清单 vs mindcanvas K4 状态）

| 参考源交互 | 参考源实现 | mindcanvas K4 | 状态 / 理由 |
|---|---|---|---|
| 新建子节点 / 同级 | MapView Tab/Enter + 右键菜单 | `EditorController.addChild/addSibling` + Tab/Enter | ✅ 已实现 |
| 删除（确认 + 子树） | onDelete + confirm | `removeNode` + confirm | ✅ 已实现 |
| 文本编辑 | F2 + 内联 input | OverlayEditor（F2/Enter/Esc/blur） | ✅ 已实现 |
| 编辑空文本处理 | updateNode 空文本保留原值 | `commitEdit` 空文本 = 取消（不把节点改空） | ✅ 已实现（对齐参考源） |
| 折叠/展开 | 空格 + 折叠图标 | NodeG 折叠三角 + Space | ✅ 已实现 |
| undo/redo | History 快照 | OpHistory op 序列 + 逆操作（K2 已移植） | ✅ 已实现（机制：快照→op 序列，见 K2-report） |
| 未保存守卫 | beforeunload | `installBeforeUnload` | ✅ 已实现 |
| 保存 | saveGate + Forgejo | `saveMarkdown`（FS Access/下载） | ✅ 有意不同：本阶段 local-first 不接 Forgejo（任务书硬约束 5）；saveGate 属 forgejo-bridge 插件 |
| 大纲联动（OutlineView 双向选择） | OutlineView + 画布同步 | — | ⏳ P1（任务书标注可选） |
| 富文本感知搜索（Ctrl+F） | MapView 搜索 | — | ⏳ P1（K4 未排入；编辑器搜索交互） |
| 右键菜单（添加/删除/编辑…） | ctxMenu | — | ⏳ P1 |
| 折叠状态持久化 | localStorage `kc.collapsed` | — | ⏳ P1 |
| 方向键导航 | ↑↓←→ | — | ⏳ P1 |
| 实体 picker / 实体节点编辑 | EntityPicker | — | ⏳ P1（实体中心接入，K5 镜子范畴） |
| 新节点自动聚焦编辑 | addChild 后 startEdit | ✅ 已实现（Tab/Enter 后自动进入编辑） | ✅ 已实现 |

**明确不做（本阶段）及理由**：Forgejo 保存/409 合并/轮询（属 forgejo-bridge 插件，任务书硬约束 5）；实体 picker 完整流程（实体中心接入属 K5 镜子验收范围）。

## 四、R15 快速注释（T4）实现说明

- **存储**：`note.qa`（spec §5.5 透传键，YAML 数组）——serializer 对未知键按序遍历输出，round-trip 不丢（测试证明）
- **双面呈现、单一来源**（spec §5.5「数据双面呈现、单一来源」）：翻转卡 `QaEditor`（查看/新增/删除）+ 画布 `QaCard`（点选节点浮现；新增注释 → 布局重排即时出现）——均消费 `controller.root` 的 `note.qa`
- **写回**：`controller.updateNote(id, { qa })` → TreeOp `update-node patch.note` → OpHistory（可 undo）
- **令牌**（spec §5.5「新增 annotationAccent」）：三主题同 accent 不同质感——classic 实色 `#e8590c` / sticker 纸感 `#f2a284` / glass 半透明珊瑚 `rgba(247,107,88,.55)`；`annotationBadge` 计数徽章底

## 五、插件运行时（T3/T5）说明

- **六注册表实装**（`runtime/registries.ts`）：kinds（内置七类）/ noteKeys（links/groups/qa 语义）/ layouts（六布局）/ renderers（kind 角标渲染描述）/ semantics、channels（空实现——纯内核三规则 ②）
- **PluginHost**：load/unload/unloadAll；Plugin 基类 `registerInto` 生命周期自注销（Obsidian 模式）
- **DemoPlugin 样例**（T5，`plugins/demoPlugin.ts`）：注册自定义 kind `session`（含 validateId 校验）/ 语义键 `ai_role` / 渲染器 `qa-badge` / DOM 事件监听——演示四种组合面；`unload` 后全部自注销（测试断言）
- **纯文本版构建**：`apps/canvas` 组合 kernel + 内置渲染，默认挂载 DemoPlugin（UI 显示「◆ 插件已载」/「◆ 纯文本版」）；无插件配置全部测试绿

## 六、性能验证（T6）

基准（`tests/edit-perf.test.ts`，681 节点平衡树，中位数采样）：

| 指标 | 数值 | 对照 |
|---|---|---|
| 编辑 + relayout 单操作（增删改/折叠/undo） | **1.41ms 中位数** | < 100ms 目标（约 70 倍余量）；单帧预算内 |
| 布局耗时 | ~1.8ms（K3 T5 基线） | kernel 23ms 预算 |
| undo/redo 树状态 | 快照序列逐字节还原/重放 | s0↔s3 双向一致 |

交互流畅性：编辑操作 < 2ms（逻辑）+ React 单帧单渲（K3 FrameScheduler 纪律延续）+ 视口裁剪可见子集提交 → 稳定 60fps。

## 七、参考文档

- roadmap: `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md`（K4 段）
- spec: `docs/specs/2026-08-27-mindmap-forgejo-sync-design.md` §4.5 / §4.6 / §5.5
- 参考源（只读）: `<local-path>`、`EditorShell.tsx`、`state/unsaved.ts` 等
- 前序: `docs/dispatch/K3-report.md`