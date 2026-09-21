# Mindcanvas

纯文本思维导图与自由画布，基于 TypeScript、React 和 Vite。思维导图使用 `.mm.md`，自由画布使用 `.mc.canvas.json`；文档由用户在浏览器中打开、编辑和导出。

[![CI](https://github.com/zc63463-cmyk/mindcanvas/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/zc63463-cmyk/mindcanvas/actions/workflows/ci.yml)

## 开发状态

这是持续开发中的项目。`main` 从原工程已提交基线 `a2ce72bf122574815bf1b9134253a7bd0349c038` 建立公开源码快照，另行加入 GitHub 配置与可移植性调整；并非宣称产品已发布或所有特性通过验收。

- `codex/workspace-wip`：原主工作区尚未整合的开发内容。
- `codex/summary-node-s5`：摘要节点候选，原锚点 `123d22b773a06c4b8e3f6aa987e5493a2e3fce1b`，**S5 REJECT，待返修**。
- 历史 SHA 用于追溯本地来源，不属于本公开仓库历史；旧历史和完整取证包单独备份。

分支差异、已知限制见 [开发交接](docs/development-handoff.md)。CI 的结果只覆盖列明的自动检查，不代表 S5 已被签收。

## Windows / macOS / Linux 快速开始

安装 Node.js 24（Apple Silicon 使用 arm64 版本）和 Git，然后：

```sh
npm install --global pnpm@10.33.2
git clone https://github.com/zc63463-cmyk/mindcanvas.git
cd mindcanvas
pnpm install --frozen-lockfile
pnpm build
pnpm --filter canvas dev --host 127.0.0.1
```

打开终端输出的本地地址。首次先构建 workspace 包，再启动 canvas。常规前端开发不需要 Docker 或数据库服务。

Mac 使用 APFS 开发目录，Windows 使用 NTFS；exFAT 移动盘可保存备份，避免直接在其中安装需要符号链接的 pnpm workspace。每台电脑独立安装依赖，不复制 Windows 的 `node_modules` 到 Mac。

## 检查与构建

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm depcruise
pnpm lint
pnpm budget
pnpm check:public
```

`lint` 沿用项目的存量 warning 策略；错误会失败。CI 在 Linux 运行完整门禁，在 macOS / Windows 验证安装、类型、测试和构建。运行器架构以 CI 日志为准，不等同于 Mac mini M4 的实机交互验收。

可选浏览器工具使用项目依赖：先 `pnpm exec playwright install chromium`，再按对应 `tools/verify-*.mjs` 的说明启动服务并执行。历史工具有固定端口/夹具要求，不自动纳入通用 CI。

## 目录

| 路径 | 内容 |
| --- | --- |
| `packages/kernel` | 无界面的数据、协议与布局内核 |
| `packages/react` | React 渲染与交互 |
| `packages/free-canvas` | 自由画布模型 |
| `apps/canvas` | Vite 应用入口 |
| `docs/specs`、`docs/adr` | 协议与架构决策 |
| `docs/dispatch` | 历史开发任务与报告，日期与状态以正文为准 |
| `tools` | 诊断与定向验证工具 |

开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)，跨电脑流程见 [开发环境](docs/development.md)。

## 数据与许可

个人笔记、浏览器档案、密钥、环境配置和完整取证包不随本仓库发布。历史文档中的本机路径已作占位替换；省略的本地报告路径不保证可打开。

当前尚未选择开源许可证。公开可见不等于授予开源再分发许可；依赖仍适用其各自许可证。
