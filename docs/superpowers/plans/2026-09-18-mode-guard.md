# MODE-GUARD 两模式离开保护实施计划

> For agentic workers: 使用 `superpowers:executing-plans` 逐任务执行，采用 test-driven-development 与 verification-before-completion。当前仅准备计划，实施由启动 prompt 发起。

**Goal:** 导图与自由画布的未保存内容不会因切模式或替换文档静默消失，用户能选择保存、放弃或取消。

**Architecture:** App 持有当前 Stage 的 DocumentLeavePort 登记；Stage 内的文档替换与 App 模式切换调用同一个离开决策器。两个 Stage 仍互斥挂载、文档模型和保存宿主各自独立；保存结果复用包 1，确认 UI 在应用层实现。

**Tech Stack:** React、TypeScript、现有 UnsavedPrompt、DocumentLeavePort、Vitest/Testing Library、浏览器自动化。

**Spec:** 审计报告 §3 P0-B；`2026-09-18-reliability-123-dispatch.md`；包 1 实施计划及回执。

## Global Constraints

- 依赖包 1 完成；不得复制第二套保存队列、恢复无条件 markSaved 或只看按钮是否点击。
- 不新增草稿持久化、自由画布历史栈或自动保存；本包只保证离开路径不静默丢弃内容。
- 既有 `UnsavedPrompt` 是两按钮设计；本包**明确升级**为保存/放弃/取消，不将新产品语义伪装成“纯搬迁”。现有两按钮调用需迁移或保持兼容。
- 自定义模态；不用 `window.confirm/alert/prompt`。浏览器页面关闭仍使用 `beforeunload` 原生能力，不能试图在关闭事件里异步保存。
- App 只登记 leave port，不接管两种文档内容。不同时隐藏挂载两个 Stage 规避问题。
- 入口必须带会话归属和重复触发保护；旧 Stage 清理不能注销刚挂载的新 Stage。未就绪时先禁模式按钮，不能用“port 缺省即放行”制造短窗口。
- 普通保存失败/取消/被拦/过期不得离开；下载已发起不证明文件落盘，保存并离开路径须留在当前文档并提示“已发起下载，确认保留文件后可选择放弃并离开”。下载用户仍有显式离开的路径。
- 遵守总纲工作树及默认不提交/不推送纪律。

## 决策规则（执行口径）

| 当前状态/动作 | 结果 |
|---|---|
| 内容干净且无 I/O | 直接执行目标动作 |
| 输入框有未提交修改 | 先 flush 到模型，再判断 dirty；提交失败保持当前模式和输入 |
| dirty → 取消 / Esc / 遮罩 | 原文档、输入、目标入口状态保持；不触发新文档写入 |
| dirty → 放弃 | 不再排定新的 auto；已发 I/O 必须等待收束，再废弃当前会话并执行目标 |
| dirty → 保存 | 仅 saved.current=true 且再次确认 dirty=false、saving=false 才执行目标 |
| 保存期间继续编辑 | 返回后仍 dirty 则保留文档与确认入口，明确需要再保存或放弃；不循环自动保存并无限等待 |
| 保存失败/取消/被拦/过期 | 不执行目标；失败提示留在可见层，允许重试/取消 |
| 下载兜底 | 不自动离开；提示已发起下载，提供取消或显式放弃离开 |
| 当前已保存中 | 显示忙碌状态，可取消离开；不重复开 picker。写入完成后重新判定，不提前卸载 |
| 连续点击不同入口 | 一次只处理一个离开请求，后续点击不覆盖 resolver/目标，不产生悬挂 Promise |

busy 等待不增加可见的无限阻塞：取消按钮只取消“离开请求”，不声称撤销正在写入的 I/O。若底层任务一直不完成，应保留内容并显示保存仍进行中；本包不引入不可靠的强制杀写入。

## 文件与内部接口

新增：

