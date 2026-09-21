# 跨电脑开发

Node.js 24 / pnpm 10.33.2；依赖以 pnpm-lock.yaml 为准。禁止提交 node_modules、构建目录、个人文档或登录信息。

## 切换开发线

```sh
git fetch origin
git switch --track origin/codex/summary-node-s5
pnpm install --frozen-lockfile
pnpm build
pnpm --filter canvas dev --host 127.0.0.1
```

分支已经存在时用 `git switch codex/summary-node-s5`。主开发暂存线同理使用 `codex/workspace-wip`。切换前处理当前改动；不要用 reset --hard 丢弃它们。

换电脑前在功能分支提交并推送，另一台电脑拉取后安装依赖。Git 不同步 IndexedDB、未提交文件或应用中的未导出文档；需要的个人文档另行保存。不要让网盘同时同步整个活动 Git 工作区。

## 本地检查

从克隆仓库执行 README 中的检查。构建产物按本平台重新生成。若使用 Corepack，仍以 packageManager 指定版本为准。

历史 tools/graph-engine 是可选 Python 子工具，按其说明重新建虚拟环境；不搬运原 Windows venv。主前端无须此工具即可启动。

## GitHub 工作流

main 为集成线，功能修改用分支与 PR。S5 尚未通过验收；测试全绿也不会自动合并。

CI 使用只读仓库权限，不读取部署密钥，不运行自动发布。新增公开内容由 `pnpm check:public` 检查路径边界，并运行 Gitleaks 检查密钥。无法靠自动扫描证明任意文本都不含私人资料；提交前阅读自己的差异。

需要保留证据时，只提交脱敏后的小型文本证据到 docs/evidence/。完整浏览器日志、截图和本机取证包独立保存，不自动上传。

如使用 Git hooks，可自行 `git config core.hooksPath .githooks`；CI 不依赖本机 hook。仓库不预配置任何机器专属代理或凭据。
