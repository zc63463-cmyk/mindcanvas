# FO-B3 外派任务书：e2e · CHANGELOG · 交付报告

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。  
> 阶段：**FO-B3**（Batch B · Task 6 / 全功能收口）。**前置：FO-B2 已验收。**  
> 本阶段后全系列暂停，等主控总验收；**不 push**。

## 你的角色

工程执行 agent。补 canvas 真 Stage e2e、CHANGELOG、outputs 报告；修 e2e 暴露的缺口（仅限框编辑相关，禁止顺手重构）。跑门禁。显式路径提交。

## 必读

1. 设计稿 §9 验收直觉（五条必须 e2e 或单测覆盖）  
2. 计划 Task 6  
3. e2e 模板：`apps/canvas/tests/note-flip-host.test.tsx` 或同目录近期 Stage 测试  
4. 既有 FO-A/B 回执与 commits

## 范围

**创建**

- `apps/canvas/tests/frame-outline-host.test.tsx`（文件名可微调）
- `outputs/2026-09-15-subtree-frame-outline-report.md`

**修改**

- `CHANGELOG.md`（新版本段；版本号按当时 HEAD 既有段递增）
- 仅修复 e2e 失败所需的最小代码（回执列清）

**同时（若尚未入库）**可一并提交文档：

- `docs/specs/2026-09-15-subtree-frame-outline-design.md`
- `docs/superpowers/plans/2026-09-15-subtree-frame-outline.md`
- `docs/dispatch/2026-09-15-fo-*.md`（本系列 prompt / overview）

**禁止**：push；扩大范围到无关 open items；动 graph-engine；放宽既有阈值测试。

## e2e 最低用例

1. 成框 → `serialize()` 含 `frame` / `depth` → 重载或再 parse 仍在  
2. 拆框 → `frame` 键删除；幕布字段仍在  
3. 祖先 `depth=1`：子成框失败；孙（挂载层）成框成功  
4. 大纲改 text（若 UI 已通）→ 拆框后节点 text 保留  
5. （可选）改 depth 只改元数据、id 稳定

## 门禁（原文贴进报告）

```bash
# 按仓惯例；至少：
corepack pnpm --filter @mindcanvas/kernel test -- --run
corepack pnpm --filter @mindcanvas/react test -- --run
corepack pnpm --filter @mindcanvas/canvas exec vitest run tests/frame-outline-host.test.tsx
# tsc / depcruise / lint / budget：与近期 dispatch 收口同口径，报告写命令与结果
```

改过 react 源 → **重建 dist**。

## 报告必含

- 各阶段 commit 列表  
- 红/绿原文（e2e + 关键门禁）  
- 规格 §9 五条逐条对应证据  
- 与 `sections` / OutlinePanel / 翻卡：无回归说明  
- `git status --short` 全文  
- 偏差与未做（规格非目标）

## 停止条款

- e2e 失败根因在 B1/B2 设计洞 → 停，写清洞，勿用测放宽掩盖  
- lint/budget 上升无法本阶段消化 → 停报

## 回执格式

1. commits  
2. 报告路径  
3. 门禁摘要  
4. 是否请求主控总验收（是/否）

## 验收对照（主控用）

- [ ] §9 五条有证据  
- [ ] CHANGELOG 有段  
- [ ] 工作树干净或仅允许的保留物（graph-engine / 既有 tmp）  
- [ ] 未 push  
- [ ] 总计划非目标仍未做
