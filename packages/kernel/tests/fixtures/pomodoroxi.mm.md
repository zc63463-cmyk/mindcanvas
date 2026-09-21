<!--
edges:
  - from: node:PomodoroXI 迁移/P0 缺陷/FTS5 触发器异常
    to: node:PomodoroXI 迁移/P0 缺陷/move_note 不移动文件
    rel: relates-to
    label: 同为数据层
    source: manual
  - from: node:PomodoroXI 迁移/战略/V2EX 发帖
    to: node:PomodoroXI 迁移/战略/先与真实用户对话
    rel: blocks
    label: 发帖前需先验证
    source: manual
-->
# PomodoroXI 迁移

<!--
desc: 从 PomodoroX（Tauri/Vue3）迁到 FastAPI + Vue3 + Docker + Cloudflare Tunnel
-->
- 架构迁移目标：脱离 Tauri 桌面壳，改为自托管 Web 服务

## 架构

### 后端
- FastAPI（Python）— engine.py 732 行，待拆 3 个文件
- SQLite + FTS5 全文检索
- 增量同步（离线优先）

### 前端
- Vue 3 + TypeScript
- Dexie.js（IndexedDB 本地缓存）
- PWA 离线可用

### 部署
- Docker 容器化
- Cloudflare Tunnel 内网穿透
- 自托管，不依赖第三方云服务

## P0 缺陷

- move_note 不移动文件（只改数据库，文件仍在原地）

- _note_path 平铺，忽略目录结构

- FTS5 触发器异常

- .trash 无日期分组，会导致数据丢失

- restore 覆盖现有文件

## 进度

- 20 个功能已实现 / 12 个 stub（NotImplementedError）
- Stage 4（前端）未开始
<!--
qa:
  - 12 个 stub 是「未实现」还是「暂不需要」？决定 Stage 4 的起点
  - engine.py 拆分会动到所有调用方，先补测试再动
-->

## 战略

- 先与真实用户对话 —— 目前最大瓶颈是「0 用户」，所有需求都是我自己推演的

- V2EX 发帖（突破 0 用户）

- 「小记」功能：任务中即时捕捉思考，融入 session/日程/stats

## 技术债

- engine.py（732 行）拆分为 3 个文件
- 补 filesystem 层的集成测试

## 参考

- @issue:1
- @doc:docs/architecture.md
- @milestone:Stage 4 前端
