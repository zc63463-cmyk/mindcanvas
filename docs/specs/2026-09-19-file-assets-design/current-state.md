# 现状调查：能力矩阵、调用链与源码锚点

任务：FILE-ASSETS-DESIGN（D0 证据部分）。日期：2026-09-19。

阅读方式：只读调查当前工作树，未修改任何产品源码、测试、门禁或既有证据。所有行号取自本次读取时的实际文件内容；若后续有人改动同一文件，行号可能漂移，应以符号名回查。

---

## 0. 取值口径

本文件把每条结论标成三类之一，后续所有设计文档沿用同一口径：

| 标记 | 含义 |
|---|---|
| **【事实】** | 本次直接读取源码确认，含文件与行号。 |
| **【线索】** | 由已确认的调用链推导出的风险，未在真实浏览器/真实目录上复现。不代表已确认缺陷。 |
| **【提案】** | 本设计包建议的目标行为，当前不存在。 |

已有功能一律标 **【事实】**；不得把既有实现记为本包新增成果。

---

## 1. 起点的真实边界

- **【事实】** HEAD 为 `a2ce72b`（`docs(dispatch): ROOT-DRAG-1 收口记录`），`git status --porcelain` 共 123 条变更（48 条已跟踪修改 + 75 条未跟踪）。HEAD 只是基底，工作树含多轮未提交成果。
- **【事实】** 与文件/资产直接相关的未跟踪新文件包括：`apps/canvas/src/documentLifecycle.ts`、`apps/canvas/src/draftFlush.ts`、`apps/canvas/src/hooks/useDocumentSaveSession.ts`、`useFreeCanvasDocument.ts`、`useUnsavedTransition.ts`、`useDocumentLeaveRegistration.ts`、`packages/react/src/edit/draftSessions.ts`、`compositionGuard.ts`、以及 `apps/canvas/tests/save-destination.test.tsx`、`save-lifecycle.test.tsx`、`mode-guard.test.tsx`、`leave-entry-matrix.test.tsx` 等。
- **【事实】** `docs/specs/2026-09-19-file-assets-design/` 在本包开工前不存在，无需 `-r2` 后缀。
- 引用上一轮结论时只标注来源，不重跑：DELIVERY-CLOSE 的候选为 `outputs/delivery-close-finish/20260919-04/candidate.json`（808 项），门禁证据沿用 20260919-03 的 gate/build/analyze 成功与 2489 测试（来源：`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md:3-5,43`）。本包**未**重新运行全仓门禁。
- 本包不重开 DELIVERY-CLOSE。`docs/roadmap/2026-09-15-open-items.md:10-11` 明确 O3（`NoteGrowthPanel` 孤儿组件）与 O4（`jumpToAnchor` 无 jsdom 测试）**仍未做**，本包不划完成。

---

## 2. 能力矩阵

### 2.1 导图（`.mm.md`）

| 能力 | 状态 | 证据 |
|---|---|---|
| 新建 / 打开 / 保存 / 另存为（单文件，无工作区） | 已有 | `useDocumentActions.ts:147-165,167-299`；`save.ts:71-84,111-128` |
| 自动保存（300ms 去抖） | 已有 | `useAutoSave.ts:69,112-113,121` |
| 目录工作区挂载 / 恢复 / 断开 | 已有 | `directoryHost.ts:151-199`；`MindmapStage.tsx:796-845` |
| 目录扫描（.mm.md/.md，深度 8，上限 2000 文件） | 已有 | `directoryHost.ts:35-61,207-254` |
| 文件管理面板：树 / 搜索 / 最近 / 收藏 / 新建 / 改名 / 删除 / 拖入目录 / 右键菜单 | 已有 | `FileManager.tsx:132-236,286-541`；`fileTreeModel.ts:38-209` |
| 浏览器文档库（localStorage 元数据 + 虚拟目录） | 已有 | `docLibrary.ts:17-25,86-320` |
| 打开工作区文件（携带真实句柄即写盘目的地） | 已有 | `MindmapStage.tsx:815-830` |
| 当前文档在文件面板中的**高亮标识** | **无入口** | `FileManagerTree.tsx` 全文件无 `currentPath`；`currentPath` 只用于面包屑与状态条（`FileManager.tsx:365-374`） |
| 复制文档 | **无入口** | `DirectoryWorkspaceHost` 无 `copy` 方法；`FileManagerContextMenu.tsx:54-72` 仅 4 项 |
| 「最近」= 打开历史 | **不符**（按树内 `ts` 倒序 = 磁盘 mtime） | `FileManager.tsx:249-256`；`directoryHost.ts:237`（mtime）/`docLibrary.ts:32`（访问时间）——两种源的 `ts` 语义不同 |
| 文件夹整体移动 | **无入口** | `moveFile` 只处理文件（`directoryHost.ts:343`）；`FileManagerTree.tsx:105` 只有文档行 `draggable` |
| 重命名/移动后回填返回值 | **未消费** | host 明确要求消费（`directoryHost.ts:304-307`），调用点 `FileManager.tsx:217,230` 丢弃返回值，仅 `reload()` 全量重扫 |

