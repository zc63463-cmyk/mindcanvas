# FO-C2 外派任务书：框壳体积 + 碰撞分离

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-C2**。**前置：FO-C1 已验收（紧凑换行已合入，`outlineHeight`/行盒为真高度）。**  
> 本阶段**必须先取证再改码**。完成后可附短报告；**不 push**。

## 你的角色

工程执行 agent。让成框外壳具备布局体积，并与邻节点/邻岛碰撞分离；内容撑高触发外层重排。补齐设计稿 §5.1 与 amendment「框要有体积、要有碰撞」。

## 必读

1. `docs/specs/2026-09-15-subtree-frame-outline-c-amendment.md`  
2. `docs/specs/2026-09-15-subtree-frame-outline-design.md` §5.1  
3. FO-C1 合入后的 `frameLayout.ts` / `FrameOutline.tsx`（壳尺寸来源）  
4. `packages/kernel/src/layout/separate.ts` · `separateTree`  
5. `packages/react/src/demo/pipeline.ts`（`expandFrameIslands` 接线）  
6. B1 报告债：`outputs/2026-09-15-subtree-frame-outline-report.md` §七「岛不参与外层占位」

## 用户原话（验收对照）

> 框是要有体积的，要有碰撞的。

## 范围

**目标行为**

1. 计算框壳 AABB = 大纲行包围盒 + `FRAME_SHELL_PAD`（与 FrameOutline 壳一致；**默认不含挂出子树外包络**——与 B2 壳一致；若取证证明必须含挂出才能「不透穿」，在回执写明并做，算可接受偏差）  
2. 该 AABB 作为占位参与基座后的分离：邻节点不得与框壳重叠（在 separate 容差内）  
3. 框内换行/编辑导致 `outlineHeight` 变大 → 下一帧布局邻节点被推开（重排），不得永久压住邻居  

**预期改动面（取证后钉死，建议 ≤3 文件编排 + 测）**

- `packages/kernel/src/layout/frameLayout.ts`（导出 shell bounds；展开后写回/合并盒）  
- `packages/kernel/src/layout/separate.ts` 或调用点（**优先在 expand 之后对结果盒跑分离**，避免重写 separate 内核）  
- `packages/react/src/demo/pipeline.ts`  
- 测试：`frame-layout.test.ts` / 新 `frame-collision.test.ts`；必要时 react wiring 测

**禁止**

- 再改一版「视觉换行」却不接线体积（属 C1）  
- 大拆 `islands.ts` 升格语义  
- 新 `type`；graph-engine；`git add -A`；push  
- 把框内每一大纲行当成独立碰撞体（碰撞体 = **框壳**，挂出空间节点仍用自身盒）

## 取证强制产出（回执 §1）

写清 file:line：

1. 今日 `expandFrameIslands` 之后是否调用 `separateTree` / 等价物  
2. 框根在基座布局里当前盒是什么（剪枝后往往只剩框头小盒）  
3. 拟采用的策略（三选一，回执写选哪）：  
   - **S1**：展开岛后，将框根（或虚拟壳）盒替换为 shell AABB，再 `separateTree`  
   - **S2**：基座前给成框根注入「预估壳高」measure，展开后校正再 separate  
   - **S3**：其它（须说明为何 S1/S2 不够）

## 验收测（至少）

1. 两棵子树相邻；左侧成框且长文换行撑高 → 右侧节点盒与 shell AABB 无重叠（允许 separate 既有 margin）  
2. 拆框后恢复可重叠/原森林行为不永久粘住（或至少框根恢复普通 measure）  
3. 无框文档：布局结果与 C2 前同引用或几何回归（pipeline「无框零行为变更」精神）

## 步骤

1. 取证 → 选定 S1/S2  
2. 红测碰撞 → 实现 → 绿  
3. 门禁：kernel/react 相关测；tsc；重建 dist  
4. 短报告段落可写入 `outputs/2026-09-15-subtree-frame-outline-c-report.md`（新建）或追加原报告 §八  
5. 提交

建议 commit：`fix(kernel): frame shell AABB participates in layout separation`

## 停止条款

- 必须改动 >3 个布局编排核心文件且无把握保无框回归 → 停，拆 C2b  
- 升格岛与框壳双重分离互相打死循环 → 停报  
- 为碰撞而禁止换行/矮化壳 → 验收打回

## 回执格式

1. 取证 + 策略 S1/S2/S3  
2. commits + stat  
3. 碰撞测试原文  
4. shell AABB 是否含挂出子树  
5. 无框回归如何证明  
6. 偏差

## 验收对照（主控用）

- [ ] 框壳有体积且邻节点被推开（测或截图级证据）  
- [ ] 碰撞体是壳不是每行卡  
- [ ] 无框路径未无声破坏  
- [ ] C1 换行能力未回退
