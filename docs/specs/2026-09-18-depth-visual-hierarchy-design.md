# DEPTH-VIS-1 · 深度视觉阶梯（父先于子）设计

> 状态：主控拍板口径，供外派。日期：2026-09-18。  
> 摩擦：岛内树父子同款描边/字号/填色 → 扫读时叶子与一级分支抢注意力，**重要信息抓取偏叶子**。用户信息链路默认 **父 → 子**。  
> 范围：SVG 节点卡视觉（`NodeG` / `nodeCardStyle` / 主题 token）；**不**改布局几何、**不**改折叠语义、**不**改 Section/总览卡。

---

## 1. 问题

| 现状（代码事实） | 观感 |
|---|---|
| `tier = depth >= 2 ? 'leaf' : 'branch'`（`MapView`） | depth 0 与 1 **共用** branch 卡色 |
| 根仅 `fontWeight = weightRoot`，字号与一级相同 | 根不够「地标」 |
| 叶：`sizeLeaf` 仅小 1–2px、`strokeWidthLeaf` 略细、leaf 填色略淡 | 深色主题（glass）下父子几乎同亮 |
| 有子节点靠折叠三角区分 | 三角过小，不能单独承担层级 |

结论：**会**导致重要信息抓取偏误——用户先看到密叶文案，漏掉一级骨架。

---

## 2. 目标与非目标

**目标**

1. 一眼分出三档：**中心/根 > 一级分支 > 更深叶子**（父级更醒目）。  
2. 符合读图习惯：对比度与字重 **先服务父级**；叶子更密、更淡、更小。  
3. 三主题（classic / sticker / glass）同语义阶梯；glass 暗底上差距必须够大。  
4. 零协议、零布局盒公式变更（度量仍走既有 `measure`；允许字号变化导致盒高微调——可接受）。

**非目标**

- 选中态「先高亮父再高亮子」的交互动画（另批 DEPTH-VIS-2）  
- 改 branchIndex / 分色算法  
- FrameOutline 框内行样式（另轨；本批可不碰）  
- 总览卡 / Section 标题栏阶梯（已有地标语义）  
- ① freeEdges / FE-FRAME / Nest-align

---

## 3. 口径（禁止再议）

| # | 裁决 |
|---|---|
| **V1 三档** | 视觉档 `VisualRank = 'root' \| 'branch' \| 'leaf'`：`depth===0` → root；`depth===1` → branch；`depth>=2` → leaf。**保持与今日 depth 切分一致**（不改为「有子=父」），避免分色/LOD 连锁。 |
| **V2 父先** | 对比度顺序：root 最醒目 → branch 次之 → leaf 最弱。禁止「叶子比父更亮/更粗描边」。 |
| **V3 字** | root：`sizeRoot`（新，默认 = size+2）+ `weightRoot`；branch：`size` + `weight`（可略升至 560/600）；leaf：`sizeLeaf`（建议再降 1px 相对今日，或保持 sizeLeaf 但增大与 branch 的差：branch 升 1px）。**锁定数值见 §4。** |
| **V4 卡** | root：略厚描边 / 略实填充；branch：branch 色板；leaf：靠 **更淡 fill、更细描边、更小字号/字重** 弱化。**禁止**把 leaf **标题色**压到 `textMuted` / 幕布注释带——标题必须明显亮于 `desc`（glass：leaf.text ≥ `#c8ced8`，desc 继续用 chrome muted）。 |
| **V4b 与幕布分层** | 同卡上：节点标题（含叶子）= 主信息；`note.desc` = 次级注释（更小字 + muted + 竖条）。二者不得同亮同色。 |
| **V5 结构提示** | 有子且非 root：折叠钮保留；可选 root/branch 左侧 **色点**（已有根节点表现则加强，branch 可加 3px chip）。叶子不加色点。 |
| **V6 LOD** | `lodSkipText` 仍按 depth；skeleton 下父子差靠卡色/描边即可。 |
| **V7 Canvas 后端** | 若 scene 用同一 `nodeCardStyle` 则跟随；否则本批只保证 SVG 路径（与 Section 已知边界一致，注明即可）。 |

---

## 4. Token 数值（权威默认）

在 `TokenSet.font` / `nodeStyle` 增补（缺省回退旧行为的主题不得崩）：

| 键 | classic | sticker | glass | 说明 |
|---|---|---|---|---|
| `font.sizeRoot` | 13 | 14 | 13 | 根字号 |
| `font.size`（branch） | 12（↑1） | 13（↑1） | 12（↑1） | 一级略升，拉开与叶 |
| `font.sizeLeaf` | 9 | 10 | 9 | 可保持 |
| `font.weightRoot` | 700 | 700 | 650 | 根更重 |
| `font.weight` | 600 | 600 | 550 | 一级 |
| `font.weightLeaf`（新） | 500 | 500 | 450 | 叶更轻 |
| `nodeStyle.strokeWidthRoot`（新） | 1.8 | 1.8 | 1.6 | 根描边 |
| `nodeStyle.strokeWidth` | 1.4 | （既有） | （既有） | branch |
| `nodeStyle.strokeWidthLeaf` | 1.0 | （既有） | 0.7 | 叶更细 |

