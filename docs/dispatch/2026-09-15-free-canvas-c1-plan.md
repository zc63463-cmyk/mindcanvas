# Free-canvas C+1 派遣计划（对标 markvault · 独立子模式）

> 状态：**待执行**。执行方开工第一件事：单独提交本文档（`docs: 追加 free-canvas C+1 派遣计划`），然后再动代码。
> 上游：`docs/specs/2026-09-15-free-canvas-spec.md` + 用户裁定 **C（多壳/翻面/连线/持久化）+ 1（独立 `.mc.canvas.json` + 模式切换）**。
> 本批**不 push**（除非用户另令）。遵守 `docs/collab/parallel-agent-discipline.md`。

## §0 基线与工作树现状（开工先核对）

- 起点 HEAD（写稿时）：`b81f32d`（P2b 收口）。**以你开工时 `git log -1` 为准**，不符先报告。
- 导图门禁（写稿参考）：kernel / react / canvas 既有套件须**零回归**；新包 `@mindcanvas/free-canvas` 自带测试加法。
- **禁区**：`tools/graph-engine/`、`.codebase-memory/`、`.cursor/`、`_tmp_*`、导图 `NotePopover` / `fixedNotePanels` / `note.md` 产品语义（**禁止**再把翻卡接回 note 面板）。

### 工作树上已有半成品（必须先处置，禁止无视重写冲突）

下列文件**可能已存在且未提交**（上一会话脚手架）。**FC-A 开工第一件事**：盘点 → 跑测 → **采纳并补齐** 或 **报告缺口后最小修补**；禁止整目录删光重写除非测试全红且无法修。

| 路径 | 预期状态 |
|---|---|
| `docs/specs/2026-09-15-free-canvas-spec.md` | 规格已写 |
| `packages/free-canvas/`（types/guards/factory/document/ops/viewport + 3 测试文件） | 模型脚手架 |
| `packages/react/src/free-canvas/index.ts` | **仅 re-export 壳**（尚无 View） |
| `packages/react/package.json` / `tsconfig.json` references | 可能已加 `@mindcanvas/free-canvas` |
| `apps/canvas/package.json` | 可能已加依赖 |
| `.dependency-cruiser.js` | 可能已加 `free-canvas-pure` |

**FC-A 验收**：`corepack pnpm install` → `pnpm --filter @mindcanvas/free-canvas test` 全绿 → `tsc -b` 该包通过 → 精确路径提交（见 §2）。

---

## §1 目标与非目标

### 目标（C 最低可感）

1. 应用内进入**自由画布**（不经导图 note 面板）
2. `sticky-classic` + `card-panel` 可建、可拖、**整卡 CSS 3D `rotateY` 翻面**
3. 「添加背面」后空背可翻；正/背面 markdown 可编辑并落盘（`face` 持久化）
4. 两卡可连线；删卡级联删边；重开 `face`/边仍在
5. 事实源 `*.mc.canvas.json`；导图 `.mm.md` 链零改语义

### 非目标

- 不移植 Obsidian / markvault 标注素材库
- 不引 tldraw / Excalidraw / xyflow
- 不改 `NotePopover` 当产品翻卡
- 不做 `text-banner` / image·html·composite（二期）
- 不做导图级边避障

---

## §2 外派切分（波次 · 文件所有权 · 可并行性）

```
FC-A 模型收口 ──► FC-B 视口+壳+拖 ──► FC-C 真翻卡+编辑 ──► FC-D 连线 ──► FC-E 应用集成
                     │                      │
                     └─ 同波禁止并行改同一文件；波次之间必须门禁绿再开下一波
```

**并行规则**：同一波次内**只派 1 个执行 agent**（共享工作树 + 文件面重叠大）。多 agent 仅允许：
- 一人写报告/CHANGELOG、一人跑门禁（只读）；或
- 用户另开 **git worktree** 后按波次并行（推荐：worktree 每波一支）。

### FC-A · 模型包收口 + workspace 接线（0.5d）

**所有权**：`packages/free-canvas/**`、根 `pnpm-lock`（若 install 变更）、`.dependency-cruiser.js`、`packages/react/package.json` + `tsconfig.json` references、`apps/canvas/package.json`（**仅依赖行**，不动业务源）。

**任务**：
1. 核对/补齐 `@mindcanvas/free-canvas` 导出面与 spec 一致（`schemaVersion:1`、`NativePlacement`、`McCanvasEdge` 用 `fromPlacementUuid`/`toPlacementUuid`、`nativeBackEnabled`）。
2. 测试绿：document round-trip / 未知键透传 / ops flip·addBack·级联删边 / viewport zoomAt。
3. depcruise：`free-canvas-pure`（禁 react）；`pnpm depcruise` 零 error。
4. `pnpm --filter @mindcanvas/free-canvas build` 产出 dist。

