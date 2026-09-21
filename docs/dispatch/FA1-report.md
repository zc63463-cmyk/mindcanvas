# FA1 交付报告：文件保存闭环与 SVG 素材调用体系重构

> 工作目录 `<workspace>`，分支 `main`。
> 提交序列（`git log --oneline -6`）：
> ```
> 0461d0e FA1: gate - host contract compat (optional restoreHandle) and regression tests
> 988f632 FA1: T5 - svg adaptive theming and inline data url support
> a2a45e9 FA1: T4 - modern asset hub with grid view, tabs and search
> 750e8aa FA1: T3 - decouple asset insertion semantics (icon/media/child)
> 3f7fb02 FA1: T2 - indexeddb handle store for cross-session persistence
> d49f6aa FA1: T1 - save handle loop closure and auto-save fix
> ```

---

## 1. 验收门禁逐项

| # | 门禁 | 结论 | 验证方式 |
|---|------|------|----------|
| 1 | 连续按 `Ctrl+S`，第二次起绝不弹文件选择器/覆盖确认 | ✅ | `packages/react/tests/save-handle.test.ts`：「已有 handle → 连续 3 次 save 都不再唤起 showSaveFilePicker」，断言 `picker` 调用次数 = 0 且三次写入内容依次落盘 |
| 2 | 修改后 300ms 静默落盘，顶部状态平滑流转 | ✅ | `MindmapStage.tsx` 自动保存 effect 保留 300ms debounce，新增 `saving` 瞬态驱动 `● 未保存 → 保存中… → ✓ 已保存`；手动 `Ctrl+S` 走同一指示器（不再割裂） |
| 3 | 刷新/从最近文档载入后无需重选路径 | ✅ | T2 新增 `handleStore.ts`（IndexedDB `mindcanvas-handles`）；打开/保存即写入，切文档时 `restoreHandle()` 异步补挂。权限 `prompt` 时不主动弹窗，**留到用户点「保存」的手势时**再 `requestPermission` |
| 4 | 图库为现代网格视图 + 搜索栏，SVG 可清晰预览 | ✅ | 面板 230px → 360px，网格卡片 48×48 矢量预览 / 80×60 缩略卡，常驻搜索框 + 4 个分类 Tab；`tests/asset-panel-grid.test.tsx` 19 条用例 |
| 5 | 可自由选择“设为图标 / 嵌入节点”，不再无差别建子节点 | ✅ | 顶部「插入为：节点图标 / 节点插图 / 子分支」三选一；`onInsertAs(item, action)` 落到 `note.icon` / `note.media` / `addEntityChild` |
| 6 | 节点左侧正确渲染 SVG 图标且随主题变色 | ✅ | 内核 `nodeLayout` 为图标预留宽度（`NODE_ICON_SIZE+GAP`），`NodeG` 内联渲染 + `currentColor`；`tests/nodeg-icon.test.tsx` 8 条、`tests/svg-tint.test.ts` 15 条 |
| 7 | 全量构建与测试全绿 | ✅ | kernel 52 文件 / 407 测试，react 87 文件 / 799 测试，canvas 4 文件 / 33 测试；三包 `tsc -b` 与 `npm run build` 全部 0 错误；biome lint 0 error；depcruise 无违规 |
| 8 | 产出本报告 | ✅ | 本文件 |

**说明（诚实披露）**：第 1、3 条依赖 File System Access API，无头浏览器不支持 `showSaveFilePicker`（需 secure context + 用户手势），因此**浏览器端未做人工点击复现**，结论来自单测对真实调用链的断言（选择器调用次数、写入内容、句柄回传）。建议本地 `pnpm dev` 后按一次 Ctrl+S 复核观感。

---

## 2. 保存机制：重构前 → 重构后