### 2.2 自由画布（`.mc.canvas.json`）

| 能力 | 状态 | 证据 |
|---|---|---|
| 新建 / 打开 / 保存 / 最近（localStorage 独立键） | 已有 | `canvasDocHost.ts:27,31-33,51-126` |
| 自动保存 | **无**（注释自陈「本模式无自动保存」） | `FreeCanvasStage.tsx:115-121` 离开端口不带 `suppressPendingAuto` |
| 进入目录工作区 | **无入口** | `isWorkspaceDocName` 只认 `.mm.md`/`.md`（`directoryTypes.ts:80-83`）；`apps/canvas/src` 内 `canvasDocHost` 与 `DirectoryWorkspaceHost` 无相互引用 |
| 出现在文件管理面板 | **无** | `FileManagerModal` 只在导图 Stage 挂载（`MindmapStage.tsx:2329-2343`）；自由画布 Stage 无该渲染点 |
| 浏览器本地资产（IdbAssetHost） | 已有持久化能力（`packages/react/src` 内，非自由画布专有） | `idbAssetHost.ts:19-20,101-158` |

### 2.3 图库（`AssetPanel`）

| 能力 | 状态 | 证据 |
|---|---|---|
| 范围 Tabs（本地上传 / 常用 / 内置图标 / 全部） | 已有 | `AssetPanel.tsx:73-85,135` |
| 搜索（名称/类型/id）、网格+列表切换、列表虚拟化 | 已有 | `AssetPanel.tsx:65-67,132-136,158-172,355-388,465-489` |
| 上传四入口（按钮 / Dropzone / 面板 drop / paste） | 已有 | `AssetPanel.tsx:202-219,258-268,391-419,421-438` |
| 画布 drop / paste 上传 | 已有（但走 `onAssetFiles`，无落点语义） | `MapView.tsx:1844-1852`；`MindmapStage.tsx:1834-1867` |
| 三语义插入 icon / media / child | 已有（仅导图） | `SidePanels.tsx:128-153`；`assetTypes.ts:22-23` |
| IndexedDB 持久化 + 磁盘 `./assets/` 持久化 | 已有 | `idbAssetHost.ts:101-158`；`workspaceAssetHost.ts:57-112`；`directoryHost.ts:375-386` |
| 小 SVG 内联（≤15KB）+ data URL 自包含 | 已有 | `assetIcons.ts:12`；`svgTint.ts:18,172-174,189-191` |
| 断图占位 + `W-ASSET-MISSING` 诊断 | 已有 | `NodeG.tsx:138-141,166-196`；`assetDiagnostics.ts:15-30`；`MindmapStage.tsx:895-898,2118-2148` |
| 资产删除 / 改名 / 引用查询 | **无入口** | `AssetHost` 只有 list/resolve/upload/has（`assetHost.ts:40-52`）；三实现均无对应方法 |
| 面板失效标识 `isMissing` 在生产生效 | **未接线** | prop 存在（`AssetPanel.tsx:41-42`），`apps/canvas` 内零传入 |
| 画布拖放落点语义（icon/media/child/free） | **未接线** | `MapView.tsx:274-280,1844-1846` 与 `dropSensing.ts` 已实现；`apps/canvas` 内 `onAssetDrop` 零命中（产品只传 `onAssetFiles`，`MindmapStage.tsx:1834`） |
| 自由画布中的图库入口 / 插入 / 预览 | **无入口** | `packages/react/src/free-canvas/` 内 `asset`/`icon`/`media` 零命中 |
| 缩略图懒加载 | **无** | `assetViews.tsx:76-84,158-166` 的 `<img>` 无 `loading` 属性 |
| 资产清单分页 / 增量加载 | **无**（一次 `getAll` 全量含二进制） | `idbAssetHost.ts:22-35,89-125`；网格全量渲染见 `AssetPanel.tsx:184` 注释 |

### 2.4 三维矩阵（画布 × 存储场景 × 原生文件接口）

原生文件接口 = File System Access API（`showOpenFilePicker` / `showDirectoryPicker` / `createWritable`）。可用性探测点：`isDirectoryPickerSupported()`（`directoryHost.ts:64-66`）、`handleOpen` 内联判断（`useDocumentActions.ts:148`）、`canvasDocHost` 的 `isEmbeddedFrame` 兜底（`canvasDocHost.ts:36-38,54,62-65`）。

