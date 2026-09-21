# PROMOTE-SEED-1 · 升格就近落点（防蹦）设计

> 状态：主控已拍板口径，供外派执行。日期：2026-09-17。  
> 关联：NEST-CONTAIN-1（框罩住子孙 ≠ 纠正首次落点）；`outputs/2026-09-05-layout-islands-design.md` §4.3。

---

## 1. 问题

父岛 / Section 内把子节点**升格为中心**后，子岛常出现在远离原位之处（往往 `y≈0` 的森林自动槽），虚线 `parent_link` 被拉长；NEST-CONTAIN 会把父框 AABB **撑大罩住**远离子岛——包容正确，落点错误。

用户期望：**就近扩展**，大致仍在父框视觉邻域内。

---

## 2. 根因（已核实）

| 环节 | 现状 |
|---|---|
| UI 入口 | `makeCenterActions.onPromote`、`sectionActions.onPromoteAndMark` 只传 `{ dir }`，**不传 `pos`** |
| 命令层 | `planPromoteCenter` **已支持** `opts.pos`；未传则 `upsertCenter` 不写 `x/y`（或吸 `center_pos` 历史） |
| 布局 | `pos` 缺失 → `layoutForest` 自动排布：`origin = { x: rightMost+gap, y: 0 }` |
| 对照 | **切断** `handleCutTreeEdge` 已用「当前布局盒中心」作 `pos`，无跳变 |

设计债（§4.3 早写未落地）：「新升格捕获当前可见本体世界中心，无跳变」。

NEST-CONTAIN **不在本批范围**（已验收）；本批只修**升格写点**。

---

## 3. 口径（禁止再议）

| 做 | 不做 |
|---|---|
| 产品壳升格两条入口（菜单/环 `onPromote`、Section `onPromoteAndMark`）写入升格前布局盒中心为 `x/y` | 不改 `layoutForest` 无坐标岛的自动向右 `y=0` 打包策略（另议） |
| 与切断同一公式：`{ x: box.x + w/2, y: box.y + h/2 }` | 不改 `projectIslands` 剪枝；不改 freeEdges zoom（①）；不改 Nest-align |
| 无布局盒（折叠不可见 / 未入 layout）→ **不传 pos**（走既有历史吸附或自动排布）；**禁止写 (0,0)** | 不引入第二套「父框内相对偏移」启发式（有盒中心即可） |
| 裸调 `planPromoteCenter` 不传 pos → 保持今日语义（含 `center_pos` 吸附） | 不强制历史坐标覆盖可见落点：UI 有盒时**可见位置优先** |
| 协议 §6.3 补一句「产品壳新升格落当前布局中心」 | 不 `git add -A`；不 push |

成功标准：

1. 父岛内节点升格后，新中心 `centers[].x/y` ≈ 升格前该节点布局盒中心（容差钉死）。  
2. 升格后岛不因缺坐标落入 `layoutForest` 的 `y=0` 自动槽（相对父岛不再「蹦到画布底/右」）。  
3. `onPromote` 与 `onPromoteAndMark` 行为一致。  
4. 无布局盒时不写 `(0,0)`；无 host 解析器时 `center_pos` 吸附回归仍绿。  
5. 相关 vitest 绿；回执含未提交 diff 或 commit hash。

---

## 4. 设计要点

### 4.1 共享取点（推荐）

在 canvas（或 react 若已有同类工具）抽一处纯函数，切断与升格共用：

```ts
function layoutBoxCenterOf(
  layout: { nodes: readonly { node: { id: string }; box: { x: number; y: number; w: number; h: number } }[] },
  nodeId: string,
): { x: number; y: number } | undefined
```

- 命中 → 盒中心；未命中 → `undefined`。  
- 本批**不**另做 bodyRect（仓库尚无）；与切断口径对齐，避免两套中心。

### 4.2 Host 注入（菜单/环）

`NodeBagHost` 增可选：

```ts
layoutPosOf?: (id: string) => { x: number; y: number } | undefined;
```

`onPromote`：

```ts
const pos = host.layoutPosOf?.(id);
const plan = planPromoteCenter(controller.root, id, {
  dir,
  ...(pos !== undefined ? { pos } : {}),
});
```

`MindmapStage` 构造 `nodeBagHost` 时注入 `layoutPosOf: (id) => layoutBoxCenterOf(layout, id)`。

**语义优先级（UI）**：显式 `pos`（布局盒）> `upsertCenter` 内「当前条目坐标」> `center_pos` 历史 > 缺省自动排布。

既有测「无 host → `center_pos` 吸附」保持：测试不传 `layoutPosOf` 即可。

### 4.3 Section 升格并标

`onPromoteAndMark` 同样取 `layoutBoxCenterOf(layout, id)` 传入 `planPromoteCenter`。

### 4.4 切断对齐（小清理，可选同批）

`handleCutTreeEdge` 改为调用同一 `layoutBoxCenterOf`，避免公式分叉。行为不变。

### 4.5 协议

`docs/specs/2026-09-02-mm-md-protocol.md` §6.3 在包容跟移段落后追加一句：

> 产品壳**新升格**中心时，写入升格前节点布局盒世界中心为 `x`/`y`（与切断落点同口径），避免无坐标落入森林自动槽导致视觉跳变。

---

## 5. 测试计划（TDD）

| 文件 | 断言 |
|---|---|
| `apps/canvas/tests/center-actions-promote.test.tsx` | 注入 `layoutPosOf` → 升格后 `centers[0].pos` 等于注入值；**覆盖**同 at 的 `center_pos` 历史（可见优先） |
| 同上（既有） | **不**注入 `layoutPosOf` → `center_pos` 吸附回归仍绿 |
| `apps/canvas` 或 `packages/react` 集成测（择一易接） | 父岛布局后升格子节点 → note 含成对 x/y，且与升格前 `layout.nodes` 盒中心接近 |
| 可选 | `onPromoteAndMark` 路径写 pos（Stage 测或抽出纯辅助测） |

不要求：改 `layoutForest` 单元测；全包 vitest。

---

## 6. 非目标 / 后续

- 无坐标岛的 2D/贴父自动打包（改 `layoutForest`）——另开 dig。  
- 折叠内不可见升格的「先展开再升格」产品流——本批仅不写 `(0,0)`。  
- ① free-edge zoom 重路由；Nest-align 缓存。

---

## 7. 工作量估计

单提交量级：host 注入 + 两入口接线 + 共享取点 + 协议一句 + 2～4 测。预计半日内可验收。
