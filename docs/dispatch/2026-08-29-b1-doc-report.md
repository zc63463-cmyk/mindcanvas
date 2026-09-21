# B1 多文档 + 本地持久化 交付报告

> 日期：2026-08-29 · 范围：从单文件 demo → 多文档可用产品（local-first，不接 Forgejo）
> 提交：`feat(doc): B1-T1/T2/T3` + fix（9c96c79 → bf9ae30）
> 基线：react 211 → **218**（+7 测试）；kernel 281 不变；build / typecheck 0 错误

## 一、交付内容

| 任务 | 内容 | 关键点 |
|---|---|---|
| **T1 文档宿主层** | `MindDoc` / `DocumentHost` 契约 + `LocalDocHost` | open（FS Access 优先，不支持 → null 走 file input 兜底）；save 有句柄**直接写回不重复弹框** / 无则弹框或下载；recent（localStorage 上限 8 去重置顶，handle 不序列化）；契约可换 Forgejo/Tauri 实现 |
| **T2 文档栏与流程** | 左上玻璃文档栏（名称 + 未保存 ● + 新建/打开/最近/保存/另存为）+ Ctrl+O/Ctrl+N | doc state 驱动解析 → `controller.reset`（清 history/折叠/选中）+ 实体表重建；未保存守卫 confirm；保存后 markSaved + remember；另存为强制弹框 |
| **T3 切换收尾** | 文档切换后平滑适配新图；首挂跳过重复 fit | reset 语义复用既有 controller.reset（测试已覆盖） |

## 二、验收（dev server :5174，Chrome/Edge 全功能）

1. **Ctrl+S**：弹保存框选择位置 → 写入真实 .mm.md 文件（再次 Ctrl+S 直接写回，不再弹框）
2. **Ctrl+O**：打开任意 .mm.md → 画布切换、折叠/选中/历史清空、视图平滑适配
3. **新建（Ctrl+N）/ 最近列表**：切换文档；有未保存修改时弹确认守卫
4. **另存为**：强制弹框另存新位置
5. 不支持的浏览器（Firefox 等）：打开走文件选择兜底，保存走下载

## 三、工程决策与限制（诚实披露）

| # | 决策/限制 | 说明 |
|---|---|---|
| D1 | **文件层 = File System Access API**（local-first） | 零后端依赖、浏览器原生、可真实落盘验收；`DocumentHost` 契约预留 Forgejo/Tauri 切换（用户此前决策点：已选本地 FS 先行，不接 Forgejo） |
| D2 | **资产持久化仍留宿主契约** | 资产 id 保持「导图相对路径」；物理落盘（把上传资产写入导图同目录）依赖宿主写能力（FS 目录句柄 / Forgejo），本期未实现——P0-P3 的 objectURL 会话级保持不变，文档已标注 |
| D3 | 最近列表存全文（localStorage） | demo 规模可接受；上限 8 防膨胀；handle 不入库（打开最近文档后保存走弹框——合理） |
| D4 | 初始文档 = 内置 gateway 快照（saved=true） | 不产生初始 ●；首次 Ctrl+S 保存到本地才落盘 |
| D5 | 首挂跳过 reset/fit effect | 避免重复动画（controller 首次创建 + MapView 初始 fit 已处理） |

## 四、后续（B1 之外）

1. **资产物理持久化**：宿主写能力（FS 目录句柄 / Forgejo API）——资产与导图同目录落盘，`每导图资产空间`从逻辑变物理
2. **导入导出增强**：.mm.md 拖拽到窗口直接打开（复用 P1 投放管线扩展）
3. **自动保存**（防丢失，dirty 后 debounce 写回 handle）
4. **多标签**（同一时间打开多个文档横向切换）——依赖 controller 实例化改造