| 场景 | 导图（.mm.md） | 自由画布（.mc.canvas.json） |
|---|---|---|
| 单文件 + 原生接口可用 | **已有**：系统选择器读写，句柄入 IDB | **已有**：`LocalCanvasDocHost.open/save`，嵌入 frame 抛 `fs-access-unavailable` |
| 单文件 + 原生接口不可用 | **已有**：隐藏 file input 打开 + 下载兜底保存（`useDocumentActions.ts:156-160`；`save.ts:111-128`） | **部分支持**：写句柄失效 → `downloadJson`（`canvasDocHost.ts:68-76`） |
| 目录工作区 + 原生接口可用 | **已有**：扫描/新建/改名/删除/拖入；保存直写句柄 | **无入口**（见 2.2） |
| 目录工作区 + 原生接口不可用 | **无入口**：能力探测失败后回落浏览器文档库（`FileManager.tsx:136-139`） | **无入口** |
| 浏览器文档库（无工作区） | **已有**：`DocLibrary` 虚拟目录 + `mindcanvas.library.v1` | **部分支持**：独立最近列表 `mindcanvas.canvas.recent.v1`，不进 `DocLibrary`、不进文件面板 |
| 浏览器资产库（图库） | **已有**：IDB `mindcanvas-assets` + 挂载工作区后落 `./assets/` | **无入口**（图库面板不在自由画布挂载） |

补充事实：目录工作区模式下 `.mm.md` 的保存**不走** `writeFile`，而是 `docHost.save({..., handle})` → `writeToHandle`（`useDocumentActions.ts:192`；`save.ts:150`）。`DirectoryWorkspaceHost.writeFile` 只被 `createFile` 内部使用（`directoryHost.ts:284`）。

---

## 3. 调用链

### 3.1 打开

```text
入口 A：启动页 / 最近文档菜单 / Ctrl+O
  → useDocumentActions.handleOpen (useDocumentActions.ts:147)
     原生接口可用 → docHost.open() → applyDoc(opened)   :150-153
     用户取消 → return（不再弹 file input）             :155
     FS 抛错 → fileInputRef.click()                     :156-160

入口 B：文件管理面板点击条目（工作区）
  FileManagerTree.tsx:155-163  n.wsFile ? onOpenFile(n.wsFile) : onOpenEntry(n.entry)
  → FileManagerModal.tsx:93-96 onOpenFile → MindmapStage.openWorkspaceFile (MindmapStage.tsx:815)
      workspace.readFile(file)                            :817
      setWorkspacePath(file.path)          ← 唯一的「当前路径」状态    :818
      applyDoc({ id: file.path, name, source, handle, saved:true, ts })  :820-827
  → applyDoc → requestLeave(...)（App 注入的三选项决策器）  :133-143
  → performApplyDoc: session.beginDocument(next.handle); setDoc(next); docHost.remember(next)  :114-128

入口 C：文件管理面板点击条目（兼容模式，无 source）
  FileManagerModal.tsx:76-82 → onClose() + handleOpen()（转「重新选文件」）
```

关键事实：**工作区文档的 `MindDoc.id` 就是相对路径**（`MindmapStage.tsx:821`），而写盘能力来自 `handle`（`:824`）。两者是同一个对象的两个字段，没有任何机制在文件被外部改名后校正 `id`。

### 3.2 保存 / 自动保存 / 另存为 / 重开

```text
手动保存  useDocumentActions.handleSave (useDocumentActions.ts:167)
  会话忙且无目的地 → refuseBusy()（不排队，保 transient activation）  :170
  取消 pending auto 定时器（≠取消已开始的 I/O）                      :171-174
  session.submit({ intent:'manual',
     guard: canWriteDoc(syncedSourceRef.current, doc.source)         :178
     capture: { source: controller.serialize(), content: controller.root } :179
     write:  目的地 = session.getDestination() ?? IDB 补挂 + verifyPermission :187-191
             docHost.save({...doc, source, handle: effective})       :192
     commit: session.setDestination(nextHandle)                      :201
             setDoc(savedSource/handle/saved/ts)                      :203-209
             if (current) controller.markSaved()                     :211
             remember + persistHandle，失败只发附属警告               :214-230
  })
  结果映射：blocked → SAVE_BLOCKED_NOTICE；failed → SAVE_FAILED_NOTICE；cancelled/stale 静默  :234-235

自动保存  useAutoSave.ts
  条件：controller.dirty && doc.saved && doc.handle                   :69
  去抖 300ms，deps 含 content/dirty/saved/id/handle                   :112-113,121
  成功后 if (current) controller.markSaved()                          :97-98

清脏判据（会话 + 内容双归属）  useDocumentSaveSession.ts
  entry.token !== this.token → stale，零 commit                       :243-246
  Object.is(readContent(), snapshot.content) → current                :257-262
  snapshot null / writeFailed / outcome null → failed，不 commit       :247-249

另存为  handleSaveAs (useDocumentActions.ts:251)
  write 里显式传 handle: undefined → 必然唤起选择器                    :259
  commit 同步 setDestination(nextHandle) → 已入队任务写新文件           :264
  「另存为后原文件不变」已由 DELIVERY-CLOSE DF-R5 专项覆盖（见第 5 节）

重开
  无「重开当前文档」产品入口。页面刷新后仅 `workspace.restore()`（仅 granted，MindmapStage.tsx:804-812）
  再让用户从文件面板点击。自由画布同样只恢复最近列表。
```

