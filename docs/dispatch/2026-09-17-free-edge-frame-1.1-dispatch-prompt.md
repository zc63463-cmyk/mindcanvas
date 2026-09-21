# FE-FRAME-1.1 外派任务书：Section 分层 memo + 贴框测护航

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FE-FRAME-1.1**（内部改进，**零产品语义变更**）。  
> 前置：**FE-FRAME-1 已验收**（`freeEdgeFrameAnchor.ts` / `refineEndpoints` / 贴框测绿）。  
> 主控裁决：执行方自建议 **1（动画期分层 memo）+ 3（测试护航）** 同批；**不做** placed 几何对齐、不做索引展平、不动 `routeAesthetic` / ghost 口径。  
> 读者：工程执行 agent。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| 拆 `sectionData` 为两级 memo：成员清单（动画期零重算）↔ 取盒建帧/索引（跟 `animBoxes`/`centerPreview`） | 不改贴框 / 总览 / 升格产品语义 |
| 成员公式仍**唯一出口**（画框 `memberIdsOf` 与 `memberIndex` 同源，不漂移） | 不做迷你卡 placed 几何对齐（F5 VM bounds 维持） |
| property 测：`refineFreeEdgeEndpoints` 不变式 | 不做 nodeId→sectionId 预查表 |
| 集成测：迷你卡 × 跨岛自由边（总览贴迷你卡缘） | 不改 `routeAesthetic` / stagger / ghost；不 `git add -A`；不 push |

成功标准：动画期不再每帧 `walk(contentRoot)`；FE-FRAME-1 既有测全绿；新测覆盖不变式 + 迷你贴卡；回执含 diff stat。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `packages/react/src/render/MapView.tsx` · 现 `sectionData` useMemo（约含 `walk` + `memberIdsOf` + `buildSectionViews` + 索引；deps 含 `animBoxes`/`centerPreview`）  
3. `packages/react/src/render/freeEdgeFrameAnchor.ts` · `refineFreeEdgeEndpoints`  
4. `packages/react/src/render/IslandOverviewLayer.tsx` · MiniCardView（本批**只读**，不抽 placed）  
5. 既有测：`tests/free-edge-frame-anchor.test.ts`、`tests/mapview-free-edge-frame.test.tsx`、`tests/mapview-island-overview.test.tsx`（回归绿）

---

## 2. 实现要点（权威）

### 2.1 分层 memo（建议结构）

把今日单一 `sectionData` 拆成：

**A · `sectionMembership`（或等价名）** — deps：`rootNode`, `islandMembers`, `nestedCenterIdsByRoot`, `collapsedIds`（若折叠影响成员计数/清单口径则保留；**不含** `animBoxes` / `centerPreview` / `derived`）

产出（稳定引用，动画期不变）：

- `resolved`（或等价）  
- `titleOf` / `titleCache`  
- `subtreeCache`  
- **`memberIdsOf(id)` 或 `Map<rootId, memberIds>`** —— 公式与今日逐字相同：  
  - 登记在岛表/嵌套表 → `containedMemberIds`  
  - 否则 → `islandMembers.get` / `subtreeCache` / `[id]`  
- 可选：直接产出 `SectionMemberIndex`（`buildSectionMemberIndex`），因成员与盒无关  

**B · `sectionData` / 帧视图** — deps：`sectionMembership` + `derived` + `animBoxes` + `centerPreview`（及既有 renderBoxOf 所需）

- `buildSectionViews({ memberIdsOf: 来自 A, boxOf: renderBoxOf, ... })`  
- `boundsIndex` 从 frames 收集  
- `memberIndex`：**优先直接用 A 的索引**（勿在 B 再算一遍成员公式）；若 A 只提供 `memberIdsOf`，B 建索引时仍须调用 A 的同一函数  

**不变量（测或注释钉死）**：

- 动画仅改节点盒时，A 的 Map/函数引用不变（可用测试：连续两帧 anim 中间 spy `walk` 不二次调用——若难测，至少用「deps 列表审查 + 注释」+ 行为测：动画中途 Section 成员数不变）。  
- 画框成员 ≡ 贴框索引成员（FE-FRAME-1 既有约束不破）。

### 2.2 测试护航

#### 2.2.1 Property / 不变式（扩 `free-edge-frame-anchor.test.ts` 或新文件）

对随机或表驱动的 `(index, eps)`：

| 不变式 | 断言 |
|---|---|
| 身份 | `fromId`/`toId`/`ghost`/`renderable` 与输入相同 |
| 提升盒来源 | 若 `from` 相对输入变了 → 新盒 ∈ `sectionBounds` 值集 ∪ `overviewCards[].bounds` |
| 同框 | 两端同 sectionId 或同 overview rootId → 返回**原引用** |
| 无命中 | 两端都不在任何索引 → 返回原引用 |
| ghost / !renderable | 返回原引用 |

可用小型确定性矩阵（不必上 fast-check）；若仓库已有 property 工具可选用。

#### 2.2.2 迷你卡 × 自由边集成

在 `mapview-free-edge-frame.test.tsx`（或新文件）增加夹具：

- 父岛 P（可有 Section）+ 嵌套中心 C + 外部岛 D  
- 自由边：C 侧成员（或 C 本身）↔ D  
- **近景**：跨框贴 Section（若有）或既有行为  
- **总览**（`k < K_OVERVIEW`）：提升端贴 **迷你卡** bounds（`data-island-overview-nested` 对应 VM bounds），**不是**父卡 bounds；几何判别与 FE-FRAME-1 集成测同款（端点到迷你卡边距离阈值）

---

## 3. 工作树提示

- 只改本任务相关文件；勿 `git add -A`。  
- FE-FRAME-1 / IO / NEST 未提交改动原样保留。  
- **禁止**顺手做 placed 对齐、障碍剔除、① zoom。

---

## 4. 验证命令

```bash
cd packages/react
npx vitest run tests/free-edge-frame-anchor.test.ts tests/mapview-free-edge-frame.test.tsx
# 若新增测文件一并列入
npx vitest run tests/mapview-section-drag.test.tsx tests/mapview-island-overview.test.tsx
npx tsc -b tsconfig.json
```

---

## 5. 回执格式（交主控）

```text
## 回执 · FE-FRAME-1.1
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] sectionMembership 与帧取盒分层；动画 deps 不再拖 walk
- [ ] 画框成员 ≡ 贴框索引（公式单点）
- [ ] property/不变式测绿
- [ ] 迷你卡×自由边总览贴缘集成测绿
- [ ] 未做 placed 对齐 / 预查表 / routeAesthetic
### 未做 / 风险
```

**禁止**：push；改 F1–F8 产品口径；抽 MiniCard placed；改 `routeAesthetic`。
