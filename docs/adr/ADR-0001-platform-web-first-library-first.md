# ADR-0001：平台选型 Web-first + 库优先（library-first）

| 项 | 值 |
|---|---|
| 日期 | 2026-08-27 |
| 状态 | 已接受（K0 定案） |
| 上游依据 | 内核重构路线图 · K0；联动 spec §4.8（R14）；内核调研第二辑 §1 |

## 背景（Context）

平台的三个核心目标全部 web 原生：

1. **DSH / 对话 agent 接入** —— 本机 localhost MCP + Web UI；
2. **导图中心** —— sidecar 即 hub，画布是主客户端；
3. **其他项目嵌入副本** —— tldraw「画布基础设施」模式：他项目（如 PomodoroXI 悬浮窗）要能拿到画布副本局部接入，桌面应用无法被嵌入。

同时：性能瓶颈在**渲染架构**而非容器（tldraw/Excalidraw/Figma 全是 web）；稳定性已被纯文本事实源解决（数据在 `.mm.md`/git，不在 IndexedDB）；现有栈零学习成本。

## 决策（Decision）

- **平台：Web-first（PWA + local-first）**。桌面后门保留：PWA 可安装；将来需要托盘/常驻时用 Tauri 包壳同一 web 内核，首期零成本。
- **包结构：库优先（library-first）**：

```
packages/kernel    ← headless：协议 / 布局 / 状态（零 React 依赖）
packages/react     ← 渲染器（消费 kernel）
apps/canvas        ← 完整应用（= kernel + plugins 组合入口）
```

其他项目接入：npm 依赖（首选）或拷贝自包含 `kernel` 包（真·副本）。

## 理由（Rationale）

- spec §4.8 三判据全部指向 web（接入 / 中心 / 嵌入）；
- 库优先使「其他项目获取副本局部接入」成为可能（tldraw 引擎/UI 分离同构）；
- 数据事实源在 `.mm.md`/git，web 的 local-first「长久性」天然满足（Ink & Switch 七理想）；
- 渲染选型上，本内核的富文本节点 / SVG 嵌入 / 翻转交互偏好 DOM/SVG 混合路线（调研 §1 结论 1），web 是唯一主场。

## 后果（Consequences）

- 正面：单一 codebase 同时产出「纯文本版」与「完整版」两个构建产物（`app = kernel + []`）；PWA 免安装；
- 负面/义务：渲染性能需在浏览器约束内优化（dirty-flag + LOD + 按需调度，禁永续 rAF —— 调研 §1 结论 2）；侧载/本地文件能力受浏览器限制，由 sidecar 补足。

## 被否选项（Alternatives considered）

| 选项 | 结论 | 理由 |
|---|---|---|
| 桌面优先（Electron/Tauri 起步） | 被否 | 无法满足「其他项目嵌入副本」；性能瓶颈在渲染架构而非容器；三判据全指向 web |
| 移动原生优先 | 被否 | 首期目标是桌面/局域网工作流，无移动需求 |
| 单包 monolith | 被否 | 无法满足库优先的「副本局部接入」；kernel/react/canvas 边界即解耦边界 |
| Canvas 渲染优先（Excalidraw 路线） | 被否 | DOM/SVG 混合路线更契合富文本/SVG 嵌入/翻转交互；原始绘制吞吐非本内核瓶颈 |

## 关联

- 路线图：`docs/roadmap/2026-08-27-kernel-refactor-roadmap.md`（K0/K3/K5）
- 联动 spec §4.8：`docs/specs/2026-08-27-mindmap-forgejo-sync-design.md`
- 调研第二辑 §1：`docs/research/2026-08-27-mindmap-kernel-oss-research.md`