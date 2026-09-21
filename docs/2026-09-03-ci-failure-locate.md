# 深度定位：CI 门禁「中断卡死」根因

> 日期：2026-09-03 · 方法：Git 元数据 + GitHub Actions API + 本地实测复现
> 结论等级：**P0** —— CI 自建库起 11 次运行全部失败，从未绿过

---

## 一、一句话结论

本地日志全程写着「全绿已推送」，但 **GitHub Actions 从第一次运行起 11 次全红**，
且**每次都失败在同一步：类型检查**。本地测试全绿是因为 **vitest 不做类型检查**，
而本机 `pnpm gate` 又必然卡死（vitest 跑完不退出），导致 typecheck 从未真正跑过。

三件事叠在一起，形成闭环：

```
vitest 跑完不退出（Windows 环境问题）
        ↓
pnpm gate / pre-push 本机必卡 → 只能 --no-verify 推送
        ↓
typecheck 被跳过 → 类型错误混入主干（vitest 全绿，完全掩盖）
        ↓
CI（Linux，不卡）在 typecheck 步骤失败 → 11 次全红且无人看
```

---

## 二、证据链（全部实跑，非读文档）

### 1. CI 状态：11/11 failure

```
$ curl api.github.com/repos/zc63463-cmyk/mdcanvas/actions/runs

11  2026-09-03  e29e93d  completed  failure
10  2026-09-03  e1a7cc2  completed  failure
 9  2026-09-02  1172a66  completed  failure
 8  2026-09-02  63d0dcf  completed  failure
 7  2026-09-02  d4df74b  completed  failure
 6  2026-09-02  0ae2652  completed  failure
 …  （更早 6 次同样 failure，因 API 限流未逐个展开）
 1  2026-09-02  006961d  completed  failure   ← 建库后第一次推送
```

Job 步骤明细（run 11 / `e29e93d`）：

| 步骤 | 结论 |
|---|---|
| 检出代码 / 安装 pnpm / 安装 Node / 安装依赖 | success |
| **6 · 类型检查（3 包）** | **failure** |
| 7 · 测试（794 个） | skipped |
| 8 · 构建 | skipped |
| 9–11 · depcruise / lint / budget | skipped |

### 2. 本地 typecheck：kernel 10 个错误（已修）

```
$ cd packages/kernel && ./node_modules/.bin/tsc -p tsconfig.json --noEmit
tests/verify-roundtrip-note-order.test.ts(13,25): TS2835  相对导入缺 .js
tests/verify-roundtrip-note-order.test.ts(14,46): TS2835
tests/verify-roundtrip-note-order.test.ts(28,28): TS2345  MindNode | null ≠ MindNode
… 共 10 条
```

同一个文件里 10 个类型错误，而 `vitest` 报 **301 全绿** —— 测试与类型检查完全脱节。

### 3. 但更早的提交也红 → 还有第二个原因

`d4df74b` / `63d0dcf` / `1172a66` 都早于今早新增的测试文件，同样失败在 typecheck。
说明存在一个**与今天代码无关的结构性缺陷**。

---

## 三、根因 A（主因）：CI 步骤顺序错误 —— build 排在 typecheck 之后

`.github/workflows/ci.yml` 的步骤顺序：

```
安装依赖 → 类型检查(6) → 测试(7) → 构建(8) → depcruise → lint → budget
                    ↑                ↑
             需要 dist         dist 在这里才生成
```

而：

- `dist/` 在 `.gitignore` 中，`git ls-files | grep dist/` → **0 个文件进仓库**
- `packages/react/tsconfig.json` **没有 paths 映射**，30 个文件 `import from '@mindcanvas/kernel'`
  → 走 package.json `exports` → `packages/kernel/dist/index.d.ts`

**本地复现**（临时移走 `packages/kernel/dist`）：

```
src/chrome/assetDiagnostics.ts(6,44): TS2307: Cannot find module '@mindcanvas/kernel'
src/chrome/EdgeEditor.tsx(11,44):     TS2307: Cannot find module '@mindcanvas/kernel'
src/MindmapStage.tsx(8,43):           TS2307: Cannot find module '@mindcanvas/kernel'
```

→ **即使代码零错误，CI 也必然失败。** 这与记忆里那条「app 层 typecheck 走 dist 而非 src」
是同一个坑，只是这次它发生在 CI 上。

---

## 四、根因 B（今日引入，已修）：新增测试漏跑 typecheck

今早 08:50 修 `verifyRoundTrip` 误报时新增的 `tests/verify-roundtrip-note-order.test.ts`：

- 相对导入缺 `.js`（kernel 用 `moduleResolution: node16`，必须带扩展名）
- `parseMm(src).root` 类型是 `MindNode | null`，直接传给了要求 `MindNode` 的函数

**已修复**，且未新增非空断言（债务预算冻结 bang 只减不增）：