填充：不强制新色板数组；`nodeCardStyle` 对 `root` 档用 **branch 色 + 略提高 fill 不透明度 / 略深 stroke**（glass：root fill 更不透明）。实现时三主题各调一版，以「并排截图父>子」目视为准。

---

## 5. 实现落点

| 文件 | 改动 |
|---|---|
| `theme/types.ts` | 增补可选字段（`sizeRoot?` `weightLeaf?` `strokeWidthRoot?`）；读取侧有默认） |
| `theme/tokens.ts` | classic / sticker / glass 填数 |
| `geometry.ts` · `nodeCardStyle` | 第三参由 `CardLevel = 'branch'\|'leaf'` 扩为含 `'root'`，或新增重载 `rank` |
| `NodeG.tsx` | 字号/字重按 rank；root 不再仅靠 boolean |
| `MapView.tsx` | `tier/rank = depth===0 ? 'root' : depth>=2 ? 'leaf' : 'branch'`；styleKey 含 root |
| Canvas `sceneBuilder`（若有卡色） | 对齐 rank，避免 SVG/Canvas 分叉 |

**度量**：`domMeasure` / pipeline 若读 `token.font.size` 按 depth 分支——须与 NodeG **同一函数**（抽 `fontOf(token, depth)`），防止「看起来大、点不中」。

---

## 6. 测试

| 测 | 断言 |
|---|---|
| 纯函数 / token | `fontOf`：depth0 > depth1 > depth2（size 或 weight 字典序） |
| `nodeCardStyle` | root 描边 ≥ branch ≥ leaf；leaf 不比 branch 更「实」 |
| 快照或属性 | 三主题 `fontOf`/`stroke` 阶梯成立 |
| 回归 | 既有 mapview 拖拽/命中不全红；允许盒高因字号微调 |

不要求 Stage E2E 截图门禁（目视由主控收）。

---

## 7. 成功标准

1. 同一分支色下，**根 / 一级 / 叶** 三档肉眼可分（尤其 glass）。  
2. 扫读优先注意到父级标题，叶子不抢戏。  
3. 度量与绘制字号一致；相关 vitest 绿。  
4. 零协议；未改布局算法与 FE-FRAME。

---

## 8. 非本批 / 后续

| 代号 | 内容 |
|---|---|
| **DEPTH-VIS-1.1** | glass 叶标题不得落入幕布注释色带（见 §10） |
| DEPTH-VIS-2 | 选中/聚焦时沿父链轻量高亮（信息链路交互） |
| DEPTH-VIS-F | FrameOutline 行内深度缩进色阶 |

---

## 9. 主控一句话

**三档 depth 视觉阶梯，父重子轻；先修默认观感，交互链式高亮另开。**

---

## 10. DEPTH-VIS-1.1 · 叶标题 ≠ 幕布注释（已拍板）

> 摩擦：glass 暗底下叶子标题灰度贴近 `DescBlock`（`CHROME.textMuted = #98a2b3`），扫读时标题像注释、注释像正文。  
> 原则：**叶变弱靠卡填色/描边/字号/字重，不得把标题字色掉进 muted 注释带。**

| # | 裁决 |
|---|---|
| **L1** | `DescBlock` 继续用 `CHROME.textMuted`（`#98a2b3`）+ 更小字 + 竖条——注释语义不变。 |
| **L2** | glass `leafDefault.text`（及分支 `palette.leaf?.text` 若存在）**≥ `#d3d7e0`**（与 branch 主字同档或仅略弱），推荐直接 **`#d3d7e0`** 或 **`#e8eaef`**；**禁止** `#98a2b3` 及更暗。 |
| **L3** | 叶相对父的「淡」只允许：`sizeLeaf` / `weightLeaf` / `strokeWidthLeaf` / fill·stroke alpha；**禁止**用降标题亮度冒充层级。 |
| **L4** | 测钉：`leafDefault.text` 与 `CHROME.textMuted` **不相等**；相对亮度叶标题 **高于** muted（简单通道和或 WCAG 相对 glass canvas）。classic/sticker 若叶字已明显深于浅底注释则只加「≠ muted」守卫，不强制改色。 |
| **L5** | 同步修正 `glassToken` 头注释（勿再写「文字改 #98a2b3」）；`nodeCardStyle` 叶字必须走 `leafDefault.text` / `palette.leaf.text`，不得另写死 muted。 |

开工令：`docs/dispatch/2026-09-18-depth-vis-leaf-text-dispatch-prompt.md`。