**提交**（精确路径，禁 `git add -A`）：
1. `docs: free-canvas 规格（2026-09-15）`（若 spec 未提交）
2. `feat(free-canvas): CanvasDocument v1 模型 + 往返/ops/viewport 测试`
3. `chore: workspace 接入 @mindcanvas/free-canvas + depcruise free-canvas-pure`

**停止**：模型测红修不动；depcruise 与 react 循环依赖。

---

### FC-B · 视口 + 两壳正面 + 创建/选中/拖移（1–1.5d）

**前置**：FC-A 已合并到当前工作树。

**所有权**：
- `packages/react/src/free-canvas/**`（本波新建：`FreeCanvasView.tsx`、`NativeCard.tsx`、`Toolbar.tsx`、hooks；**暂不**做 flip 按钮与 EdgeLayer）
- `packages/react/src/index.ts`（**仅加法导出** FreeCanvas 符号）
- `packages/react/tests/free-canvas-*.test.tsx`（本波）

**任务**：
1. `FreeCanvasView`：空白 pan、滚轮 zoom（消费 `@mindcanvas/free-canvas` 的 `panBy`/`zoomAt`/`viewportCssTransform`）；世界层 CSS transform。
2. 工具条：便签 / 面板 / 选择；空白点击落卡（`createNativePlacement` + `upsertPlacement`）。
3. `NativeCard`：按 `shell` 两套视觉（sticky 黄便签气质 / panel 玻璃面板）；**只渲染 front**（markdown 可用简易预格式或复用 `CardBackMarkdown`+`glassToken`——报告注明）。
4. 选中、拖移写 `movePlacement`；Delete 删卡（级联走 `removePlacement`）。
5. 受控：`doc` + `onChange(doc)`（不可变更新）。

**验收钉**：
- 空文档 → 点工具 → 点空白 → DOM 出现 `data-fc-card` ×1
- 拖后 `doc.placements[0].transform` 变化
- 导图既有测试**不跑也无所谓**，但本包 + react 新测绿；**禁止改 MapView**

**提交**：
1. `feat(react): FreeCanvasView 视口 + sticky/panel 落卡拖移`

**停止**：必须改 MapView/MindmapStage 才能画卡 → 停（架构回潮）。

---

### FC-C · 真翻卡 + 添加背面 + 正反面编辑（1d）— **产品可感点**

**前置**：FC-B 合并。

**所有权**：`packages/react/src/free-canvas/NativeCard.tsx`（及同目录 flip/edit 子组件）、相关测试；**可**小改 `FreeCanvasView` 传回调。禁止动导图 chrome 语义（允许**import** `FlipCard` / `CardBackMarkdown`）。

**任务**：
1. 整卡 3D：`preserve-3d` + `rotateY(180deg)` + `backface-visibility`（可包 `FlipCard` 的 `interactive={false}`，由角钮驱动；或自写与 markvault 同契约——报告二选一理由）。
2. 悬停显示翻面钮；**仅** `nativeBackEnabled(back)`。
3. 右键或卡菜单：**添加背面** → `addBack` → `face:'back'` → 进入编辑。
4. 双击 = 编辑**当前面**（不翻面）；失焦/Shift+Enter 提交（对齐 DescBlock/NoteBackEditor 实测口径，抄进报告）。
5. `face` 写入 doc（落盘由 FC-E 宿主负责；本波 onChange 必须带上 face）。

**验收钉**：
- 无 back → 无翻面钮
- addBack 后可翻，动画可见（`data-flip-state` 或等价锚点）
- 刷新内存态：toggle 后 `doc.placements[i].face === 'back'`

**提交**：
1. `feat(react): free-canvas 整卡 3D 翻面 + 添加背面 + 面编辑`

**停止**：只能做到「面板内切换无 rotateY」→ 停并报告（不符 C）。

---

### FC-D · 自由连线（1d）

**前置**：FC-C 合并。

**所有权**：`packages/react/src/free-canvas/EdgeLayer.tsx`、`useConnectTool.ts`（名可调整）、`FreeCanvasView` 工具「连线」、测试。

**任务**：
1. 工具=connect：从卡 A 拖到卡 B → `addEdge`；SVG 直线（中心锚 MVP）。
2. 选中边 + Delete 删边；删卡已级联（模型层）。
3. 边绘制随 viewport/transform 更新。

**提交**：
1. `feat(react): free-canvas 卡间连线（EdgeLayer + connect 工具）`

---

### FC-E · 应用集成收口（0.5–1d）

**前置**：FC-D 合并。

