# baseline：FILE-ASSETS-CONTRACT-CLOSE 调查起点

任务：FILE-ASSETS-CONTRACT-CLOSE｜记录时刻：2026-09-19 23:25 (+08:00)｜本文件为 T0 产物。

---

## 1. 本文件的作用与不作用

**作用**：固定本轮可证明的起点——提交基线、工作树状态、关键输入的指纹、七份设计文档的本轮可改范围、用户已确认与设计者建议的决策分层。

**不作用**：不宣称工作树内容与任何历史清单逐字节一致；不把状态行计数当作「逐文件未变」的证据；不重算 DELIVERY-CLOSE 的 808 项候选。

---

## 2. 提交基线

| 项 | 值 | 证据 |
|---|---|---|
| HEAD | `a2ce72bf122574815bf1b9134253a7bd0349c038` | `git rev-parse HEAD` |
| HEAD 主题 | `docs(dispatch): ROOT-DRAG-1 收口记录（提交锚定 + 验证证据）` | `git log -1` |
| 分支 | `main`，领先 `origin/main` 66 个提交（会话起点快照） | 会话起点 `git status` |

**HEAD 只是基底，不是本轮实际对象。** 当前工作树含多轮未提交成果（含本设计包）。任何实现都必须基于工作树，不得从 HEAD 单独重建后当作完整当前版本（依据：`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md:5,61`）。

---

## 3. 工作树状态（本轮开工时）

| 项 | 值 |
|---|---|
| `git status --porcelain` 总行数 | **126** |
| 已跟踪修改（` M`） | **48** |
| 未跟踪（`??`） | **78** |

**能证明的边界**：以上是状态行计数，只说明「有 126 条路径处于非 HEAD 状态」。它**不**证明这 126 条路径之外的文件与 HEAD 逐字节一致，也**不**证明这 126 条路径的内容在两次观察之间未变。

**与上一包的差异（可解释的部分）**：

```text
上一包（FILE-ASSETS-DESIGN）交付时：123 条
本轮开工时：                        126 条
新增 3 条：
  ?? docs/specs/2026-09-19-file-assets-design/              （上一包交付的设计目录，已计入 123）
  ?? docs/superpowers/plans/2026-09-19-file-assets-contract-close.md   （本轮任务书）
  ?? docs/dispatch/2026-09-19-file-assets-contract-close-start.md      （本轮启动 prompt）
```

即：新增项全部是本轮/上一轮的文档任务输入，**未发现他方对产品源码的新增修改**。这也不是「产品源码未变」的证明——只说明状态行计数差为 3 且可逐条解释。

### 3.1 他方对本包所依赖设计文档的修订（必须记录，不回滚）

七份设计文档的最近修改时间**晚于**上一包交付时刻，且内容与上一包交付版本不同（例：`shared-contracts.md` §1.2 的 ScopeId 段落已被替换为「两种元数据提议」的表述）。判定依据：

```text
asset-library.md            39,461 B   2026-09-19 22:29:55
current-state.md            32,290 B   2026-09-19 22:53:33
shared-contracts.md         35,817 B   2026-09-19 22:53:33
acceptance-and-backlog.md   36,252 B   2026-09-19 22:53:33
file-management.md          33,048 B   2026-09-19 23:02:13
design-review-receipt.md    13,371 B   2026-09-19 23:04:02
README.md                    7,691 B   2026-09-19 23:06:00
```

**处置**：本轮以**这些修订后的内容**为起点继续补正，逐处校正而不回滚；对历史回执段落使用追加勘误（见 §5）。

---

## 4. 关键输入指纹（SHA-256）

### 4.1 任务输入与上一轮边界

| SHA-256 | 路径 |
|---|---|
| `DBD9510AF7CE66DD5ADFA77B6C778CAA004B657B86C66545830A40569A0409D5` | `docs/superpowers/plans/2026-09-19-file-assets-contract-close.md` |
| `D7F96405093802153818C52CA7EA8078A406D9B2332E243A7E29AC02E8526E33` | `docs/dispatch/2026-09-19-file-assets-contract-close-start.md` |
| `5094419154C034C84023755F48DBF705CD65015D9F6B6C5D245EE0BDD75FF27C` | `docs/dispatch/2026-09-19-delivery-close-final-acceptance.md` |

### 4.2 七份设计文档（本轮补正前）

| SHA-256 | 文件 |
|---|---|
| `3B91E9DB85F53CA7C0AF46133441659051784D477F02457477ED1724749CBB3B` | `README.md` |
| `3D54B71DAE2AE36C989E17ED06384EE845EE273031B980445A490B57D7D3CFC4` | `current-state.md` |
| `97AAE5D2B4462DEC1F425849CB004812CA891CAF24B7F326FD6401D414F05CA1` | `shared-contracts.md` |
| `00285806C0F33C62145A2064E0CE6A409F435B436AFEBA64DAB6DE23FE5B563D` | `file-management.md` |
| `0DAE68748A5B63D7253ABFBADD164E29D4BE57062AF962FCE39EDE36C0A7AA5A` | `asset-library.md` |
| `82237540FC691890373F27CCAC828B4840BC5E59EAC2D4491EA2E6485A87852E` | `acceptance-and-backlog.md` |
| `09E2A3EE1857BE5D97B571332ECE63F9859189E8E2C62A52AE89D7F6A41BA94C` | `design-review-receipt.md` |

