# 图库深度优化（P0–P3）交付报告

> 日期：2026-08-29 · 范围：资产图库四向深度优化 · 提交：`feat(assets): P0`~`feat(assets): P3` 四个 commit
> 基线：react 182 → **198**（+16 测试）；kernel 281 不变；`pnpm -r build / typecheck` 0 错误

## 一、交付内容

| 任务 | 内容 | 关键点 |
|---|---|---|
| **P0 资产来源宿主化** | `AssetHost` 契约（listAssets/resolveAsset/uploadAsset/hasAsset）+ `DemoAssetHost` 注入 | 每导图一个资产空间：资产 id = 导图相对路径；清单异步、上传 objectURL 会话级；MindmapStage 写死清单 → 宿主注入 + 清单 state |
| **P1 拖拽/粘贴上传** | 文件拖入画布/粘贴 → host.uploadAsset → 插入 `@img` 引用 | MapView 容器 dragOver（Files 放行 + 虚线高亮）/drop/paste + `onAssetFiles` 可选回调；逐文件 TreeOp，undo 可回退 |
| **P2 资产失效态** | `@img` 加载失败 → warn 占位（虚线框 + ✕ 提示）；面板失效标识 | 替代原「静默隐藏」；修复 href 变化后失败态不重置的缺陷；AssetPanel `isMissing` 可选 prop → 失效项禁插 |
| **P3 缩略图/懒加载** | AssetPanel 窗口化虚拟滚动 + 缩略图 | 500 资产 DOM 从 500 → <60（O(可视)）；`resolve` 可选 prop → 32×22 objectFit 缩略图，加载失败自动隐藏 |

## 二、验收与门禁

- react 全量 **198/198**（36 files）；kernel **281/281**；typecheck / build 0 错误
- 浏览器验收路径（dev server :5174 已跑，Vite 热更新）：
  1. `Ctrl+Shift+A` 图库 → 两 demo 资产带缩略图
  2. **拖一张图片文件到画布** → 画布出现虚线高亮 → 松手 → 选中节点下插入 `@img` 节点并渲染图片；`Ctrl+Z` 可回退
  3. **粘贴图片**（截图）→ 同上
  4. 把节点 `@img` 引用改为不存在的路径（如 `assets/missing.png`）→ 卡片出现 warn 虚线框 + 「✕ 资产缺失」（刷新后 objectURL 资产失效同样呈现）
  5. 图库清单缺失项（演示：无）→ 面板 warn 标识 + 禁插

## 三、工程决策与限制（诚实披露）

| # | 决策/限制 | 说明 |
|---|---|---|
| D1 | 上传资产为 **objectURL 会话级**（刷新失效） | 浏览器沙箱无法落盘；真实持久化 = 宿主实现（HTTP/自托管 FS），接口已留 `uploadAsset` 契约 |
| D2 | 每导图一个资产空间 | 资产 id 保持导图相对路径（`assets/xxx.png`），迁移不碎；渲染经 `host.resolveAsset` 拼 URL |
| D3 | AssetPanel 无签名破坏 | `isMissing`/`resolve` 均为可选 prop；既有 4 测试原样通过 |
| D4 | 失败态样式全走 token（warn） | 与 ADR-0003 三主题一致，无硬编码色值 |

## 四、后续建议（P0–P3 之外）

1. **HttpAssetHost**：接自托管静态托管/Forgejo API，`listAssets`/`uploadAsset` 换网络实现即真实持久化
2. **失效诊断入解析层**：parse 时结合宿主清单产出「引用缺失」诊断（W-ASSET-MISSING），面板/大纲联动
3. **缩略图缓存**：大图集时缩略图 URL 加尺寸参数（宿主侧生成），减少带宽
4. 图库项右键：删除资产（含树内引用检查）——需要宿主 delete 契约扩展（major 前置评估）
