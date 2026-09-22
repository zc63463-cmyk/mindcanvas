# counterexamples：反例与证据等级

任务：FILE-ASSETS-CONTRACT-CLOSE。日期：2026-09-19。

---

## 0. 证据等级（本文件的分类基准）

| 等级 | 定义 | 本文件中的标注 |
|---|---|---|
| **实跑证据** | 在真实浏览器/真实目录/真实测试下运行并留有输出 | **本文件 0 条**（本包只做文档补正，未运行任何测试） |
| **读码结论** | 直接读取源码即可确认的事实（含行号） | 标 `[读码]` |
| **逻辑反例** | 由已确认的调用链推导出的「会导致错误结果」的具体时序/输入；**未实跑** | 标 `[逻辑]` |

**纪律**：

1. 任何 `[逻辑]` 反例都**不得**在其它文档里被写成「已确认缺陷」或「已复现」。
2. 若某条 `[逻辑]` 反例最终被实测否定，应在本文件标注「已否定 + 证据路径」，**不删除原文**。
3. 下表的「验证方式」是**设计预期**，不是运行记录。

---

## CE-01 dirty 时改名会以磁盘旧快照生成新文件 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | ① 工作区已挂载并打开 `研发/架构.mm.md`；② 文档 dirty（内存内容 ≠ 磁盘内容）；③ 用户在文件面板改名 |
| 当前代码路径 | `FileManager.tsx:212-223`（`commitRename` 不消费返回值）→ `directoryHost.ts:308-318`（`readFile` 读磁盘 → `createFile` 写新文件 → `removeFile` 删旧）→ 旧句柄指向已删除的文件，而 `session.destination` 仍是旧句柄（`:99-106` 只在 `beginDocument`/`commit` 更新）→ 后续 auto 的条件 `doc.handle` 仍成立（`useAutoSave.ts:69`）→ 写入可能失败或落到已删除路径 |
| 错误结果 | 新文件内容 = 改名**前**的磁盘快照（不含未保存编辑）；随后的自动保存要么失败（`failed`，dirty 保持，用户看到失败提示），要么不可预期 |
| **是否已复现** | **否**。成立与否取决于「dirty 且保存失败/未保存」的具体时序，以及浏览器对「已删除路径的陈旧句柄」的写入行为；本包未做实测 |
| 正确结果 | 改名被拒绝并提示「先保存再改名/移动」（I-14）；得到一次 `saved && current` 后，新文件内容 = 该次落盘快照，且改名期间的新编辑在租约释放后由一次 auto 补写到**新**目的地 |
| 正式复现条件 | 真实浏览器 + 真实目录；夹具：`createWritable` 正常、`removeEntry` 正常；步骤：打开 → 编辑（不保存）→ 改名 → 再编辑 → 触发 auto；观察点：`removeEntry` 后旧句柄的 `createWritable()` 是抛错还是成功；磁盘上新文件的内容版本 |
| 验证方式（设计预期） | `apps/canvas/tests/rename-current-doc.test.tsx`：① dirty 时点改名 → 断言出现「先保存再改名」且 `renameFileSafe` **未被调用**；② 保存成功后改名 → 断言新文件内容等于落盘快照；③ 改名期间编辑 → 断言释放租约后恰好一次写新目的地的 auto |
| 预期转红的负控 | 去掉 I-14 前置（允许 dirty 直接改名）→ 断言②③必须失败 |

---

