# FO-UI1 外派任务书：框深度步进器（替换 `window.prompt`）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-UI1**（交互债）。**前置：FO-C2.1 已验收 `ba3a83a`。**  
> 用户裁定：开「深度步进器」——右键「改框深度…」不再用原生 `prompt`（裁决 M3 脉络：webview 静默吞对话框 → 功能假死；与 `LenBubble` 同款）。

## 你的角色

工程执行 agent。用画布内数值气泡/步进器改 `note.frame.depth`；命令仍走 `setFrameDepth`（同一撤销栈）；TDD；显式路径提交；不 push。

## 现象

今日路径：

1. `contextMenuItems`「改框深度…」→ `requestFrameDepth(controller, id)`  
2. `frameCommands.askDepth` → **`window.prompt('框内大纲深度（1…8，当前 N）')`**  
3. 合法整数 → `setFrameDepth`

问题：系统弹窗不可样式化；IDE 内嵌 webview 常静默失败；`apps/canvas` 已禁裸 `prompt`（`no-native-dialogs.test.ts`），但 `packages/react` 的 `frameCommands` **仍留 prompt**——菜单一点就踩坑。

## 口径（已裁定）

| 做 | 不做 |
|----|------|
| 「改框深度…」→ 宿主浮层（对齐 `LenBubble`：固定层 + 输入/± + Enter 提交 / Esc·点外部取消） | 不新 `type`；不改 `frame` 协议形态 |
| 提交值经 **`setFrameDepth`**（内部已 `clampFrameDepth`）；非法/取消 **不写盘** | 不改成框默认 depth=2 的一期策略（成框仍可一键默认 2；本批只替换「改深度」询问 UI） |
| 删除菜单对 **`requestFrameDepth` / 原生 prompt** 的依赖；`askDepth` 删除或仅测用且标注废弃 | 不做完整「成框时选深度」向导（可列为偏差外后续） |
| 范围展示：当前 depth + 合法上界（`min(8, subtreeMaxRelativeDepth)`，与 clamp 同源） | 不动 OutlinePanel / graph-engine；不改布局几何 |

**UI 最低要求（可高于不可低于）**

- 预填当前 `frame.depth`  
- 可输入整数，或提供 **− / +** 步进（步进时钳在 `[1, max]`）  
- Enter 提交；Esc / 点 backdrop 取消  
- `stopPropagation` 键盘，不进画布快捷键链（与 `LenBubble` 一致）  
- `data-*` 便于测（建议 `data-frame-depth-bubble`）

视觉可复用 `LenBubble` 风格（深色半透明卡片），不必引入新设计系统。

## 接线形状（对齐出线长度）

参考既有：

- `GrowDirMenuActions.onRequestLenCustom` → `NodeContextMenu` → `MindmapStage` `setLenBubble` → `<LenBubble>` → `applyLen`  
- 本批对称增加例如：`onRequestFrameDepth?: (id, x, y, current, max) => void`（命名可微调，回执钉名）  
- 菜单「改框深度…」`onSelect` **只调宿主回调**（带上菜单坐标），**禁止**再调 `requestFrameDepth`  
- 宿主 commit：`setFrameDepth(controller, id, n)`（或 `controller` 薄封装，但须同一 undo）

`requestFrameDepth`：删除，或改为「无宿主时 no-op + 测试断言不再依赖 prompt」——**生产菜单路径不得出现 `prompt(`**。

## 必读

1. `packages/react/src/edit/frameCommands.ts` · `setFrameDepth` / `requestFrameDepth` / `askDepth`  
2. `packages/react/src/edit/contextMenuItems.ts` · 「改框深度…」  
3. `apps/canvas/src/LenBubble.tsx` + `MindmapStage` lenBubble 接线  
4. `apps/canvas/src/NodeContextMenu.tsx` · `onRequestLenCustom` 传坐标模式  
5. `packages/react/tests/frame-commands.test.ts` · 现有「无 prompt → no-op」断言须改写  
6. `apps/canvas/tests/len-bubble.test.tsx` · 气泡测样板  
7. `apps/canvas/tests/no-native-dialogs.test.ts` · canvas 禁 prompt（本批勿在 canvas 引入 prompt）

## 范围

**修改（预期）**

- `frameCommands.ts`：去掉生产用 `prompt`；保留/强调 `setFrameDepth`  
- `contextMenuItems.ts` + `menuActionTypes.ts`：注入 `onRequestFrameDepth`  
- `apps/canvas`：`FrameDepthBubble`（新建，或与 LenBubble 抽共享壳——**优先复制 LenBubble 小改**，勿大抽象）  
- `NodeContextMenu` / `MindmapStage` 接线  
- 测：react 命令/菜单；canvas 气泡 Enter/Esc/钳制；可选 e2e 菜单点开见气泡  

**禁止**

- 在 `apps/canvas/src` 写 `prompt(`  
- `git add -A`；push；graph-engine  
- 改 kernel 布局 / C2.1 几何  

## 必须交付的测试（先红后绿）

```ts
// 1) 菜单路径不再调用 prompt（可 spy prompt 或断言 onRequestFrameDepth 被调）
// 2) FrameDepthBubble：预填当前值；Enter 合法 → onCommit(n)；非法不 commit
// 3) −/+ 或输入使 n 钳在 [1, max]；max = clamp 上界
// 4) setFrameDepth 仍写 note.frame.depth 且进 undo（既有 frame-commands 测保留/改写）
// 5) 取消（Esc）不改盘
```

改写原「无 prompt 环境 requestFrameDepth no-op」：改为「无宿主回调时菜单项不写盘 / 或回调未注入则不出现改深度项」——回执写清选哪种（推荐：**回调未注入则不显示「改框深度…」**，与「自定义长度」缺省不注入同款）。

## 步骤

1. 红测：菜单点「改框深度…」应请求宿主气泡，且 `prompt` 不被调用  
2. 实现气泡 + 接线 + 删 prompt 路径 → 绿  
3. canvas/react 定向测 + `no-native-dialogs` 仍绿  
4. 显式路径提交（建议 1–2 个 commit：feat UI + 可选 chore 删 askDepth）

```bash
corepack pnpm --filter @mindcanvas/react exec vitest run tests/frame-commands.test.ts
corepack pnpm --filter canvas exec vitest run tests/len-bubble.test.tsx tests/no-native-dialogs.test.ts
# 若新建 frame-depth-bubble.test.tsx 一并带上
```

建议 commit：`feat(canvas): frame depth stepper bubble replaces window.prompt`

## 停止条款

- 发现环形菜单也暴露「改框深度」且必须同步 → 可一并接同一回调；若环模型大改 → 停报拆批  
- 为去 prompt 而去掉改深度能力 → 验收打回  

## 回执格式

1. commits + `--stat`  
2. 红→绿原文  
3. 气泡组件路径；菜单→宿主→`setFrameDepth` 接线（file:line）  
4. 声明：`prompt` 已从改深度生产路径清除；undo 仍可用；未动布局  
5. 偏差  

## 验收对照（主控用）

- [ ] 「改框深度…」弹出画布内气泡，无系统 `prompt`  
- [ ] Enter 写入 depth（钳位正确）；Esc 不写盘；undo 可逆  
- [ ] `apps/canvas` `no-native-dialogs` 绿；react 菜单/命令测绿  
- [ ] 未 push  
