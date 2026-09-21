# FA2 深度外派任务书：本地目录工作区（DirectoryPicker）与文件管理器 UI/UX 现代重构

> **本文件即开工令**。工作目录 = `<workspace>`。  
> 本任务书**自包含全部上下文与代码锚点**，执行 Agent 不需要读取任何外部历史对话。

---

## 你的角色

你是 `mindcanvas` 仓库的工程执行 Agent。本次任务是攻克文件管理体系的**最后也是最核心的一块硬骨头**——将当前简陋的 420px 虚拟路径弹窗，重构成**类 Obsidian / VS Code 的真实本地目录工作区与现代文件工作台**，并补齐上期遗留的画布拖拽落点智能感知。

---

## 背景与痛点（60 秒）

1. **虚假目录与 8 篇容量截断魔咒**：
   - 现有的 `DocLibrary` 是基于 `localStorage` 的纯元数据索引。受限于容量，代码硬编码了 `SOURCE_KEEP = 8`，超过 8 篇的旧文档源码会被直接剥掉，打开时退化成“重新选文件”。
   - 现有的目录树全是假字符串拼接（`folder: "工作/项目A"`），改目录竟然靠 `movingId` 弹出一个 `<input>` 手动敲字符串（`FileManager.tsx:198`）。
2. **缺乏真实磁盘工作区（DirectoryPicker）**：
   - 全仓目前只有文件句柄（`FileSystemFileHandle`），无任何目录句柄（`FileSystemDirectoryHandle`）。无法像 Obsidian 那样直接“打开一个文件夹”作为工作区，导致大图素材无法就地落盘到同级 `./assets/`。
3. **画布拖拽落点感知遗留**：
   - 上期实现了面板内选择「节点图标 / 节点插图 / 子分支」，但直接从外部或图库拖拽进画布时，仍未做区域智能碰撞判定。

---

## 必读材料与代码锚点（按序）

1. `docs/2026-09-03-文件管理-深度调研.md`（旧版文件库容量缺陷与迁移调研）
2. `docs/2026-09-05-project-graph-调研与减法设计.md:292`（目录句柄缺失记录）
3. `apps/canvas/src/FileManager.tsx` & `FileManagerModal.tsx`（当前需彻底重构的 420px 弹窗）
4. `packages/react/src/edit/docLibrary.ts` & `document.ts`（既有虚拟库接口）
5. `packages/react/src/edit/handleStore.ts`（上期建立的 IndexedDB 句柄缓存，可复用于存储 DirectoryHandle）
6. `packages/react/src/render/MapView.tsx:922-942`（画布 `onDrop` 与拖拽感知入口）

---

## 任务清单

### T1 · 本地目录工作区引擎（DirectoryWorkspaceHost）

**目标**：摆脱 localStorage 与 8 篇容量限制，支持一次性打开本地真实文件夹。

- [ ] **在 `packages/react/src/edit/` 新增 `directoryHost.ts`**：
  - 调用 `window.showDirectoryPicker()` 授权本地工作目录；
  - 递归扫描目录下的所有 `*.mm.md` 与 `*.md`，构建真实的物理目录树（`WorkspaceFile = { name, path, handle }`）；
  - 读写直接走 `FileSystemDirectoryHandle` / `FileSystemFileHandle`，天然解决多文档持久化与资产同步。
- [ ] **复用 `handleStore.ts` 持久化目录句柄**：
  - 将选中的目录句柄存入 IndexedDB（key: `workspace-root`）；
  - 刷新页面后，自动恢复该工作区目录，免去每次重复选择目录的繁琐。
- [ ] **平滑降级（双模式兼容）**：
  - 若浏览器不支持目录选择器或用户仅打开单文件，平滑回落至既有的 `LocalDocHost`（上一期构建的单文件句柄闭环已稳定，两者互为补充）。

---

### T2 · 文件工作台 UI/UX 彻底重构（淘汰 420px 敲路径弹窗）

**目标**：从“居中玩具弹窗”升级为“专业级文档抽屉/侧边工作台”。