**所有权**：
- `apps/canvas/src/App.tsx`（模式态）
- `apps/canvas/src/FreeCanvasStage.tsx`（新建）
- `apps/canvas/src/StartupScreen.tsx`（加法入口，不破坏导图入口）
- `apps/canvas/src/canvasDocHost.ts`（或 hooks，平行 DocumentHost）
- `apps/canvas/public/demo-free.mc.canvas.json`
- `apps/canvas/tests/free-canvas-*.test.tsx`
- `CHANGELOG.md` + `outputs/2026-09-15-free-canvas-c1-report.md`
- README 一行入口说明（可选）

**任务**：
1. 模式：`mindmap` | `free-canvas`；切换**不串**导图 doc 状态（分 Stage 挂载/卸载即可）。
2. `CanvasDocHost`：recent（独立 localStorage key）、打开/保存 `.mc.canvas.json`（FS picker + 下载兜底，对标 `LocalDocHost` 模式）。
3. 启动页或顶栏：**自由画布 / 新建画布 / 看演示**。
4. demo 文件含 2 卡 + 1 边 + 一卡已有 back。
5. e2e：新建→落两卡→添加背面→翻面→连线→ serialize 含 face/edges → 再 parse 仍背面。
6. 门禁：四包 test（含 free-canvas）+ tsc + depcruise + lint + budget；**重建 react dist**（若 canvas 消费 dist）。

**提交**：
1. `feat(canvas): FreeCanvasStage + 模式切换 + .mc.canvas.json 宿主`
2. `docs: free-canvas C+1 收口（CHANGELOG + 报告）`

---

## §3 决策点（已锁定，勿再问）

| ID | 决定 |
|---|---|
| D1 | 事实源 = `*.mc.canvas.json`，`schemaVersion: 1` |
| D2 | 仅 native 两壳；annotation 读入时丢弃（normalize） |
| D3 | `back` 对象存在即可翻（空 body OK） |
| D4 | `face` 落盘 |
| D5 | 实现 = React 自研；借鉴 markvault UX/schema，不整仓移植 |
| D6 | 与导图分 Stage；禁止共用 MapView 指针栈 |
| D7 | 版本：CHANGELOG 新段（建议 `[1.9.0]` 或 `[1.8.x]` 按仓库当前 semver 习惯；报告写明） |

---

## §4 停止条款（任一触发 → 停写报告，等复核）

- 为做翻卡去改 `NotePopover` / `fixedNotePanels` / `.mm.md` 协议
- 引入白板 SDK 依赖
- 导图既有测试被本批改红且无法证明无因果
- lint 水位上升 / budget 超限 / depcruise error
- FC-C 无法交付可见 `rotateY` 整卡翻面

---

## §5 报告格式（`outputs/2026-09-15-free-canvas-c1-report.md`）

按波次：commit hash · 文件列表 · 红→绿原文 · 新增用例数。  
必须含：① 与 markvault 对照表（壳/翻面/添加背面/连线）② 导图零改动证据（`git diff` 无 NotePopover/MapView note 链，或仅 import）③ 门禁原样 ④ `git status --short`。  
**不 push**。

---

## §6 推荐外派口令（复制给执行 agent）

### 口令 · FC-A
```
执行 docs/dispatch/2026-09-15-free-canvas-c1-plan.md 的 FC-A。
先盘点工作树已有 packages/free-canvas 半成品：跑测、补齐、精确路径提交。
禁止 git add -A；禁止动 NotePopover；禁止 push。
完成后写 outputs 片段或等 FC-E 汇总。
```

### 口令 · FC-B（FC-A 合并后）
```
执行同一计划 FC-B：FreeCanvasView 视口 + sticky/panel 落卡拖移。
文件所有权仅 packages/react/src/free-canvas/** 与 index 加法导出 + 新测试。
禁止改 MapView/MindmapStage。TDD 先红后绿。不 push。
```

### 口令 · FC-C
```
执行 FC-C：整卡 CSS 3D 翻面 + 添加背面 + 当前面编辑；face 写入 doc。
验收必须有 data-flip-state（或等价）与 rotateY。禁止回潮 NotePopover。不 push。
```

### 口令 · FC-D
```
执行 FC-D：EdgeLayer + connect 工具；addEdge/removeEdge；删卡级联已在模型。不 push。
```

### 口令 · FC-E
```
执行 FC-E：App 模式切换 + FreeCanvasStage + CanvasDocHost + demo + e2e + CHANGELOG + 总报告。
门禁全绿；重建 react dist；不 push。
```

---

## §7 后续切片（不在本批）

- text-banner / 多选对齐 / 边样式与 label 编辑
- JSON Canvas 导出互换
- 空间索引（N 大再立）
- 导图 note.md 实验入口降级文案（产品说明「翻卡请用自由画布」）
