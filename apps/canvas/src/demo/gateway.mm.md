<!--
edges:
  - from: node:Agent Gateway/我的想法/先只读，把引用解析链路跑通
    to: "@issue:8"
    rel: blocks
    label: 待验证
    source: manual
  - from: node:Agent Gateway/任务（真实 Issue）
    to: node:Agent Gateway/里程碑
    rel: relates-to
    label: 里程碑归属
    source: manual
-->
# Agent Gateway

## 文档（Forgejo 真实）
- @doc:docs/01-architecture.md
- @doc:docs/07-entity-ref-protocol.md
- @doc:docs/09-knowledge-canvas-and-conventions.md

## 任务（真实 Issue）
- @issue:1
<!--
qa:
  - 评价观点，对比事实，形成自己的判断
  - 解析路径要可观察：每步存疑与决策可回放
-->
- @issue:6
- @issue:8

## 里程碑
- @milestone:门户显示优化

## 灵感联动
- @idea:forge-inbox:2

## 断裂引用（unresolved 演示）
- @issue:99
- @pr:17
- @doc:docs/架构设计-不存在.md

## 我的想法
<!--
one_liner: 只读先行，别被 AI 带偏
status: 设计中
next: 先验证 entity-ref 解析链路，再谈编辑
reminder: 节点引用是快照不是拷贝
-->
- 先只读，把引用解析链路跑通

## 幕布描述（v1.3.0 · 节点下方纯文本 · Shift+Enter 编辑）
<!--
desc: 这是对主题的补充说明，纯文本可多行。\n默认收缩为一行，点击展开全文；Shift+Enter 进入编辑。
-->
- 设计网关接入 Forgejo
<!--
desc: 只读先行——先把 entity-ref 解析链路跑通，再谈编辑能力。
-->
- 先只读，把引用解析链路跑通

## 图库（资产实体化）
- @img:demo-assets/demo-diagram.svg
- @draw:demo-assets/board.svg