# FA1 深度外派任务书：文件保存闭环与 SVG 素材调用体系重构

> **本文件即开工令**。工作目录 = `<workspace>`。  
> 本任务书**自包含全部上下文与代码锚点**，执行 Agent 不需要读取任何外部对话历史。

---

## 你的角色

你是 `mindcanvas` 仓库的工程执行 Agent。本次任务是**核心使用体验（Dogfooding）脱困重构**——解决“保存像记事本一样反复弹覆盖确认”、“文件管理简陋低效”以及“SVG 素材被粗暴当成子节点、缺乏现代素材库 UI”的两大高频硬伤。

你的交付目标是：
1. **彻底消除记事本式覆盖弹窗**，打通文件句柄闭环与静默自动保存；
2. **重构素材库调用语义**，将“强插子节点”解耦为“节点图标 / 节点插图 / 独立分支”，并落地现代化网格素材中心。

---

## 背景（90 秒）

1. **保存体验硬伤根因**：
   - `packages/react/src/edit/save.ts:63` 在调用 `showSaveFilePicker()` 成功保存后，**丢弃了浏览器返回的 `FileSystemFileHandle`**。
   - `LocalDocHost.save()` 拿不到更新后的句柄，导致文档的 `doc.handle` 始终为 `undefined`。每次按 `Ctrl+S` 都重新唤起系统另存为窗口，触发系统级覆盖确认。
   - `localStorage` 的 `DocLibrary` 无法存储不可序列化的 Handle，导致跨会话恢复的文档全部丧失句柄。
   - `MindmapStage.tsx:384` 的静默自动保存因守卫 `!doc.handle` 彻底空转。
2. **SVG / 素材库硬伤根因**：
   - `SidePanels.tsx:90` 点击素材直接调用 `controller.addEntityChild()`，**把图标/插图强行塞成子节点**，破坏思维导图层级。
   - `AssetPanel.tsx` 是仅 230px 宽的单列 30px 高度文本列表，缩略图仅 32×22px，无网格、无分类、无搜索。
   - SVG 仅作为普通 `<image>` 渲染，缺失矢量自适应主题色（`currentColor`）与离线自包含（Data URL）能力。

---

## 必读材料与代码锚点（按序）

1. **保存与持久化链路**：
   - `packages/react/src/edit/save.ts`（`saveMarkdown`、`FsFileHandle`、`SaveResult`）
   - `packages/react/src/edit/document.ts`（`MindDoc`、`LocalDocHost`）
   - `packages/react/src/edit/docLibrary.ts`（`DocLibrary` 元数据索引）
   - `apps/canvas/src/hooks/useDocumentActions.ts`（`handleSave`、`handleSaveAs`、`applyDoc`）
   - `apps/canvas/src/MindmapStage.tsx:370-401`（`autoSaveTimer` 自动保存 effect）
2. **素材库与节点渲染链路**：
   - `packages/react/src/chrome/AssetPanel.tsx`（当前素材抽屉）
   - `packages/react/src/chrome/assetHost.ts` & `idbAssetHost.ts`（资产宿主与 IndexedDB 持久化）
   - `apps/canvas/src/SidePanels.tsx:82-111`（素材面板调用与插入逻辑）
   - `packages/react/src/render/NodeG.tsx:103-187`（节点内资产与 `<image>` 渲染）
   - `packages/kernel/src/protocol/types.ts`（`MindNode`、`EntityRef`、`Note`）

---

## 任务清单

### T1 · 消除覆盖确认：文件句柄闭环与无感保存流

**目标**：一次选择，终身静默落盘；自动保存恢复运作。

- [ ] **修改 `packages/react/src/edit/save.ts`**：
  - 扩展返回类型：`export type SaveOutcome = { result: 'fs' | 'download' | 'cancelled'; handle?: FsFileHandle };`
  - `saveMarkdown()` 在通过 `showSaveFilePicker` 写入成功后，**返回该 `handle`**。
- [ ] **修改 `packages/react/src/edit/document.ts`**：
  - `DocumentHost.save(doc: MindDoc)` 改为返回 `Promise<SaveOutcome>`。
  - `LocalDocHost.save` 成功后回传更新的 `handle`（已有 handle 写回成功则保留，新建唤起选择器成功则返回新 handle）。
