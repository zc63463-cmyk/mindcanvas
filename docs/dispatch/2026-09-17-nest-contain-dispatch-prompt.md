# NEST-CONTAIN-1 外派任务书：嵌套子孙岛 Section 包容 + 父拖跟移

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**NEST-CONTAIN-1**。主控已拍板用户需求：**父 Section / 中心内再升格子孙岛，必须留在父框内；拖父岛时子孙跟移**。  
> 背景：现行投影把升格子树从父岛剔除 → Section AABB 只用本岛 `islandMembers` → 子岛「脱离」绿框；原 C3「父拖不带子」与需求冲突，**本批废止 C3 跟移裁决**。  
> 读者：工程执行 agent（零业务上下文假设）。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| 内容树非 `detached` 子孙升格中心 → 计入祖先 Section AABB 成员并集 | 不改「升格子树从父岛投影剔除」——岛仍独立布局 |
| 拖祖先中心 / Section 标题 → 子孙中心 `x/y` **同步平移**（预览+提交） | 不改自由边 zoom 重路由（那是①，另批） |
| `detached: true` 切断岛 **不** 挂到上级祖先包容链 | 不改 `projectIslands` 剪枝算法本身 |
| 协议 §6.3 改写为「包容跟移」；翻旧 C3 测试为跟移钉 | 不 `git add -A`；不 push；不顺手 Nest-align 缓存 |

成功标准：

1. 父岛 P 内升格 C 并给 P 标 Section → 父框 AABB **罩住** C 岛成员盒。  
2. 拖 P → P 与 C 两岛成员预览位移；提交后两边 `centers[].x/y` 都变。  
3. 拖 C → 仅 C 动，P 不动。  
4. 切断 `detached` 的 C 不进 P 的 nested 表、不跟 P 拖。  
5. 相关 vitest 绿；回执含 commit hash（若用户/任务要求提交）或「未提交+diff 统计」。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `docs/specs/2026-09-02-mm-md-protocol.md` §6.3 / §6.4（改前先读；改后自洽）  
3. `packages/kernel/src/layout/islands.ts` · `projectIslands`（剪枝不改）  
4. `packages/react/src/render/sectionFrames.ts` · `memberIdsOf` 注入点  
5. `packages/react/src/render/MapView.tsx` · `centerPreview` / Section `memberIdsOf`  
6. `apps/canvas/src/MindmapStage.tsx` · `handleCenterMove` / `islandView`  
7. 旧钉：`packages/react/tests/mapview-center-nested-drag.test.tsx`（原 C3 不跟随——**本批翻钉**）

---

## 2. 实现要点（权威设计）

### 2.1 纯函数模块

新建 `packages/react/src/render/islandNesting.ts`：

- `buildNestedCenterIdsByRoot(documentRoot, centerIds, detachedIds?)`  
  → `Map<祖先中心 id, 子孙升格中心 id[]>`（先序）  
  - 非 detached：登记到所有内容树祖先中心  
  - detached：不登记到上级；自身仍为下级祖先链起点（可包容自己的非切断子孙）  
- `containedMemberIds(rootId, membersByRoot, nestedCenterIdsByRoot)`  
  → 本岛成员 ∪ 各子孙岛成员（去重、本岛在前）

从 `@mindcanvas/react` index 导出（若仓库惯例要求）。

### 2.2 管线

`buildIslandView` 增返回字段 `nestedCenterIdsByRoot`（无中心时空 Map）。  
`membersByRoot` **保持**投影互斥成员（勿把子孙并进投影成员表）。

### 2.3 MapView

新可选 prop：`nestedCenterIdsByRoot`。

- Section：`memberIdsOf` 在同时有 `islandMembers` + `nestedCenterIdsByRoot` 时走 `containedMemberIds`  
- `centerPreview`：父岛拖动成员集同样走 `containedMemberIds`

### 2.4 MindmapStage

- 传入 `nestedCenterIdsByRoot={islandView.nestedCenterIdsByRoot}`  
- `handleCenterMove(id, dx, dy)`：对 `[id, ...nested]` 逐个 `upsertCenter` 平移坐标（基准 = 既有 pos 或当前布局盒中心）

### 2.5 协议

`docs/specs/2026-09-02-mm-md-protocol.md` §6.3：删除「父拖不带子」C3 表述，改为包容跟移两句（① AABB ② 拖祖先跟移；detached 除外）。日期注 2026-09-17。

### 2.6 测试（TDD）

| 文件 | 断言 |
|---|---|
| `tests/island-nesting.test.ts` | nested 表 P→[C]；detached C 不进 P；`containedMemberIds` 并集 |
| `tests/mapview-center-nested-drag.test.tsx` | **翻钉**：拖 P → C 跟移；拖 C → P 不动；投影 members 仍互斥 |

可选补：`sectionFrames` / 集成：P 的 Section bounds 包含 C 岛盒（若现有夹具易接）。

---

## 3. 工作树提示（主控可能已有半成品）

若已存在 `islandNesting.ts` / `nestedCenterIdsByRoot` 接线：

1. **以本任务书为权威**做 diff 对照  
2. 缺测补测、口径漂移改正、协议段落去重  
3. 跑指定测试至绿  
4. **不要推倒重写**无理由的代码

若从零实现：严格按 §2。

---

## 4. 验证命令

```bash
cd packages/react
npx vitest run tests/island-nesting.test.ts tests/mapview-center-nested-drag.test.tsx
```

（可选）`npx vitest run tests/section-frames.test.ts` 若有新增。

---

## 5. 回执格式（交主控）

```text
## 回执 · NEST-CONTAIN-1
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] Section AABB 包容子孙岛
- [ ] 拖父跟移 / 拖子不反向
- [ ] detached 不进上级链
- [ ] 协议 §6.3 已改且无旧 C3 残留
### 未做 / 风险
```

**禁止**：push；改 freeEdges zoom；改 Nest-align 缓存；扩大 scope 到①。