- `apps/canvas/src/hooks/useUnsavedTransition.ts`：一次离开请求、三选项决策与异步状态；不存文档。
- `apps/canvas/src/hooks/useDocumentLeaveRegistration.ts`：Stage 与 App 登记/清理桥，若少量接线可合并到上述 hook，回执说明。
- `apps/canvas/tests/unsaved-transition.test.tsx`：状态机/重复点击/失败分支。
- `apps/canvas/tests/mode-guard.test.tsx`：真实 App 双向切换。
- `apps/canvas/tests/free-canvas-leave.test.tsx`：替换文档入口与 beforeunload。

修改：`documentLifecycle.ts`、`App.tsx`、`UnsavedPrompt.tsx`、`MindmapStage.tsx`、`FreeCanvasStage.tsx`、`hooks/useDocumentActions.ts`；为 flush 草稿按需修改下表的编辑组件。包 1 的 hook 仅必要适配，不重新设计队列。

```ts
export type LeaveChoice = 'save' | 'discard' | 'cancel';
export type RequestLeave = (perform: () => void | Promise<void>) => Promise<boolean>;
// true = 目标执行；false = 用户取消、保存未证实成功或会话失效。
// 同时只能存在一个 active request；释放/卸载时剩余请求 resolve(false)。
```

若采用额外 Stage prop，须为应用层可选字段且冷启动/错误态有明确 ready/blocked 状态，不改变 React 包冻结导出。包内公开组件若必须增加 flush 回调，仅增加可选参数并验证旧调用方。

## Task 1：离开决策器与三选项模态

**Files:** 新建 `hooks/useUnsavedTransition.ts`、`tests/unsaved-transition.test.tsx`；修改 `UnsavedPrompt.tsx`。

- [ ] 写假 leave port 的矩阵测试，覆盖上表全部分支。明确 saved/current 与 downloaded 分支不同。
- [ ] 实现单请求、归属清理及忙碌状态。检查成功回调前的实时 dirty/saving；用户取消后迟到的保存完成不能执行原目标。
- [ ] 模态提供“保存并继续”“放弃修改”“取消”；默认焦点放在非破坏性选项，Esc/遮罩=取消。不得沿用旧框的“任意 Enter 都放弃”键盘处理；Enter 只激活聚焦按钮。
- [ ] 模态必须覆盖自由画布按钮层（现有 toolbar z=200、App 浮标 z=500；旧模态 z=70 不够），背景不可穿透点击；焦点进入、约束在模态、关闭后恢复。
- [ ] 保存失败通知在模态内可见；busy 时阻止重复保存及切换提交，取消仍可操作。

必要时序测试骨架（fixture 将真实回调接入）：

```ts
// port.save() 在人为 resolve 前保持 pending；perform 为 vi.fn()。
// requestLeave(perform) → choose('save') → 编辑版本变化。
// resolve({kind:'saved', current:false})。
expect(perform).not.toHaveBeenCalled();
// 再次请求但 choose('cancel')，即使旧保存以后完成也不能执行 perform。
```

运行：`pnpm --filter canvas exec vitest run tests/unsaved-transition.test.tsx tests/useDocumentActions.test.tsx`。

## Task 2：编辑草稿的提交边界

离开前先提交“输入框里但模型还没有”的内容，不能只读 controller.dirty。按实际编辑入口逐项登记：

| 输入类型 | 首查文件 | 验收 |
|---|---|---|
| 节点标题/框内标题 | `packages/react/src/edit/OverlayEditor.tsx`、`chrome/FrameOutline.tsx` | 未 blur 的文本进入快照；Esc 原有取消语义保持 |
| 描述/注释/背面 Markdown | `chrome/DescBlock.tsx`、`NotePopover.tsx`、`NoteBackEditor.tsx`、宿主 note 写回 | 输入不丢；校验失败不离开；空文本语义保持 |
| 自由画布正反面 | `packages/react/src/free-canvas/NativeCard.tsx`、`FreeCanvasView.tsx` | 保存并继续收到最后输入的正文 |

