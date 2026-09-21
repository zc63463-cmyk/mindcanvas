# BD-FIX1 外派任务书：lens 层距起点用真 gap（修 startLen ×2 中点假设）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**BD-FIX1**（P1 回归）。**前置：BD-1（B1→B3）已合入** `ea18c74` / `d284890` / `5e15b0c`。  
> 主控审查：双把手 bias 路径正确；**先调 `beamAt` 再拖梁中段**时 `startLen` 仍按「中点 ×2」虚高 → 层距跳变，摩擦复发。

## 你的角色

工程执行 agent。只修 `startLen` 与被钉错的测试期望；TDD；显式路径提交；**不 push**。做完停下交回执。

## 现象（主控已复算）

夹具：上向 hub，`gap = 96`，`beamAt.up = 0.75` → `rail = 28`。

| 量 | 值 |
|---|---|
| 真层距 `gap = \|childEdge − parentEdge\|` | **96** |
| 现行 `startLen = \|rail − parentEdge\| × 2` | **144** |
| 虚高 | **+48** |

用户先拖**主干**抬梁，再拖**梁中段**哪怕 1px → 提交 `lens ≈ 145`（本应 ≈ `96+Δ`）→ 子组猛外推，体感仍像「1:1 / 一拖全乱」。

根因（已核）：

```ts
// packages/react/src/render/beamDrag.ts ~L164
const startLen = Math.max(BEAM_MIN_LEN, Math.round(Math.abs(g.rail - parentEdge) * 2));
```

中点时代 `\|rail−parent\|×2 ≡ gap`；`beamAt ≠ 0.5` 后恒假。  
测试还把错误钉死：`beam-drag.test.ts` 期望 `startLen === 144`。

## 口径（已裁定）

| 做 | 不做 |
|----|------|
| `startLen = max(BEAM_MIN_LEN, round(\|childEdge − parentEdge\|))`（真 gap） | 不改 `beamAt` 协议 / 命中分裂 / 徽标文案 |
| 改错测试：`at=0.75` → `startLen === 96`（不是 144） | 不改 kernel 梁坐标公式（已正确） |
| 加判别：`at≠0.5` 时 lens 微拖提交 ≈ `gap+Δ`，禁止跳到 `2×trunk+Δ` | 不加宽 trunk 命中（P2 发现性另批） |
| 注释删「rail 是中点」过时表述 | 不动 centers / edges / graph-engine；禁 `git add -A`；不 push |

`beamLenAfterDrag` / `beamRailDuringDrag` / `beamDragCommit` **映射公式可不动**——修好 `startLen` 基线即够。

## 必读

1. `docs/specs/2026-09-17-beam-dual-handle-design.md` §4.2–4.3（lens 写整段层距）  
2. `packages/react/src/render/beamDrag.ts` · `buildBeamHandles`（`startLen`）· `beamLenAfterDrag`  
3. `packages/react/tests/beam-drag.test.ts` L81–98（错误期望 144）  
4. 主控审查要点：虚高导致「bias 后再 rail」跳变  

## 范围

**修改（预期）**

- `packages/react/src/render/beamDrag.ts` — `startLen` 改真 gap；头注释/`BeamHandle.startLen` 注释去中点假设  
- `packages/react/tests/beam-drag.test.ts` — 改 144→96；**追加** lens@at=0.75 微拖提交钉  
- 可选：`packages/react/tests/mapview-beam-drag.test.tsx` 或 canvas 写路径薄测（真管线：先 bias 再 lens，断言 lens 增量 ≈ 指针 Δ）  

**禁止**

- 顺手做 P2 命中加宽 / 避障重排 / 协议改键  
- 放宽既有 bias「子盒不动」断言  

## 必须交付的测试（先红后绿）

```ts
// 1) 改期望后若实现未动 → 仍红（证明旧实现）
const h = soleHandle(atOfUp); // at=0.75, gap=96, rail=28
expect(h.startLen).toBe(96);          // 修前：received 144
expect(h.startLen).not.toBe(144);

// 2) ★ lens 微拖不得跳变（修前必红）
const st = dragState(atOfUp, { mode: 'lens' });
expect(st.len).toBe(96);
const next = beamDragMove(st, { x: st.handle.parentCenter, y: st.startW.y - 10 }); // up：向上拉长
expect(next.len).toBe(106);           // 修前：≈ 154（144+10）
expect(beamDragCommit(next)).toEqual({ kind: 'lens', dir: 'up', len: 106 });

// 3) 缺省 at=0.5 回归：startLen 仍为 96（与改前数值相同，公式语义变了但中点时等价）
expect(soleHandle().startLen).toBe(96);
```

阴性对照（自跑恢复）：改回 `* 2` 公式 → 用例 1/2 必红。

## 步骤

1. 先改测试期望 + 追加微拖钉 → 红（贴 `expected 96 / received 144`、`expected 106 / received 154`）  
2. 改 `startLen` 为真 gap + 注释 → 绿  
3. 跑 beam-drag 全文件 + 可选 mapview-beam / beam-at-write  
4. 显式路径提交  

```bash
corepack pnpm --filter @mindcanvas/react exec vitest run tests/beam-drag.test.ts tests/mapview-beam-drag.test.tsx
corepack pnpm --filter @mindcanvas/canvas exec vitest run tests/beam-at-write.test.tsx
corepack pnpm --filter @mindcanvas/react exec tsc -b --pretty false
```

建议 commit：`fix(react): beam startLen use true gap not midpoint doubling`

## 停止条款

- 发现 canvas 写路径另有「用 \|rail−parent\|×2 推 lens」的第二拷贝 → **停报**并列出 file:line，勿只改一处装绿  
- 修后 at=0.5 中点路径数值漂移 → 停报（中点必须与改前逐位等价）  

## 回执格式

1. commit hash + `--stat`  
2. 红→绿原文（含 144→96、154→106）  
3. `startLen` 最终表达式 file:line  
4. 声明：未做 P2 命中加宽；未改 beamAt 协议；未 push；阴性对照已跑并恢复  
5. 偏差  

## 验收对照（主控用）

- [ ] `at=0.75` 时 `startLen === gap === 96`  
- [ ] lens 微拖提交 `gap+Δ`，不再 `2×trunk+Δ`  
- [ ] `at=0.5` 数值回归不变  
- [ ] 未 push  

## 用户体感（验收语义）

先拖主干抬梁，再拖梁中段微调层距 → **平滑增减**，禁止子组「弹开一截」。