```ts
/** 显式判空抛错来收窄类型，而不是到处补 `!` */
function parseRoot(src: string): MindNode {
  const { root } = parseMm(src);
  if (!root) throw new Error(`解析未产出根节点：${src}`);
  return root;
}
```

修复后：kernel typecheck **10 错 → 0 错**，该测试 4 条仍全绿。

---

## 五、根因 C（环境，会反复咬人）：vitest 跑完不退出

全部重定向到文件（排除管道缓冲干扰）后的实测：

| 用例 | 结果 |
|---|---|
| kernel 40 文件 / 301 测试（node 环境） | **exit=0，正常退出** |
| react 64 文件 / 469 测试 | 全绿但 **exit=124**（挂满 300s timeout） |
| react 单文件（jsdom） | exit=0，正常退出 |
| canvas 4 文件 / 24 测试 | 全绿但 **exit=124** |
| react 前 16 文件，默认 pool | exit=124；改 `--pool=forks` → **exit=0** |
| react 全量 + `--pool=forks` | 仍 exit=124 |

规律：**纯 node 环境从不挂，jsdom 环境必挂**；与规模/组合相关
（8 文件 126 测试挂、8 文件 78 测试不挂）。二分到文件级未找到单一泄漏源 ——
判定为 **Windows 下 vitest worker 回收问题，非代码缺陷**（CI 是 ubuntu-latest，不受影响）。

这条直接导致 `pnpm gate` / pre-push 在本机必然卡死，是整条因果链的起点。

---

## 六、当前实测基线

| 项 | 状态 |
|---|---|
| kernel typecheck | ✅ 0 错（修后） |
| react typecheck | ✅ 0 错 |
| canvas typecheck | ✅ 0 错 |
| kernel 测试 | ✅ 301 绿 |
| react 测试 | ✅ 469 绿 |
| canvas 测试 | ✅ 24 绿（2 skipped = 停用的 stage-render） |
| **CI** | 🔴 **11/11 failure** |

---

## 九、修复结果：方案 B 已实施（commit `7e4acc8`）

用户拍板选 **方案 B**。实施中发现朴素的 paths 行不通，改用 **TypeScript project references**。

### 为什么不是「paths 直指对方 src」

实测给 react 加 `paths: {'@mindcanvas/kernel': ['../kernel/src/index.ts']}` → **78 个新错误**：

```
../kernel/src/layout/mindmap.ts(409,37): TS2532: Object is possibly 'undefined'
../kernel/src/layout/mindmap.ts(415,28): TS18048: 'curr' is possibly 'undefined'
```

**paths 会把对方源码纳入本项目的检查域** —— 用 react 的 `noUncheckedIndexedAccess: true`
（继承自 base）去检查 kernel 源码（它特意设为 `false`）。
project references 的价值正是：各项目**用自己的编译设置**检查，只共享声明文件。

### 实际改动

| 文件 | 改动 |
|---|---|
| `packages/kernel/tsconfig.build.json` | `+ composite: true` |
| `packages/react/tsconfig.build.json` | `+ composite: true` |
| `packages/react/tsconfig.json` | `+ references` → kernel build 配置；`+ paths` 自映射到 src |
| `apps/canvas/tsconfig.json` | `+ references` → kernel + react 的 build 配置 |
| 三个包 `package.json` | `typecheck`: `tsc -p tsconfig.json` → **`tsc -b tsconfig.json`** |
| `.gitignore` | `+ *.tsbuildinfo` |
| `ci.yml` / `CONTRIBUTING.md` | 防回归注释 / 更新过时的「必须先 build」说明 |

两个约束：

- references **必须指向 build 配置**，不能指向 `tsconfig.json` —— 被引用项目不允许
  noEmit（`TS6310: Referenced project may not disable emit`）
- react 的 tests 有包内自引用（`from '@mindcanvas/react'`），需要 react **自己的** dist，
  而 typecheck 是 noEmit 根项目不会构建自己 → 加 `paths` 自映射到 src。
  安全前提是 `src` 内部不使用包名自引用（已 grep 确认），故发布产物不受影响

### 顺带修掉的两件事

1. **今早的 10 个类型错误**（TS2835 + TS2345）已在上一节修复
2. **budget 门禁从未真正执行**（CI 里一直 skipped），掩盖了 `asCast 33 > 上限 31`
   —— 两处 `x as Record<string, unknown>`（serializer.ts / docLibrary.ts）改为
   **类型谓词 `isRecord()`** 消除，零断言

> 附带发现：注释里的示例代码 `val as Record<string, unknown>` 也会被 budget 正则计入，
> 改了注释措辞才真正达标（33 → 32 → 31）。

### 🎁 意外收获：旧 dist 是长期未清理的陈旧产物