## CE-02 把包装对象写进 `'workspace-root'` 会让旧版本失去工作区 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 按初版候选方案，把 `{handle, scopeId, schemaVersion}` 写进键 `'workspace-root'` |
| 当前代码路径 | `handleStore.ts:39-45` 的 `isDirectoryHandle` 要求对象上存在 `getDirectoryHandle` 函数；包装对象没有该方法 → `getDirectoryHandle()` 返回 `null`（`:89-92`）→ `directoryHost.restore()` 拿不到句柄（`:172` 区域）→ 用户需要在旧版本里重新选择文件夹 |
| 错误结果 | 回退版本静默失去工作区恢复能力（无错误提示，只是「没恢复」） |
| **是否已复现** | **否**（读码推导；`handleStore.ts:166-190` 的测试覆盖了「垃圾数据 → null」，但未覆盖「包装对象」这一具体形状） |
| 正确结果 | 注册表写**新键** `'workspace-registry.v1'`；`'workspace-root'` 永远只放裸句柄；两键在**同一 readwrite 事务**内更新 |
| 正式复现条件 | jsdom + fake-indexeddb：向 `'workspace-root'` 写入 `{handle, scopeId, v:1}` → 断言 `getDirectoryHandle()` 仍返回句柄 |
| 验证方式（设计预期） | `packages/react/tests/workspace-scope.test.ts` 的 S2 用例（`acceptance-and-backlog.md` §3.1） |
| 预期转红的负控 | 把注册表记录写进 `'workspace-root'` → 断言「旧读路径仍返回句柄」必须失败 |

---

## CE-03 同名、同大小、同时间戳、不同字节被跳过上传 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 目标目录已存在 `x.png`；新上传文件的 `name` 相同、`size` 相同、`lastModified` 相同，但**字节不同** |
| 当前代码路径 | 初版规则「`size` + `lastModified` 一致视为同内容 → 不弹冲突、跳过写入」。现有实现则相反：`directoryHost.ts:379` 的 `getFileHandle(name,{create:true})` 直接覆盖（`idbAssetHost.ts:147` 的 `put` 同理） |
| 错误结果 | 按初版规则：用户的新内容被**静默丢弃**（没有提示、没有冲突对话框）；按现状实现：旧内容被**静默替换**。两种都错 |
| **是否已复现** | **否**（该窗口由构造 `size`/`mtime` 相同的两个不同文件即可复现，属确定性输入；本包未执行） |
| 正确结果 | 进入冲突三选，默认焦点「保留两份」→ 原文件字节不变、新文件以不冲突名写盘、用户明确选择 |
| 正式复现条件 | 夹具：写 `x.png`（内容 A，例如 100 字节）→ 记录其 `{size, lastModified}` → 构造内容 B 且字节长度相同 → 用 `utimes` 类手段对齐 `lastModified`（浏览器侧可用 `File` 构造的 `lastModified` 参数）→ 上传 |
| 验证方式（设计预期） | `packages/react/tests/workspace-asset-host.test.ts` 扩展：N2 用例（`acceptance-and-backlog.md` §3.1） |
| 预期转红的负控 | 用 `size`+`mtime` 判同内容并跳过 → 断言「原文件字节不变 **且** 新内容已保存（两份都在）」必须失败 |

---

## CE-04 epoch 变化后丢弃回填 → 资产成为孤儿 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 在工作区 A 发起上传（写盘较慢，例如大位图）→ 写入完成前用户切到工作区 B → 结果返回 |
| 当前代码路径 | `workspaceAssetHost.ts:100-112` 的写入**已经发生**（`writeAsset` 已 `close()`）；现状唯一的作用域防护是组件级 `alive`（`MindmapStage.tsx:908-916`），而 `uploadToGallery`（`:888-892`）不捕获 scope/epoch |
| 错误结果 | 按初版规则「丢弃结果」→ A 的 `assets/` 里多了一个无人记录的文件；用户切回 A 会看到来源不明的资产；或以为上传失败而重复上传（产生同名冲突） |
| **是否已复现** | **否** |
| 正确结果 | 不更新当前清单（避免串图），但**记账**：`AssetIndexEntry.unconfirmed: true` 属于捕获时的 `scopeId`；切回 A 时由 `listAssets` 重新发现并清除标记 |
| 正式复现条件 | 夹具：让 A 的 `writeAsset` 延迟 800ms；步骤：上传 → 500ms 时切换工作区 → 等写入完成 → 检查 A 的记录与 B 的清单 |
| 验证方式（设计预期） | `apps/canvas/tests/asset-scope-switch.test.tsx` 的 N3 用例 |
| 预期转红的负控 | epoch 变化后什么都不做 → 断言「切回 A 后能在素材库发现该文件」必须失败 |

