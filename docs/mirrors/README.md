# 三面镜子（消费者规格）

内核接口设计的验收标尺——每设计一个扩展点，问「这三个消费者要挂进来，插口够不够」。K5 阶段逐镜子正式验收。

| # | 镜子 | 文档 | 压力测试点 |
|---|---|---|---|
| 1 | Forgejo 联动（forgejo-bridge，未来首个插件） | `../specs/2026-08-27-mindmap-forgejo-sync-design.md`（R1-R14） | kind 注册 / SemRole 映射 / 通道 / 提议集数据流 |
| 2 | MarkVault-JS MindFlow 标注系统 | `./mindflow-annotation-design.md` | note 键注册 / 渲染器 / annotation kind / structureType |
| 3 | PomodoroXI 接入设想 | `./pomodoroxi-integration-sketch.md` | 新 kind（session/task）/ resolver / 对账 / 跨框架嵌入 |