### 3.3 文件操作（新建 / 改名 / 移动 / 删除 / 复制）

```text
新建导图  FileManager.tsx:168-175 → createFile(dirPath,'未命名.mm.md',NEW_DOC_TEMPLATE) → reload()
新建文件夹 FileManager.tsx:177-189 → createDir(parentPath, name) → reload()
改名      FileManager.tsx:212-223 → renameFile(node.wsFile, name) → reload()   ← 返回值丢弃
移动(拖入) FileManagerTree.tsx:61-68 → dropInto (FileManager.tsx:226-236)
             canDropInto 校验（fileTreeModel.ts:202-209）
             → moveFile(node.wsFile, target.fullPath) → reload()              ← 返回值丢弃
删除      FileManager.tsx:192-210 → removeFile / removeDir → reload()
复制      无

host 侧实现（directoryHost.ts）
  createFile   :271-287  同级同名 → uniqueName 静默加序号（:352-365）
  renameFile   :308-318  readFile → createFile(同父目录) → removeFile → return created
  moveFile     :343-349  readFile → createFile(目标目录) → removeFile → return created
  removeFile   :321-328  dirAt(parent) → dir.removeEntry?.(name)   ← 可选调用
  removeDir    :331-336  removeEntry(name, {recursive:true})       ← 可选调用
  writeAsset   :375-386  getFileHandle(name, {create:true}) → 直接覆盖，无 hasAsset 检查
```

### 3.4 上传 / 插入 / 解析 / 导出

```text
上传
  面板四入口 → SidePanels.tsx:124(onUpload) / :172(onPaste)
  → MindmapStage.tsx:2362-2371 过滤 image/* 或图片扩展名 → uploadToGallery (:888-892)
       assetHost.uploadAsset(file) → setAssetList(按 id 去重追加)
  画布 drop/paste → MapView.tsx:1848-1854 onAssetFiles
  → MindmapStage.tsx:1834-1867：.mm.md 优先当文档打开；图片 → uploadToGallery → addEntityChild → select

插入（仅导图）
  SidePanels.tsx:39-41  assetValueOf(item) = item.svg ? svgToDataUrl(item.svg) : `${item.kind}:${item.id}`
  SidePanels.tsx:128-153 action==='icon'|'media' → controller.updateNote(targetId,{icon|media})
                           否则 → controller.addEntityChild(targetId,{kind,id}) + select + close
  目标节点 = controller.selectedId ?? controller.root.id  (:129)
  撤销：经 EditorController 的 apply/patch → OpHistory（controller.ts:250-254,296-301），Ctrl+Z 可撤

解析
  文档内三形态：实体 `@kind:id`（serializer.ts:137）、note.icon/note.media（serializer.ts:107-117）、
                小 SVG 内联 data URL（svgTint.ts:172-174）
  渲染：NodeG.tsx:107-131  assetHref = resolveAssetUrl?.(ref) ?? (assetBaseUrl + ref.id)
                          iconSrc  → nodeIcon.ts:30-46 三分支（data: 优先 → draw:/img: → assetBaseUrl+id）
  宿主注入：MindmapStage.tsx:1626-1628（assetBaseUrl="/"、resolveAssetUrl = assetHost.resolveAsset）
  WorkspaceAssetHost.resolveAsset :81-85  objectUrls(relPath) ?? fallback.resolveAsset
  IdbAssetHost.resolveAsset       :127-131  objectUrls(id) ?? baseUrl + id

导出
  useExportActions.ts:41-75   SVG 直出；PNG 失败（tainted / 不支持）降级为 SVG 并提示
  文案：:71 '画布含外部图片，无法导出 PNG，已改为导出 SVG。' / :72 '当前环境不支持导出 PNG，已改为导出 SVG。'
```

**资产引用的解析基准（重要，易误改）【事实】**：磁盘资产的引用字符串是**相对工作区根**的 `assets/<name>`（`directoryHost.ts:385` 用 `ASSETS_DIR` 拼接、`readAssetFile` 用 `dirAt(root, segs)` 从根逐级取，`:398-409`），与文档所在目录无关。实际渲染优先命中会话内的 objectURL 缓存（`workspaceAssetHost.ts:64-68,103-105`），未命中时回落 `baseUrl + id`，而 `baseUrl = '/'`（`MindmapStage.tsx:853-856`），即**站点根**，不是工作区根。因此「嵌套目录下资产路径的解析基准」= 工作区根（正确路径）；而回落分支语义含混，是设计要收紧的点（见 `asset-library.md` §5）。

---

## 4. 源码锚点索引