---

## CE-05 内置图标作为 child 插入会断图 `[读码]`

| 项 | 内容 |
|---|---|
| 触发条件 | 用内置图标、以「子分支」语义插入 |
| 当前代码路径 | `SidePanels.tsx:138` 的 child 分支直接 `addEntityChild(targetId, { kind: item.kind, id: item.id })`，**不经过** `assetValueOf`（`:39-41`）→ 序列化为 `@draw:builtin:<id>`（`serializer.ts:137`）→ 渲染时 `resolveAsset` 在 `objectUrls` 未命中 → 回落 `baseUrl + id`（`idbAssetHost.ts:127-131`）= `/builtin:<id>` → 404 → 断图占位（`NodeG.tsx:166-196`） |
| 错误结果 | 内置图标作为子分支插入后，重开/刷新显示断图 |
| **是否已复现** | **否**（读码推导；路径确定，但未实跑） |
| 正确结果 | child 路径与 icon/media 一致：内联为 `data:`（或先归一化到工作区再引用），不得写 `builtin:` 引用 |
| 正式复现条件 | 产品入口：插入内置图标为子分支 → 保存 → 关闭 → 重开；观察点：`<image>` 的 `href` 与是否出现 `data-asset-broken` |
| 验证方式（设计预期） | `apps/canvas/tests/asset-insert-normalize.test.tsx` 的 N4 用例 + 扩展现有 `packages/react/tests/nodeg-icon.test.tsx` |
| 预期转红的负控 | child 直接写 `builtin:` 引用 → 断言「重开后无断图占位」必须失败 |

---

## CE-06 「当前目录唯一同名命中」被当作归属证据 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | `mindcanvas.starred.v1` 里有一条路径键；当前工作区恰好只有一篇同名文档 |
| 当前代码路径 | 初版 M6 的规则「能按 `relPath` 唯一匹配到当前作用域 → 直接迁移」。旧键只有路径字符串（`fileManagerShared.ts:115,133-146`），从未记录作用域 |
| 错误结果 | 用户在新工作区里看到一个自己从未收藏过的「收藏」；或原收藏被绑到错误的工作区后，在原工作区消失 |
| **是否已复现** | **否** |
| 正确结果 | 不自动绑定。旧键进历史池，以「N 条旧记录未关联工作区」呈现；用户显式确认后才绑定并记 `relinkEvidence` |
| 正式复现条件 | 夹具：两个工作区各有一篇 `笔记.mm.md`；在 A 里收藏该文档 → 断开 → 挂载 B → 首次进入文件面板；观察点：B 的收藏列表是否出现该条 |
| 验证方式（设计预期） | `apps/canvas/tests/doc-index.test.ts` 的 S3 用例 |
| 预期转红的负控 | 按唯一命中自动绑定 → 断言「未关联列表中存在该条」必须失败 |

---

