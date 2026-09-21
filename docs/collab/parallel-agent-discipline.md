# 多 agent 并行协作纪律（mindcanvas）

> 生效日期：2026-08-29 · 触发：主线与资产功能线并行开发，出现「`git add -A` 卷入他人临时产物」与「同一缺陷两条线独立归因」两起事件
> 适用对象：所有在 mindcanvas 仓库工作的执行 agent（含主线维护、功能线外派、用户自推）

## 一、提交纪律（硬性）

### 1.1 禁用 `git add -A`

多 agent 共享工作树时，`-A` 会把**他人的临时产物**一并提交。

```bash
# ❌ 禁止
git add -A && git commit -m "..."

# ✅ 正确：精确路径
git add packages/react/src/render/NodeG.tsx packages/react/tests/geometry.test.ts
git commit -m "fix(render): ..."
```

### 1.2 提交前三步确认

```bash
git status --short          # 逐行核对：有不属于自己的文件 → 不提交，先询问
git diff --stat             # 确认改动范围与预期一致
git log --oneline -3        # 确认基线（他人是否已推入新提交）
```

### 1.3 临时产物即时入 .gitignore

创建任何临时目录（`dogfood-output/`、`out/`、`tmp/`、`*.log`、截图产物等）时，**同一批次**内加入 `.gitignore`，不等到事后清理。

当前已忽略：`.playwright-cli/`、`dogfood-output/`、`node_modules/`、`dist/`、`*.log`。

### 1.4 commit message 规范

```
类型(范围): 简短描述

类型：feat / fix / docs / refactor / test / chore / style
范围：kernel / react / canvas / assets / render / theme / docs ...
示例：fix(render): 资产节点布局为 @img/@draw 预留预览高度（图文不再重叠）
```

## 二、冲突规避（分区与时序）

### 2.1 文件分区（软约定，冲突时以本表为准）

| 区域 | 主责 | 修改前建议 |
|---|---|---|
| `packages/kernel/src/**` | 主线（已冻结 1.0.0，改动需 ADR 合规判断） | **先沟通**——内核是共享地基 |
| `packages/react/src/render/**` | 主线 | 渲染几何/令牌改动先沟通 |
| `packages/react/src/chrome/**` | 功能线 | 面板/浮层可自主 |
| `apps/canvas/src/**` | 功能线（接线层） | 可自主 |
| `docs/**` | 各自目录互不覆盖 | 不修改他人报告文件 |

### 2.2 时序规则

1. **开工前** `git pull` + `git log --oneline -5`，确认基线
2. **长任务中途** 若跨小时，阶段提交后再次 `git pull`（避免长期分叉）
3. **push 前** 若他人已推进，`git pull --rebase` 而非 merge（保持线性历史）

### 2.3 同一缺陷的双重归因（本次事故）

**现象**：资产节点显示异常，主线与功能线各自归因——功能线认为是「SVG 图形太简单」（治标），主线经源码诊断确认是「布局高度未预留」（治本）。

**规则**：
- 遇到**跨层问题**（表现层症状 + 可能的内核根因），**先描述现象与源码位置，不要抢先下结论并动手**
- 涉及 `packages/kernel` 的疑似根因，**交主线诊断**——功能线 agent 通常不具备内核全局视角
- 主线诊断完成会出**纠偏简报**（`docs/dispatch/*realignment*.md`），功能线收到后按简报复验并回执

## 三、接口冻结合规（ADR-0004）

自 1.0.0 起 `@mindcanvas/kernel` / `@mindcanvas/react` 公开导出受 semver 治理：

| 变更类型 | 判定 | 流程 |
|---|---|---|
| 新增**可选**字段/导出 | minor（合规） | 直接做，记 CHANGELOG |
| 新增主题令牌值 | minor（合规） | 直接做 |
| 修改既有签名/行为 | **major** | **必须先写 ADR**，评审后实施 |
| 注册表条目（新增 kind / SemRole） | 非签名变更 | 直接做 |

**判断不准时**：按 major 处理（先问），不要赌。

## 四、验收流程（沿用 K 系列）

每个阶段/任务交付后：任务书 → 执行 → **回报（自述门禁）** → **主线独立复核（重跑测试 + 代码抽审，不轻信自述）** → 放行下一阶段。

交付报告统一落在 `docs/dispatch/`，命名 `<阶段>-report.md`。
