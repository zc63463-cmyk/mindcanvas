# MindCanvas 外派计划与逐包启动 prompt

日期：2026-09-20。性质：供用户逐包外派；不代表任何包已实施或通过验收。本会话不自动派发。

## 1. 顺序与出口

| 顺序 | 包 | 前置 | 交付 | 放行核心 |
|---|---|---|---|---|
| 1 | G0 | v5 → v5.1 已通过 | 契约与 NC-5 三入口独立复核回执 | 29 处最小勘误已固定，无阻断 |
| 2 | P0-0 | G0 通过 | 注册表、裸句柄、原子事务、scope 身份 | 不猜身份、不吞存储故障、不丢并发更新；无 UI 改动 |
| 3 | N0 | P0-0 通过 | 节点语义协议与纯函数访问器 | parse/serialize 往返、未知字段与旧文档保真 |
| 4 | P0-D | P0-0 通过；排期在 N0 后 | 索引、收藏、单一最近、迁移与降级投影 | 索引可恢复、新写入也可被降级版本读取 |
| 5 | P0-A | P0-D 通过 | 改名、移动、副本、删除、租约和反馈 | 当前文档、索引、真实保存目的地一致 |
| 6 | P0-B | P0-A 通过 | 上传结果、同名处理、作用域、插入归一化 | 切工作区不串图，失败不伪报成功，保存重开有效 |
| 7 | P0-C | P0-A/B 通过 | 提示统一、整链验收、阶段回执 | 用户可区分成功、会话可用、失败及部分成功 |

**G0 已通过。现在只发送 P0-0 prompt。** P0-0 交回复核通过后再发 N0 或 P0-D，之后逐包交回复核；包内任务可连续完成，不逐小步请求确认。N0 与 P0-D 无直接技术依赖，串行是为了候选和证据清晰。默认不允许多个执行者同时写 index.ts、MindmapStage、FileManager 或保存会话。

本轮不做节点外观/类型设置 UI、摘要渲染、笔记 modal、文件导航重做、归档、资产删除/引用扫描、项目打包。它们不能被写为本轮已完成。

## 2. 已确认产品边界

- 自由画布首期不纳入工作区与文件面板；既有保存与离开保护不得回退。
- 只有一个“最近”，不分打开/修改两个页签；数据层可分记打开时间与保存时间。
- 归档以后可以做；引用范围未知时以后允许警告后删除资产。本轮不提前交付这些入口。
- 不向用户展示索引内部结构。
- 文件/资产各包不改 `.mm.md` 或 `.mc.canvas.json` 格式，不引入数据库服务、云同步、自动 GC。
- N0 单列处理兼容性的 note 元数据，不换语法、不改结构性节点 type、不借机实现节点 UI。
- `<local-path>` 为只读需求来源。其“用途/类型”“摘要”“笔记 modal”分开处理，本轮只做协议基础，不覆盖原文件。

## 3. 所有包共同遵守的交付契约

各 prompt 均要求先读本节，复制对应 prompt 即可使用。

1. 开工读 CONTRIBUTING.md、相关设计、前置包最终回执与真实源码；如有 AGENTS.md，按作用域读取。前置不满足只报告具体缺口，不抢跑。
2. 记录 HEAD、分支、工具链、已有修改和涉及文件的起点指纹。当前基础含大量未提交成果，HEAD 不代表完整候选；不能只从 a2ce72b 检出就当作有前置成果。
3. 每次只有一个执行者写本候选。隔离副本必须包含已核验的未提交基础，记录来源；不覆盖他人目录，不自动切换/重置共享分支，不 stash/回滚他人修改，不清理他人服务或证据。
4. 不暂存、提交、推送、部署或发布；改名/删除/迁移验证使用独占夹具，不处理用户真实文件。
5. 新接口须有本包真实消费者，不能交空壳或只有测试消费的未来框架。packages 不反向依赖 apps；共享类型放在合理公共层。
6. 包内顺序：正确行为用例→复现缺口→最小实现→回归→关键守卫负控。若代码已满足要求，核验即可，不重复重构。
7. 负控仅在隔离副本中中性化指定守卫，保持正确期望；记录子命令真实退出码、断言和连带红项。编译/导入/环境错误不算命中。常态必红反例不进默认套件，不用 it.fails、反转期望、catch 后 PASS 或宽泛 skip。
8. 每包独占 `outputs/file-assets/<package>/<RunId>/`。运行前核验冻结清单；运行器或夹具改动后另建清单并重跑受影响证据，不覆盖旧声明。末尾记录候选指纹、证据清单及复算结果。
9. G0 以文档和定向编排核验为主，无须全仓门禁。产品包先相关用例，再当前 `pnpm gate`、`pnpm build`；结构/预算变化补 `pnpm analyze`。仓库声明 pnpm 10.33.2，先核验环境，不擅自升级锁文件。历史测试总数不能替代本包证据。
10. 保存/离开链路变化复跑 verify-save-lifecycle、verify-mode-guard；渲染/导出变化跑相关 release 矩阵。新增 UI 旅程必须有真实浏览器验证；N0 无渲染改动不机械全跑浏览器。
11. 句柄替身不等于系统选择器，合成 composition 不等于真实 OS 输入法，内存事务模型不等于 IndexedDB。未验证项如实列出，不扩大通过结论。
12. 交付 `docs/dispatch/<日期>-<包名>-report.md`，重名用新 RunId。包含范围、前置候选、文件清单、API/契约增量、行为证据、负控、门禁、未运行项、残余问题、下一包接口。交回即停止，不自行开下一包。

