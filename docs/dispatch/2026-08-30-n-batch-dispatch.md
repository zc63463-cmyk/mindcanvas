# 批次 N：实体深化 + 分享闭环（M 线第二轮）

> 日期：2026-08-30 · 定位：M1 已闭合实体链路，本轮把它**做深**（候选可复用 / 交互补齐 / 边界清债）+ 补上**分享闭环**（PNG）
> 前置：M1 实体 picker（42388eb-a2ffd53）· kernel 282 + react 247 全绿
> 冻结纪律：**kernel 零改动**（本轮全在 react / apps 层，纯 minor：新文件 + 既有纯函数分支扩展）

## 一、任务总览

| 任务 | 内容 | 依赖 | 量级 |
|---|---|---|---|
| **N4 `\@` 转义** | 输入 `@@`/`\@` 开头 → 落为纯文本，不弹 picker（M1 已知边界清债） | 无（可先做） | 0.5 天 |
| **N1 EntityHost 候选宿主化** | 实体引用跨文档复用（LocalEntityStore + 打开/保存时登记） | 无 | 1 天 |
| **N2 实体节点右键菜单** | 改引用… / 转纯文本 / 在关系图中显示 | N1（共用 store） | 0.5 天 |
| **N3 PNG 导出** | exportSvg → Image → Canvas 2x → Blob（含外链资产降级） | GH-T4 | 0.5-1 天 |
| **N5 验收 + 报告** | 浏览器全流程 + 数据落档 | 全部 | 0.5 天 |

顺序建议：**N4 → N1 → N2 → N3 → N5**（N4 独立清债先做；N1/N2 同属实体深化可并行外派）

## 二、逐任务改法（深度）

### N4 · `\@` 转义（边界清债）

- **现状**：`onEditCommit` 判定 `t.startsWith('@')` → 一律进 picker；想写纯文本 `@xxx` 会被拦截
- **改法**：
  - 新增纯函数 `packages/react/src/chrome/entityInput.ts`：
    - `isEscapedEntityInput(t)`: `t.startsWith('@@') || t.startsWith('\\@')`
    - `unescapeEntityInput(t)`: 去掉首个转义符（`@` 或 `\`）
  - Stage `onEditCommit`：先判转义 → `commitEdit(id, unescape(t))`；否则走 picker 分支
  - EntityPicker 空态文案补一行：「输入 `@@文本` 可写纯文本」
- **测试**：转义判定（`@x`/`@@x`/`\@x`/`x` 四态）+ 反转义 + 回归（普通文本不受影响）

### N1 · EntityHost 候选宿主化（跨文档复用）

- **现状**：picker 候选 = `entities`（当前文档内存态）；新建 = 输入即 id → **刷新即失、跨文档不复用**
- **改法**：
  - 新增 `packages/react/src/chrome/entityStore.ts`：
    ```ts
    interface EntityRecord { kind: string; id: string; title: string; usedAt: number; docs: string[] }
    class LocalEntityStore {
      list(): EntityRecord[]
      remember(refs: {kind,id,title}[], docName: string): void   // 打开/保存文档时批量登记
      remove(key: string): void
      search(q: string): EntityRecord[]
    }
    ```
    - 持久化 localStorage `mindcanvas.entities.v1`，上限 200（LRU by usedAt）
  - Stage：
    - 文档切换/保存后 `store.remember(documentRefs, doc.name)`
    - picker candidates = store 列表（带来源标记：本文档 / 其他文档）+ 当前文档 entities 合并去重
  - F1 关系面板同源消费（collectEntityRelations 标题优先取 store 的 title）
- **测试**：store 去重（同 ref 再次登记只更 usedAt/docs）/ 上限裁剪 / 持久化往返 / search / 与当前文档合并去重

### N2 · 实体节点右键菜单

- **现状**：`contextMenuItemsFor(controller, id)` 是**纯函数**（可测）；实体节点无专属项
- **改法**：函数签名扩展（保持既有返回值兼容）：实体节点追加
  - 「改引用…」→ 开 picker（同 N1 路径）
  - 「转纯文本」→ `controller.setEntityRef(id, null)`
  - 「在关系图中显示」→ `setRelationOpen(true)` + 面板定位该实体（复用 activeRefKey 联动）
- **测试**：菜单项按节点类型分支（文本节点无三项 / 实体节点有三项）+ 动作回调

### N3 · PNG 导出（含能力探测）

- **现状**：GH-T4 已有 `exportSvg`（纯函数 → SVG 字符串）
- **改法**：新增 `exportPng`（react/src/chrome/exportPng.ts）
  ```
  exportSvg(...) → Blob(svg) → URL.createObjectURL → new Image() → onload
    → canvas(w*2, h*2) → ctx.scale(2,2) → drawImage → canvas.toBlob('image/png')
  ```
  - 2x 分辨率（分享清晰度）；文件名同 SVG（`.png`）
- **风险与降级**：SVG 内含**外链图片**（资产 `@img` 指向远端）时 canvas 会被 taint → `toBlob` 抛 SecurityError
  - 探测策略：先导出无外链资产文档（安全）；含外链时 try/catch → 回落 SVG 下载 + 提示条「含外部图片，已改为导出 SVG」
- **测试**：jsdom 无 canvas → 测「参数构造 + 降级路径」（注入 fake canvas/Image）；真实验收走浏览器

### N5 · 验收与报告

- 浏览器全流程（见下）+ 数据入档 `docs/dispatch/2026-08-30-n-batch-report.md`

## 三、验收清单（:5174）

1. **跨文档复用**：gateway 里引用 issue → 打开另一文档 → picker 候选里能选到上一次的 issue（标「其他文档」）
2. **右键实体节点**：「改引用…」/「转纯文本」/「在关系图中显示」三项可用且生效
3. **PNG 导出**：「导出 PNG」→ 下载 2x 图；含外链资产时降级为 SVG + 提示
4. **转义**：输入 `@@备注` → 落为纯文本「@备注」，不弹 picker；普通 `@门户` 仍弹 picker

## 四、风险与对策

| 风险 | 对策 |
|---|---|
| N3 canvas taint（外链资产） | 能力探测 + try/catch 降级 SVG + 提示；不外链资产场景完整可用 |
| N1 store 膨胀 | 上限 200 + LRU（usedAt 排序裁剪）；localStorage 满 → 静默 |
| N1 与 F1 标题双源冲突 | 明确优先级：当前文档 entities > store > ref.id（文档内最新为准） |
| N2 菜单扩展破坏既有 | `contextMenuItemsFor` 是纯函数且已有测试，扩展只加分支（既有 4 项不动） |

## 五、不做的事（本轮冻结）

- ❌ kernel 改动（本轮全在 react/apps）
- ❌ B 线（forgejo-bridge）——按你的决定跳过；B0 任务书完好、零耦合，随时可回
- ❌ 移动端触控 / Canvas 后端 / M2 富内容——留作下一轮候选
