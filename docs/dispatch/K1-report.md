# K1 交付报告（2026-08-27）

> 本文件是 K1 阶段（协议层整体移植 + 透传铁律固化）的交付自查与总结。
> 执行依据：`docs/dispatch/K0-dispatch-prompt.md` 后续的 K1 外派任务书；路线图 K1 段（`docs/roadmap/2026-08-27-kernel-refactor-roadmap.md`）。

## 验收门禁（逐项确认）

- [x] `pnpm install && pnpm -r build && pnpm -r test` 全绿
  - build：kernel / react / canvas 三包全过
  - test：kernel **93 tests / 12 文件**全过；react 无测试文件（占位包 passWithNoTests）
  - typecheck：三包全过
- [x] `packages/kernel` 依赖图无 react / DOM（`pnpm why react --filter @mindcanvas/kernel` 无匹配）
- [x] 参考源协议相关测试数量无遗漏
  - **已移植 5 文件 / 58 用例**（仅依赖协议层）
  - 参考源 import 协议模块的测试共 **13 文件**；差额 **8 文件**因依赖非协议模块（state / layout / forgejo / components / mermaid），属 K2/K4（见「未移植测试清单」）
- [x] 三个透传铁律测试通过（未知 kind / 未知 note 键 / 混合）—— `tests/passthrough-ironlaw.test.ts`
- [x] 三份 demo 画布 fixtures 解析无 E 级（错误级）诊断 + round-trip 幂等 —— `tests/demo-fixtures.test.ts`
- [x] K0 原有测试继续全绿：entity（8）+ registry（10+2 builtin）+ plugin（4）+ roundtrip（2）= 26 测全过
- [x] git log 呈现 `K1: TX ...` 分步提交

```
1cbf0a1 K1: T5 demo 画布 fixtures 抽样验证
84f0e15 K1: T4 透传铁律固化测试
326186f K1: T3 与 K0 模块接线
4a789c9 K1: T2 协议测试随迁
bea2daf K1: T1 协议层目录级移植
```

## 移植文件清单（源 → 目的地）

### 协议源码（<local-path> → packages/kernel/src/protocol/）

| 源文件 | 目的地 | import 改动 |
|---|---|---|
| types.ts | types.ts | 无（自身无 import） |
| parser.ts | parser.ts | `'./types'` → `'./types.js'`（NodeNext 显式扩展名） |
| serializer.ts | serializer.ts | `'./parser'`→`'./parser.js'`、`'./types'`→`'./types.js'` |
| uri.ts | uri.ts | 无 |
| goldenCases.ts | goldenCases.ts | `'./types'` → `'./types.js'` |

> 全部逻辑逐字忠实拷贝；唯一改动是相对 import specifier 机械追加 `.js` 扩展名（NodeNext 要求），不触任何逻辑。

### 协议测试（knowledge-canvas\tests\ → packages/kernel/tests/）

| 源文件 | 用例数 | 改动 |
|---|---|---|
| parser-compat.test.ts | 7 | import 加 `.js` |
| parser-golden.test.ts | 31（T01-T30 + 零噪声） | import 加 `.js` |
| serializer-roundtrip.test.ts | 10 | import 加 `.js`；fixture `?raw` 指向 `./fixtures/` |
| validateId-prefix.test.ts | 7 | import 加 `.js` |
| safeHref.test.ts | 3 | import 加 `.js` |

### fixtures（knowledge-canvas\src\demo\canvas\ → packages/kernel/tests/fixtures/）

- gateway.mm.md / roadmap.mm.md / ideas-pool.mm.md（T2 随 serializer-roundtrip 依赖落位，T5 复用，无重复拷贝）

## 接线设计决策（T3，本阶段唯一新代码）