- [ ] **更新 `apps/canvas/src/hooks/useDocumentActions.ts`**：
  - `handleSave` 与 `handleSaveAs` 接收 `outcome.handle`，并在 `setDoc` 中写回 `doc.handle` 与 `saved: true`。
  - 确保后续连续 `Ctrl+S` 直接走 `handle.createWritable()`，零弹窗。
- [ ] **激活自动保存与状态展示**：
  - `MindmapStage.tsx`：自动保存触发成功后同样更新 `doc.ts` 与 `controller.markSaved()`。
  - 在文档标题栏旁增加微状态指示：`● 未保存`（修改中） / `保存中...` / `✓ 已保存`。

---

### T2 · 跨会话 Handle 保持：IndexedDB 句柄存储

**目标**：刷新页面或从“最近文档”载入时，句柄不丢失。

- [ ] **在 `packages/react/src/edit/` 新增 `handleStore.ts`**：
  - 基于 IndexedDB（库名 `mindcanvas-handles`，对象仓库 `handles`），以 `doc.id` 或文件名为 key，存储 `FileSystemFileHandle` 原生对象（结构化克隆）。
  - 提供方法：
    - `setFileHandle(docId: string, handle: FsFileHandle): Promise<void>`
    - `getFileHandle(docId: string): Promise<FsFileHandle | null>`
    - `verifyPermission(handle: FsFileHandle, readWrite?: boolean): Promise<boolean>`
- [ ] **接线 `LocalDocHost` 与 `useDocumentActions`**：
  - `open()` 或首次保存成功后，调用 `setFileHandle(doc.id, handle)`。
  - 从 `recent()` 或 `DocLibrary` 切换文档时，尝试异步读取并绑定 `doc.handle`。如果权限处于 `prompt` 状态，在用户下一次产生交互（如点击保存）时调用 `requestPermission()`，无需重新选文件。

---

### T3 · 素材调用语义解耦：节点图标 vs 节点插图 vs 子分支

**目标**：彻底纠正“插入素材必成子节点”的反直觉逻辑。

- [ ] **内核与协议支持（加法兼容）**：
  - 检查 `Note`（`packages/kernel/src/protocol/types.ts`）：允许节点携带 `icon?: string`（记录素材 id 或 inline 标识）。
- [ ] **渲染层 `NodeG.tsx` 增强**：
  - 若节点配置了 `icon`：在节点文字左侧渲染 18×18px 的图标（支持与文字居中对齐）。
  - 若节点为媒体实体（`kind: 'img' | 'draw'`）：保持当前卡片插图形式（文字下方/上方），但明确属于**当前节点本体**，非强制子节点。
- [ ] **调用入口 `SidePanels.tsx` 重构**：
  - 选中节点点击图库项时，提供 3 种语义操作（或上下文菜单）：
    1. **设为节点图标（Set as Icon）**：更新当前节点 `note.icon`，文字前展示小图标；
    2. **嵌入节点插图（Embed Media）**：作为当前节点内部的多媒体卡片；
    3. **添加为子分支（Add Child Branch）**：原逻辑（`addEntityChild`）。
  - 拖拽（Drag & Drop）判定：
    - 拖到节点**文本区域** ➔ 提示“设为图标 / 嵌入插图”；
    - 拖到节点**连线右侧** ➔ 作为子节点添加；
    - 拖到**画布空白处** ➔ 生成独立自由节点。

---

### T4 · 素材中心 UI 重构：网格视图 + 搜索分类 + 现代上传

**目标**：将 230px 纯文本列表升级为高质感素材抽屉。