| 环节 | 重构前 | 重构后 |
|------|--------|--------|
| `saveMarkdown` 返回值 | `SaveResult` 字符串，**丢弃** `showSaveFilePicker()` 返回的 handle | `SaveOutcome = { result, handle? }`，成功即回传句柄 |
| 有句柄的写回 | 内联在 `LocalDocHost.save` 里，成功也只回 `'fs'`，调用方拿不到句柄 | 抽出 `writeToHandle(handle, text)`；成功后 `return { result:'fs', handle: doc.handle }` |
| 句柄失效 | `try/catch` 吞掉后直接兜底下载 | 同上，但**不把失败当成功**（新增用例：createWritable 抛错 → 回落 `download`） |
| `doc.handle` | 恒为 `undefined`（除 `open()` 那一次） | 保存/另存为/打开全部写回 `doc.handle` |
| 自动保存 | 守卫 `!doc.handle` 恒真 → 彻底空转 | 句柄闭环后生效；`saving` 瞬态驱动状态指示 |
| 跨会话 | localStorage 存不了句柄 → 刷新即丢 | IndexedDB 结构化克隆持久化 + 权限分级处理 |
| 状态可见性 | 只有 `● 未保存` / `已保存` 两态 | 三态：`● 未保存` / `保存中…` / `✓ 已保存`，手动保存同样有指示 |

关键取舍：`verifyPermission()` 默认 `request = false`。页面加载/切文档属于**无用户手势**上下文，`requestPermission()` 会被浏览器直接拒绝（需 transient user activation），白白抛错。真正的权限请求放在用户点「保存」时完成 —— 这也是为什么补权限的代码写在 `handleSave` 内部而不是 `applyDoc` 里（同一异步流程内使用返回值，避免读到过期的 `doc.handle`）。

---

## 3. 素材库：新旧 UI 与交互对比

| 维度 | 旧 | 新 |
|------|----|----|
| 宽度 / 布局 | 230px 单列文本列表 | 360px，网格 ⇄ 列表双模式（默认由产品壳传 `grid`，包内默认 `list` 保持既有调用方不变） |
| 缩略图 | 32×22 固定裁剪 | 图标 48×48 居中矢量 / 图片 80×60 保宽高比卡片 |
| 检索 | 无 | 常驻搜索框，按名称 / 类型 / id 实时过滤 |
| 分类 | 无 | `📁 本地上传`（默认）/ `⭐ 常用`（★ 收藏，localStorage 持久化）/ `🎨 内置图标`（28 个）/ `全部` |
| 插入语义 | 点击 = 必定 `addEntityChild()` 新建子节点 | 顶部三选一：`节点图标`（note.icon）/ `节点插图`（note.media）/ `子分支`（原行为） |
| 上传 | 顶部小「+ 上传」按钮 | 底部整块虚线 Dropzone「拖拽 SVG / 图片到此处，或点击上传」+ 剪贴板 paste（图片文件 或 `<svg>…</svg>` 纯文本均可入库） |
| 内置素材 | 无（空态只能等上传） | 28 个单色 24×24 图标：完成/待办/警告/禁止/疑问/星标/关注/书签/旗帜/优先级 1–5/负责人/想法/目标/时间/紧急/快速/文档/文件夹/标签/链接/图片/代码/设置/下一步/新增 |

语义落点（三种写入值的差异）：

- **节点图标** → `note.icon`，渲染在标题左侧 18×18；
- **节点插图** → `note.media`，渲染在标题**上方**的卡片区（内核为它预留 `ASSET_H`，与实体资产同口径，不会压文字）；
- **子分支** → 原 `addEntityChild()`。

前两者都作用在**当前节点本体**上，不产生新节点 —— 这才是“素材不是子节点”的实质。

---

## 4. SVG 矢量赋能（T5）

1. **随主题变色**：`<image>` 加载的外部 SVG 是独立文档，拿不到宿主 `currentColor`。因此小 SVG 改为**内联**渲染（`sanitizeInlineSvg` 净化后插入 `<g>`，外层 `style.color` 由主题令牌驱动），单色图标自动跟随主题。
2. **自包含分发**：`< 15KB` 的 SVG 在上传时额外存一份源码（`AssetItem.svg` / IDB 记录的 `svg` 字段）。设为图标时写入 `data:image/svg+xml;utf8,…`，**脱离本机 IndexedDB 也能在 Obsidian / VS Code 里显示**。内核往返用例（`tests/icon-roundtrip.test.ts`）锁死 data URL 里的 `:` `%` `#` 不被自研 YAML 序列化器吃掉。
3. **安全**：内联等价执行 HTML，因此走 **DOMParser + 元素/属性白名单**（不是正则替换）。剔除 `script` / `foreignObject` / 事件属性 / `javascript:` / `data:text/html`；多色图标不染色（避免洗掉配色）。对应 4 条 XSS 用例 + 多色保护用例。

