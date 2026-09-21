# FA2 交付报告：本地目录工作区与文件工作台现代重构

> 工作目录 `<workspace>`，分支 `main`。
> 提交序列（`git log --oneline -5`）：
> ```
> 308e914 FA2: T4 - true disk assets persistence in workspace/assets
> 7cce44a FA2: T3 - canvas drop zone spatial sensing for assets
> 249d4b5 FA2: T2 - modern file explorer drawer with drag-drop tree
> fbc02ec FA2: T1 - directory workspace host with showDirectoryPicker
> ```

---

## 1. 验收门禁逐项

| # | 门禁 | 结论 | 验证方式 |
|---|------|------|----------|
| 1 | 打开含多个 `.mm.md` 的磁盘目录，左侧实时列出真实文件树 | ✅ | `tests/directory-host.test.ts`：递归收录、跳过 `node_modules/.git`、目录在前名称排序、中文按拼音；「空目录保留」用例覆盖可在空目录里新建 |
| 2 | 彻底移除「输入路径字符串移动文件」，改为拖拽归位 | ✅ | `apps/canvas/tests/file-manager-tree.test.tsx`：拖文件到目录行 → `moveFile(文件, 目标目录)` 且拖拽经过时 `data-drop-active` 高亮。旧 `movingId` 输入框已从 `FileManager.tsx` 完全删除 |
| 3 | 树上右键新建文件夹 / 新建文档 / 原地重命名 / 删除 | ✅ | 同上：四个菜单项齐全；新建走 `createDir`/`createFile`（真实落盘）；重命名内联输入失焦提交；删除带 `window.confirm`（取消→不删，确认→删） |
| 4 | 拖素材到节点文本上方自动设为图标、拖到边缘长子分支，有投放反馈 | ✅ | `tests/mapview-drop-sensing.test.tsx` 20 条：纯几何五个区域 + MapView 集成（dragover 出预览浮层、drop 带语义回调、drop 后浮层消失） |
| 5 | 工作区模式下大图真实写入磁盘 `./assets/` | ✅ | `tests/directory-host.test.ts`（`writeAsset` 建 `assets/` 并落盘、返回相对路径、文本/二进制皆可）+ `tests/workspace-asset-host.test.ts`（分诊规则、相对路径 id、刷新后重建 objectURL） |
| 6 | `tsc -b` / Lint / 测试套件全绿 | ✅ | kernel 52 文件 407 测试、react 90 文件 862 测试、canvas 5 文件 51 测试；三包 `tsc -b` 与 `npm run build` 均 0 错误；biome lint 0 error；depcruise 无违规 |
| 7 | 产出本报告 | ✅ | 本文件 |

**诚实披露**：第 1、5 条依赖 `showDirectoryPicker`，无头浏览器与 jsdom 都没有这个 API，因此**未做真实磁盘点击复现**。结论来自与真实句柄接口面一致的 Fake FS（异步迭代 `values()` / `getFileHandle` / `getDirectoryHandle` / `removeEntry` / `createWritable`）上的断言 —— 测的是本模块的遍历、排序、去重命名、先写后删、资产落盘逻辑，不含浏览器 FS 实现本身。建议本地 `pnpm dev` 后开一个文件夹手工复核。

---

## 2. T1 · 本地目录工作区引擎

新增 `packages/react/src/edit/directoryHost.ts` + `directoryTypes.ts`。

| 能力 | 实现 |
|------|------|
| 授权 | `window.showDirectoryPicker({ mode: 'readwrite' })`；类型声明进 `declare global`，零 `as` 断言 |
| 扫描 | 递归遍历，只收 `.mm.md` / `.md`；跳过 `node_modules` / `.git` / `.obsidian` / `dist` 等；**深度上限 8、文件上限 2000** 防超深目录拖死浏览器 |
| CRUD | `createFile` / `createDir` / `renameFile` / `removeFile` / `removeDir` / `moveFile` |
| 持久化 | 目录句柄存 IndexedDB（key `workspace-root`），刷新后 `restore()` 自动恢复 |
| 降级 | 不支持或用户取消 → `pick()` 返回 `null`，上层回落到 `LocalDocHost` 单文件闭环 |

两个**在写测试时才暴露、已修掉**的真实缺陷：

