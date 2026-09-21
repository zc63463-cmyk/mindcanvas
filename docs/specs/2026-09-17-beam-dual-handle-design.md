# 共享梁双把手设计（方案 C）

> 日期：2026-09-17  
> 状态：**已拍板，待外派实现**  
> 摩擦来源：用户拖「上向共享梁」抬高时，子节点短桩与梁 **1:1 齐步走**——直觉想「只拉长父→梁主干」，实现却在改整段层距。  
> 前置实现：`packages/kernel/src/layout/beamSide.ts` · `packages/kernel/src/layout/branching.ts` · `packages/react/src/render/beamDrag.ts` · MapView 梁拖拽叠层

---

## 0. 一句话

**一根梁、两个把手：**

| 把手 | 命中区 | 写入 | 节点是否动 |
|---|---|---|---|
| **梁中段（rail）** | 共享梁线段（避开与主干交汇处） | `lens[dir]`（整段层距） | 松手后子组重排（现状语义） |
| **主干（trunk）** | 父出边 → 梁交点的那截干线 | `beamAt[dir]`（梁在空隙中的比例位） | **不动**；短桩伸缩 |

缺省 `beamAt = 0.5`（中点）→ 与今日几何 **逐像素兼容**。

---

## 1. 问题诊断（已核代码）

今日契约（`beamDrag.ts` 头注释 + `beamYUp`/`beamYDown`）：

1. 梁位 = 父出边 ↔ 最近子入边的**中点**  
2. `startLen = |rail − parentEdge| × 2` → 拖梁位移 **1:1** 写进层距  
3. 松手写 `lens[dir]` → 布局权威重排，子节点被推开  
4. 短桩长度 ≈ 半段层距 → 看起来「梁抬多少，分支一起抬多少」

用户场景（上向 hub：四「新节点」汇入横梁 → 落入「培养速读技巧」）：想拉长**父→梁**留白，不想短桩/子盒跟着平移。

---

## 2. 几何模型

对某一方向组 `dir ∈ {up,down,left,right}`：

```
parentEdge ── trunk ──► beamRail ── stub ──► nearestChildEdge
                 │
            gap = lens[dir]   （盒边到盒边）
            beamAt ∈ (0,1)    （从 parentEdge 朝 child 的比例；缺省 0.5）
            trunk = gap × beamAt
            stub  = gap × (1 − beamAt)
```

**梁坐标（替换硬编码中点）：**

```
rail = parentEdge + sign(dir) * gap * beamAt
```

`sign`：`up/left` 为负轴方向，`down/right` 为正（与现 `beamYUp` / `beamXRight` 同向）。

**护栏：**

- `gap` 仍钳 `[SEPARATE_MARGIN, BEAM_MAX_LEN]`（14…600）  
- `beamAt` 钳到使 `trunk ≥ PAD` 且 `stub ≥ PAD`（推荐 `PAD = LINK_CLEAR_MARGIN` 或 8px，换算为 `beamAt ∈ [PAD/gap, 1−PAD/gap]`；gap 过小则锁 0.5）  
- 手写非法值：读侧静默回落 0.5（与 `lens` 容错同纪律）

---

## 3. 协议（节点 note，父节点上）

与既有 `lens` / `hub` 同级，挂在**枢纽父节点**上：

```yaml
hub: true
lens:
  up: 96
beamAt:                 # 新增；可省略
  up: 0.72              # 只写拖过的方向键；hide 缺省不落盘
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `lens` | `{up?/down?/left?/right?: number}` | **不变**：方向组整段层距 |
| `beamAt` | `{up?/down?/left?/right?: number}` | **新增**：梁比例位；缺省/非法 = 0.5 |
| `hub` | boolean | 不变 |

- 序列化：仅当某方向 `beamAt` **≠ 0.5**（浮点容差 e.g. `1e-3`）时落盘该键——保持手写文件干净  
- 透传铁律：未知键仍透传；`beamAt` 纳入已知字段表（protocol §5.2 + changelog）  
- **不做**节点级坐标；**不**改 `centers` / 自由边

往返：parse → serialize → parse 数值容错（数字串）与 `lens` 同。

---

## 4. 交互契约

### 4.1 命中分裂

在现有 `BeamHandle` 上扩展（或拆成两个 handle 共用几何）：

| 区 | 几何 | 光标 | 模式 |
|---|---|---|---|
| **trunk** | 父出边中点 → 梁上交汇点的线段，带宽 `BEAM_HIT_TOLERANCE` | `ns-resize` / `ew-resize`（同向） | `bias` |
| **rail** | 原共享梁 `[lo,hi]`，但扣除交汇处 ±`JUNCTION_PAD`（建议 12px 世界坐标） | 同左 | `lens` |
| 交汇垫 | 主干与梁 T 字交叉附近 | — | **优先 trunk**（摩擦入口） |

无 hub / 非共享梁方向：行为与今日一致（无双把手）。

### 4.2 拖拽中（预览）

与今日相同：**节点盒不动**；只动画梁/干线叠层 + 徽标。

| 模式 | 指针映射 | 徽标文案 |
|---|---|---|
| `lens` | `Δ` → `lens' = clamp(startLen + Δ)`；预览梁按**当前 beamAt** 落在新 gap 上（父边固定、子边假想外推）或保持「梁跟手」但松手后权威重排——**推荐松手前梁跟手，徽标显示层距** | `层距 Npx` |
| `bias` | 指针在空隙轴上的位置 → `beamAt' = clamp((p − parentEdge) / gap)`；**gap 不变** | `主干 Npx`（= `round(gap×beamAt)`） |

