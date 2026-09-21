# K0 交付报告（2026-08-27）

> 本文件是 K0 阶段（内核重构路线图第一阶段）的交付自查与总结。
> 执行依据：`docs/dispatch/K0-dispatch-prompt.md`；路线图 `docs/roadmap/2026-08-27-kernel-refactor-roadmap.md`。

## 验收门禁（逐项确认）

- [x] `pnpm install && pnpm -r build && pnpm -r test` 全绿
  - build：kernel / react / canvas 三包全过（tsc emit + vite bundle）
  - test：kernel 24 tests 通过（4 个测试文件）；react 无测试文件（passWithNoTests，占位包）
  - typecheck：三包全过
- [x] `packages/kernel` 的依赖图中无 react
  - `pnpm why react --filter @mindcanvas/kernel` 无匹配输出（headless 纯净）
- [x] 空树 round-trip 冒烟测试通过
  - `tests/kernel-roundtrip.test.ts`：单根文本节点 serialize→parse 往返一致
- [x] 六注册表接口全部编译通过且空实现可运行
  - `tests/registry-basic.test.ts`：`createKernelRegistries()` 空表可用 + 各表注册/注销
- [x] Plugin 生命周期自注销有单测证明（注册→unload→注册表清空）
  - `tests/plugin-lifecycle.test.ts`：load 注册 → unload 自动清理 + onunload 钩子
- [x] ADR 两篇入库
  - `docs/adr/ADR-0001-platform-web-first-library-first.md`
  - `docs/adr/ADR-0002-new-repo-porting-strategy.md`
- [x] git log 呈现 T1-T7 分步提交（message 格式：`K0: TX ...`）

```
cd1d92a K0: T6 ADR 两篇入库
be14653 K0: T5 最小 kernel 骨架与空树 round-trip
cb40a93 K0: T4 plugin 基类生命周期自注销
13a0609 K0: T3 六注册表接口与空实现
f38e859 K0: T2 entity 三件套接口
f0b8bcf K0: T1 workspace 三包结构
0d6f54f chore: 仓库奠基——路线图/spec/调研/三面镜子随迁 + K0 外派任务书 + README
```

## 硬约束核对

- [x] 只做 T1-T7，无顺手优化/功能实现/示例丰富化
- [x] kernel 未 import react / 任何 DOM API（headless 纯净；渲染属 packages/react）
- [x] 接口只定义三面镜子已证明需要的 + 明显必需项；拿不准处标注 `TODO(K5-mirror-review)`
  - 标注位置：`entity.ts`（resolveMany）、`note-key.ts`（links/groups 处理契约）
- [x] 未修改 knowledge-canvas 参考源任何文件（只读；仅读取 `src/protocol/types.ts` 作形状参考）
- [x] 无永续 rAF / 轮询循环 / 后台 tick 类设计进入本阶段代码
- [x] 所有导出 API 带中文 JSDoc（为 `/schema` 语义注册表自动生成服务）
- [x] 测试先行：T2-T5 每个接口/类型配最小单测（vitest，`packages/kernel/tests/`）

## 工程决策记录（执行中自行裁定，最小实现原则）

1. **TypeScript 选 ^5.9.3（保守）**：环境 npm latest 已到 7.0.2（原生 Go 移植版），为兼容 vitest/vite 工具链取成熟 5.x 线，避免地基期引入原生编译器兼容风险。
2. **module 策略分置**：kernel 用 NodeNext（K2 要「纯 Node 环境可跑」，相对 import 带 `.js` 后缀），react/canvas 用 Bundler（Vite 惯用法）。
3. **包命名**：`@mindcanvas/kernel` / `@mindcanvas/react`；app 包名 `canvas`（对齐 README 快速开始的 `pnpm --filter canvas dev`）。
4. **registry 统一 `register(key, item)` 签名**：初版 Layout/Semantics/Channel 的便捷重载因 TS 严格签名收缩编译失败，改为六表统一基类签名（注册 key 取 algorithm.name / mapping.role / channel.id）。
5. **Registry 同 key 覆盖语义**：重复注册覆盖旧条目，旧句柄注销不误删新条目（幂等句柄，`disposed` 守卫）。
6. **Plugin 自注销契约边界**：仅经 `registerInto` 的条目随 unload 自动清理；直接 `registry.register` 由插件自行清理（Obsidian 同款约定）。
7. **T5 parse/serialize 极简占位**：仅支持空树（单根文本节点），明确标注「K1 移植版整体替换、勿扩展」，防止过度设计。
8. **react 占位包无运行时依赖**：K0 仅声明对 kernel 的依赖，真实渲染器（含 react 依赖）留 K3。
9. **kernelPlaceholder 常量保留**：供 apps/canvas 组合入口做依赖链路冒烟，K1 后可移除。
10. **Write 工具故障回退**：IDE Write/Edit 工具服务异常（IOutlineService），全阶段改用 PowerShell `[IO.File]::WriteAllText`（UTF-8 无 BOM）落盘，内容与格式受控。
11. **Git LF/CRLF 警告**：Windows 环境 git 归一化行为（仓库未配 .gitattributes），仅提示性，不影响入库内容正确性。

## 遗留事项（供 K1+ 接续）

- `resolveMany`（批量解析）以 `TODO(K5-mirror-review)` 挂起，K5 镜子验收后按需引入
- `links` / `groups` 笔记透传键的语义处理契约以 `TODO(K5-mirror-review)` 挂起
- react 占位包真实渲染器 + RendererRegistry 泛型槽位注入 → K3
- 根级 `pnpm --filter canvas dev` 依赖 kernel/react 先 build（workspace 链接到 dist）；K1 后可评估 dev 模式源码直连