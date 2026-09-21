# Nest-align · Agent 深度可读 / 可操作取证包（PROBE）

> 日期：2026-09-17  
> 性质：**只取证、默认可停**——验证「嵌套升格子岛编辑 → 祖先岛误 miss」是否在本机/真实用法上成立，并产出**可直接外派实现**的红钉口径。  
> 读者：外派执行 agent（零业务上下文假设）+ 主控验收。  
> 出处：CHANGELOG `[1.8.15]` 偏差② · `outputs/2026-09-14-forest-layout-cache-report.md` §6.2 · `forest.ts:117-121` · `islands.ts:128-154`  
> **禁止本文件阶段改生产布局语义**（可加探针/测试/脚本；不可「顺手对齐投影」）。

---

## 0. 一页可操作结论（agent 先读这里）

| 问题一句话 | 岛级缓存键 = **投影岛根对象身份**；嵌套升格时，改里层 B 可能让祖先岛 A 的投影壳每次换新 → `forestIslands.get(A)` miss → A 内容未变也全量重算。 |
|---|---|
| 对用户 | 套娃升格文档里，改深层中心时布局「二次全量」顿挫（正确性通常仍对）。 |
| 本阶段成功标准 | ① 用夹具**复现或证伪** miss；② 贴耗时数字；③ 写好「实现批红钉原文」；④ **不改** `sameShell` / 投影算法。 |
| 停止 | miss 不成立，或编辑中位 &lt;16ms 且用户无感 → **停报，不开 NEST-ALIGN 实现**。 |

---

## 1. 深度可读地图（读码顺序 · 禁止跳读）

按序打开并在回执贴「读过」勾选：

### 1.1 缓存键契约（为什么会 miss）

```117:125:packages/kernel/src/layout/forest.ts
  //    F2 岛级缓存：键 = 岛根**对象身份** + dir（collapsedKey/measureKey 已在入口统一校验）。
  //    身份键的可靠性（§1.4）：不可变编辑只重建到编辑点为止的祖先链 + 投影复用未变节点壳
  //    ⇒ 编辑岛 I 内任一节点 → I 的投影岛根换壳（miss → 重算）；其它岛岛根身份不变（命中）。
  //    已知边界：投影壳易位（如根岛/含嵌套升格的岛每次投影换新壳）→ 恒 miss 重算——
  //    只影响提速、不影响正确性。
  const local = centers.map((spec) => {
    const entries = cache?.forestIslands.get(spec.node);
    const hit = entries?.find((e) => e.dir === spec.dir);
```

**可读要点**：`spec.node` 必须是**同一对象引用**才 hit。引用一变 = miss。正确性靠重算兜底，所以这是 perf 边界不是功能 bug。

### 1.2 投影壳稳定化（F4 修了什么、没修什么）

```128:154:packages/kernel/src/layout/islands.ts
 * 为什么需要：岛级缓存的键 = 岛根**对象身份**——若"升格剪枝"（changed=true）每次
 * 投影都新建壳，含嵌套升格的岛**永远 miss**。
...
function sameShell(a: EditableNode, b: EditableNode): boolean {
  if (a === b) return true;
  // 非 children 字段引用相等 + children 逐项 ===
```

```246:260:packages/kernel/src/layout/islands.ts
    const naive: EditableNode = changed ? { ...node, children: projectedChildren } : node;
    const prev = lastProjected.get(node);
    if (prev !== undefined && sameShell(prev, naive)) {
      return { projected: prev, members };
    }
    // 文档根特判：... lastRootShell
```

**可读要点**：

| 已修（F4） | 未修（Nest-align） |
|---|---|
| 一级升格剪枝 → 根岛壳可跨编辑复用 | **嵌套**：A 的投影 `children` 里含「指向 B 岛的剪枝空洞」；B 子树一变，A 的 walk 路径上 `changed` / children 引用链如何变化，是否导致 A 的 `projectedRoot` 换新对象 |
| `lastProjected` 以**源树 node** 为 WeakMap 键 | 祖先岛 A 的**源**节点可能未编辑，但投影产出仍可能因下游剪枝结构共享失败而换壳 |

**假设（待 PROBE 证实或证伪）**：编辑 B 岛内叶子 → 源树只重建 B→根祖先链；投影时 A 的 `walk(A)` 仍因「子路径上某壳未复用」使 `naive !== prev` → A 的 `projectedRoot` 新对象 → `forestIslands.get(旧A壳)` 找不到 → miss。

### 1.3 基准脚本现状（可操作入口）

- `scripts/bench-layout-cache.mjs`：k=8 会 BFS 升格含嵌套，但**编辑型对照未拆「改嵌套子岛 vs 祖先命中」**。  
- PROBE 须**新增**探针（测试或脚本），不能只跑现成 bench 就下结论。

---

## 2. 术语（agent 回执必须用同一套词）

| 词 | 定义 |
|---|---|
| **命中 hit** | `cache.forestIslands.get(spec.node)` 找到同 `dir` 的 entry，且本轮**未**调用 `layoutMindmapBranched` 重算该岛 |
| **误 miss** | 该岛自上次布局以来，**成员文本/结构相对该岛语义未变**，但 `spec.node` 引用变了导致重算 |
| **合法 miss** | 编辑落在该岛成员内，或 `dir`/折叠/measureKey 变了 |
| **投影壳** | `LayoutIsland.projectedRoot`（或 centers 传入的 `spec.node`）对象身份 |
| **层级对齐** | 实现批方向：让「内容未变的祖先投影」跨编辑保持**同一 projectedRoot 引用**（或缓存键改为稳定身份——须另 ADR，本 PROBE 不选型） |

---

## 3. 可操作夹具（最小复现）