1. **`.mm.md` 被当成 `.md` 拆分** —— 用 `lastIndexOf('.')` 做重名去重时，`架构.mm.md` 会生成 `架构.mm 2.md`：既丢了 `.mm.md` 语义（应用认不出这是导图），又长得莫名其妙。改为 `splitExt()` 先把 `.mm.md` 当一个整体扩展名，得到 `架构 2.mm.md`。
2. **目录句柄的持久化测试** —— `FileSystemDirectoryHandle` 是原生对象可结构化克隆，但 JS 替身的**方法不能克隆**（克隆回来 `getDirectoryHandle` 变 undefined，窄化谓词直接判为"不是目录句柄"）。与 FA1 同类问题，改用按引用存储的内存 IDB 替身。

`rename` 与 `moveFile` 都是「写新 + 删旧」（FS Access API 没有 rename/move）：**先写后删**，最坏情况留下副本，不会同时丢失两份。

---

## 3. T2 · 文件工作台 UI/UX

`FileManager.tsx` 完全重写（配合新的 `FileManagerModal.tsx` 与纯逻辑层 `fileTreeModel.ts`）：

| 维度 | 旧 | 新 |
|------|----|----|
| 形态 | 420px 居中玩具弹窗 | `drawer` 320px 左侧抽屉 / `wide` 680px 宽幅模态（`variant` 切换） |
| 搜索 | 无 | 顶部常驻，按文件名 + 路径实时过滤，**保留祖先目录链**（不把树拍平） |
| 目录树 | 假字符串拼接（`工作/项目A`） | 真实磁盘树；展开折叠状态记忆 |
| 移动文件 | 弹出 `<input>` 敲路径字符串 | **拖拽文件到 📁 文件夹**即归位（`canDropInto` 校验：不能拖进自己的后代） |
| 右键菜单 | 无（只有三个小按钮） | 新建导图 / 新建文件夹 / 重命名 / 删除（带确认） |
| 面包屑 | 无 | 逐级展示物理路径 `📁 MyNotes › 研发 › 架构.mm.md` |
| 状态 | 只有「N 个需重选」 | `🟢 工作区已连接` / `📝 未保存` / `⚠︎ 未连接工作区` |
| 数据源 | 仅 localStorage（`SOURCE_KEEP=8`） | 工作区真实磁盘；未连接时降级 DocLibrary（同一套树，落点换 localStorage） |

新增 `fileTreeModel.ts` 把「两种数据源 → 同一种 `TreeNode`」抽成纯函数（`treeFromWorkspace` / `treeFromLibrary` / `filterTree` / `canDropInto`），UI 只认 `TreeNode`，树构建与过滤因此可脱离浏览器直接测。

---

## 4. T3 · 画布拖拽落点智能感知

新增 `packages/react/src/render/dropSensing.ts`（纯几何，零 DOM 依赖）：

```
┌───────────────────────────────┐
│  MEDIA（上边缘带）            │  → note.media  嵌入卡片插图
├───────────────────────────────┤
│      TEXT CORE（中心）        │  → note.icon   设为节点图标
├───────────────────────────────┤
│  MEDIA（下边缘带）            │  → note.media
└───────────────────────────────┘
                                ┆
                           BRANCH（右侧桩）  → addEntityChild 添加子分支
                           空白处            → 新建自由节点
```

- 判定顺序**先上下带、后右侧桩**：若先判右侧桩，右上角那一小块会被"子分支"吃掉，而用户从上往下拖时视觉上明明细长一条是上边缘。
- MapView `dragover` 期间实时预览（半透明虚线浮层 + 图标 + 中文提示），`drop` 时把语义回调给上层；未传 `onAssetDrop` 的老调用方**行为不变**（仍走 `onAssetFiles`）。

**一个只在写测试时才发现的比例 bug**：最小节点只有 34px 高，若上下各留固定 18px 插图带，两条带直接吃掉整个盒子 —— 文本核心宽度归零，「设为图标」永远命中不到。改为 `min(18, 高×30%)`，矮盒子自动收窄边缘带。

---

## 5. T4 · 资产真落盘到 `./assets/`

新增 `packages/react/src/chrome/workspaceAssetHost.ts`，按体积分诊：

| 资产 | 去向 | 理由 |
|------|------|------|
| 小 SVG（≤15KB） | 保留内联源码 → data URL 写进 `note.icon` | 自包含，单文件拷走也能显示（FA1-T5 能力不回退） |
| 位图 / 大 SVG（>15KB） | 写进工作区 `./assets/`，id = 相对路径 `assets/diagram.png` | 整个文件夹拷到任何机器、用 Obsidian/VS Code 打开都能离线浏览 |