| 主题 | 文件 | 关键符号与行号 |
|---|---|---|
| 文件面板 | `apps/canvas/src/FileManager.tsx` | `WorkspaceLike:54`、`FileManagerProps:66`、`FileManager:88`、`reload:132`、`commitRename:212`、`dropInto:226`、`collectDocs:249`、`filtered:152` |
| 面板承载 | `apps/canvas/src/FileManagerModal.tsx` | `FileManagerModalProps:17`、`FileManagerModal:46`、打开策略 `:76-96`、drawer/wide `:107-146` |
| 树渲染 | `apps/canvas/src/FileManagerTree.tsx` | `FileManagerTreeCtx:15`、`FileManagerTree:35`、目录行 `:47-97`、文档行 `:99-179`、星标 `:132-154` |
| 右键菜单 | `apps/canvas/src/FileManagerContextMenu.tsx` | `ContextMenu:11`、四项 `:54-72` |
| 面板外壳 | `apps/canvas/src/FileManagerChrome.tsx` | `StorageBar:16`、`ViewTabs:96`、`FlatDocRow:146`、`TAB_DEFS:89` |
| 统一树模型 | `apps/canvas/src/fileTreeModel.ts` | `TreeNode:15`、`treeFromWorkspace:38`、`treeFromLibrary:71`、`filterTree:148`、`canDropInto:202` |
| 面板共享 | `apps/canvas/src/fileManagerShared.ts` | `collectDocs:72`、`STARRED_KEY:115`、`useStarredKeys:128` |
| 文档库 | `packages/react/src/edit/docLibrary.ts` | `LIB_KEY:17`、`FOLDERS_KEY:18`、`SOURCE_KEEP:25`、`DocEntry:28`、`DocLibrary:86`、`persistSorted:315` |
| 目录工作区 | `packages/react/src/edit/directoryHost.ts` | `SCAN_SKIP_DIRS:35`、`ASSETS_DIR:46`、`DEFAULT_SCAN:57`、`DirectoryWorkspaceHost:128`、`createFile:271`、`renameFile:308`、`removeFile:321`、`moveFile:343`、`writeAsset:375`、`readAssetFile:398`、`listAssetFiles:413`、`uniqueName:352` |
| 目录类型 | `packages/react/src/edit/directoryTypes.ts` | `WorkspaceFile:44`、`WorkspaceDir:58`、`isWorkspaceDocName:80` |
| 保存契约 | `apps/canvas/src/documentLifecycle.ts` | `SaveIntent:17`、`SaveCompletion:35`、`DocumentLeavePort:68`、`SAVE_BUSY_NOTICE:102`、`SAVE_FAILED_NOTICE:111`、`SAVE_METADATA_WARNING:120`、`SAVE_METADATA_WARNING_DOWNLOAD:129` |
| 保存会话 | `apps/canvas/src/hooks/useDocumentSaveSession.ts` | `SaveSnapshot:34`、`SaveRequest:41`、`DocumentSaveSession:64`、`destination:72`、`setDestination:99`、`getDestination:104`、`beginDocument:127`、`isSaving:142`、`waitForIdle:152`、`submit:160`、`drain:209`、清脏判据 `:243-262` |
| 文档操作 | `apps/canvas/src/hooks/useDocumentActions.ts` | `performApplyDoc:114`、`applyDoc:133`、`handleOpen:147`、`handleSave:167`、`handleSaveAs:251` |
| 自动保存 | `apps/canvas/src/hooks/useAutoSave.ts` | `useAutoSave:46`、条件 `:69`、去抖 `:112-113`、清脏 `:97-98` |
| 离开决策 | `apps/canvas/src/hooks/useUnsavedTransition.ts` | `useUnsavedTransition:119`、互斥 `:277`、归属校验 `:129-135`、决策后复核 `:348-355`、放弃分支 `:366-391` |
| 离开端口登记 | `apps/canvas/src/hooks/useDocumentLeaveRegistration.ts` | `useLeavePortRegistration:14`、箭头转发 `:23-28` |
| 自由画布 | `apps/canvas/src/canvasDocHost.ts` | `CanvasDoc:13`、`CANVAS_RECENT_KEY:27`、`CANVAS_FILE_TYPES:31`、`LocalCanvasDocHost:51` |
| 自由画布状态 | `apps/canvas/src/hooks/useFreeCanvasDocument.ts` | `useFreeCanvasDocument:66`、`beginDocument:94`、`write:128`、`commit:134`、清脏 `:151` |
| 资产契约 | `packages/react/src/chrome/assetHost.ts` | `kindOfFileName:11`、`IMAGE_EXT_MIME:17`、`AssetHost:40-52`、`DemoAssetHost:60` |
| IDB 资产 | `packages/react/src/chrome/idbAssetHost.ts` | `DB_NAME:19`、`AssetRecord:23`、`IdbAssetHost:52`、`objectUrls:59`、`listAssets:101`、`resolveAsset:127`、`uploadAsset:133`、静默降级 `:146-150` |
| 工作区资产 | `packages/react/src/chrome/workspaceAssetHost.ts` | `WorkspaceWriter:20`、`WorkspaceAssetHost:28`、`objectUrls:34`、`shouldPersistToDisk:52`、`listAssets:57`、`resolveAsset:81`、`uploadAsset:87`、`cacheInline:115` |
| 资产面板 | `packages/react/src/chrome/AssetPanel.tsx` | `AssetPanelProps:37`、`FAV_KEY:71`、`TABS:80`、`BUILTIN_ASSET_ITEMS:88`、`loadFavs:97`、`AssetPanel:117`、网格 `:355-371`、列表窗口 `:372-388` |
| 资产展示 | `packages/react/src/chrome/assetViews.tsx` | 缩略图解析 `:31-34`、失败态 `:76-99`、列表项 `:158-169` |
| 资产诊断 | `packages/react/src/chrome/assetDiagnostics.ts` | `hasAssetIn:10`、`assetDiagnostics:15`、文案 `:26` |
| SVG 安全 | `packages/react/src/render/svgTint.ts` | `INLINE_SVG_LIMIT:18`、`sanitizeInlineSvg:108`、`svgToDataUrl:172`、`isInlineableSvgText:189` |
| 渲染解析 | `packages/react/src/render/NodeG.tsx` / `nodeIcon.ts` / `assetRef.ts` | `NodeG.tsx:107-131,138-141,166-196`；`nodeIcon.ts:30-46`；`assetRef.ts:20-43` |
| 拖放落点 | `packages/react/src/render/dropSensing.ts`、`MapView.tsx` | `dropSensing.ts:25,73-111,114-138`；`MapView.tsx:262-280,632-636,1844-1852` |
| 导入导出 | `apps/canvas/src/hooks/useExportActions.ts` | `handleExport:41`、`handleExportPng:53`、降级文案 `:71-72` |
| 产品接线 | `apps/canvas/src/MindmapStage.tsx` | 工作区 `:796-845`、资产宿主 `:849-858`、文档库登记 `:874-883`、清单 `:908-916`、上传 `:888-892`、画布 drop `:1834-1867`、文件面板按钮/渲染 `:2038-2044,2329-2343` |
| 侧面板 | `apps/canvas/src/SidePanels.tsx` | `assetValueOf:39-41`、`onUpload:124`、`onInsertAs:128-153`、老路径 `onInsert:155-171`、`onPaste:172` |

