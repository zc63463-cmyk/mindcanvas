# BD-1 外派任务书：共享梁双把手（方案 C · trunk / rail）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**BD-1**（Beam Dual-handle）。设计已拍板：`docs/specs/2026-09-17-beam-dual-handle-design.md`。  
> 摩擦：拖上向共享梁抬高时短桩/子节点 1:1 跟随——用户要「拖主干只改父→梁；拖梁中段才改整段层距」。

## 你的角色

工程执行 agent。按设计 **B1→B2→B3** 三提交落地；TDD；显式路径提交；**不 push**。做完停下交回执。

## 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|----|------|
| 新键 `note.beamAt.{up\|down\|left\|right}` ∈ (0,1)，缺省 **0.5**（≡今日中点） | 不新增第二套绝对 stub 长度键 |
| **rail** 拖 → 只写 `lens[dir]`；保留既有 `beamAt` | 一次拖拽改两个字段 |
| **trunk** 拖 → 只写 `beamAt[dir]`；**子盒不动**（松手后 gap 不变） | 拖预览期推动子节点 |
| ≈0.5 的方向键不落盘（删键保最小面） | 改 centers / 自由边 / G7 / graph-engine |
| 旧无 `beamAt` 文档布局与中点 **逐位相同** | `git add -A`；push；放宽既有阈值测试 |

命中：trunk = 父出边→梁交点干线；rail = 共享梁段扣除交汇 ±`JUNCTION_PAD`（建议 12）；交汇垫 **优先 trunk**。

## 必读（按序）

1. `docs/specs/2026-09-17-beam-dual-handle-design.md`（全文）  
2. `packages/react/src/render/beamDrag.ts`（把手 / 命中 / `beamLenAfterDrag` / `beamRailDuringDrag`）  
3. `packages/kernel/src/layout/beamSide.ts`（`groupGapOf` / `readLensMap` / `BEAM_MAX_LEN`）  
4. `packages/kernel/src/layout/branching.ts`（`beamYUp` / `beamYDown` / `beamX*` / `beamVariants`）  
5. MapView 中 `beamHandles` / `onBeamLensChange` / 梁预览叠层接线  
6. `docs/specs/2026-09-02-mm-md-protocol.md` §5.2（`lens`/`hub`/`len` 表 —— 本批追加 `beamAt`）

## 范围

**预期改动**

- `packages/kernel/src/layout/beamSide.ts` — `readBeamAt` / 钳制；导出  
- `packages/kernel/src/layout/branching.ts`（及森林重建若写死中点）— 梁坐标吃 `beamAt`  
- `packages/kernel/tests/` — 新 `beam-at.test.ts`（或并入既有 layout 测）  
- `packages/react/src/render/beamDrag.ts` — 双把手、双模式映射、预览 rail  
- `packages/react/src/render/MapView.tsx` — 命中分流、徽标「层距」/「主干」、光标  
- canvas 写路径（`onBeamLensChange` 扩成 lens\|bias，或并列回调）— **单条 undo**  
- `docs/specs/2026-09-02-mm-md-protocol.md` §5.2 一行 + `CHANGELOG.md` 条目  
- 对应 react/canvas 判别测试  

**禁止**

- 重写整棵 branching；放大 MapView「顺手重构」  
- 新 `type` 关键词（用现有 interface / 函数）除非仓库既有风格需要  
- 动 `tools/graph-engine/`  

## 必须交付的测试（先红后绿）

### B1 · 几何

```ts
// 无 beamAt → rail === 中点（与改前公式逐位相等）
// beamAt.up = 0.75 → |parentTop - rail| / gap === 0.75（容差内）
// 非法 beamAt / 数字串 → 回落 0.5；PAD 钳制不让 trunk/stub 塌到 0
```

### B2 · 交互纯函数

```ts
// hit：点在 trunk 带 → mode bias；点在 rail 中段 → mode lens；交汇垫 → bias
// bias 拖：gap 固定，beamAt 随指针变；len 输出不变
// lens 拖：len 变，beamAt 输入保留
```

### B3 · 写路径 / 协议

```ts
// trunk 松手 → 只出现 beamAt；子盒坐标不变（布局重跑后仍同）
// rail 松手 → lens 变；beamAt 不变；子组外推
// beamAt≈0.5 → 序列化无该方向键
// parse→serialize→parse 往返
```

阴性对照（自跑恢复）：强制 `beamYUp` 仍写死 0.5 → B1「0.75」用例必红。

## 步骤

### B1

1. 写失败测（中点兼容 + beamAt 偏移）→ 红  
2. `readBeamAt` + 改 `beamY*`/`beamX*` → 绿  
3. commit：`feat(kernel): beamAt ratio for shared-beam rail position`

### B2

1. 写失败测（命中分裂 + 映射）→ 红  
2. 扩展 `beamDrag.ts` + MapView 命中/预览 → 绿  
3. commit：`feat(react): dual hit targets for beam trunk vs rail`

### B3

1. 写失败测（写路径 / 落盘 / 徽标）→ 红  
2. canvas 提交分流 + protocol/CHANGELOG → 绿  
3. 建议真浏览器或最小脚本：上向 hub 三子，拖主干 vs 拖中段对照  
4. commit：`feat(canvas): persist beamAt; lens vs trunk drag badges`

```bash
corepack pnpm --filter @mindcanvas/kernel exec vitest run tests/beam-at.test.ts
# 若测文件名不同，改成实际路径；并跑 branching / layout 相关回归
corepack pnpm --filter @mindcanvas/react exec vitest run tests/beam-drag.test.ts
# canvas 侧若有 center/beam 写路径测一并跑
corepack pnpm --filter @mindcanvas/kernel exec tsc -b --pretty false
corepack pnpm --filter @mindcanvas/react exec tsc -b --pretty false
```

## 停止条款

- 避障 `beamVariants` 使默认梁位无法贴近 `beamAt` 且无法用「默认优先 + 次优」说清 → **停报**，贴候选 y 表  
- MapView 为接线超过 +80 行且无法下沉 `beamDrag.ts` → 停报拆文件方案  
- 发现左右竖梁与上向横梁公式镜像不一致 → 停报，先补换轴钉再继续  

## 回执格式

1. commits（hash + `--stat`）×3（或合并理由）  
2. 每步红→绿原文  
3. `readBeamAt` / 命中分裂 / 写路径 的 file:line  
4. 声明：旧文档中点兼容；未改 centers/edges；未 push；未动 graph-engine  
5. 偏差（JUNCTION_PAD 实值、徽标文案最终措辞、避障是否挤偏 beamAt）  

## 验收对照（主控用）

- [ ] 拖主干：子不动，短桩伸缩，`beamAt` 落盘  
- [ ] 拖梁中段：`lens` 变，子组外推，`beamAt` 保留  
- [ ] 无 `beamAt` 旧文件布局逐位兼容  
- [ ] 协议表 + CHANGELOG 已记  
- [ ] 未 push  

## 用户摩擦原话（验收语义）

> 这个梁的提升为什么会导致分支线也跟着提升，主要 1:1 太怪了  

通过标准：同一上向 hub 图，**拖父→梁干线**不再带动四子齐步平移；要整体留白时改拖**梁中段**。