1. **Entity 形状以协议层为准**：`entity.ts` 的 Entity/EntityRef/UnresolvedReason/unresolvedEntity/refKey 改为 re-export 自 `protocol/types.js`；保留 K0 独有 `isUnresolved` / `Resolver` 契约 —— K0 entity 测试原样通过（对外 API 未破坏）。
2. **协议层 vs 注册表的关系**：协议层持有**语法事实**（`REGISTERED_KINDS` 参与 parseContent 的已知 kind 判定、`KIND_META` 提供默认展示元信息、`validateId` 解析期直接使用）；运行时 `KindRegistry` 持有**独立容器**，插件可增删/覆盖。`registerBuiltinKinds` 是**显式种子**（非自动注册），保持「空注册表 = 纯文本内核」语义不变；`validateId` 槽位暂不接线（TODO(K5-mirror-review)）。
3. **包入口重名规避**：协议 types 的 Entity 等经 entity re-export；index 用显式命名导出其余协议类型/值（`REGISTERED_KINDS`/`KIND_META`/`KIND_FALLBACK_COLOR`/`validateId`/`stripOrgPrefix` 与 `RegisteredKind`/`MindNode`/`Note`/`Diagnostic`/`ParseResult`），避免 `export *` 同名冲突。

## 未移植测试清单（差额 = 依赖非协议模块）

| 参考源测试 | 依赖的非协议模块 | 归属 |
|---|---|---|
| treeOps.test.ts | state/history、protocol/parser | K2（headless 树） |
| mindmap-layout.test.ts | state/treeOps、layout/mindmap | K2 |
| relations.test.ts | layout/relations | K2 |
| wrap.test.ts | layout/wrap、layout/nodeLayout、state/treeOps | K2 |
| merge-3way.test.ts | forgejo/merge | K4（保存管线） |
| resolver-scope.test.ts | forgejo/resolver | K4 |
| entityCard-lines.test.ts | components/entityCard | K4（渲染层） |
| mermaid-export.test.ts | mermaid/export | 后续（导出模块） |

## 发现 / 冲突清单（以参考源代码为准，不改移植代码）

1. **文档 vs 代码冲突（已按代码为准）**：派发任务书 T4 示例 `@future-kind:xyz` 含连字符；协议 kind 语法为 `[a-z][a-z0-9_]*`（无连字符），连字符 kind 会落为普通文本且无诊断。T4 铁律测试改用 `@futurekind:xyz` 验证未知 kind 透传。
2. **观察项（非 bug）**：goldenCases.ts 头部 T15/T23 erratum 为规格-实现冲突的文档化修正，移植完整保留；未发现需要记录的疑似运行时 bug（参考源 326 测试固化下协议行为稳定）。

## 工程决策（执行中自行裁定，均最小实现原则）

1. **kernel 包关闭 `noUncheckedIndexedAccess`**：参考源 strict 无此选项，移植代码按 Bundler + strict 编写；关闭后保持逐字忠实（不给移植代码加断言/改逻辑），其余严格选项（strict / verbatimModuleSyntax / isolatedModules / NodeNext）保留。react/canvas 继承 base 不受影响。
2. **NodeNext 显式扩展名**：仅对移植文件的相对 import specifier 机械追加 `.js`（NodeNext 必需），逻辑零改动。
3. **fixtures 落位时机**：T2 随 serializer-roundtrip 测试依赖一并落位，T5 直接复用（无重复拷贝）。
4. **包入口分阶段**：T1/T2 索引暂只暴露协议层（entity/registry/plugin 因与协议 types 重名需先接线），T3 接线后恢复全量导出。
5. **kernel 依赖图保持零运行时依赖、零 react / DOM**（硬约束 4 持续满足）。
6. **测试先行**：T4/T5 新测试先写后验，对已移植协议层即刻转绿，即证明移植正确（若有红则指示移植问题）。

## 遗留事项（供 K2+ 接续）

- `resolveMany`（批量解析）与 `validateId` 运行时槽位接线 → TODO(K5-mirror-review)
- 协议测试中依赖 state/layout 的 8 个文件 → K2/K4 移植时随迁
- 参考源 mermaid-export 模块 → 导出功能立项时再移植
- golden 与旧仓库抽样 diff（roadmap K1 验收「旧文件新内核解析与旧内核一致」）→ 可在 K2 布局/状态落地后补做全量对照