---

## 5. 风险与验证状态

**重要**：下表「线索」列全部为**读码推导**，不是实测确认的缺陷。每条附复核办法，供后续开发包用真实浏览器/真实目录验证。

| 编号 | 线索 | 源码锚点 | 状态 | 复核办法（后续包） |
|---|---|---|---|---|
| R-01 | 改名/移动**当前打开文档**后，会话目的地仍是旧句柄；若旧文件已被删除，后续写入失败；若旧文件被新文件覆盖语义改变，可能写回错误路径 | `directoryHost.ts:308-318,343-349`；`FileManager.tsx:217,230`；`session.destination` 只在 `beginDocument`/`commit` 更新（`useDocumentSaveSession.ts:99-106,127-129`） | 线索（未复现） | 真浏览器：打开工作区文档 → 编辑 → 在面板改名 → 再编辑 → Ctrl+S，观察是否报错/写入哪份；用 `writeFile` 断点核对 handle |
| R-02 | 移动 = 复制后删源，非原子。目标已创建、源删除失败时既无回滚也无上报，`moveFile` 直接抛错，新文件成为孤儿副本 | `directoryHost.ts:343-349`；`FileManager.tsx:226-236`（无 try/catch）；`FileManagerTree.tsx:67`（`void` 调用） | 线索（未复现） | 夹具：让 `removeEntry` 抛 `E-PERMISSION`，断言目标存在 + 源存在 + UI 有「部分成功」提示 |
| R-03 | 删除/改名/移动全部无 try/catch，交互式失败只产生未处理 Promise 拒绝，用户看不到任何反馈 | `FileManager.tsx:195-210,212-223,226-236`；`FileManager.tsx:397`（`void doRemove`） | 事实（代码路径确认无 catch）+ 未实测 UI 表现 | 夹具：`removeDir` reject → 断言无未捕获拒绝且出现错误提示 |
| R-04 | 删除确认条不读 `dirty`/当前打开文档，删除当前文档或其父目录时不警告草稿/未保存内容；`dirty` 已作为 prop 传入面板（`FileManagerModalProps:40`）却只用于状态行 | `FileManager.tsx:377-410`；`FileManagerModal.tsx:38-40`；`MindmapStage.tsx:2340` | 事实（未消费 dirty）+ 后果未实测 | 真浏览器：dirty 状态下删除当前文件，观察是否静默丢弃 |
| R-05 | 收藏键为 `fullPath \|\| key`（`doc:<relPath>`）。改名/移动/切换工作区后键变化，收藏静默丢失；同一文件在不同工作区会共用同名键造成误收藏 | `fileManagerShared.ts:115,133-146`；`FileManagerTree.tsx:135`；`FileManager.tsx:478-479,498` | 事实（键构成确认）+ 串键未实测 | 夹具：两工作区同名文件各自收藏 → 切换 → 断言不串；改名后断言收藏迁移 |
| R-06 | 「最近」实为树内 `ts` 倒序：工作区源是磁盘 mtime，兼容源是访问时间，导致同一标签下排序语义混用 | `FileManager.tsx:249-256`；`directoryHost.ts:237`；`docLibrary.ts:32` | 事实 | 直接读代码即可判定；已裁决保留单一「最近」入口，P1 统一为 `openedAt` 排序，`savedAt`/mtime 仅展示 |
| R-07 | `WorkspaceAssetHost.objectUrls` 缓存键只有相对路径；挂载/切换/断开工作区时**不重建宿主、不校验作用域、不丢弃迟到结果** | `workspaceAssetHost.ts:33-34,43-46,63-68,81-85`；宿主一次性创建 `MindmapStage.tsx:852-857`；唯一防护是组件级 `alive` 标志 `:908-916` | 线索（缓存键事实；串图未实测） | 双工作区夹具（各含 `assets/a.png`）+ 制造迟到：先 `listAssets` 旧作用域，切换到新作用域后再回填 → 断言预览不串 |
| R-08 | 上传结果三态不可区分：IDB `put` 失败被 catch 后**仍返回同一个** `AssetItem`；上层无 try/catch、无提示，失败只成为未处理拒绝 | `idbAssetHost.ts:146-157`；`MindmapStage.tsx:888-892,2362-2371` | 事实（静默降级代码确认）+ UI 表现未实测 | 夹具：令 `putRecord` reject → 断言当前无法区分「已持久化」与「仅会话可用」 |
| R-09 | 磁盘资产同名直接覆盖（`getFileHandle(name,{create:true})`），无确认、无「保留两份」，既有引用随之改内容 | `directoryHost.ts:379-386`；`workspaceAssetHost.ts:100-105`（从不查 `hasAsset`） | 事实 | 夹具：两同名不同内容上传 → 断言当前是静默替换 |
| R-10 | 清单一次 `getAll` 取回全部含 `ArrayBuffer` 的记录并逐条建 objectURL；网格全量渲染；缩略图无懒加载 | `idbAssetHost.ts:89-125`；`AssetPanel.tsx:184,355-371`；`assetViews.tsx:76-84,158-166` | 事实（无分页/无懒加载）+ 性能数值未测 | 用既有 `asset-virtual.test.tsx` 的 500 项夹具扩到 2000 项量级，记录首屏 DOM 数与耗时（本包不测） |
| R-11 | `AssetPanel.isMissing` 生产未接线 → 面板不显示失效项，用户在插入前无法预知断图 | `AssetPanel.tsx:41-42,121`；`apps/canvas` 零传入 | 事实 | 仅需接线 + 测试；失效判定数据已在 `assetDiagnostics.ts` |
| R-12 | `MapView.onAssetDrop` 落点语义（icon/media/child/free + 预览浮层）已实现但产品未接线，实际走 `onAssetFiles`（无落点语义） | `MapView.tsx:274-280,1844-1846`；`dropSensing.ts:73-138`；`MindmapStage.tsx:1834` | 事实 | 接线后由 `mapview-drop-sensing.test.tsx:147-233` 同族用例承担 |
| R-13 | 自由画布无任何资产能力（无图库入口、无插入、无预览） | `packages/react/src/free-canvas/` 零 `asset` 命中；`FreeCanvasStage.tsx` 无 `AssetPanel` 渲染 | 事实 | 需产品决定是否在 P1 对齐；见 `asset-library.md` §7 |
| R-14 | 自由画布文档不进工作区与文件面板（`isWorkspaceDocName` 只认 `.md`） | `directoryTypes.ts:80-83`；`directoryHost.ts:235` | 事实 | 需产品决定文件面板是否管理两种文档；见 `file-management.md` §2.3 |
| R-15 | 资产解析未命中时回落 `baseUrl + id`（`baseUrl='/'` = **站点根**），与「工作区根」不一致；清单未就绪的首帧可能命中站点根同名文件或显示断图 | `workspaceAssetHost.ts:81-85`；`idbAssetHost.ts:127-131`；`MindmapStage.tsx:853-856` | 线索（语义确认；观感未实测） | 真浏览器：刷新后立即截图网格与画布，核对首帧是否出现错图/断图 |
| R-16 | objectURL 只在同名替换时 revoke，无卸载/断开工作区/关闭面板时的统一释放 | `idbAssetHost.ts:151-152`；`workspaceAssetHost.ts:103-104`；`assetHost.ts:93-94`；全仓 `revokeObjectURL` 仅此 3 处 | 事实 | 长会话内存曲线未测；设计给生命周期契约（见 `asset-library.md` §6） |
| R-17 | `DocLibrary` 只为最近 `SOURCE_KEEP=8` 条保留 `source`，更早条目仅元数据；这不是缺陷而是既有取舍，但直接影响「重新定位/恢复」能承诺什么 | `docLibrary.ts:21-25,315-319`；`fileTreeModel.ts:120` | 事实（既有设计选择） | 设计须显式承接，不得承诺「浏览器文档都能恢复内容」 |
| R-18 | 资产引用字符串与文档所在目录无关（相对工作区根），实际渲染优先走会话 objectURL。设计若按「相对文档目录」改写将破坏既有可携带性 | `directoryHost.ts:385,398-409`；`workspaceAssetHost.ts:63-68,103-105` | 事实 | 由 A5/X1 验收固定该口径 |

