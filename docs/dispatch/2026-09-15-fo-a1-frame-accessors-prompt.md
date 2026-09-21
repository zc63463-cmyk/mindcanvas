# FO-A1 外派任务书：`note.frame` 访问器

> **本文件即开工令**。工作目录 = mindcanvas 仓库根。任务书自包含。  
> 阶段：**FO-A1**（Batch A · Task 1）。完成后停，等验收，勿做 A2。

## 你的角色

工程执行 agent。只做本阶段：协议类型 + `frame.ts` 读写访问器 + 单测 + mm-md 协议表一行。TDD。显式路径提交。不 push。

## 必读（按序）

1. `docs/specs/2026-09-15-subtree-frame-outline-design.md` §3.1（字段形状）
2. `docs/superpowers/plans/2026-09-15-subtree-frame-outline.md` · Task 1（含测试代码，照抄断言）
3. `packages/kernel/src/protocol/section.ts`（访问器风格参考：容错读、不可变写）
4. `packages/kernel/src/protocol/types.ts` · `Note` 接口

## 范围（只许动这些）

**创建**

- `packages/kernel/src/protocol/frame.ts`
- `packages/kernel/tests/frame.test.ts`

**修改**

- `packages/kernel/src/protocol/types.ts` — `FrameSpec` + `Note.frame?`
- `packages/kernel/src/index.ts` — 导出
- `docs/specs/2026-09-02-mm-md-protocol.md` — 字段表 + 修订历史各一行

**禁止**：改 layout / react / canvas；改 `ANCHOR_NOTE_KEYS`；动 `tools/graph-engine/`；实现嵌套校验（那是 A2）。

## 必须交付的 API

```ts
export interface FrameSpec { version: 1; depth: number }
export function frameOf(note: Note | undefined | null): FrameSpec | undefined
export function normalizeFrameDepth(raw: unknown): number | undefined
export function setFrame(note: Note | undefined, depth: number): Note  // 非法 depth → throw Error('invalid frame depth')
export function clearFrame(note: Note | undefined): Note | undefined
```

读侧：`version` 必须严格 `=== 1`；`depth` 为有限整数且 `≥ 1`；否则 `frameOf` 返回 `undefined`（不丢 note 里原值，只是访问器不认）。

## 步骤

1. 按计划 Task 1 写入失败测试 → 跑红  
2. 最小实现 → 跑绿  
3. 协议文档补一行  
4. 提交（禁止 `git add -A`）

```bash
corepack pnpm --filter @mindcanvas/kernel test -- --run tests/frame.test.ts
```

建议 commit message：

```
feat(kernel): add note.frame accessors for subtree outline frames
```

## 停止条款

- 需要改 parser/serializer 才能存 mapping → **停并报告**（预期透传已足够）
- 想加嵌套/`canCreateFrame` → 不做，留 A2
- lint/tsc 因本改动新红 → 修到绿或停报

## 回执格式（交验收方）

1. 起点 / 终点 `git log -1 --oneline`  
2. `git show --stat HEAD`  
3. 测试命令 + 全文通过原文  
4. 导出符号列表（从 index 核对）  
5. 未改文件声明（react/canvas/graph-engine）  
6. 偏差（若无写「无」）

## 验收对照（主控用）

- [ ] 仅 kernel + 协议文档  
- [ ] `frame.test.ts` 覆盖：缺省 / 合法 / 非法读忽略 / set+clear 保留其它键 / normalize  
- [ ] 无 `canCreateFrame` / partition（属后续阶段）