主控复核固定检查：需求实现；身份与失败路径；证据判别力；下一包能否消费。只返修未关闭项，不重复打开已有充分证据的事项。

## 4. G0：v5 最终复核（已完成，保留 prompt 供追溯）

```text
你是 MindCanvas G0 独立复核执行者，只复核 P0-0 v5 契约和负控编排，不实现产品、不启动 P0-0。
仓库：<workspace>。
先完整阅读 docs/dispatch/2026-09-20-file-assets-foundation-dispatch.md 并遵守共同交付契约。
输入：
- docs/specs/2026-09-19-file-assets-contract-close/p0-0-implementation-plan.md、contract-delta.md、counterexamples.md、review-receipt.md
- docs/specs/2026-09-19-file-assets-design/shared-contracts.md、acceptance-and-backlog.md
- docs/dispatch/2026-09-20-file-assets-contract-close-review3.md 及引用证据。
v5 声明 SHA-256：faf45cf84038c8b602e5ac8a1fd8606fabcce09a6f1d06ef2c8bb2697bc3a765。G0 已将其修订为 v5.1；放行指纹以 docs/dispatch/2026-09-20-g0-report.md 中列出的四个新指纹为准。不要把 v5 旧哈希作为当前实现基线。

任务：
1. NC-5 三入口必须分开：默认生产回归 PASS/0；旧调用方快照反例独立运行，常态 FAIL/非零；生产中性化副本正常先 PASS/0，再定向变更后 FAIL/非零。共同 oracle：abc 三条保留、记录合法、唯一 active、其余 dormant。
2. 核对默认收集与 counterexample include 不重叠、helper 不被当测试、父命令不吞结果。可用独占最小夹具核验编排，但只称模型/编排证据，不称产品并发已验证。
3. 空库和 detach 后零 active 合法；双 active 等非法记录必须拒绝；Promise mutate 拒绝与真实 IDB 生命周期验证分开。
4. 定向消除剩余文本缝隙：同实例并发也用 legalAppend；helper export/导入和句柄形状一致；null 与真正缺键不混为 empty；corrupt 的 picker 行为与不得覆盖损坏库出口一致。
5. 局部接线/口径问题可本包最小勘误，记录旧→新及新哈希，不扩成全新设计。损坏库采用不隐式覆盖的保守默认；未来显式修复不在本包。

出口：G0 通过或明确阻断清单，分开设计检查、模型实跑、产品未跑。无故不重做已关闭 CR2 项。交回唯一 g0-report 和证据目录后停止；通过也由用户另发 P0-0，不由你实施。
```

## 5. P0-0：身份与存储（当前外派）