## CE-07 「清定时器 + waitForIdle」不是互斥（竞态） `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 已有一次成功落盘；用户点改名；在等待/执行期间（a）内容发生变化使 auto 重排，或（b）用户按 Ctrl+S |
| 当前代码路径 | `suppressPendingAuto` 只清一个定时器；`useAutoSave.ts:121` 的 deps 含 `content`，内容变化会**重新排定**（`:112-113`）；`waitForIdle()` 只覆盖当前会话（`useDocumentSaveSession.ts:146-157` 的类头注与边界声明）。于是：等待空闲 → 新保存进入 → `renameFile` 读到的仍是**上一次**落盘内容 → 删源 |
| 错误结果 | 复制出的新文件是旧快照，而新保存写入的是**旧目的地**（在删源前后交错）；用户最终看到新文件内容落后于屏幕 |
| **是否已复现** | **否** |
| 正确结果 | 租约期间 `submit` 一律 `blocked`；改名复制的内容 = 租约前那次落盘快照；租约期间的新编辑在释放后由一次 auto 写到**新**目的地 |
| 正式复现条件 | 夹具：让 `createWritable` 延迟 500ms；步骤：保存 → 立刻改名 → 期间按 Ctrl+S / 编辑触发 auto；观察点：`renameFile` 内 `readFile` 的返回内容、`submit` 是否入队、释放后 auto 的目的地 |
| 验证方式（设计预期） | `apps/canvas/tests/file-op-lease.test.tsx` 的 L1 用例 |
| 预期转红的负控 | 只清定时器、不取租约 → 断言「租约期间无写入请求进入队列」必须失败 |

---

## CE-08 无条件重试删源会覆盖/删除外部修改 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 部分成功状态（目标已建、源删除失败）→ 用户在应用外修改了**源**文件 → 用户点「重试删除原始」 |
| 当前代码路径 | 初版只规定「重试删源只删源、不重做复制」，未要求复查源是否变化；`directoryHost.ts:321-328` 的 `removeEntry?.()` 不比对任何快照 |
| 错误结果 | 删除了外部程序刚写入的内容；且没有任何提示 |
| **是否已复现** | **否** |
| 正确结果 | 删除前复查 `{size, lastModified}` 快照；不一致 → 不删，提示「原文件已被外部修改，未删除」，转为「保留两份」 |
| 正式复现条件 | 夹具：`removeEntry` 首次抛 `E-PERMISSION` 制造部分成功 → 修改源文件的 `lastModified`/内容 → 点重试删除 → 断言源仍在 |
| 验证方式（设计预期） | `apps/canvas/tests/file-op-partial.test.tsx` 的 L4 用例 |
| 预期转红的负控 | 跳过复查直接 `removeEntry` → 断言「源文件仍存在」必须失败 |

---

## CE-09 撤销副本会丢掉部分成功后写入的新编辑 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 部分成功 → 当前编辑的是**新**位置那份 → 用户继续编辑并触发一次成功保存 → 点「撤销新副本」 |
| 当前代码路径 | 初版规定「目的地与路径回到旧位置」，未对「副本是否已被编辑/写入」设门槛 |
| 错误结果 | 删除副本 = 丢掉那次成功保存的新内容；会话回到旧文件（内容是旧快照），用户以为只是「撤销了移动」 |
| **是否已复现** | **否** |
| 正确结果 | 拒绝直接删除；只提供「放弃这些改动并删除副本」或「保留两份」 |
| 正式复现条件 | 组件级：制造 partial → 在副本上编辑并保存 → 点撤销副本 → 断言副本文件仍存在且内容为最新 |
| 验证方式（设计预期） | `apps/canvas/tests/file-op-partial.test.tsx` 的 L3 用例 |
| 预期转红的负控 | 无条件删除副本 → 断言「副本内容仍为最新」必须失败 |

---

## CE-10 「删新键即无损回退」`[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 升级到新版本 → 用户新增收藏 / 打开若干文档（写 `openedAt`）/ 句柄键迁移到新键 → 回退到旧版本 |
| 当前代码路径 | 初版 §6.3 的表述「回退 = 删除新键即可，无数据损失」。旧键 `mindcanvas.library.v1` / `mindcanvas.starred.v1` / `docId` 裸句柄在升级后**不再被更新** |
| 错误结果 | 回退后看不到升级期间的收藏与最近；句柄记录也停在升级前 |
| **是否已复现** | **否** |
| 正确结果 | 分情形：R-A（无新写入）删新键无损；R-B（已有变更）必须靠**降级投影**——新版本每次变更后同步写旧格式 |
| 正式复现条件 | 单测：走一遍「新增收藏」→ 断言 `mindcanvas.starred.v1` 含该键（投影已写）；再断言仅删新键时旧版本可见的数据不含该键（证明「删新键 ≠ 无损」） |
| 验证方式（设计预期） | `apps/canvas/tests/doc-index.test.ts` 的 R1 用例 |
| 预期转红的负控 | 只保留旧键、不做投影 → 断言「R-B 的收藏在旧键里可见」必须失败 |

