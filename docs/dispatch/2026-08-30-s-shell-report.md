# S 产品壳批交付报告

> 日期：2026-08-30 · 从「demo 形态」到「可日用应用壳」· 规划：`2026-08-30-next-phase-roadmap.md` 第 1 步
> 提交：S1（2fcdb5c）→ S2（44c890c）→ S3（89b7002）
> 基线：react 281 → **291**（+10 测试）；kernel 282 不变；typecheck / build 0 错误

## 一、交付内容

| 任务 | 内容 | 关键点 |
|---|---|---|
| **S1 面板互斥收口** | 四个独立布尔 state → 单一 `activePanel` 互斥（search/outline/assets/relation）；面板打开时翻卡让位 | 移动端不再浮层堆叠；快捷键/工具栏/右键菜单全接通；组件层零改动（纯 Stage 组装） |
| **S2 PWA 最小壳** | manifest（standalone + svg 图标）+ SW（导航 network-first / 同源静态 cache-first）+ main.tsx PROD 注册 | 断网可打开上次会话；dev 不注册避免缓存干扰；构建产物验证含 manifest/sw/icon |
| **S3 错误边界** | `ErrorBoundary`（class 边界）：玻璃 fallback = 错误摘要 + 「重载页面」+ 恢复提示（自动保存文档不丢失）；App 层包裹 Stage | 崩溃不再白屏 |

## 二、验收清单

1. 打开任一侧面板（搜索/大纲/图库/关系）→ 其它面板自动关闭，翻卡隐藏
2. 再点同按钮/快捷键 → 面板关闭
3. 生产构建部署后：断网刷新 → 页面可用（SW 缓存）；安装到桌面/主屏 → 独立窗口
4. 手动触发渲染异常 → 玻璃 fallback（错误摘要 + 重载按钮 + 恢复提示），不再白屏

## 三、回归

- react **291/291**（56 files）、kernel **282/282**；typecheck / build 0 错误
- build 的 safe-delete 清 dist 偶发中断（WorkBuddy 沙箱 shim）为已知环境问题，重试即过——非代码问题

## 四、产品壳剩余（等 F 自用周输入）

1. 启动页/最近文档首屏（当前 gateway 默认文档仍硬编码）
2. 面板宽度响应式（小屏全屏化）
3. 设置持久化（主题已持久化；面板偏好/布局偏好待加）

## 五、与总规划的关系

S 批即 `2026-08-30-next-phase-roadmap.md` 第 1 步「产品壳批」。完成后进入 **F 自用验证周**（用真实工作文档跑一周，只记摩擦），F 周产出缺陷清单后按 roadmap 原案回归 B 线（B0 实测已完成首轮，D1 建议达标，待独立环境对照）。
