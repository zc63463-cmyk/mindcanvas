# PROMOTE-SEED-1 外派任务书：升格写入布局盒中心（防蹦）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**PROMOTE-SEED-1**。设计权威：`docs/specs/2026-09-17-promote-seed-pos-design.md`。  
> 背景：升格只传 `dir`、不写 `x/y` → `layoutForest` 把无坐标岛排到 `{y:0}` 右槽 → 子岛「蹦远」；NEST-CONTAIN 只罩框不纠落点。切断路径已有布局盒中心种子，升格漏接。  
> 读者：工程执行 agent（零业务上下文假设）。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| `onPromote` + `onPromoteAndMark` 写入升格前布局盒中心为 `pos` | 不改 `layoutForest` 自动打包；不改 `projectIslands` |
| 与切断同公式：`box` 中心；抽共享 `layoutBoxCenterOf`（切断可改用） | 不改 freeEdges zoom（①）；不改 Nest-align；不做 bodyRect |
| 无布局盒 → **不传 pos**（禁止 `(0,0)`） | 不破坏「无 host 时 `center_pos` 吸附」既有测 |
| UI 有盒时可见位置优先于 `center_pos` | 不 `git add -A`；不 push |
| 协议 §6.3 补一句升格落点口径 | 不扩大 scope 到无坐标岛 2D 贴父打包 |

成功标准：

1. 注入布局中心升格 → `centers[].x/y` 等于该中心（钉）。  
2. 两入口行为一致；无盒不写 `(0,0)`。  
3. 无 `layoutPosOf` 时 `center_pos` 吸附回归仍绿。  
4. 相关 vitest 绿；回执含「未提交 + `git diff --stat`」或 commit hash。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `docs/specs/2026-09-17-promote-seed-pos-design.md`（全文）  
3. `packages/react/src/render/centers.ts` · `planPromoteCenter` / `upsertCenter`（确认 `opts.pos` 已通）  
4. `apps/canvas/src/nodeMenuBags.ts` · `makeCenterActions` · `onPromote`  
5. `apps/canvas/src/MindmapStage.tsx` · `handleCutTreeEdge`（种子范本）· `onPromoteAndMark` · `nodeBagHost`  
6. `packages/kernel/src/layout/forest.ts` · 无 `pos` 时 `{ x: rightMost+gap, y: 0 }`（只读，不改）  
7. 既有测：`apps/canvas/tests/center-actions-promote.test.tsx`、`packages/react/tests/centers-promote.test.ts`

---

## 2. 实现要点（权威）

### 2.1 共享取点

新建（建议路径，可微调但须单点）：`apps/canvas/src/layoutBoxCenter.ts`（或并入既有 utils）：

```ts
export function layoutBoxCenterOf(
  layout: { nodes: readonly { node: { id: string }; box: { x: number; y: number; w: number; h: number } }[] },
  nodeId: string,
): { x: number; y: number } | undefined
```

`handleCutTreeEdge` 改为调用它（行为不变）。

### 2.2 Host

`NodeBagHost` 增：

```ts
layoutPosOf?: (id: string) => { x: number; y: number } | undefined;
```

`onPromote`：

```ts
const pos = host.layoutPosOf?.(id);
planPromoteCenter(controller.root, id, {
  dir,
  ...(pos !== undefined ? { pos } : {}),
});
```

`MindmapStage`：

```ts
const nodeBagHost = {
  ...
  layoutPosOf: (id: string) => layoutBoxCenterOf(layout, id),
};
```

注意：`nodeBagHost` / `makeCenterActions` 的 `useMemo` 依赖须含 `layout`（若当前无 memo 则保持与现网一致，但勿闭包陈旧 layout）。

### 2.3 onPromoteAndMark

同取 `layoutBoxCenterOf(layout, id)` 传入 `planPromoteCenter(..., { dir: 'right', pos? })`。

### 2.4 协议

`docs/specs/2026-09-02-mm-md-protocol.md` §6.3：在现有「包容跟移」段落后加一句产品壳新升格写布局盒中心（见设计 §4.5 措辞）。**勿**回写旧 C3。

### 2.5 测试（TDD · 先红后绿）

| 文件 | 断言 |
|---|---|
| `apps/canvas/tests/center-actions-promote.test.tsx` | 新测：`makeCenterActions(..., { layoutPosOf: () => ({x:111,y:222}) })` → 升格后 `collectCenters` 的 `pos` 为 `{111,222}` |
| 同上 | 新测：同时存在 `center_pos` 历史与 `layoutPosOf` → **以 layoutPosOf 为准** |
| 同上 | 既有「无 layoutPosOf → center_pos 吸附」保持绿 |
| 可选 | `layoutBoxCenterOf` 单测；或 Stage/`onPromoteAndMark` 写 pos 钉 |

`packages/react/tests/centers-promote.test.ts` 的「pos 传入」已存在——**不必重复**；本批钉在 **canvas 接线层**。

---

## 3. 工作树提示

- 仓库可能已有 NEST-CONTAIN / freeEdges 未提交改动：**只改本任务文件**；勿 `git add -A`。  
- 半成品若已有 `layoutPosOf`：以本任务书 diff 对照，缺测补测，勿无理由重写。  
- **不要**「顺手」改 `layoutForest` 打包来「贴父」。

---

## 4. 验证命令

```bash
cd apps/canvas
npx vitest run tests/center-actions-promote.test.tsx

cd ../../packages/react
npx vitest run tests/centers-promote.test.ts
```

（若新增 Stage 测，一并列入回执。）

---

## 5. 回执格式（交主控）

```text
## 回执 · PROMOTE-SEED-1
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] onPromote 写布局盒中心
- [ ] onPromoteAndMark 同口径
- [ ] 无盒不写 (0,0)；无 host 时 center_pos 吸附仍绿
- [ ] 切断改用共享取点（若做了）
- [ ] 协议 §6.3 已补升格落点一句
### 未做 / 风险
```

**禁止**：push；改 `layoutForest` / freeEdges zoom / Nest-align / `projectIslands`；扩大到 2D 贴父自动排布。