重建后发现旧 dist 比新构建**多 39 个文件**（kernel 9 / react 30），
对应源码早已删除的模块（`parse.ts`、`MubuNote.tsx` 等）；
且 `dist/protocol/serializer.js` 内容不同 —— **旧 dist 不含今早的 verifyRoundTrip 修复**。
tsc 不清理输出目录，dist 只会越积越旧。发布前应先删 dist 再 build。

### 验收

- **移走 `packages/*/dist` 后三包 typecheck 全部 exit=0**，dist 由 `tsc -b` 自动重建
- 本地六项门禁全绿：typecheck(3 包) / test(301+469+24) / build / depcruise / lint / budget
- **CI 第 12 次运行：六项全 success** —— 建库以来第一次变绿

| 步骤 | 此前 | 现在 |
|---|---|---|
| 6 · 类型检查（3 包） | failure | ✅ success |
| 7 · 测试（794 个） | skipped（从未跑过） | ✅ success |
| 8 · 构建 | skipped（从未跑过） | ✅ success |
| 9 · 架构依赖守护 | skipped（从未跑过） | ✅ success |
| 10 · 代码检查 | skipped（从未跑过） | ✅ success |
| 11 · 债务预算 | skipped（从未跑过） | ✅ success |

`ci.yml` 未改 —— 方案 B 让 typecheck 自带依赖构建，原步骤顺序即可工作。

---

## 九、续：本机 vitest「跑完不退出」已修（commit `b42b34d`）

这是 §五 那个环境问题的后续。它正是整条因果链的源头，值得单独记录。

### 定位过程

1. 症状边界清晰：kernel（纯 node）从不挂，react / canvas（jsdom）必挂
   → 怀疑 jsdom 的 `pretendToBeVisual`（默认开，会挂 requestAnimationFrame 循环）
2. 实验：设 `environmentOptions.jsdom.pretendToBeVisual = false`
   → 进程**确实退出了**（exit=1，是测试失败码而非超时），
   但 **18 个测试失败 + 10 个 error** → rAF 循环确是句柄来源之一，**但不能关**
3. 参考搜索提到 `--force-exit`，实际本版本（vitest 4.1.11）**没有该选项**（勿信二手资料）
4. 改试 `--no-file-parallelism`（单进程顺序执行，与 `--maxWorkers=1` 不是一回事）
   → **exit=0，469 全绿，正常退出**

### 根因

Windows 下并行 worker 跑 jsdom 测试，worker 结束但句柄未释放，主线程一直等它退出。
单进程无 worker 池，绕开该问题。

### 解法与意外收益

三个包的 `vitest.config.ts` 加 `fileParallelism: false`。**不靠调 timeout 兜底**。

| 指标 | 并行 worker | 单进程 |
|---|---|---|
| react transform | 170s | **14s** |
| react import | 187s | **23s** |
| 进程退出 | 挂死（exit 124） | **exit=0** |

并行时每个 worker 各自 transform，单进程复用模块图 —— 既解决挂死，又快一个数量级。

验证：三包串行跑全部 exit=0，301 + 469 + 24 全绿；CI run 14 同样 success。

### ⚠️ 另一个独立问题：pnpm 在本沙箱跑测试会卡

与上面**不是同一件事**，此前一直被混为一谈：

| 命令 | 结果 |
|---|---|
| `./packages/*/node_modules/.bin/vitest run`（直接） | exit=0 |
| `pnpm -r test` / `--workspace-concurrency=1` / `--filter <pkg>` | 全绿但挂死，exit=124 |

原因：沙箱安全策略阻止 `pnpm` 调用 `wmic.exe`（Windows 上用于管理子进程），
pnpm 等不到子进程退出信号。属**环境限制，非项目问题**，故不改项目脚本去迁就它。
本沙箱内跑测试一律用直接命令；CI（Linux）不受影响。

## 十、尚未处理的相关项

| 项 | 说明 |
|---|---|
| 8 月 157 commits 未进远端 | 只存在于 bundle，历史不连续无法拼接 |
| ~~两个遗留文件未入库~~ | ✅ 已归档（`677dbf5`）：`split-stage.mjs`、`MindmapStage.pre-split.bak` 纳入版本控制，远端有备份，工作树恢复干净。未删除（避免破坏性操作），需要时可 `git show` 取回 |
| **F 自用周从未开始** | 无 friction-log；它是下一轮功能规划的唯一事实源 |
| **E5 网络视图永久挂起** | 触发条件 = friction-log ≥2 条跨文档关系类摩擦 → 因 F 周未开而永远不触发 |
| ⚠️ E5 编号撞车 | roadmap 的 E5 = 网络视图（挂起）；增补批的 E5 = 存储重构（已完成 `b851fb9`） |
| 仓库名 `mdcanvas` vs 项目名 `mindcanvas` | 若是有意缩写则忽略 |
