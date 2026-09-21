# 纯思维导图内核重构：前沿设计调研（第二辑）

| 项 | 值 |
|---|---|
| 日期 | 2026-08-27 |
| 定位 | 内核主线（R12 总路线 ①）的架构输入；第一辑（Forgejo 联动侧）见 `2026-08-27-mindmap-forgejo-sync-oss-research.md` |
| 调研线 | ① 画布渲染架构（tldraw/Excalidraw）② Local-first 与 CRDT ③ 树布局算法谱系 ④ Obsidian/CodeMirror 插件架构 |
| 工具 | multi-search-engine（多引擎定向检索）+ GitHub trending（三次重试失败：详情 API 持续 404，疑脚本解析问题，待修或配 `GITHUB_TOKEN`） |

---

## 1. 画布渲染架构：tldraw vs Excalidraw 的路线分野

| 维度 | tldraw（45k★） | Excalidraw（90k★） |
|---|---|---|
| 渲染方式 | **DOM 树**（非 Canvas）+ Signals 响应式 | **HTML Canvas**（rough.js 手绘风） |
| 数据模型 | Record Store（记录存储）+ 事件订阅增量更新 | JSON 元素数组（稳定、直存） |
| 大图性能 | 空间索引 + 视口裁剪 + LOD（远 zoom 简化元素），千级元素流畅 | 每帧重绘可见视口，数百元素级流畅 |
| 自定义形状 | ShapeUtil 一等公民（组件+几何分离，TS 泛型强制契约） | elements API，有限 |
| 空闲 CPU | ~1.5%（TickManager 永续 rAF：指针速度/相机动画/每帧裁剪） | ~1.2%（pull-based rAF，无动画即停） |

**对内核的三条结论**：

1. **渲染选型是特性方向问题，不是纯性能问题**：DOM 路线赢得「嵌入任意内容」（网页/视频/React 组件、无障碍、CSS 主题）——tldraw 是 Notion 白板、微软 Loop 的底层，证明 DOM 可用 Signals + 裁剪 + LOD 撑到千级元素；Canvas 路线赢得原始绘制吞吐。你的内核 ambitions（富文本节点、SVG 嵌入、翻转交互）天然偏向 **DOM/SVG 混合**——现有 knowledge-canvas 路线有先例背书
2. **空闲 CPU 由 tick 架构决定，与渲染器无关**（实测数据）：永续 rAF 循环（tldraw）≈1.5%，pull-based（Excalidraw）随空闲归零——内核状态更新必须走 **dirty-flag + 按需调度**，禁止永续帧循环
3. **ShapeUtil 模式值得抄**：自定义形状 = 组件（渲染）与几何（碰撞/边界）分离的注册单元——与我们「渲染器注册表」同构，且它证明了 TS 泛型可以在编译期强制插件契约

## 2. Local-first 与 CRDT：七理想 + 引擎选型

**Ink & Switch 2019 宣言**（Kleppmann 等）七理想：无转圈（本地 I/O 速度）/ 多设备 / 网络可选 / 无缝协作 / 长久性（数据活得比厂商久）/ 隐私默认 / 用户所有权——Obsidian（本地 md 文件）被列为部分达成的范例，**与我们的 `.mm.md` 纯文本事实源完全同哲学**。

**2026 引擎格局**：Yjs（部署最广，YATA 算法，RLE 压缩/B 树索引/状态向量增量）、Automerge 3（JSON CRDT + 列式存储，文档小 10×）、**Loro 1.0（Rust + WASM，movable trees 可移动树 CRDT）**——Loro 的可移动树与思维导图树结构**直接对应**，是将来多设备同步的最短路径。

**对内核的结论**：

1. 纯文本 `.mm.md` 天然满足七理想中的「长久性/所有权/无转圈」——**内核期不需要引入 CRDT**，但要在心里给同步留缝：树操作 API 设计成「可重放操作」形态（而非直接改内存），将来 CRDT 化才不用重写
2. 遗留难点预警（2026 仍未解）：tombstone 垃圾回收（数据无限增长）、CRDT 与端到端加密的组合——多设备立项时把这两条写进风险评估

## 3. 树布局算法谱系（论文线）

```
Reingold-Tilford 1981（Tidier Drawings of Trees）
  → Walker 1989（A Node-Positioning Algorithm for General Trees）
    → Bucheim et al. 2002（Improving Walker's Algorithm to Run in Linear Time）
      → van der Ploeg 2013（Drawing Non-layered Tidy Trees in Linear Time）
        = d3-flextree（Markmap 布局内核；变节点尺寸 + 线性时间）
```

**对内核的结论**：现有自研布局引擎（buildLayoutTree/annotateTree/placeSubtree）与这条谱系同构且已做变节点尺寸——**不需要换 d3-flextree**，但 van der Ploeg 2013 论文值得精读：它是「变尺寸节点 + 线性时间」的权威参考，内核重构时用来校验自研算法的渐近行为（A1 的子树高度缓存已把布局压到 O(N)，方向正确）。径向布局（radial）= RT 算法把 x 解释为角度、y 为半径的坐标系变换——将来加放射布局不需要新算法。

## 4. Obsidian / CodeMirror 6：嵌套微内核的活样本

Obsidian 架构四层：**核心引擎**（Electron + Markdown 渲染 + Vault 文件管理 + 双链计算）→ **API 中间件**（40+ 接口：Vault/MetadataCache 事件/Workspace/Commands）→ **插件运行时**（生命周期管理 onload/onunload、卸载自动注销注册项）→ **UI 扩展层**。

最深的启示是**嵌套微内核**：Obsidian 的编辑器是 CodeMirror 6，而 CM6 自己内部又是「极小核心 + extensions（ViewPlugin/StateField）」——**微内核里套微内核**，两层插件系统互不感知、各自版本化。这直接验证我们 R12 的 L2 注册表插件设计，并给出三个可抄的模式：

1. **生命周期自注销**：插件注册的一切（命令/事件监听/编辑器扩展）随 `onunload` 自动清理——我们的注册表要收 Plugin 基类，注册即挂生命周期
2. **读/写视图分离扩展点**：Reading view 用 post-processor（HTML 后处理），Live Preview 用 CM6 extension——对应我们「渲染器注册表」要区分「静态投影」与「交互编辑」两类渲染扩展
3. **MetadataCache 事件驱动**：缓存变更推送事件而非轮询——实体 resolver 的角标回显走事件总线（现有多 Tab BroadcastChannel 可升级复用）

## 5. 综合补充（对 R12 总路线的三点修正建议）

1. **内核状态层建议明确选 Signals 响应式 + Record Store 形态**（tldraw 验证过的大图路线），配合既有 dirty-flag 纪律——这是 Phase A 性能目标的架构支点
2. **树操作 API 设计为可重放操作形态**——为将来 Loro/Yjs 多设备同步预留，成本为零（就是 API 命名和纯函数纪律）
3. **插件基类带生命周期自注销**——从第一个插件（forgejo-bridge）立项前就定死，避免注册泄漏

## 6. 遗留说明

- GitHub trending 快照三次重试失败（repo 详情 API 持续 404）：疑似脚本对当前页面结构解析失效，建议修复脚本或配置 `GITHUB_TOKEN` 后补跑
- 本报告与第一辑互补：第一辑定「桥」（集成侧架构原则），本辑定「内核」（渲染/状态/布局/插件运行时四件套）
