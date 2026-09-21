# DEPTH-VIS-1 外派任务书：深度视觉阶梯（父先于子）

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**DEPTH-VIS-1**。设计权威：`docs/specs/2026-09-18-depth-visual-hierarchy-design.md`。  
> 摩擦：父子节点同亮同粗 → 扫读抓叶漏骨；信息链路应父 → 子。  
> 读者：工程执行 agent。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| 三档 `root` / `branch` / `leaf`（depth 0 / 1 / ≥2）拉开字号·字重·描边·填色对比 | 不改「有子才算父」的切分；不改 branchIndex |
| 父更醒目、叶更弱（V2）；三主题都达标，glass 重点 | 不做选中父链高亮（DEPTH-VIS-2）；不改 FrameOutline |
| `fontOf`/`stroke` 与度量同源，防点不中 | 不改协议 / 布局算法 / FE-FRAME / 总览卡 |
| token 增补见设计 §4 | 不 `git add -A`；不 push |

成功标准：设计 §7；回执含「未提交 + diff --stat」或 commit hash。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `docs/specs/2026-09-18-depth-visual-hierarchy-design.md`（全文）  
3. `packages/react/src/theme/types.ts` · `tokens.ts`（三主题）  
4. `packages/react/src/render/geometry.ts` · `nodeCardStyle` / `CardLevel`  
5. `packages/react/src/render/NodeG.tsx` · 字号字重  
6. `packages/react/src/render/MapView.tsx` · `tier = depth >= 2 ? 'leaf' : 'branch'`  
7. 度量侧：`domMeasure` / `demo/pipeline` 中与 font size 相关分支（须对齐）

---

## 2. 实现要点（权威）

### 2.1 Token

按设计 §4 为 classic / sticker / glass 写入 `sizeRoot`、`weightLeaf`、`strokeWidthRoot` 等；旧字段保持可回退。

### 2.2 单一出口

```ts
export type VisualRank = 'root' | 'branch' | 'leaf';
export function visualRankOf(depth: number): VisualRank;
export function fontOf(token: TokenSet, depth: number): { size: number; weight: number };
```

`NodeG`、度量、（若有）Canvas scene **只许**走上述函数。

### 2.3 nodeCardStyle

扩展支持 `'root'`：描边用 `strokeWidthRoot`；fill/stroke 在 branch 色上略加强（glass 提高不透明）。leaf 再弱一档。

### 2.4 MapView

```ts
const rank = visualRankOf(ln.depth); // 或 depth===0?'root':depth>=2?'leaf':'branch'
const styleKey = `${branchIdx}|${rank}|${entityKind ?? ''}`;
```

### 2.5 测试

| 文件 | 断言 |
|---|---|
| `tests/visual-rank.test.ts`（新） | rank 映射；fontOf 阶梯 size/weight；三主题 |
| `tests/node-card-style.test.ts` 或扩既有 | root 描边 ≥ branch ≥ leaf |
| 回归 | 相关 mapview 冒烟不全红 |

---

## 3. 工作树提示

只改本任务文件；勿 `git add -A`。勿顺手改 FE-FRAME / IO / 协议。

---

## 4. 验证命令

```bash
cd packages/react
npx vitest run tests/visual-rank.test.ts
# 若有卡样式测一并列入
npx tsc -b tsconfig.json
```

目视（回执可附）：glass 主题打开任意深树，确认根 > 一级 > 叶。

---

## 5. 回执格式（交主控）

```text
## 回执 · DEPTH-VIS-1
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] 三档 depth 视觉可分（含 glass）
- [ ] 父醒目 ≥ 叶；fontOf 与度量同源
- [ ] 未改协议 / 布局算法 / FE-FRAME / 选中父链
### 未做 / 风险
```

**禁止**：push；DEPTH-VIS-2；改 FrameOutline；改 branch 分色算法。