### 4.3 契约所依据的源码（读码锚点基线）

| SHA-256 | 路径 |
|---|---|
| `15DF475FCBFDC4A0B77A1F383AE6D461DEBBBAF4A3AB78FD5A2DFFDB6C2D08E2` | `packages/react/src/edit/handleStore.ts` |
| `ADA6CE28D0165070F452C03D91386193D5FFEDAAF5B3FD6B2D1877994C87C2EC` | `packages/react/src/edit/directoryHost.ts` |
| `206630D59A12DDAFCCEFE02A67C356EC472917ADC3D3AD8E28B2DE8AA7BE66CA` | `packages/react/src/edit/directoryTypes.ts` |
| `0EFA9D08CE48E51C0F96A9552BDEF85A5388F6C0AFBD3B3EBB15965FB7619531` | `packages/react/src/edit/save.ts` |
| `6CEEB0357344F3CAADB635F30D985A736EB3AF2D7C98C62AFB03E29B6E27C860` | `packages/react/src/chrome/assetHost.ts` |
| `9B7E75562975165C90C66829BB4FDEFA97FE4413E4F135361E8B0C246967B53D` | `packages/react/src/chrome/idbAssetHost.ts` |
| `689FA51583673B906F5072766DC7B852AB1F7C1364C2FEA124FF0E23A2CD2A78` | `packages/react/src/chrome/workspaceAssetHost.ts` |
| `39E068930794B0111FBEC0D8CA6ED4B7DC8BC1988F7076B22D24B424888CB75B` | `packages/react/src/chrome/AssetPanel.tsx` |
| `EB8479728634DC7AF674E371DCF06A9C5BB97CF448A80B4BBD24048A888FEB4B` | `apps/canvas/src/hooks/useDocumentSaveSession.ts` |
| `A3EA427E005E76AC7AB000FCCBBCB82B4812C82B0E0D78EF992D7F7DB0A4B292` | `apps/canvas/src/hooks/useAutoSave.ts` |
| `0BB1C9503B2ED47032FE0BC5131287013540FCEF661634BFBCEB297D82B84225` | `apps/canvas/src/hooks/useDocumentActions.ts` |
| `F9ACBC216FD3442A22160FE034F19D3C98AF557BF3AFDEDD770E7FF3D91753B8` | `apps/canvas/src/hooks/useUnsavedTransition.ts` |
| `C3CA280FE5F9B69AD07F52B9A2BA3811198CED555599BD86CAF4CBD81EB3BC59` | `apps/canvas/src/documentLifecycle.ts` |
| `D3174F1F53E2D9D058BF31D63A45776092A1E2BF1C0F8C3DE80135EFC5A32EDB` | `apps/canvas/src/MindmapStage.tsx` |

指纹用途：本轮只做文档补正，故指纹用于「证明我读的是哪一版」。若后续有人改动这些文件，对应契约段落需重新核对。

### 4.4 构建/测试配置核对（用于 P0-0 计划的真实命令）

| 事实 | 证据 |
|---|---|
| workspace 包：`packages/*`、`apps/*` | `pnpm-workspace.yaml` |
| 根脚本：`typecheck` / `test` / `depcruise` / `lint` / `budget` / `gate` / `gate:fast` | `package.json:11-25` |
| `@mindcanvas/react` 无 framework 名，包名 `@mindcanvas/react`，测试脚本 `vitest run` | `packages/react/package.json:2,21` |
| `@mindcanvas/react` 测试配置：`include: ['tests/**/*.test.{ts,tsx}']`，默认 `environment: 'node'`，`fileParallelism: false` | `packages/react/vitest.config.ts:6,7,15` |
| 应用包名 `canvas`，测试脚本 `vitest run`，typecheck 同时覆盖 `tsconfig.json` 与 `tsconfig.test.json` | `apps/canvas/package.json:2,11,12` |
| depcruise 实际规则集：`kernel-pure`、`free-canvas-pure`、`kernel-no-node-builtin`、`no-kernel-depends-on-outer`、`no-cross-app`、`no-circular`、`no-orphans`(warn)、`no-duplicate-dep`(warn) | `.dependency-cruiser.js:15-101` |
| **现状 depcruise 没有一条规则禁止 `packages/react` → `apps/canvas`** | 同上（规则 `to.path` 未覆盖该方向） |
| `packages/react/src/index.ts` 已再导出 `./edit/handleStore.js` 与 `./edit/directoryHost.js` | `packages/react/src/index.ts:325-344` |
| 现有测试替身：`handle-store.test.ts` 自建「按引用存储」的内存 IDB 替身，其事务 `onerror` setter 为空实现 | `packages/react/tests/handle-store.test.ts:30-95` |