```text
你是 MindCanvas P0-0 实施执行者，只交身份与存储基础，不改 UI/apps/**，不做索引、租约、文件安全操作或图库。
仓库：<workspace>。
先读 docs/dispatch/2026-09-20-file-assets-foundation-dispatch.md、docs/dispatch/2026-09-20-g0-report.md、G0 放行指纹对应的 p0-0-implementation-plan.md 与 shared-contracts.md。G0 只证明契约和编排通过，P0-0 产品尚未实施。

开工第一步核验 `pnpm --version`、Node 版本、仓库声明的 `packageManager` 与工作树。本机曾出现 pnpm 11.19.0，而仓库声明 pnpm 10.33.2。不得为了通过门禁改锁文件或静默升级工具链；环境差异写入回执。

分任务连续完成：
1. workspaceScope.ts：ID/记录校验、合法追加、淘汰、目录比较。最多 8 条且保留 active；nonnull activeScopeId 恰有匹配 active，null 时零 active；ID 唯一、形状合法。
2. handleStore：workspace-registry.v1 单记录，workspace-root 永远裸句柄。读取 ok/empty/corrupt/unavailable；故障不折叠 empty。writeWorkspaceRegistry(mutate, legacy) 同一 readwrite 事务内读、同步合并、验证、写注册表并 write/delete/unchanged 裸键，失败 abort 两键。mutate Promise 判 invalid；conflict 明确返回；请求/abort/complete 不悬挂或双结算。
3. directoryHost 与 directoryTypes：pick/restore/requestPermission 共用身份解析并暴露 scopeState/scopeId/scopeEpoch。唯一 same 复用；空库/全 different 注册；含 unknown 无 same 降级；多个 same 拒绝。名称、路径、对象引用不作身份凭据。unavailable 不写键；有句柄才可会话挂载；整库不可读且无句柄不可假挂载。已挂载 requestPermission 不变 scope/epoch。detach 休眠与裸键删除同事务。
4. 两阶段解析：事务外 await 比较，事务内同步复核基线；冲突最多重解析 2 次，仍冲突降级。不在 mutate await 非 IDB 操作。
5. 接 index.ts 导出与真实 host 消费，不交未来空实现。

测试必须含：A→B→A 与重启恢复、同名不同目录、能力缺失/抛错、空库/损坏/不可读、第二次 put/delete 失败原子回滚、权限恢复、超限淘汰、非法记录/Promise mutate 不写键。
并发用两个独立生产模块实例共用数据库而不共用 writeChain，验证不丢更新及同目录并发不重复 ID。以真实浏览器 IndexedDB 校准事务回滚/跨任务行为，替身局限单列。
执行已锁定 NC-1…NC-7，NC-5 三入口绝不混入默认套件；中性化副本正常先绿再红，oracle 不变。

允许改 packages/react/src/edit/{workspaceScope,handleStore,directoryHost,directoryTypes}.ts、src/index.ts、对应测试/helpers、独立反例配置/脚本及文档；保留公开 API 和正确既有断言。
跑相关测试、gate/build；交回真实导出签名、scope 语义、逐出口证据和回执，停止，不启动 N0/P0-D。
```

## 6. N0：节点语义协议

```text
你是 MindCanvas N0 执行者，只做节点语义协议与纯函数访问器，不做类型设置 UI、摘要渲染、形状外观或笔记 modal。
仓库：<workspace>。
先读 docs/dispatch/2026-09-20-file-assets-foundation-dispatch.md、P0-0 回执、docs/specs/2026-09-02-mm-md-protocol.md；只读 <local-path>
核查 kernel 的 protocol/{types,note,parser,serializer}.ts、tree/treeOps.ts 与测试，先确认 note 绑定后继节点、对象列表和未知字段保留规则。

任务：
1. 基于现有 note 扩展写协议增量，语义类型与 EditableNode.type 的 text/image/entity 分开。旧 note:string[]、note_text、desc、md、qa 回退不破坏。
2. 对可确认需求提供稳定 ID、用途/类型两级定义、节点引用、摘要 Markdown 的纯读写访问器。候选字段 node_type_defs、annotation_type_defs、node_type、annotation_type、node_kind、summary_md 经冲突核查后定稿。颜色/形状可透明保留，不预定完整枚举或渲染；“属性类型”不推断成任意自定义属性引擎。
3. 访问器不改输入、不按显示名重写 ID；无效/未知值安全读取，写已知字段时保留未知字段。复杂语义未明确的部分只透明保留，不擅自实现 UI 或扩大协议。
4. 真实 parse→读取→局部修改→serialize→parse 测试：旧样例、需求只读副本、中文/引号/多行 Markdown、未知标量/对象列表、未识别类型 ID、缺字段、重复/无效定义、后继绑定。断言语义数据保真，不要求无约定的逐字节排版恒等。
5. 中性化未知字段保留或语义字段传递，固定正确 roundtrip 断言必须红。公共导出接真实协议读写链，不造庞大未来配置框架；不换解析器/语法、不导入 UI。

不迁移用户文件、不改文件资产引用或自由画布格式。交回协议增量、实现/测试、兼容矩阵、gate/build 与未决 UI 清单后停止，不启动后续节点包或 P0-D。
```

## 7. P0-D：索引、收藏、最近与迁移

