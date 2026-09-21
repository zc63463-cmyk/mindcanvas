# DEPTH-VIS-1.1 外派任务书：glass 叶标题脱离幕布注释色带

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**DEPTH-VIS-1.1**（DEPTH-VIS-1 补丁，**只修字色语义冲突**）。  
> 设计权威：`docs/specs/2026-09-18-depth-visual-hierarchy-design.md` **§10**（L1–L5）。  
> 摩擦：黑色模式（glass）叶子节点标题过暗，与幕布注释（`DescBlock` → `CHROME.textMuted #98a2b3`）同档，扫读分不清「正文标题」与「附属说明」。  
> 前置：DEPTH-VIS-1 三档阶梯已落地（或同工作树）；本批**不重做**字号/字重阶梯，只纠正「叶变弱误伤标题亮度」。  
> 读者：工程执行 agent。做完停下交回执；**不 push**。

---

## 0. 口径（已裁定 · 禁止再议）

| 做 | 不做 |
|---|---|
| glass `leafDefault.text` 提到 **≥ `#d3d7e0`**（推荐 `#d3d7e0` 或 `#e8eaef`） | 不改 `DescBlock` / `CHROME.textMuted`（注释保持 muted） |
| 叶「淡」只靠 fill/描边/字号字重；标题不得用 muted | 不改 DEPTH-VIS-2、FrameOutline、协议、布局、FE-FRAME |
| 测钉：叶字 ≠ `CHROME.textMuted`，且相对 canvas 更亮于 muted | 不 `git add -A`；不 push；不回头把叶字改回 `#98a2b3` |
| 修正过时头注释（禁止再写「叶文字 = #98a2b3」） | 不借机大改三主题分支色板数组 |

成功标准：glass 叶标题肉眼明显亮于同卡幕布注释；测绿；回执含 diff。

---

## 1. 必读（按序）

1. 本任务书全文  
2. `docs/specs/2026-09-18-depth-visual-hierarchy-design.md` **§10**  
3. `packages/react/src/theme/tokens.ts` · `glassToken.color.leafDefault` + `CHROME.textMuted`  
4. `packages/react/src/render/geometry.ts` · `nodeCardStyle`（叶字来源）  
5. `packages/react/src/chrome/DescBlock.tsx` · 只读确认 `color: CHROME.textMuted`（**勿改**）  
6. 既有 `tests/visual-rank.test.ts`（若有）——扩断言，勿拆阶梯测

---

## 2. 实现要点（权威）

### 2.1 Token

```ts
// glassToken.color.leafDefault
text: '#d3d7e0', // 或 '#e8eaef'；禁止 '#98a2b3'
```

- fill / stroke 可保持 DEPTH-VIS-1 的弱霓虹（`.04` / `.16`）——层级靠卡，不靠把字弄灰。  
- 更新 `glassToken` 文件头注释：删「文字改 #98a2b3」；改为「叶标题 ≥ branch 主字档，≠ CHROME.textMuted」。

### 2.2 接线核验

确认 `nodeCardStyle(..., 'leaf')` 的 `text` 来自 `palette.leaf ?? leafDefault`，**NodeG 标题 fill 用 style.text**。若有任何路径写死 muted / `#98a2b3`，改掉。

### 2.3 测试（TDD）

| 文件 | 断言 |
|---|---|
| `tests/visual-rank.test.ts` 或新 `tests/leaf-text-vs-desc.test.ts` | `glassToken.color.leafDefault.text !== CHROME.textMuted` |
| 同上 | 相对亮度：叶标题通道和 **>** `CHROME.textMuted`（或 parse hex 后 R+G+B 更大） |
| 同上 | `nodeCardStyle(glass, palette, 'leaf').text` 满足同上（防接线漂移） |

可选：classic/sticker 只断言 `leafDefault.text !== CHROME.textMuted`（CHROME 恒定玻璃壳，浅底主题叶字本就不是该 hex）。

### 2.4 目视（回执一句即可）

glass 主题打开带 `desc` 的叶节点：标题亮于 `|` 注释行；绿角标仍可最跳，但标题不得看起来像第二行注释。

---

## 3. 工作树提示

- 只改 token + 测（及确需的 style 接线）；勿 `git add -A`。  
- 若 DEPTH-VIS-1 未提交：本批可叠在其上，回执写清文件列表。  
- **禁止**为「更淡」再次降低叶标题亮度。

---

## 4. 验证命令

```bash
cd packages/react
npx vitest run tests/visual-rank.test.ts tests/leaf-text-vs-desc.test.ts
# 按实际新增/扩展文件名调整
npx tsc -b tsconfig.json
```

---

## 5. 回执格式（交主控）

```text
## 回执 · DEPTH-VIS-1.1
### commits（或「未提交」+ git diff --stat）
### 测试原文（绿）
### 口径自检
- [ ] glass leafDefault.text ≥ #d3d7e0 且 ≠ CHROME.textMuted
- [ ] 叶淡靠卡/字号，不靠标题 muted
- [ ] DescBlock 未改；头注释已修正
### 未做 / 风险
```

**禁止**：push；改 DescBlock 颜色；DEPTH-VIS-2；把叶字改回 `#98a2b3`。