### 5.1 与本包无关但必须尊重的既有约束

| 约束 | 来源 | 本包处置 |
|---|---|---|
| `downloaded` ≠ 磁盘已保存 | `documentLifecycle.ts:22-38` | 沿用，不改语义 |
| 写盘事实与附属元数据警告分开 | `documentLifecycle.ts:28-31,120-130` | 沿用；新增文件/资产操作也按「主事实 / 附属记录」两分 |
| 内容 + 会话双归属匹配才清脏 | `useDocumentSaveSession.ts:243-262` | 沿用；改名/移动不得新开清脏通道 |
| IME 与隐藏草稿须正确提交 | `draftFlush.ts:54-113`；`useUnsavedTransition.ts:236-259` | 沿用；删除当前文档流程必须复用同一 flush |
| `flush` 的 `failed` 不作真值成功 | `documentLifecycle.ts:60-66`；`useUnsavedTransition.ts:378-391` | 沿用 |
| 离开决策单请求 + 每异步边界校验归属 | `useUnsavedTransition.ts:129-135,277,331,347` | 沿用；文件操作不得绕过 |
| 端口方法经箭头包装/ref 转发避免丢 this 与陈旧闭包 | `useDocumentLeaveRegistration.ts:18-28`；`useDocumentSaveSession.ts:109-116`；`workspaceAssetHost.ts:43-46` | 新接口同规 |
| 不把系统选择器替身当真实手势 | `docs/dispatch/2026-09-19-delivery-close-final-acceptance.md:52-54` | 验收区分自动化与人工 |