- [ ] **重构 `packages/react/src/chrome/AssetPanel.tsx`**：
  - **尺寸与布局**：宽度扩展至 360px，支持双模式切换：【网格视图 (Grid)】 / 【列表视图 (List)】。
  - **搜索框**：顶部常驻 `input`，实时过滤素材名称与类型。
  - **分类标签页（Tabs）**：
    - `⭐ 常用`
    - `🎨 内置矢量图标`（内置 20+ 个常用思维导图 SVG：如完成、警告、星标、优先级 1-5、负责人等）
    - `📁 本地上传`
  - **网格平铺（Grid View）**：
    - 图标类：48×48px 网格，居中高对比度矢量渲染，悬停浮显名称 Tooltip。
    - 图片类：80×60px 缩略卡片，保持宽高比。
  - **现代上传热区（Dropzone）**：
    - 底部提供虚线拖放热区，清晰文案：“拖拽 SVG / 图片到此处，或点击上传”。
    - 支持直接监听剪贴板 `Paste`（复制图片文件或 `<svg>...</svg>` 纯文本字符串均可直接入库）。

---

### T5 · SVG 矢量特性赋能：动态主题变色与自包含分发

**目标**：SVG 不再只是死板的位图 `<image>`，发挥矢量自适应优势。

- [ ] **动态主题适配（Adaptive Theme）**：
  - 对单色矢量 SVG，渲染时支持注入 `currentColor`，或根据节点彩虹主题/当前色板赋予一致的描边色（`stroke`）和填充色（`fill`）。
- [ ] **小型矢量图内联与自包含持久化**：
  - 对于 `< 15KB` 的 SVG 文件，上传时支持保存完整 SVG 文本或 Data URL（`data:image/svg+xml;utf8,...`）。
  - 导出或保存为 `.mm.md` 时，小图标内联存储，脱离本地浏览器 IndexedDB 也能在 Obsidian/VS Code 中无损显示。

---

## 硬约束（质量与工程纪律）

1. **测试基线零回归**：
   - 运行 `pnpm --filter @mindcanvas/kernel test` 与 `pnpm --filter @mindcanvas/react test`，全部测试必须全绿，已有用例不允许删除。
   - 为新功能补齐单测：
     - `packages/react/tests/save-handle.test.ts`（验证 handle 捕获与保存流式写回）
     - `packages/react/tests/asset-panel-grid.test.tsx`（验证网格视图与分类检索）
2. **代码风格与规范**：
   - 遵循工作区规范，禁止滥用 `any` 和 `as` 双重类型断言。
   - UI 样式严格复用 `CHROME` 主题令牌（`packages/react/src/theme/tokens.ts`），保证深色模式与毛玻璃质感统一。
3. **分步提交（Git Commit）**：
   - 每完成一个任务阶段进行一次独立提交：
     - `FA1: T1 - save handle loop closure and auto-save fix`
     - `FA1: T2 - indexeddb handle store for cross-session persistence`
     - `FA1: T3 - decouple asset insertion semantics (icon/media/child)`
     - `FA1: T4 - modern asset hub with grid view, tabs and search`
     - `FA1: T5 - svg adaptive theming and inline data url support`

---

## 验收门禁（Checklist）

- [ ] 连续按 `Ctrl+S` 时，第二次起**绝不弹出**系统的文件选择器和覆盖确认窗口。
- [ ] 修改画布节点后，静默 300ms 自动落盘生效，顶部状态指示平滑流转。
- [ ] 刷新浏览器并重新打开最近文档后，无需重新选路径，直接具备写回权限（或一次手势唤起即可）。
- [ ] 打开图库面板，呈现现代网格视图与搜索栏，可清晰预览 SVG 图形。
- [ ] 点击素材时，可自由选择“设为当前节点图标”或“嵌入节点”，不再无差别新建子节点。
- [ ] 节点左侧能正确渲染选中的 SVG 图标，且随主题色板协调变色。
- [ ] 全量构建与测试全绿（`pnpm build` + `pnpm test` 通过）。
- [ ] 产出交付报告：`docs/dispatch/FA1-report.md`。

---

## 交付报告要求

在任务完成后，创建 `docs/dispatch/FA1-report.md`，内容包含：
1. 门禁逐项打勾与验证截图/数据；
2. 保存机制重构前后的逻辑对比；
3. 素材库新旧 UI 与交互对比；
4. 遗留项或后续扩展建议（如本地目录 `DirectoryPicker` 深度集成）。