### 3.1 文档结构（必须嵌套）

```
根
 └─ A（升格中心，dir=right，大子树：建议 ≥200 节点，便于看耗时）
      └─ …普通节点…
      └─ B（升格中心，嵌在 A 的源树子树内）
           └─ leaf（编辑目标）
```

构造注意：

- A、B 都必须进 `root.note.centers` 且 `well-formed`。  
- B 在**源树**上是 A 的后代；投影后 B 从 A 岛 `children` 剔除（`islands.ts:228-239`）。  
- 对照臂（可选）：仅一级中心、无嵌套——用于证明「嵌套才 miss」。

### 3.2 编辑动作

对 `leaf` 做 `updateNode` 改 `text`（单字段），**同一** `LayoutCache` 实例连续 2 次 `layoutIslands` / `layoutDemo`。

---

## 4. 探针设计（深度可操作 · 先红或先表）

### 4.1 推荐：kernel 判别测试（可进实现批）

伪代码口径（实现时落 `packages/kernel/tests/forest-nest-cache-hit.test.ts`）：

```ts
// 给定：嵌套 A⊃B，cache 共享
// 第 0 次 layout → 记录 projectedRootA0 / projectedRootB0（或 centers[].node 身份）
// updateNode(leaf)
// 第 1 次 layout → projectedRootA1 / projectedRootB1

// 合法：B1 !== B0（B 被编辑，miss）
// 待证伪/证实：
expect(projectedRootA1).toBe(projectedRootA0); // 若红 → Nest-align 成立（祖先误换壳）
// 另：用 measure 计数或 stub layoutMindmapBranched 计数：
// expect(layoutCallsFor(A)).toBe(0) // 第二次不应再进重算
```

**若该断言现在就红**：PROBE 成功，实现批直接拿这条当红钉。  
**若绿**：证伪「换壳」路径——改为查 `forestIslands` 键是否用了别的对象；或报告「注释过时，嵌套已命中」。

### 4.2 耗时表（主控决策用）

同夹具，`SAMPLES≥15` 中位：

| 场景 | 第 2 次 layout 中位 ms | A 岛 hit? | B 岛 hit? |
|---|---|---|---|
| 嵌套：改 B.leaf | ? | ? | 应 miss |
| 对照：改 A 内非 B 成员 | ? | 应 miss | 应 hit |
| 对照：无嵌套单中心改叶 | ? | — | — |

命令建议（二选一，回执写清用了哪个）：

```bash
# 现成（只能看整体，不能单独证明祖先 miss）
pnpm -r build && node scripts/bench-layout-cache.mjs

# PROBE 新增：scripts/bench-nest-align-probe.mjs 或 vitest 上表
corepack pnpm --filter @mindcanvas/kernel exec vitest run tests/forest-nest-cache-hit.test.ts
```

### 4.3 仪器（可选但强烈建议）

在 `forest.ts` 的 hit/miss 分支加**测试专用**计数（`opts.__islandCacheStats` 或 `globalThis` 探针），**勿默认开**：

```ts
stats.misses.push(spec.node.id)
stats.hits.push(spec.node.id)
```

PROBE 结束可保留测试钩子；禁止留下生产日志。

---

## 5. 回执格式（主控可读 / 下一 agent 可接着干）

1. **结论三选一**（必须选）  
   - `CONFIRMED`：祖先误 miss，附红钉断言原文  
   - `REFUTED`：嵌套下祖先壳稳定且 hit，附绿证据  
   - `INCONCLUSIVE`：测不了（说明堵点 file:line）  
2. **身份表**：A0/A1、B0/B1 是否 `===`（Object.is）  
3. **耗时表**（§4.2）  
4. **读码勾选**：forest.ts 键契约 / islands sameShell / lastRootShell  
5. **实现批建议**（仅 CONFIRMED）：一句话方案候选（壳对齐 vs 稳定键）+ **禁止项**（勿恢复 F5 已删的 shiftTree memo）  
6. 声明：未改投影算法；未 push  

### 实现批开门条件（主控用）

| CONFIRMED 且 | 动作 |
|---|---|
| 第 2 次 layout 中位 **≥16ms** 或用户明确卡 | 开 `NEST-ALIGN` 实现外派 |
| &lt;16ms 且仅实验室 miss | **可选**开（token 富余 + 你有嵌套用法）——须阴性对照防陈旧壳 |
| REFUTED | 更新 CHANGELOG/注释「边界已不成立」，**不开实现** |

---

## 6. 深度可操作性检查表（写给派工的人）

一份 Nest 相关 prompt 必须让 agent **不用猜**：

| 维度 | 本包是否满足 |
|---|---|
| 现象 ↔ 代码锚点 | ✅ forest 键 + islands 壳 |
| 可复现夹具 | ✅ §3 |
| 可假说检验 | ✅ §4.1 红/绿双向 |
| 停止条款 | ✅ §0 / §5 |
| 与正确性边界 | ✅ 写明「只影响提速」 |
| 和 F5 教训隔离 | ✅ 禁止 shiftTree memo |
| 下一棒输入 | ✅ 红钉原文可原样粘贴进实现 prompt |

---

## 7. 明确不做（PROBE）

- 改 `sameShell` / `lastProjected` / 缓存键语义  
- 为冲 &lt;5ms 动 place 重放 / islandLinks memo（另项）  
- 无 CONFIRMED 就开「对齐」实现  
- `git add -A` / push  

---

## 8. 给主控的一句话

你已满足「真用嵌套」；**本包把「值不值得做」变成 agent 可执行的证伪实验**——先跑 PROBE，再用 CONFIRMED + 耗时决定是否烧 token 做 NEST-ALIGN。