- [ ] **重构 `apps/canvas/src/FileManager.tsx`**：
  - **形态升级**：提供左侧滑出式现代抽屉（Drawer，宽 320px）或沉浸式宽幅模态工作台（宽 680px）；
  - **常驻快速检索**：顶部提供文档全局搜索框（按文件名、最后修改时间实时过滤）；
  - **真实树状交互（Tree View）**：
    - 文件夹支持展开/折叠（记忆展开状态）；
    - 文件夹/文件右键菜单：`[新建导图]`, `[新建文件夹]`, `[重命名]`, `[删除 (带确认)]`；
    - 废除敲字符串改目录的逻辑，支持 **拖拽文件至文件夹图标（Drag & Drop）** 即可移动文件。
  - **面包屑与状态指示**：
    - 展示工作区物理路径（如 `📁 MyNotes > 📁 研发项目 > 架构.mm.md`）；
    - 区分标识：`🟢 本地磁盘已同步` / `📝 未保存`。

---

### T3 · 画布素材与文件拖拽智能落点感应（Smart Drop Sensing）

**目标**：拖拽素材到画布时，无需手动在面板切换按钮，按释放位置自动判定。

- [ ] **增强 `MapView.tsx` 的 Drop 碰撞判定**：
  - 当外部图片、SVG 或素材面板中的项被拖入画布时，根据光标坐标 `worldPoint` 计算碰撞目标：
    1. **落在节点文本盒中心（Text Core）**：触发高亮虚线光晕 ➔ 判定为 `设为节点图标 (note.icon)`；
    2. **落在节点顶部/底部边缘（Media Area）**：触发上下插入提示线 ➔ 判定为 `嵌入卡片插图 (note.media)`；
    3. **落在节点右侧连接桩（Branch Out）**：触发连接指示符 ➔ 判定为 `添加子分支 (addEntityChild)`；
    4. **落在空白画布（Canvas Void）**：判定为 `新建自由图元节点`。
- [ ] **视觉反馈微动效**：在 `MapView` 的浮层中提供半透明投放目标示意（Drop Zone Highlight），让用户在松开鼠标前即可预知投放结果。

---

### T4 · 本地相对路径资产真落盘（Disk Asset Persistence）

**目标**：彻底解决导出的 Markdown 文件脱机后图片断链的问题。

- [ ] **打通目录级资产写入**：
  - 在工作区模式下，用户上传的大尺寸 SVG 或位图（>15KB）不再仅存浏览器的 IndexedDB；
  - 自动在工作区根目录下创建或查找 `./assets/` 真实物理文件夹，写入对应文件；
  - 思维导图中统一生成标准相对路径（如 `@img:assets/diagram.png`），使整个工作区文件夹拷贝到任何机器、用 Obsidian / VS Code 打开时均可完美离线浏览。

---

## 硬约束（工程与质量纪律）

1. **测试基线零回归**：
   - 运行全量单元测试（`kernel` 407+ / `react` 799+ / `canvas` 33+），确保已有测试全绿。
   - 新增测试：
     - `packages/react/tests/directory-host.test.ts`（工作区树遍历、句柄存储与增删改查）；
     - `apps/canvas/tests/file-manager-tree.test.tsx`（拖拽移动、新建文件夹、搜索过滤）；
     - `packages/react/tests/mapview-drop-sensing.test.tsx`（区域碰撞判定逻辑）。
2. **规范与代码约束**：
   - 严格复用 `CHROME` 设计令牌，禁止自造生硬的 CSS 样式；
   - 零 `any` / 零 `asCast` 债务预算，严格遵守 Biome Lint 规则。
3. **分步提交（Git Commit）**：
   - `FA2: T1 - directory workspace host with showDirectoryPicker`
   - `FA2: T2 - modern file explorer drawer with drag-drop tree`
   - `FA2: T3 - canvas drop zone spatial sensing for assets`
   - `FA2: T4 - true disk assets persistence in workspace/assets`

---

## 验收门禁（Checklist）

- [ ] 可通过「打开本地文件夹」选择一个包含多个 `.mm.md` 的磁盘目录，左侧能实时列出完整真实文件树。
- [ ] 彻底移除旧版“输入路径字符串移动文件”的交互，支持将文件拖拽入文件夹完成归位。
- [ ] 可以在树上直接右键新建文件夹、新建文档、原地重命名与删除。
- [ ] 拖拽素材到节点文本上方时能自动设为图标，拖到边缘能自动长出子分支，且有明确的视觉投放反馈。
- [ ] 工作区模式下上传的大图会真实写入磁盘上的 `./assets/` 文件夹，本地资源管理器可见。
- [ ] 全量类型检查 `tsc -b`、Lint 与测试套件全绿。
- [ ] 产出交付报告：`docs/dispatch/FA2-report.md`。
