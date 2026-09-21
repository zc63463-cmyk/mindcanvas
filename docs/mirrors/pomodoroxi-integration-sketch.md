# 镜子 3：PomodoroXI 接入设想（消费者规格草稿）

> 状态：设想稿（源自 2026-08-27 联动设计会话 §4.6 镜子表）。用于内核接口设计验收：PomodoroXI 若将来接入，需要内核提供什么。

## 消费者画像

PomodoroXI 是自托管的 FastAPI + Vue3 + PWA 番茄钟时间-事务管理系统（离线优先）。设想中的接入形态：

1. **悬浮窗思维导图**：专注 session 期间以悬浮窗呈现当日任务树（L1~L3 层级），节点即任务项
2. **任务实体**：导图节点引用 PomodoroXI 的任务/番茄记录

## 对内核接口的压力测试点

| 需求 | 考验的接口 |
|---|---|
| 新实体种类 `session:42` / `task:17` | **KindRegistry**：注册新 kind（语法校验/图标/颜色）零内核改动 |
| 从 PomodoroXI API 拉取任务状态（进行中/已完成） | **resolver 契约**：EntityRef → Entity 统一形状，失败返回 unresolved |
| 任务状态变化回显为节点角标 | **渲染器注册表**：按 kind 提供角标渲染（packages/react 侧） |
| 导图节点标记 → 在 PomodoroXI 创建任务 | **SemanticsRegistry**：SemRole（task）→ 落库映射（插件侧） |
| 悬浮窗轻量嵌入（非完整应用） | **库优先**：`packages/react` 作为 Vue 应用可嵌的 web component / iframe 载体 |
| 双向对账（任务在 PomodoroXI 侧完成/修改） | 提议集 / reconcile 语义（见联动 spec §7.3 模式） |

## 验收问题（K5 时逐条回答）

- [ ] 不改内核代码，能否注册 `session` kind 并让旧版本画布安全打开含它的文件？（透传铁律）
- [ ] Vue 技术栈的项目能否消费 `packages/react` 或需 SSR/无渲染路径？
- [ ] 离线场景下 resolver 失败（PomodoroXI 不可达）是否优雅降级为 unresolved 角标？