- 导图里生成的引用是**相对路径**（`@img:assets/diagram.png`），不是 `blob:`、不是绝对路径。
- 刷新后 `listAssets()` 从磁盘重建 objectURL，缩略图不裂。
- 未挂载工作区时**完全退回** IndexedDB 宿主，行为与之前一致。

**一个只在写测试时才发现的顺序 bug**：`cacheInline()` 原本是 fire-and-forget（`void`），调用方紧接着读 `item.svg` 一定是 `undefined` —— 面板缩略图会空。改为 `await`。

---

## 6. 新增测试清单

| 文件 | 用例数 | 锁死什么 |
|------|--------|----------|
| `packages/react/tests/directory-host.test.ts` | 32 | 能力探测/降级、递归扫描与噪声跳过、深度上限、CRUD、移动、资产落盘、IDB 恢复 |
| `packages/react/tests/mapview-drop-sensing.test.tsx` | 20 | 五个区域边界值、重叠取顶层、最小节点仍有文本核心、MapView 集成与预览浮层 |
| `packages/react/tests/workspace-asset-host.test.ts` | 11 | 落盘分诊、相对路径 id、刷新后重建 objectURL、未挂载时降级 |
| `apps/canvas/tests/file-manager-tree.test.tsx` | 18 | 拖拽归位、拖拽高亮、右键四类操作、删除确认、搜索保留层级、面包屑与状态 |

既有用例一律未删除、未降级。

---

## 7. 遗留项与后续建议

1. **浏览器端人工复核未做**（`showDirectoryPicker` 无头不支持）。建议 `pnpm dev` 后确认：① 打开文件夹能列出真实树；② 拖文件进文件夹能移动；③ 上传大图后资源管理器里 `./assets/` 有文件；④ 拖素材到节点不同区域有不同反馈。
2. **`FileManager` 的 `workspace` 用结构化类型 `WorkspaceLike`** 而非具体类 —— 这是为了可测性（能注入替身）。若后续确认只有 `DirectoryWorkspaceHost` 一家实现，可收紧为具体类型。
3. **工作区文档与 DocLibrary 尚未双向同步**：工作区模式下打开的文档不写 localStorage 索引（磁盘即事实源），反之亦然。若要「最近打开」跨两种模式统一，需要补一层合并。
4. **目录树未做增量刷新**：目前增删改后整体重扫（工作区文件数上限 2000，量级可控）。真实大仓库建议接 `FileSystemObserver`（Chromium 实验特性）或按目录懒加载。
5. **MapView.tsx 的 T3 提交里夹带了仓库先前未提交的 G6′ 改动**（垂直连线共享梁 / 声明方向覆盖几何判据）。原因：这两处改动与 FA2 位于同一文件，且 HEAD 版 MapView 与当前未提交的 `sceneBuilder` 不兼容（单独还原后编译不过），为保证提交可编译只能一并纳入。已在提交信息中注明。

---

## 8. 门禁复现命令

```bash
# 类型检查（三包）
(cd packages/kernel && ./node_modules/.bin/tsc -b tsconfig.json)
(cd packages/react  && ./node_modules/.bin/tsc -b tsconfig.json)
(cd apps/canvas     && ./node_modules/.bin/tsc -b tsconfig.json)

# 测试
(cd packages/kernel && ./node_modules/.bin/vitest run)   # 52 files / 407 tests
(cd packages/react  && ./node_modules/.bin/vitest run)   # 90 files / 862 tests
(cd apps/canvas     && ./node_modules/.bin/vitest run)   #  5 files /  51 tests

# 架构守护 + lint + 构建
node node_modules/@biomejs/biome/bin/biome lint packages apps --max-diagnostics=300
./node_modules/.bin/depcruise packages apps --config .dependency-cruiser.js
(cd packages/kernel && npm run build) && (cd packages/react && npm run build) && (cd apps/canvas && npm run build)
```

> 环境提示：Windows 沙箱下 vitest 跑完全部用例后进程可能不自行退出（结果已打印完），需 `timeout` 包裹；`npx vitest` 会卡住，须用各包本地 `./node_modules/.bin/vitest`。