---

## CE-11 两个同名 `assets/a.png` 从浏览器素材库插入后重开解析到工作区那张 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 工作区已挂载且 `<ws>/assets/a.png` 存在（红）；浏览器素材库另有一张 `a.png`（蓝）；用户从浏览器素材库插入蓝图 → 保存 → 关闭 → 重开 |
| 当前代码路径 | 文档里只能写 `assets/a.png`（`serializer.ts:137`；`SidePanels.tsx:39-41` 的 `assetValueOf` 取 `item.id`，浏览器项 `id = 'assets/<name>'`，`idbAssetHost.ts:136`）。重开后解析按 `WorkspaceAssetHost.resolveAsset` → `objectUrls.get('assets/a.png')`（磁盘项，`:63-75` 预热）→ **红线** |
| 错误结果 | 用户插入的是蓝图，重开显示成红图；反向情形（先插入红线、后清掉磁盘文件）则变成断图 |
| **是否已复现** | **否** |
| 正确结果 | 插入时**归一化**：蓝图字节复制到 `<ws>/assets/a 2.png`（默认保留两份），文档引用 `assets/a 2.png` → 重开显示蓝图 |
| 正式复现条件 | 夹具：工作区写红 `a.png`；IDB 放蓝 `a.png`；产品入口插入 → 保存 → 重开；观察点：`<image>` 的实际字节（可用像素/颜色断言）与文档里的引用字符串 |
| 验证方式（设计预期） | `apps/canvas/tests/asset-insert-normalize.test.tsx` 的 N1 用例 |
| 预期转红的负控 | 只在卡片上加 scope 徽章、插入仍写 `assets/a.png` → 断言「重开显示蓝图」必须失败 |

---

## CE-12 `no-scope` 被当成 `missing` `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 文档含 `assets/diagram.png`；用户**没有**挂载工作区就打开它 |
| 当前代码路径 | 现状 `resolveAsset` 在未命中时回落 `baseUrl + id`（`idbAssetHost.ts:127-131`，`baseUrl = '/'`，`MindmapStage.tsx:853-856`）→ 浏览器请求 `/assets/diagram.png` → 404 → 断图；`assetDiagnostics` 按清单比对产出 `W-ASSET-MISSING`（`assetDiagnostics.ts:15-30`），**不区分**「没开工作区」与「文件真的没了」 |
| 错误结果 | 用户被引导去「重新定位」一个其实完好的引用；若用户真的选了一个新文件，可能把一个正确的引用改坏 |
| **是否已复现** | **否**（读码推导） |
| 正确结果 | 未挂载工作区 → `unresolved('no-scope')`，文案「这份文档的图片保存在它的工作区 assets/ 里，请先打开对应文件夹」，**不提示重新定位**；挂载后自动恢复 |
| 正式复现条件 | 组件级：不挂载工作区，打开含 `assets/...` 引用的文档 → 断言占位文案是「请先打开对应文件夹」而不是「不在了」；然后挂载工作区 → 断言图像恢复且**没有**触发任何重新定位 |
| 验证方式（设计预期） | 扩展 `packages/react/tests/nodeg-asset.test.tsx` + `apps/canvas/tests/asset-insert-normalize.test.tsx` |
| 预期转红的负控 | 保留 `baseUrl` 回落 → 断言「未挂载时不发起指向站点根的图片请求」必须失败 |

---