```text
你是 MindCanvas P0-D 执行者，只做索引基础、收藏、单一最近、迁移与降级，不做文件操作或 UI 重构。
仓库：<workspace>。
先读 docs/dispatch/2026-09-20-file-assets-foundation-dispatch.md、P0-0/N0 回执、shared-contracts 的身份/迁移/回退章节及 acceptance-and-backlog 的 P0-D。

任务：
1. apps/canvas/src/docIndex.ts 或同职责小模块为唯一索引写入口；消费 scope，区分工作区和浏览器身份。DocIndexEntry/AssetIndexEntry 按契约保留 lineageId、path、openedAt:null、savedAt、starred、sourceRef、ephemeral、legacyKeys、relinkEvidence 等。不把路径当血统或把 scope 当保存会话令牌。
2. 用户打开推进 openedAt，保存推进 savedAt；单一最近按打开时间排，null 靠后，不回落 mtime。收藏用稳定身份，为 P0-A 改路径保留连续性。
3. 实现 M4–M9 并衔接已完成 M11，幂等、可中断续跑。无归属证据入历史池，唯一同名也不认领。保留旧键和 DocLibrary 正常写路径，只增加必要读取和已约定兼容投影。
4. 分别实现 R-A 无新增写入回退、R-B 有新增收藏/来源/文件夹记录回退；实际让旧结构读取新数据，不以删除新键冒充降级。多键无法原子提交时记录可重试状态，失败不标迁移完成。
5. FileManager/fileManagerShared 换索引数据源和收藏，保持布局。存储失败本包可见，不等 P0-C 补救。

验证 A/B 同名隔离、重启、迁移重复、中途写失败续跑、损坏旧项、新库可用、未知归属不猜绑、打开时间排序、R-A/R-B 逐项降级读取。
负控分别去掉归属证据、用 mtime 代替 openedAt、跳过新数据投影，必须命中正确期望。
交回接口/键/迁移状态、P0-A 索引更新契约、相关测试、浏览器收藏与重开、gate/build 和回执；停止，不启动 P0-A。
```

## 8. P0-A：安全文件操作

```text
你是 MindCanvas P0-A 执行者，交改名、工作区内移动文件、同目录创建副本、删除，以及租约、目的地一致性和反馈。
仓库：<workspace>。
先读 docs/dispatch/2026-09-20-file-assets-foundation-dispatch.md、P0-0/P0-D 回执、shared-contracts 的租约/I-14/I-20/部分成功、file-management 和 F1/F2/F3/F5 验收。
先核实 documentLifecycle、useDocumentSaveSession、useDocumentActions、useUnsavedTransition、directoryHost，保留 SAVE-LIFECYCLE/MODE-GUARD 契约。

五个任务：
1. 同步取操作租约再 await，跨会话 physicalWritesInFlight 纳入互斥，新保存不能钻入等待窗口。每次 await 后核会话、内容、scopeEpoch、目的地；条件释放避免旧任务解锁新任务。当前会话 waitForIdle 不等于物理 I/O 全空闲；防止租约内请求保存而自锁。
2. SaveDestination 单一事实源，rebindDestination 不推进文档替换令牌。当前文档 dirty 必须确认落盘后才可从磁盘复制/改名，downloaded 不合格。完成后句柄/path/索引/workspacePath 一致，auto/manual 后续写新文件。
3. 公共层 FileOpOutcome/错误码和 rename/move/removeFile/removeDir Safe 操作，删除能力缺失明确失败，不能可选调用后当成功。处理取消/同名冲突；副本独立身份，改名移动保持血统。
4. 目标写成但删源失败时绑定新目的地，给保留两份/重试删源/撤销副本。重试只删源且先核对外部修改；撤销前核对副本是否已编辑/再次写入，不无条件删除。
5. 接 FileManager/Modal/MindmapStage 和当前文档删除三阶段流程，复用离开端口，不重写决策器。成功/取消/失败/冲突/部分成功反馈本包一起完成。

排除文件夹移动、跨目录复制、跨工作区复制、批量、自由画布、归档、引用扫描。
测试慢 auto→改名→编辑、旧会话物理写未完、等待中切区/切文档、取消、close 失败、复制成删源败、源被外改、撤销前副本新写、IME/未提交草稿下删除。用实际字节和后续写入目标证明，不只看提示。
负控命中租约/归属/条件删除守卫。相关正式测试、gate/build、verify-save-lifecycle、verify-mode-guard 实跑；浏览器验证改名→保存→重开、部分成功和删除取消。真实选择器/IME 未覆盖如实列出。
交回回执及 P0-B 可消费租约/错误签名后停止，不启动图库。
```

## 9. P0-B：图库上传与插入