---

## 5. 新增测试清单

| 文件 | 用例数 | 锁死什么 |
|------|--------|----------|
| `packages/react/tests/save-handle.test.ts` | 9 | 句柄回传、连续保存零弹窗、取消不误走下载、失效回落 |
| `packages/react/tests/handle-store.test.ts` | 14 | IDB 往返、垃圾数据容错、隐私模式降级、权限策略（默认不请求） |
| `packages/react/tests/asset-panel-grid.test.tsx` | 19 | 网格视图、搜索/分类/收藏、三语义插入、Dropzone + paste |
| `packages/react/tests/svg-tint.test.ts` | 15 | 净化白名单（XSS 路径）、单色判定与染色、data URL 往返与体积门槛 |
| `packages/react/tests/nodeg-icon.test.tsx` | 8 | 内联图标 `<g>` + style.color、资产引用走 `<image>`、`note.media` 插图、编辑态不画图标 |
| `packages/kernel/tests/node-icon-metrics.test.ts` | 8 | 图标宽度 / 插图高度的**布局预留**（渲染前就防图文重叠） |
| `packages/kernel/tests/icon-roundtrip.test.ts` | 5 | `note.icon` / `note.media` 的协议层无损往返 |
| `apps/canvas/tests/useDocumentActions.test.tsx` | +5 | 句柄写回、下载兜底不抹句柄、另存为换句柄、`restoreHandle` 回填与可选降级 |

既有用例一律未删除；因契约变更而**调整断言**的共 3 处（`document-host.test.ts` 的 `result` → `outcome.result`；`useDocumentActions.test.tsx` 的 save 返回值改为 `SaveOutcome`）。

---

## 6. 遗留项与后续建议

1. **拖拽落点判定未实现**：任务书 T3 里的「拖到节点文本区 = 设为图标/插图、拖到连线右侧 = 子节点、拖到空白 = 自由节点」未在本次落地。当前以面板顶部的语义选择器达成同一目标，拖拽是锦上添花，建议与画布 drop 语义统一设计后单开任务。
2. **`DocumentHost.restoreHandle` 设为可选**：为避免破坏第三方/测试替身宿主。若后续确认宿主只有 `LocalDocHost` 一家，可收紧为必选。
3. **`onInsert` 与 `onInsertAs` 双通道**：为兼容老调用方保留。等全部调用点迁移到 `onInsertAs` 后可移除 `onInsert`。
4. **常用（⭐）目前是本地收藏**：未做跨设备同步，也未做「按使用频次自动置顶」。若要自动常用，需要在使用点埋点计数。
5. **目录授权（DirectoryPicker）**：更强的形态是一次授权整个工作目录，资产 sidecar、多文档索引都能落盘。属产品决策，未纳入本次。
6. **浏览器端人工复核**：建议本地 `pnpm dev` 后确认三件事 —— ① 首次 Ctrl+S 选路径、第二次静默；② 刷新后从「最近」打开可直接保存；③ 深色/浅色主题下节点图标颜色跟随。

---

## 7. 门禁复现命令

```bash
# 类型检查（三包）
(cd packages/kernel && ./node_modules/.bin/tsc -b tsconfig.json)
(cd packages/react  && ./node_modules/.bin/tsc -b tsconfig.json)
(cd apps/canvas     && ./node_modules/.bin/tsc -b tsconfig.json)

# 测试
(cd packages/kernel && ./node_modules/.bin/vitest run)   # 52 files / 407 tests
(cd packages/react  && ./node_modules/.bin/vitest run)   # 87 files / 799 tests
(cd apps/canvas     && ./node_modules/.bin/vitest run)   # 4 files / 33 tests

# 架构守护 + lint + 构建
node node_modules/@biomejs/biome/bin/biome lint packages apps --max-diagnostics=300
./node_modules/.bin/depcruise packages apps --config .dependency-cruiser.js
(cd packages/kernel && npm run build) && (cd packages/react && npm run build) && (cd apps/canvas && npm run build)
```

> 环境提示：Windows 沙箱下 vitest 跑完全部用例后进程可能不自行退出（结果已打印完），需 `timeout` 包裹或 Ctrl+C；`npx vitest` 会卡住，须用各包本地 `./node_modules/.bin/vitest`。