## CE-13 `openedAt === null` 被 mtime 填充（违反 UD-2）`[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 旧索引条目在迁移时没有真实打开时间 |
| 当前代码路径 | 现状「最近」用树内 `ts` 排序：工作区源是 mtime（`directoryHost.ts:237`）、兼容源是访问时间（`docLibrary.ts:32`）（`current-state.md` R-06） |
| 错误结果 | 把 mtime 当成「用户何时打开」→ 最近列表顺序与用户记忆不符，且**看起来像是**打开了从未打开过的文档 |
| **是否已复现** | **否**（这是设计选择问题，不是崩溃） |
| 正确结果 | `openedAt: number \| null`；`null` 的条目排在末尾并显示「未记录打开时间」 |
| 正式复现条件 | 单测：构造一条无 `openedAt` 的旧条目 → 断言它不在「最近」前部、且显示为「未记录打开时间」；断言 `savedAt` 不参与该排序 |
| 验证方式（设计预期） | `apps/canvas/tests/doc-index.test.ts` + `file-manager-tree.test.tsx` 扩展 |
| 预期转红的负控 | 用 mtime 回填 `openedAt` → 断言「该条不进前部」必须失败 |

---

## CE-14 `physicalWritesInFlight` 缺失时的交错写 `[逻辑]`

| 项 | 内容 |
|---|---|
| 触发条件 | 用户「另存为」后旧会话仍有一次未完成的物理写；随后立刻对新文件执行改名/移动 |
| 当前代码路径 | `useDocumentSaveSession.ts:26-27` 的类头注明确：被替换会话已发出的物理 I/O 无法撤回，且**不阻塞** `waitForIdle()`；token 推进只保证回调不回填（`:243-246`） |
| 错误结果 | 改名/移动与该次写入交错：源文件可能在读完内容后被写入，或目标文件在创建后被旧会话的写入覆盖 |
| **是否已复现** | **否** |
| 正确结果 | `physicalWritesInFlight > 0` 时 `beginExclusiveOp` 返回 `refused('busy-physical')`，用户看到可重试提示；不静默等待 |
| 正式复现条件 | 单测：会话 A 发起一次慢写 → `beginDocument` 切到会话 B → 在 A 的写完成前调用 `beginExclusiveOp` → 断言返回 `busy-physical` 而非 `granted` |
| 验证方式（设计预期） | `apps/canvas/tests/file-op-lease.test.tsx` 的 L2 用例 |
| 预期转红的负控 | 用 `waitForIdle()` 代替物理写计数 → 断言 `busy-physical` 拒绝路径存在必须失败 |

---

## 1. 与既有风险表的关系

| 本文件 | `current-state.md` 对应 | 关系 |
|---|---|---|
| CE-01 | R-01 | 口径统一为「逻辑反例（未实跑）」 |
| CE-03 | R-09 | 由「静默覆盖」扩展为「两种错误实现」 |
| CE-04 | — | 本轮新增（epoch 记账） |
| CE-05 | — | 本轮新增（child 内置图标） |
| CE-07 / CE-14 | R-01/R-02 的时序面 | 本轮把竞态具体化 |
| CE-11 / CE-12 | R-15 | 本轮把「回落站点根」升级为「解析规则」问题 |
| CE-13 | R-06 | 与 UD-2 对齐 |

**未在本文件覆盖的既有风险**（仍按 `current-state.md` §5 处理）：R-03（无 catch）、R-04（删除不读 dirty）、R-05（收藏键易碎）、R-08（三态不可区分）、R-10（性能）、R-11（`isMissing` 未接线）、R-12（落点语义未接线）、R-13/R-14（自由画布）、R-16（objectURL 未统一释放）、R-17（`SOURCE_KEEP=8`）、R-18（引用基准事实）。

---

## 2. 本文件未做的事

- 未运行任何测试、浏览器脚本或探针；上表所有「验证方式」都是**设计预期**。
- 未对任何真实目录执行改名、移动或删除。
- 未测量性能；`asset-library.md` §2.4 的指标仍是拟定目标。
- 未验证跨浏览器行为（`isSameEntry`、`createWritable`、IDB 持久化策略）。
