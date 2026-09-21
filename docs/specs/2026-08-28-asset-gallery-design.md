# 笔记图库（资产实体化）设计

| 项 | 值 |
|---|---|
| 日期 | 2026-08-28 |
| 状态 | 已批准（brainstorming 收敛） |
| 上游 | spec §4.5 扩展缝矩阵「新内容类型」预留缝；roadmap M2 富内容实验；v1.0 冻结注册表/透传铁律 |
| 定位 | M2 富内容实验首项；spec §4.5 预留缝的第一次真实消费 |

## 0. 设计原则：并存是终态

`![]()` image 节点与 `@img` / `@draw` 实体是**数据形态差异而非版本差异**，长期并存，不搞「统一运动」：

| | `![]()` image 节点 | `@img` / `@draw` 实体 |
|---|---|---|
| 服务对象 | 随手贴图（宽松、无元数据） | 资产图库（强引用、可版本、可复用） |
| 数据形态 | `url` 字段，markdown 语法糖 | EntityRef（kind+id），实体中心 |
| 演进 | 透传宽松 | 走注册表 / resolver / 降级角标 |

两者写同一 `.mm.md`，互不干扰，各自服务不同心智场景。

## 1. 数据契约

- 引用语法：`@img:assets/pic.png` / `@draw:assets/board.svg`（EntityRef，`kind:id` 形态）
- `@img` = 静态资产（png/jpg/svg 文件，只渲染，无编辑交互）
- `@draw` = 可编辑 SVG 白板（FreeCanvas 式，首期只渲染预览，编辑交互预留后续）
- 资产文件存导图同目录 `assets/`（本地优先），引用走相对路径；**resolver 预留插拔**（本地读文件 → 未来远端对象存储）
- 符合 spec 演进纪律 3：资产引用只走 EntityRef 字段，**不开新存储通道**

## 2. 内核落点（极小，全走冻结 API）

- `KIND_META` 增两条目（`img` / `draw` 元信息 + 回退色），`REGISTERED_KINDS` 同步——**无签名变更**，符合 v1.0 冻结语义（minor 可加不可改）
- 复用 KindRegistry / RendererRegistry 槽位：新 kind 注册即校验 + 透传；旧版画布按 unknown-kind 降级通用实体角标（透传铁律兜底，数据不丢）
- 资产读取在 react 侧渲染器完成，内核零 IO

## 3. react 渲染

- **`@img` 渲染器**：节点渲染为图片卡片——缩略图 + 加载态 + 失败降级图标；复用 nodeCardStyle 令牌（形状/边框/圆角随主题）
- **`@draw` 渲染器**：首期内联渲染 SVG 预览（读 `ref.id` 相对路径加载 SVG 文本 → 内联 `<svg>`）；编辑交互预留后续，不侵入现有 text/image 渲染路径
- 渲染器注册走 `createReactRegistries` 的 renderer 槽位注入，与 DemoPlugin 同构

## 4. 图库侧栏面板（右侧）

- 与 FlipCard / OutlinePanel 同构的右侧侧栏：资产列表 → 缩略图网格 + 名称 + 类型徽章（img/draw）
- 交互：点击插入 `@img:assets/x.png`（或 `@draw:...`）引用到**选中节点**下（新建子节点）；拖拽插入预留后续
- 空态引导：无资产时提示「将图片放入导图同目录 assets/」
- **资产清单来源（消除浏览器沙箱歧义）**：浏览器无法任意扫描本地目录，首期资产清单来自**打包进应用的 demo 资产目录**（构建期静态清单 + 资产文件随包分发）；渲染器按 `ref.id` 相对路径从该清单解析。真实文件系统接入（File System Access API / Forgejo contents API）属后续迭代，引用语法与渲染管线不变
- 资产上传 / 删除 / 重命名首期不做（只读浏览 + 插入），文件管理交给文件系统 / Forgejo repo

## 5. 测试

- kernel：`@img` / `@draw` 引用解析 + 序列化往返（round-trip 逐字节）+ unknown-kind 降级透传（新增单测，225+ 基线只增不减）
- react：`@img` 渲染器（成功 / 加载 / 失败三态）+ `@draw` 渲染器（SVG 内联预览）+ 侧栏面板（扫描 / 插入 / 空态）
- 全链路：插入 `@img` 引用 → serialize → 重导 → 逐字节一致

## 6. 明确不做（YAGNI）

- 资产上传 / 删除 / 重命名管理 UI
- `@draw` 的 SVG 编辑交互（首期仅渲染预览）
- 对象存储 / 远端 resolver（本地优先，插拔接口预留）
- 富文本化内嵌图片（方案 B 已否决：破坏纯文本事实源）
- 废弃或迁移现有 `![]()` image 节点

## 7. 验收门禁

- [ ] kernel 新增 `img` / `draw` kind 注册 + 引用解析往返 + 降级透传单测全绿（基线 225+ 不降）
- [ ] react `@img` / `@draw` 渲染器三态 + 侧栏面板单测全绿（基线 126+ 不降）
- [ ] 三包 `pnpm -r test / typecheck / build` 全绿
- [ ] 浏览器实测：插入 `@img` 引用 → 节点渲染图片；旧文件（无 img kind 认知）打开不白屏
- [ ] git log 分步提交（K5 后修复分支独立提交）
