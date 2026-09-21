# 子树框编辑 · 外派总览与验收约定

> **系列状态：功能外派冻结（FO-HYG1 收口后）** —— A/B、C、C2.1、FIX1–4、UI1、UI1.1、HYG1 全部
> **已验收**；本系列不再外派新阶段（后续债见「系列之外 · 未开清单」，需要时另立系列）。
>
> 你（主控）只做：**写计划 / 出阶段 prompt / 验收**。执行由外派 agent 按阶段 prompt 开工。  
> 设计：`docs/specs/2026-09-15-subtree-frame-outline-design.md`  
> 修正：`docs/specs/2026-09-15-subtree-frame-outline-c-amendment.md`  
> 总计划：`docs/superpowers/plans/2026-09-15-subtree-frame-outline.md`

## 阶段顺序（严禁跳序）

### Batch A/B（已交付 · [1.10.0]）

| 阶段 | Prompt | 状态 |
|------|--------|------|
| FO-A1…A3 / FO-B1…B3 | `2026-09-15-fo-*.md` | **已验收收口** |

### Batch C（产品修正 · 已收口）+ 回归修复

| 阶段 | Prompt 文件 | 产出摘要 | 依赖 |
|------|-------------|----------|------|
| **FO-C1** | `2026-09-15-fo-c1-compact-wrap-prompt.md` | 紧凑大纲行 + 固定列宽换行 + 换行编辑 | B3 已合入 · **已验收** |
| **FO-C2** | `2026-09-15-fo-c2-shell-collision-prompt.md` | 框壳 AABB 体积 + 碰撞分离 | C1 已验收 · **已验收** |
| **FO-FIX1** | `2026-09-15-fo-fix1-hang-subtree-prompt.md` | **P0** 挂出子树丢连线 / 贴边 | C2 后用户实测 · **已验收 `0f83c69`** |
| **FO-FIX2** | `2026-09-16-fo-fix2-drop-desc-chip-prompt.md` | 去掉框内旁侧注释 chip（与幕布注释重复） | FIX1 后 · **已验收 `4e56671`** |
| **FO-FIX3** | `2026-09-16-fo-fix3-hang-sibling-stack-prompt.md` | **P0** 同挂点行多空间同级叠坐标 | FIX2 后 · **已验收 `766584b`** |
| **FO-FIX4** | `2026-09-16-fo-fix4-hang-cross-parent-collision-prompt.md` | **P0** 不同挂点父亲的挂出子树互压（无推挤） | FIX3 后 · **已验收 `e792bcd`** |
| **FO-C2.1** | `2026-09-16-fo-c2.1-hang-envelope-shell-prompt.md` | 壳占位含挂出外包络 → 推基座邻居 | FIX4 后 · **已验收 `ba3a83a`**（报告 `82ebfd8`） |

### UX 债（布局收口后）

| 阶段 | Prompt 文件 | 产出摘要 | 依赖 |
|------|-------------|----------|------|
| **FO-UI1** | `2026-09-16-fo-ui1-frame-depth-stepper-prompt.md` | 改框深度：画布气泡步进器替换 `window.prompt` | C2.1 后 · **已验收 `ca4d19a`+`0d2f864`+`83d5f5c`** |
| **FO-UI1.1** | `2026-09-16-fo-ui1.1-depth-bubble-focus-prompt.md` | 深度气泡抢焦点：Enter 勿落到画布建同级 | UI1 后 · **已验收 `f3cedf3`** |

### 工程卫生收尾

| 阶段 | Prompt 文件 | 产出摘要 | 依赖 |
|------|-------------|----------|------|
| **FO-HYG1** | `2026-09-16-fo-hyg1-series-hygiene-prompt.md` | FO docs 入库 + FIX5→UI1 注释 + 系列冻结（不 push） | UI1.1 后 · **已验收 `febf863`+`fc9c511`** |

### 系列之外 · 未开清单（不外派，等主控另立系列）

`UI2` 框内行右键菜单（FO-UI2）· 成框时选深度向导 · 跨深度拖拽视觉 · 编辑态 Enter 链式 —— **均未开**、本系列冻结后不排期；需要时按新系列走「设计 → 派发 → 验收」同一流程。

## 外派方式

1. 复制对应阶段 **整份 prompt** 发给执行 agent。  
2. 对方：必读 → TDD → 显式路径提交 → 回执。  
3. 回执交主控验收；**未通过不得开下一阶段**。

## 全局纪律

- 不新 `type`；不做方案 Y；`frame` 不进 `ANCHOR_NOTE_KEYS`  
- 相对深度框根 = 0；禁用 `depthOf` 做框相对深度  
- 不动 `tools/graph-engine/`；禁 `git add -A`；不 push  
- Batch C 额外：框内 text = 固定列宽换行；碰撞体 = **框壳**（非每行卡）

## 主控验收清单（通用）

1. [ ] 提交范围正确  
2. [ ] 测试原文  
3. [ ] 无新 type / 未动 graph-engine  
4. [ ] 回执含未做声明  