**关于「没有规则禁止 react→apps」的处置**：依赖方向不会被 depcruise 拦住，因此**不能靠工具兜底**。P0-0 计划把公共结果类型放在 `packages/react/src/edit/**` 并从 `index.ts` 再导出，理由见 `p0-0-implementation-plan.md` §2；本包同时建议后续补一条 depcruise 规则（列为 P0-0 的可选加固项，不作为本轮改动）。

---

## 5. 七份设计文档的本轮可改范围

| 文件 | 本轮可改 | 必须保留 |
|---|---|---|
| `README.md` | 结论表述、DEC 分层表头、阅读顺序、P0 拆包引用 | 已有/提案区分口径 |
| `current-state.md` | R-06/R-17 的处置口径、自由画布决策引用 | 能力矩阵事实、源码锚点、R-01…R-18 的【线索】标记 |
| `shared-contracts.md` | §1.2、§1.4、§3.2–3.4、§4.2–4.5、§5、§6.2–6.3、§7 | 格式纪律、I-1…I-9（新增条目编号向后追加）、方案 A/B/C 比较结论 |
| `file-management.md` | §2.1 最近视图、§3.3/§3.4 改名移动编排、§5.3 部分成功文案、§7/§8 | 4 类线框、删除当前文档三阶段流程、批量操作论证 |
| `asset-library.md` | §1.2 归属表、§2.3 落点徽章、§4.1–4.8、§5 线框文案、§9/§10 | 五类线框结构、SVG 安全边界、四类删除语义分离 |
| `acceptance-and-backlog.md` | §2 降级表、§3 验收项、§4 测试映射、§5 拆包 | G1–G12 结构、F/A/X 编号、负控纪律 |
| `design-review-receipt.md` | **只在文件末尾追加「勘误与后续修订」小节** | 原文全部保留（历史声明不得被改写） |

**独占目录**：`docs/specs/2026-09-19-file-assets-contract-close/`。开工时不存在（`Test-Path` 为假），未使用 `-r2` 后缀。

---

## 6. 决策分层（本轮必须分开呈现）

### 6.1 用户已确认（本轮直接沿用，不再询问，不视为已实施）

| 编号 | 决定 | 设计含义 |
|---|---|---|
| UD-1 | 自由画布首期不纳入工作区与文件面板 | **仅此一条**。不能延伸为「用户批准了自由画布仅会话插图的实施方案」——自由画布的资产能力仍为未设计状态（见 `contract-delta.md` CD-16） |
| UD-2 | 「最近」保留一个入口，按打开时间排序；旧条目缺少真实打开时间时，不得把 mtime 伪装成打开记录 | 索引保留 `openedAt`/`savedAt` 两字段，但 UI 只有一个「最近」入口；`openedAt` 缺失时该条**不进入**按打开时间排序的顶部，也不回填 mtime |
| UD-3 | 提供归档；在可靠移动完成后实现 | 归档**依赖 P0-A 的可靠移动**，不是一个独立的视觉动作；没有可靠移动就不做归档 |
| UD-4 | 引用范围未知时允许用户显式删除资产；必须告知影响与不可撤销边界 | 允许删除 + 显式警告；**仍然禁止**任何自动清理 |
| UD-5 | 索引层不向用户暴露 | 用文件位置、保存状态、来源、待重新定位等用户语言解释，不出现作用域/索引键等概念 |

### 6.2 设计者建议（需复核确认，**不得**使用「用户已确认」表头）

| 编号 | 建议 | 状态 |
|---|---|---|
| DS-6 | 内置图标与上传素材共用收藏与搜索 | 待确认 |
| DS-7 | 同名探测不做内容精确比对，改为「一律进冲突三选」 | 待确认（本轮由 T2 收窄为**推荐最小方案**，见 `contract-delta.md` CD-07） |
| DS-8 | 「从素材库隐藏」需要独立的已隐藏视图 | 待确认 |
| DS-9 | 删除后不提供「撤销」，用归档替代 | 待确认 |
| DS-10 | 旧键删除时序由主控决定，本轮不做删除 | 待确认 |
| DS-11 | 补一条 depcruise 规则禁止 `packages/react` → `apps/**` | 本轮新增建议（§4.4 的现状缺口） |
| DS-12 | 索引层落 `localStorage`（不引入 IndexedDB） | 待确认 |

---

## 7. 本轮的禁止事项（自查清单）

- 不改产品源码、正式测试、门禁、验收脚本（本轮产物仅文档）。
- 不迁移真实数据；不对真实目录试验改名/删除。
- 不提交、暂存、推送、发布；不 `pull`/`rebase`/`reset`/`stash`。
- 不覆盖旧 DELIVERY-CLOSE 证据与历史清单；不重开 DELIVERY-CLOSE。
- 不启动 P0-0 实施，不另建执行任务。
- 不把逻辑反例或测试设计写成「实测通过」。