```text
你是 MindCanvas P0-B 执行者，只做上传结果、同名、作用域、插入归一化及反馈，不做资产删除/引用扫描/断图修复/分页重构。
仓库：<workspace>。
先读 docs/dispatch/2026-09-20-file-assets-foundation-dispatch.md、P0-A/P0-D 回执、shared-contracts I-10/I-12、asset-library 与 A1/A2/A3。
定位 react/chrome 的 assetHost/workspaceAssetHost/idbAssetHost/AssetPanel/assetViews 及 apps 的 SidePanels/MindmapStage。

任务：
1. 兼容旧 AssetHost 方法并加详细结果：已写入/仅本次会话可用/失败；写入结果、位置、可携带性分开。objectURL 有效不代表磁盘/IDB 成功，scope persisted 不代表素材可携带。通用类型与错误放公共层。
2. 缓存键 (scopeId,relPath)，操作捕获 scope/epoch，迟到回调不回填另一区。旧区实际已落字节仍记账或 unconfirmed，切回可发现，不能把丢 UI 回调等同丢记录。统一 revoke/LRU，不提前释放在用 URL。
3. 同名三选：保留两份/替换/取消，默认保留两份。size+mtime 仅预筛，不判同内容、不去重、不静默覆盖。
4. normalizeForInsert：有工作区先确保字节在当前 assets/ 再写相对工作区根引用；只有可证明同归属才复用。浏览器库/内置跨入先复制；无工作区仅按契约安全处理小 SVG 内联或明确拒绝。child 同样归一化，不保存 blob URL/内存 scope/builtin 引用后伪称可重开。
5. resolveAssetState 区分 no-scope/missing/wrong-scope/external/unavailable，取消站点根回落。成功/会话可用/失败和重试反馈本包交付；复用 SVG 安全边界，不原样内联不可信 SVG。

测试磁盘/IDB 故障、只剩 objectURL、同名同大小同时间不同字节、上传中切区、同路径不同图、切回发现迟到写、取消不改文档、失败不插悬空引用、主/child 插入保存重开；字节和引用都核对。
负控去 scope 键、漏迟到记账、跳归一化、mtime 判同内容，分别命中固定正确期望。
相关测试、gate/build、浏览器上传→插入→保存→重开→切区，复跑受影响保存/离开验收。交回接口、文案、证据及限制后停止，不启动 P0-C。
```

## 10. P0-C：提示统一与整链收尾

```text
你是 MindCanvas P0-C 执行者，只统一呈现并完成 P0 整链验收，不新增入口或改变前包业务判定。
仓库：<workspace>。
先读 docs/dispatch/2026-09-20-file-assets-foundation-dispatch.md、P0-A/B 回执、acceptance-and-backlog P0-C。

任务：
1. 错误码/结果→文案唯一映射，提示位置/停留/重试/重复点击一致。apps 可维护 assetNotices 并向公共组件注入文案或 renderer；packages/react 禁止反向 import apps。公共映射也需保留应用文案边界。
2. 区分文档保存、素材写入、会话可用、附属警告、取消、失败、部分成功。取消静默、失败可重试、部分成功说明已完成项，不能用统一文案抹掉结果差异。
3. 保留无原生 alert/confirm/prompt 约束，焦点/Esc/Tab/IME 不回退；防重复提交但保留恢复出口，不提前清掉未完成互斥。
4. 整链旅程：选 A→打开→收藏→编辑→改名/移动→继续保存→上传同名素材→插入→保存→切 B→回 A→重开。核 scope、文档身份、目的地、收藏、素材字节和引用；补存储故障/close 失败/部分移动/迟到上传，不依赖重载掩盖状态错误。
5. 文案一致性、无原生弹窗、零未处理 rejection、重复提交测试，gate/build、保存生命周期/离开脚本；按影响面跑 release，不无故重开历史视觉验收。

输出最终能力矩阵：已完成/明确降级/未实施，链接精确候选证据。N0 只有协议，不写成类型 UI/摘要/modal 完成；归档、资产删除、引用扫描、自由画布接入、项目包仍未做。
发现前包逻辑缺陷归还对应包定向修复并刷新受影响证据，不能靠文案隐藏。交回最终回执后停止，不进入 P1，不提交/发布。
```

## 11. 派发与收口

将对应代码块复制给可访问本仓库的执行者即可。G0 已通过，当前发第 5 节 P0-0；其通过后再发后续包。其他 prompt 是后续材料，不同时群发开工。

G0 的设计通过不等于 P0-0 产品验证通过。每包审完才成为下一包基础；产品变更后必须刷新受影响验证，证据工具变更按影响面重跑。阶段结束须 P0-C 整链及 N0 兼容性均通过；发布另行决定。