---

## 6. 与上一轮的衔接

- DELIVERY-CLOSE 已关闭 DF-R5（另存为隔离），其结论是「A、B 文件名相同、存储身份不同」，并明确接受当前替身范围（`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md:24-39`）。本包不得据此认为「路径身份」问题已全部解决：**同一路径换了句柄**（改名后重新取得）与**不同路径同名**（两工作区）这两种情形，不在该专项覆盖范围内。
- 保留限制：真实系统选择器手势、真实 OS 输入法、触控、跨浏览器、离线、跨平台像素金图仍未覆盖（同文件 `:54`）。本设计把这些列为人工验收项，不用自动化替身冒充。
- 后续顺序建议（同文件 `:63`）：先归档候选并明确提交边界；文件管理优先处理改名/移动/删除后的身份与保存行为；图库优先处理资产归属、引用、替换与持久化；便携打包在两者契约明确后推进。本包的设计与之一致。

---

## 6.1 本轮契约补正的指针（FILE-ASSETS-CONTRACT-CLOSE，2026-09-19）

本文件的**事实与锚点仍然有效**，但下列口径在本轮被补正或收窄，以 `../2026-09-19-file-assets-contract-close/contract-delta.md` 为准：

| 本文件位置 | 本轮补正 |
|---|---|
| R-01（改名/移动后目的地未更新） | 由 **CE-01** 承接，明确标注为**逻辑反例（未实跑）**，并给出正式复现条件；同时新增租约（CD-12/13）关闭「等待空闲→新保存进入」竞态 |
| R-06（「最近」语义混用） | 与 **UD-2** 对齐：单一「最近」按 `openedAt` 排序；`openedAt` 缺失时显示「未记录打开时间」，**不回填 mtime**（CE-13） |
| R-08（上传三态不可区分） | 三态定义改为「写入成功 / 仅会话 / 失败」并增加正交的**可携带性**（CD-08）；`persisted` 不再表示「换机器还在」 |
| R-09（同名静默覆盖） | 追加「`size`+`mtime` 不得作为同内容判定」（CD-07 / CE-03） |
| R-15（回落站点根） | 升级为**唯一解析规则**问题（CD-11 / CE-11 / CE-12）：区分 `no-scope` 与 `missing`；取消编造站点根 URL |
| R-13 / R-14（自由画布） | UD-1 只决定「首期不纳入工作区与文件面板」；自由画布能力对齐为**单列独立包**（CD-16） |

**本文件未新增实测证据；R-01…R-18 的证据等级不变。**

---

## 7. 本文件未做的事

- 未运行任何测试、门禁或浏览器脚本，未产出运行证据。
- 未对新设计做性能测量；R-10 的量化目标列为「待测」，不写成已达标数字。
- 未核实跨浏览器（Firefox/Safari）对 File System Access API、IndexedDB 持久化与 `createWritable` 的实际支持差异；能力降级表按「未验证」标注。
- 未盘点 `outputs/delivery-close-finish/20260919-04/candidate.json` 的 808 项明细；本包引用其作为起点边界，不重新复算。