取消：Esc / 未过移动阈值 → 不提交（沿用现状）。

### 4.3 松手提交

| 模式 | 写路径 | undo |
|---|---|---|
| `lens` | `controller.updateNote(parentId, { lens: { …prev, [dir]: len } })` | 单条 |
| `bias` | `controller.updateNote(parentId, { beamAt: { …prev, [dir]: at } })`；若回落到 ≈0.5 则**删除该方向键**（最小面） | 单条 |

禁止一次拖拽同时改两个字段。  
禁止 `bias` 模式改 `lens`；禁止 `lens` 模式改 `beamAt`（比例保留）。

### 4.4 布局消费

- `groupGapOf`：**只读 `lens`**（不变）  
- `beamYUp` / `beamYDown` / `beamXLeft` / `beamXRight`：改为 `parentEdge + sign * gap * readBeamAt(parent, dir)`  
- `beamVariants` 避障采样：仍以父↔子空隙为窗；**默认候选**改为 `beamAt` 位（原 `baseBeamY`），其余采样点保留  
- 森林 `islandLinks` 重建：与岛外同一 `beamAt` 公式（勿再写死 0.5）

---

## 5. 实现切片（建议三提交）

| 序 | 主题 | 主文件 | DoD |
|---|---|---|---|
| **B1** | 读侧 + 几何 | `beamSide.ts`（`readBeamAt`）· `branching.ts` 梁坐标 · kernel 单测 | 无 `beamAt` ≡ 中点；有 `beamAt` 梁位偏移；旧夹具像素不变 |
| **B2** | 双命中 + 拖拽映射 | `beamDrag.ts` · MapView 接线 · react 单测 | trunk/rail 命中互斥；bias 不改 len；lens 不改 at |
| **B3** | 协议 + 写路径 + 徽标 | protocol 表 · canvas `onBeamLensChange` 扩为 lens\|bias · 真浏览器/脚本核对 | 往返；徽标文案；CHANGELOG |

每步 TDD：先红后绿；显式路径 add；不 push。

---

## 6. 明确不做

- 半自动「只锁 stub 绝对长度」第二参数（可用 `beamAt`+`lens` 表达，不再加键）  
- 拖梁时实时推动子节点（仍松手重排）  
- Canvas 降级画布上的梁把手（与中心角标同族：SVG 完整）  
- 改自由边 / centers / G7  
- 为「发现性」加教程气泡（可另开 UX 债）

---

## 7. 验收场景（对应用户摩擦）

夹具：`hub: true`，上向 ≥3 子，初始无 `beamAt`。

1. **拖主干向上** → 梁靠近子组；子盒世界坐标不变；短桩变短；文件出现 `beamAt.up > 0.5`；undo 恢复  
2. **拖梁中段向上** → `lens.up` 增大；松手后子组整体外推；`beamAt` 不变；undo 恢复  
3. **旧文档无 beamAt** → 布局与 1.7.x 中点梁 **逐位相同**（回归钉）  
4. 左右 hub 竖梁：对称两把手成立  

---

## 8. 风险

| 风险 | 缓解 |
|---|---|
| 命中抢夺（T 字口） | 交汇垫优先 trunk；rail 扣除 JUNCTION_PAD |
| `lens` 拖预览「梁跟手」与松手权威位短暂不一致 | 徽标写「层距」降低预期；与今日一致属已知 |
| 避障把梁推离 `beamAt` | 保留 variants；默认优先 `beamAt`；脏则次优——须在报告声明 |
| MapView 行数 | 梁逻辑继续放 `beamDrag.ts`；禁止 MapView 再胀大块 |

---

## 9. 相关

- 摩擦对话：梁提升 1:1（2026-09-17）  
- 外派：`docs/dispatch/2026-09-17-beam-dual-handle-prompt.md`  
- 协议现状：`docs/specs/2026-09-02-mm-md-protocol.md` §5.2 `lens`/`hub`/`len`