- [ ] 先写聚焦输入框、输入但不 blur、立即切模式/打开的测试；断言取消后原草稿可见、保存后文件含最后输入。
- [ ] 优先沿既有 commit/blur 通道增加明确 flush 接缝；不要只查询任意 DOM textarea 后盲目读 value，也不要依赖点击事件顺序恰好触发 blur。
- [ ] 防双提交，处理中文 composition 未结束：暂缓离开到 compositionend 后再次执行已请求动作，或明确提示先完成输入；不能截断正在组合的文字。校验失败返回 false。
- [ ] 不把全部 UI 状态存入文档；只提交当前编辑值。不为测通而删除业务校验。

## Task 3：App 双向模式与 Stage 内文档替换

**Files:** `App.tsx`、`MindmapStage.tsx`、`FreeCanvasStage.tsx`、`hooks/useDocumentActions.ts`、登记 hook、`tests/mode-guard.test.tsx`、`tests/free-canvas-leave.test.tsx`。

- [ ] 将审计“便签消失”复现改成正确期望：切模式出现确认；取消保留便签；保存成功后才离开；再次打开保存文件后内容一致。单纯再次进入空 Stage 并非恢复缺陷，未保存离开才是缺陷。
- [ ] App 浮标、启动页入口和自由画布返回按钮走同一 requestLeave，不能只守其中一个按钮。
- [ ] 导图所有已有 `applyDoc` 入口接离开决策，替换旧 confirmDiscard 业务接线；检查 file input、拖入/粘贴导入、最近库和新建入口，不允许旁路 setDoc。
- [ ] 自由画布新建、打开、file input、最近、演示全部共用替换入口。解析失败和用户取消文件选择器不破坏当前模型。
- [ ] 冷启动无编辑时可直接进入其他模式；解析错误态若存在可恢复内容，不得默认视为可安全丢弃。
- [ ] 新增自由画布 beforeunload 保护；导图现有保护保留。条件覆盖 dirty/未提交草稿/正在保存，卸载清理；不在 unload 中弹自定义异步模态。
- [ ] Stage 卸载会话失效与包 1 一致；选择“放弃”也不能让尚未完成的同文件写入后来覆盖重新打开后的新编辑。

```ts
// App 级正确期望：创建一张便签，立即请求回导图。
expect(container.querySelector('[data-unsaved-prompt]')).not.toBeNull();
// 选择取消后：
expect(container.querySelectorAll('[data-fc-card]')).toHaveLength(1);
expect(container.querySelector('[data-fc-stage]')).not.toBeNull();
```

运行：`pnpm --filter canvas exec vitest run tests/mode-guard.test.tsx tests/free-canvas-leave.test.tsx tests/free-canvas-stage.test.tsx tests/unsaved-transition.test.tsx`，随后回归启动页、文档动作和包 1 保存测试。

## Task 4：跨模式验收与回执

- [ ] 双向模式 × clean/dirty/saving/failed；两模式 × 新建/打开/最近；自由画布演示；取消、放弃、保存成功/失败/下载分支均有证据。
- [ ] 浏览器验证：中文输入中切换、确认框键盘与覆盖层、真实文件 picker、下载兜底、刷新/关闭提示。文件写入仅用专门的测试文件，不覆盖用户工作文档。
- [ ] 临时去掉 App 登记守卫，确认双向保护回归变红，再只恢复该块；去掉完成前 dirty 复查，确认“保存中继续编辑”用例变红。
- [ ] 跑类型、全测试、依赖、lint、budget；现有预算红灯要记录，新增债务要消除。
- [ ] 写 `docs/dispatch/2026-09-18-mode-guard-report.md`，附完整入口清单、矩阵、已用浏览器/未验证环境及实际接口。停下交接；默认不提交、不 push。
