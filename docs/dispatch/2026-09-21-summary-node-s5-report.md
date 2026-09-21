> 公开归档副本：本机路径已作占位替换；正文是迁移前的历史报告，完整原始证据另行保存。文中的“未推送”等表述描述当时运行，不表示本公开仓库当前状态。S5 判定仍为 REJECT。

# S5 摘要节点最终收尾报告

- **候选完整 SHA**：`123d22b773a06c4b8e3f6aa987e5493a2e3fce1b`
- **候选 tree**：`bdf0b32af5b17b28ac3aa54c6c307fea82a6a4c3`
- **父提交**：`a049930b931fae17d1ba795801da953486b95f9f`
- **分支/detached**：`HEAD`
- **谱系**：`7322575 → ceb0573 → a049930 → 123d22b773a06c4b8e3f6aa987e5493a2e3fce1b`（1 条提交，线性单父，未 push）
- **独立 worktree**：`<workspace>`
- **RunId**：`S5-20260921-230000`
- **证据目录**：`outputs/summary-node/S5/S5-20260921-230000/`
- **工具链**：node v24.15.0 / pnpm 10.33.2

**判定：REJECT（存在阻断项，见第七节）**

---

## 一、基线锚定（§0）

| 项 | 实测 | 冻结期望 | 一致 |
|---|---|---|---|
| SHA | `123d22b773a06c4b8e3f6aa987e5493a2e3fce1b` | `123d22b773a06c4b8e3f6aa987e5493a2e3fce1b` | ✅ |
| tree | `bdf0b32af5b17b28ac3aa54c6c307fea82a6a4c3` | `bdf0b32af5b17b28ac3aa54c6c307fea82a6a4c3` | ✅ |
| 工作树干净 | true | true | ✅ |

## 二、确定性门禁（§3，当前候选实测）

| 门禁 | 退出码 | 实测 | 冻结基线 | 判定 |
|---|---|---|---|---|
| kernel 全包测试 | 0 | Tests 708 passed (708) | 708 passed | ✅ |
| react 全包测试 | 0 | Tests 1636 passed (1636) | 1636 passed | ✅ |
| canvas 全包测试 | 0 | Tests 396 passed (396) | 396 passed | ✅ |
| typecheck | 0 |  | exit 0 | ✅ |
| depcruise | 0 |  | exit 0 | ✅ |
| lint | 0 | Found 1541 warnings. Found 48 infos | 1541 warnings / 48 infos | ✅ |
| budget | 0 |  | exit 0 | ✅ |
| 定向摘要节点测试（react 七文件） | 0 | Tests 91 passed (91) | exit 0 | ✅ |
| prod-build-isolation（有产物） | 0 | 见 `gates/prod-build-isolation-green.log` | exit 0 | ✅ |
| prod-build-isolation（移走 dist） | 1 | 见 `gates/prod-build-isolation-red.log` | 非 0 | ✅ |

## 三、阴性对照（§3 无作弊要求）

| 组 | 中性化 | 正常副本 | 变异后 | 红因（目标断言原文） | 无作弊 | 已还原 |
|---|---|---|---|---|---|---|
| neg1-unmount | 删除 MapView.tsx 中 SummaryLayer 的 JSX 挂载（{summaryViews.length > 0 && <SummaryLayer ... />}，原 1982-1984 行） | 0 | **1** | AssertionError: 括线 path 必须存在（删除 SummaryLayer 挂载 → 此处转红）: expected +0 to be 1 // Object.is equality  (tests/summary-layer-host.test.tsx:91:7) | ✅ | ✅ |
| neg2-order | 把 MapView.tsx 中 SummaryLayer 的挂载从 tree-links 之前移到 nodes 层之后（层序挪到节点之后） | 0 | **1** | FAIL  tests/summary-layer-host.test.tsx > S4 · SummaryLayer 真实挂载（生产 MapView） > 层序契约：summaries 在树线之前、节点之前（各层同 g）
AssertionError: summaries 必须 | ✅ | ✅ |
| neg3-rootbox | summaryFrames.ts:143 中 bandOfMembers 用成员自身盒 ln.box 代替 subtreeBBox(ln)（成员子树并集），已 rebuild dist | 0 | **0** | 未转红 | ✅ | ✅ |
| neg4-nofilter | 删除 summaryFrames.ts 中 `args.satellites.length === 0` 空早退，改为在 satellites 为空时回退用 plan.specs 在盒表里查出的节点充当卫星源（新增 satSource）。 | 0 | **1** | AssertionError: 摘除判定只能来自 satellites（单一事实源）: expected [ { …(10) } ] to have a length of +0 but got 1  (packages/react/tests/summary-frames.te | ✅ | ✅ |
| rootdep | 去掉 root 透传依赖 | 0 | **1** | AssertionError: root 必须透传给 exportPng: expected undefined to be { id: 'r', type: 'text', …(2) } // Object.is equality
（tests/summary-export-r | ✅ | ✅ |

## 四、真浏览器矩阵（§1）

- 真实退出码：**0**
- 断言：**106 通过 / 0 失败**
- 页面实际加载 bundle：`main-BgdfvXm7.js`
- `dist/index.html` 引用 bundle：`main-BgdfvXm7.js`
- 服务端返回字节 == 磁盘产物：✅ 逐字相同（内容哈希）
- 证据文件：bundle-hash.txt、bundle.txt、verify-output.txt、supplement-output.txt、preview.log、plain.png、export-summary.svg、supplement-export.svg、supplement-export-png.png、supplement-png-meta.txt、served-main-BgdfvXm7.js、a1-menu.png、a2-draft.png、a3-created.png、a4-selected.png、b1-shrunk.png、b2-degraded.png、c1-left-island.png、c2-layout-decl-not-consumed.png、d0-exported.png、e1-created.png、e2-after-undo.png、e3-after-redo.png、f0-repeat-create.png、f1-deleted.png、f2-recreated.png、f3-overlap-nested.png、g1-inner.png、g2-nested.png、i0-export.png、j0-png.png、k1-frame-with-summary.png、k2-after-rename.png、l1-dangling.png、l2-stale.png、m0-plain-doc.png、m1-panned.png、m2-edited.png、m3-saved.png、theme-经典.png、theme-贴纸.png、theme-玻璃.png、z-out.png、z-mid.png、z-in.png

## 五、普通文档逐位等价（§1）

- 逐字节等价：✅
- 方法：在 <workspace> 复核普通文档（无 summary_of）等价。用当前产物 apps/canvas/dist（main-BgdfvXm7.js）起单端口同源静态服务 node serve.mjs 5312 <dist> s5（同源是必需：跨端口 iframe 实测 SecurityError: Blocked a frame with origin http://127.0.0.1:5312 from accessing a cross-origin frame；且 dist/index.html 用绝对 /assets/ 路径，必须挂源根）。真实 Chrome（DevTools MCP）走真实用户路径：构造 File('# 根\n## 甲\n## 乙\n','plain.mm.md') → 赋给隐藏 input[type=file] → 派发 change（= MindmapStage.tsx:2208 onChange → applyDoc）→ 等节点卡文本恰为 根/甲/乙 → 编辑（对 [data-node-id] 组派发 pointer/mouse 选中，window 上 F2，OverlayEditor.tsx:235 的 input[data-overlay-editor=single] 用原型 setter 改值 乙→乙改，Enter 提交）→ 点真实「导出」按钮拦 URL.createObjectURL 取 blob 原始字节 → 对 MapView.tsx:1823 wheelRef 宿主派发 WheelEvent 缩放 + 拖拽平移 → 点真实「保存」取写出字节。对照 worktree 产物在其内构建（未动 S5 产品源码）：FRV 直接 vite build 得 main-BgdfvXm7.js 450.70 kB；S1BASE 因 packages/free-canvas/dist 从未编过致构建失败（Rolldown failed to resolve import '@mindcanvas/free-canvas'），先在其内 tsc -p tsconfig.build.json 补编该包再 build，得 main-BGY-qa-.js 447.31 kB。三条 worktree commit 实测：S5=123d22b、FRV=123d22b、S1BASE=0fa0f9d。实测 sha256（chrome 内导出 blob 字节）：未编辑轮 export.svg 1407 B = cd8a1730766aee65463382bd257a133f22e58beb8651910645a6044c50b51d76，S5/FRV/S1BASE 三者相同，cmp -s 两两 IDENTICAL；编辑后（乙→乙改）export.svg 1410 B = ff4728881ec3046c98548e4c377b7fbcac02f6baba2a711992f8fbcc1ac92fad，saved.mm.md 25 B = e4078885df882dc24cfe4afcd2b4eb723f6c667baec6cd44dd9a5524aed19e4e，六份产物两两 cmp 全部 IDENTICAL；S5 独立重跑两次结果逐字节复现。其他观测量三候选逐一相同：labelXY=[948.16,436.39]、canvasNodeGCount=3/canvasPathCount=2/canvasRects=3、zoom [948.16,436.39]→[1064.33,430.02]、panDelta=[120,40]、enteredEditor/committed=true、cardTextsAfter=[根,甲,乙改]。方法、命令、全部哈希与未覆盖项写入 <workspace>/outputs/summary-node/S5/S5-20260921-230000/docs/plain-equivalence.txt；取证文件在同级 plain-eq/（serve.mjs/capture.html/recipe.js/plain.mm.md/hashes.txt + s5|frv|s1base 各 export.svg、saved.mm.md）。
- 差异：无差异。普通文档在布局、编辑、平移、缩放、保存、导出六项上，候选 123d22b 与 S1 基线 0fa0f9d 的真实浏览器产物逐字节相同（未编辑导出 1407 B / cd8a1730…，编辑后导出 1410 B / ff472888…，保存 25 B / e4078885…，三候选两两 cmp -s 全部 IDENTICAL）。因此不存在需要归因于「摘要以外既有改动」的差异。唯一非逐位相同的观测量是平移松手后的惯性滑行终点（三次跑 1414.3 / 1403.08 / 1407.54，连 S5 与 S1 之间也不同）；已定位为计时噪声而非候选差异：松手前位移确定性且三候选相同（panDelta=[120,40]，恰等于三次 pointermove 增量 (20,20)→(60,20)→(120,40) 的代数和），差异只在 pointerup 之后，而 useMapGestures.ts:402 注释「M5-T4：松手速度高于阈值 → 惯性滑行（指数衰减缓停）」、:355 速度由 performance.now() 采样，故终点取决于真实墙钟；底层 viewport.panBy（viewport.ts:91 → applyPan）本身是纯加法。如实声明未覆盖项：惯性曲线逐帧比对、Canvas 后端（本样本走 SVG）、PNG 导出、其它普通文档形态（含 note/实体/边/折叠/跨岛/自由边）、自动保存与 Ctrl+S、以及候选自身「有最近文档」时的启动页行为，均未实测，不得据此报为等价。

## 六、文档收尾（§2）

- 总体：以候选 123d22b（worktree <workspace>，HEAD 已核对 = 123d22b）为对象逐条核对文档与代码。12 项中 9 项通过、3 项未通过。核心结论：**S5 阶段的文档交付整体缺失**——outputs/summary-node/S5/S5-20260921-230000/docs/ 为空（唯一文件是本次审计生成的 gitignore-scope.txt），docs/dispatch/ 无任何 S5 报告，CHANGELOG:15 与 RV2 回执 §9.6 均自陈「S5 未启动」。S5 的浏览器与门禁证据其实已齐备且全绿（kernel 708 / react 1636 / canvas 396 / targeted 91 全 passed；verify-output.txt 与 supplement-output.txt 全 ✔，含导出层序 I1-I8、DOM 层序 H0-H3），但回执/未覆盖清单/CHANGELOG 顺延这些 S5 文本产物尚未落盘，故第 5、11（部分）、12 项以 S5 载体缺失判定未过。代码侧核对结果良好：summary_of 三态与同父连续区间含两端/单成员合法、satellites（摘除判定）vs specs（成员区间）的消费纪律、导出 parts.push 层序（背景→树线→boundaryLinks→括线→节点卡）、Canvas 后端不宣称支持、框边界不存在——均与文档一致。两处 medium/low 偏差：(a) 协议 §6.5:445 的 DOM 层序表遗漏 island-overview 层（实际 sections→island-overview→summaries→tree-links，见 MapView.tsx:1939/1967/1983 与 mapview-layer-order.test.tsx:28-37）；(b) S5 新增工具 tools/verify-summary-supplement.mjs:8/467 的 H 层序横幅描述与同脚本 H2 断言相反。§2 附带项已实测：.gitignore 无夹带（git ls-files 仅 5 条 negctl 证据日志），但护栏双向有缺口——browser/preview.log 被 *.log 静默忽略（git add --dry-run exit 1），而 gates/negctl 下任意命名 *.log 一律放行；建议收窄并已写入指定路径。未修改任何被审文件。

- ✅ 1. 协议 §6.5 / summary.ts / summary-anchor.ts 关于 summary_of 形态（from/to cid 锚、同父连续兄弟区间、含两端、单成员合法） — 一致。summary.ts:40-47 summaryOf 严格收窄（from/to 皆非空字符串才返回，否则 undefined）；summary-anchor.ts:130-146 校验同父+顺序+S 不在范围内，memberIds = parent.children.slice(fromPos.index, toPos.index+1) 即连续区间含两端；:186-191 单成员 from==to → memberIds 长度 1（测试 summary-anchor.test.ts:98）。协议 §6.5:397-427 表述与实现吻合。SummarySpec 类型在 protocol/types.ts:148。
- ✅ 2. LayoutResult.satellites 与 buildSatellitePlan(root).specs 关系表述准确 — 一致。mindmap.ts:57-67 satellites 注释=「已从布局树摘除、改为成员带外侧放置的摘要子树根」；satellite.ts:82-96 SatellitePlan 的 skip=摘除集、specs=可摘除规格（成员区间）。协议 §6.5:437-439 写「渲染层只消费 LayoutResult.satellites（摘除判定）与 buildSatellitePlan().specs（成员区间）——不重解析 summary_of 字面量」，与 summaryFrames.ts:13-32 的消费面纪律逐条对应（satellites 不携带 memberIds，故成员区间必须取 specs）。
- ❌ 3. 画布 DOM 层序与 SVG 导出层序必须与代码一致 — 导出侧一致：exportSvg.ts:63-201 parts.push 实际序 = 背景 rect(69) → 树线 path(112) → boundaryLinks 虚线(141) → 摘要括线(165-175) → 节点卡(188-199)，与协议 §6.5:446 及 CHANGELOG:46-47 一致。DOM 侧**存在偏差**：协议 §6.5:445 表把 summaries 写成紧跟 sections，但 MapView.tsx:1939/1967/1983 实际是 sections → island-overview → summaries → tree-links，遗漏 island-overview（见 findings）。
- ✅ 4. Canvas 后端括线仍未支持，文档是否明确写了该限制 — 已明确。CHANGELOG.md:45「Canvas 后端**不宣称支持括线**（与 SectionLayer 同边界，不经 SVG 分支即不渲染）」；MapView.tsx:1980-1982 注释「Canvas 模式不经本 SVG 分支 → 与 SectionLayer 同边界自动降级」；设计稿 §88/§162 亦记 ADR-0006 静默缺省。
- ❌ 5. 未覆盖项明确（原生文件选择器、真实输入法、跨浏览器） — 现有 S4/S4-R2 文档已如实列出：RV2 回执 §9.2「浏览器验收仅 Chromium 单机：未覆盖 Firefox/WebKit/移动端/真实 OS IME/系统文件选择器」；S4-R2 报告 §八.3 同措辞。但**S5 收尾文档缺失**，未在 S5 层面重申该未覆盖清单（S5 任务书本应承载）。见 finding 1。
- ✅ 6. mode-guard 既有抖动说明必须保留 — 历史口径在本 worktree 内可见且完整：outputs/summary-node/S4/S4-20260921-160000/gates/flake-note.md（含基线 0fa0f9d 上 18 次采样 1 次失败的复现证明）。S4 报告:357-361、S4-R2 报告:333/342、RV2 回执:270-271 均以「既有、非本批引入、未声称已消除」保留。注意：该说明未进入 CHANGELOG 摘要段（CHANGELOG:1-62 无 mode-guard 抖动字样），但 CHANGELOG 作为面向发布的历史段不承载抖动限制属合理；S5 收尾报告缺失才是缺口。
- ✅ 7. collectSummaryDiagnostics 无生产调用方的 S1 边界必须保留（grep 求证） — grep 核实：packages/**/src 内除 packages/kernel/src/index.ts:398 的 re-export 与 summary-anchor.ts:202 定义处外，无生产调用方；调用方仅 packages/kernel/tests/summary-anchor.test.ts:20/276/286/290（测试）。S4-R2 报告:330 与 §八.1 已记为「S1 遗留边界，不在本包补调用链」。边界保留属实。
- ✅ 8. 不得把「框边界」写成不存在的 SVG 导出层 — 无残留。protocol.md:450、CHANGELOG.md:48、exportSvg.ts:150 均明确「导出不画框边界」，并说明旧文本误把跨岛补线当成框。S5 实测 I8 印证。
- ✅ 9. 不得把施工期提交数量写成最终候选谱系（123d22b 谱系 7322575→ceb0573→a049930→123d22b = 4 条，线性单父） — 实测符合。$ git rev-list --count 7322575^..123d22b = 4；$ git log --format='%h %p' 7322575^..123d22b = 123d22b(a049930)→a049930(ceb0573)→ceb0573(7322575)→7322575(a43b99d)，线性单父。R2 报告的「施工期四提交压平为单提交」明确讲的是 S4-R2 自己的候选 ceb0573（报告:38-48），未与 S5 候选谱系混为一谈；RV2 回执:17 记谱系 7322575→ceb0573→a049930。无混淆。
- ✅ 10. 不得把「loadedBundle 名称跨环境稳定」写成保证 — 无违例。RV2 回执:274-276 明确「构建哈希不跨树稳定……『loadedBundle == dist/index.html』只在同一棵树内成立，不可作为跨环境常量比对」。其余出现（bundle.txt、evidence-index.md:31/54、manifest.txt:146）均为同一棵树内的逐字一致陈述，非跨环境保证。
- ✅ 11. CHANGELOG 是否如实记载摘要节点（v1.12 候选 / 待定号） — 如实。CHANGELOG.md:10-11 标题「[未发布 · 待版本号] … 摘要节点（XMind 式概要）S1–S4」，:12-15 显式声明尚未发版、版本号仍 1.7.0、留作 v1.12 候选且「本段只记到 S4，S5 未启动」。四组内容（S1 数据层/S2 创建事务/S3 布局卫星/S4 括线渲染与导出）与代码一致（satellites 加法字段、支持边界、nestedSkip、导出层序、4 组负控退出码 1 等均可在代码/证据中核到）。
- ❌ 12. dispatch 回执与验收清单是否与候选终态一致 — S4-R2-RV 回执（docs/dispatch/2026-09-21-summary-node-s4-r2-rv2-fix-receipt.md）判 ACCEPT、记三项阻断闭合，其内容与 123d22b 终态一致（谱系 7322575→ceb0573→a049930 见:17/56-59）。但**S5 自身的 dispatch 回执与验收清单不存在**——S5 浏览器/门禁证据已产出（gates 全绿：kernel 708 / react 1636 / canvas 396 / targeted 91；verify-output.txt 与 supplement-output.txt 全 ✔），却无 S5 回执把「候选终态 + 证据路径 + 未覆盖清单」收口成文。见 finding 1。
- ✅ §2 附带项：.gitignore 范围实测 + 收窄建议写入 docs/gitignore-scope.txt — 已实测并落盘 outputs/summary-node/S5/S5-20260921-230000/docs/gitignore-scope.txt。命令与输出：$ git check-ignore -v --no-index 证据日志（命中 ! 否定=未忽略）/ 无关日志（命中 .gitignore:8 *.log=忽略）；$ git add --dry-run 抽样 gates/（4 条全 staged）、browser/preview.log（exit 1 被忽略）、whole browser/（0 条 preview.log）；$ git ls-files 'outputs/**/*.log'（5 条，全 negctl 证据）。实测无夹带。建议方案 A：补 `!outputs/**/browser/*.log` 修 browser 缺口，并把「gates/negctl 内任意命名 .log 放行」记为显式债务（可选追加 noise 名再忽略）。未发现任何以扩忽略隐藏证据的行为。

### 文档发现

- **[high] outputs/summary-node/S5/S5-20260921-230000/docs/**：S5 阶段的文档交付完全缺失：docs/ 目录为空（本次审计只产出 gitignore-scope.txt）。S5 任务书定义的文档项——AI 契约补读法、协议补记、CHANGELOG 顺延、以及 dispatch 报告——在本候选上均未落盘。CHANGELOG:15 自陈「本段只记到 S4，S5（收尾与文档收口）未启动」，RV2 回执第 6 条同样写「S5 范围未启动」。因此本审计的 5/6/11/12 四项（未覆盖清单、mode-guard 抖动说明、CHANGELOG 摘要记载、dispatch 回执与验收清单）所要求的 S5 载体不存在。
  - 依据：$ ls -la outputs/summary-node/S5/S5-20260921-230000/docs/ → 仅 gitignore-scope.txt（本次生成）；$ find . -iname '*S5*' -type f → 无 S5 报告；docs/dispatch/ 内无 S5 报告（ls|grep -E 's5|S5' 空）。CHANGELOG.md:15 原文「本段只记到 S4，S5（收尾与文档收口）未启动」。
- **[low] packages/react/src/chrome/exportSvg.ts:150 / docs/specs/2026-09-02-mm-md-protocol.md:450 / CHANGELOG.md:48**：「框边界」不存在的 SVG 导出层：已按要求整改到位，无残留。三处均显式声明导出不画框边界，且 S5 实测 I8「导出不画 Section 框」通过。此项非 finding，记录为核对通过。
  - 依据：grep -n '框边界' docs/ CHANGELOG.md packages/react/src/chrome/exportSvg.ts → exportSvg.ts:150「① 导出不画框边界」、protocol:450「导出不画框边界」、CHANGELOG:48「导出不画框边界」；S5 supplement-output.txt I8「导出不画 Section 框（框是画布侧 chrome）」✔。
- **[medium] docs/specs/2026-09-02-mm-md-protocol.md:445**：协议 §6.5 画布 DOM 层序表遗漏 island-overview 层。表内写 `sections` → **`summaries`** → `tree-links` …，但代码实际挂载序为 SectionLayer(1967?)→IslandOverviewLayer(1967)→SummaryLayer(1983)→tree-links(1985)，即 island-overview 夹在 sections 与 summaries 之间。层序契约测试 CONTRACT 数组同样含 'island-overview'（在 'sections' 之后、'tree-links' 之前）。协议表把 summaries 写成紧邻 sections，掩盖了中间的条件层，作为层序契约的权威表述不准确。
  - 依据：MapView.tsx:1939 <SectionLayer>、1967 <IslandOverviewLayer>、1983 <SummaryLayer>、1985 <g data-layer="tree-links">；packages/react/tests/mapview-layer-order.test.tsx:28-37 CONTRACT=['sections','island-overview','tree-links',...]；协议 §6.5 表 line 445 无 island-overview。
- **[low] tools/verify-summary-supplement.mjs:8 与 :467**：S5 补充验收脚本自身的层序描述与其实测断言自相矛盾。脚本头注释与 section 横幅写「H DOM 括线层序：背景 rect → tree-links → 边界补线 → summaries → nodes」（把 summaries 排在 tree-links 之后），但同脚本 H2 断言「summaries 层在 tree-links 层之前（S4 契约：层序 = sections → summaries → tree-links）」——即横幅描述与代码/断言相反，与协议 §6.5 的括线在树线之前也不一致。工具是候选 S5 工作产物的组成部分，该描述会误导后续读者。
  - 依据：tools/verify-summary-supplement.mjs:8 与 :467 横幅文字；同文件 :489 H2 断言 idxSummary < idxTreeLinks 通过（supplement-output.txt H2 ✔ idxSummary:0 idxTreeLinks:1）。
- **[low] .gitignore:18-19**：忽略规则作用域偏宽且漏覆盖 browser/：① `!outputs/**/gates/*.log` / `!outputs/**/negctl/*.log` 对这两个目录下**任意命名**的 `*.log` 一律放行，不区分是否为验收证据（实测 `outputs/foo/gates/tmp-build.log` 被放行），噪声日志存在被误收通道；② 反向缺口——`outputs/**/browser/*.log` 未纳入否定规则，S5 的 browser/preview.log 被 `*.log` 静默忽略（git add --dry-run exit 1「paths are ignored」），正是 .gitignore 第 6-7 行注释担心的「git add <目录> 静默跳过」形态。实测当前已入库 .log 仅 5 条且全为 negctl 证据，确无夹带；亦未发现有人以扩忽略隐藏证据。详见 outputs/summary-node/S5/S5-20260921-230000/docs/gitignore-scope.txt。
  - 依据：$ git check-ignore -v --no-index outputs/foo/gates/tmp-build.log → .gitignore:19:!outputs/**/gates/*.log（放行）；$ git check-ignore -v --no-index outputs/summary-node/S5/.../browser/preview.log → .gitignore:8:*.log（忽略）；$ git add --dry-run …/browser/preview.log → exit 1「paths are ignored」；$ git ls-files 'outputs/**/*.log' → 5 条 negctl 证据，无无关日志。

## 七、独立复核判定

- **REJECT**
- 基线锚定、计数、浏览器矩阵、prod-build-isolation、root 依赖、普通文档逐位等价、文档层序与支持边界、旧证据与主工作树完整性均经我实跑/实读核verify通过；但四组阴性对照中的 neg3-rootbox 未转红且其「变异不可观测」结论经我独立复跑证伪——我把同一处 subtreeBBox→自身盒变异重新施加，目标用例真实转红（tests/summary-frames.test.ts 1 failed | 17 passed，真实 exit 1），与 neg3 日志自称的 RED_EXIT=0 /「没有任何成员节点在扁表里带 children」直接矛盾，属 high 阻断。我未核验的部分：我未重跑浏览器 MCP 矩阵（读的是 verify-output.txt 与 supplement-output.txt 的既有断言输出，二者均全绿且与磁盘 SVG 层序实测一致）；未重跑 kernel/react/canvas 全量三套件（读 gate 日志 + 局部实跑 7 个 summary 测试文件 89 passed）；未逐题重跑 neg1/neg2/neg4 的变异（读日志，三者红因均为目标断言原文、无作弊模式，判为可信）；未重跑 prod-build-isolation/rootdep 两条（读日志，红因为 MISSING_DIST/root 目标断言）；未在真实浏览器复核 PNG/J 组与主题缩放截图内容（仅读输出与魔数文本）。另：主工作树中本次唯一允许写入的 docs/dispatch/2026-09-21-summary-node-s5-report.md 在截止核验时尚未存在（该文件缺失本身不是阻断，但 S5 报告未落盘即无法核report层面的主张）。

### 阻断项

- **[high] outputs/summary-node/S5/S5-20260921-230000/negctl/neg3-rootbox.log:31-46**：neg3-rootbox 这组阴性对照未转红，且日志给出的「变异体存活/语义等价」根因经独立复跑证伪——这是四组阴性对照中唯一失效的一组。按要求「任何一组没转红 = blocker (high)」。（依据：neg3-rootbox.log:31 自述 `RED_EXIT = 0 → tests/summary-frames.test.ts (18 tests) 18 passed`；:33-44 断言「没有任何成员节点在扁表里带 children，故 subtreeBBox(ln) ≡ ln.box，两种写法结果逐位相同」。我用 node 脚本对 packages/react/src/render/summaryFrames.ts:135 施加同一变异（const b = subtreeBBox(ln) → const b = ln.box），在 packages/react 下实跑 `node node_modules/vitest/vitest.mjs run tests/summary-frames.test.ts`，输出 `Tests 1 failed | 17 passed (18)`，失败用例为「成员带包含成员的子树（不是成员自身盒）」，断言原文 `带右沿必须覆盖成员的子树…: expected 378 to be greater than or equal to 541.999999`（tests/summary-frames.test.ts:368）。真实退出码独立取为 1（`> file 2>&1; echo $?` → TRUE_EXIT=1）。即该「成员自身盒 vs 子树并集」区分在本仓布局口径下**可观测**，neg3 的存活结论错误。同时 neg4-nofilter.log:13 的行内输出显示，在 neg4 的变异下同一用例「成员带包含成员的子树」也转红，进一步反证该用例对成员子树并集敏感。）
- **[medium] outputs/summary-node/S5/S5-20260921-230000/negctl/neg3-rootbox.log:35-43**：neg3 探针数据与仓内既有判别用例自相矛盾，且该日志未编造非零码却把「未转红」归因为设计等价，属于对门禁失败的错误归因——若被采信，会把一条真实存在判别能力的断言当作冗余证据，并掩盖「成员带口径」这条本该由阴性对照钉住的契约。（依据：neg3 探针称 [with-subtopics]「成员一子一/子二 上提为父的直接孩子」(neg3-rootbox.log:38)。但 packages/react/tests/summary-frames.test.ts:347-369 的夹具 `成员一` 下有孙节点且断言带右沿覆盖孙盒；我复跑显示变异后 378 vs 542 不符，说明成员在扁表**保留**子树盒（子孙未上提），探针描述与实测不符。）

## 八、未覆盖项

- 真实 OS 文件选择器用 showOpenFilePicker 桩（浏览器自动化无法驱动真实 OS 对话框）；因此「保存」只验到 Ctrl+S 路径被走到且无失败提示，未验真实落盘字节。
- 真实输入法（IME 组合输入）未覆盖：改名/编辑用 page.keyboard.type 直接键入 ASCII/单字，未经 IME composition 事件。
- 仅 Chromium 单浏览器：未跨浏览器（Firefox/WebKit）验证。
- Canvas 后端（useCanvas）不渲染括线 —— SummaryLayer.tsx:10 自述「Canvas 模式不经过本 SVG 分支 → 自动降级不渲染」，本次未覆盖 Canvas 后端括线（该后端无括线能力，非本次引入）。
- 声明降级域 org / timeline / fishbone：画布不消费 note.layout，无法经真实 UI 触发这些布局路径。verify-summary.mjs:443-448 显式记录该边界；C4 实测「声明 layout:org 的文档仍走 mindmap 路径并有括线」正是该事实的反证。这类降级域由 kernel 层用例覆盖（summary-satellite.test.ts 等，见 gates/kernel.log 708 passed），浏览器侧只验到「节点仍可见、不绘制不满足条件的括线」这一条（L1/L4 + B3）。
- 「替换」语义在本版**不存在**：命令层重复触发同一范围产生第二个摘要节点（packages/react/tests/summary-create.test.ts:586 明载「两次独立事务，两条 undo」），浏览器实测 FA1=2 条括线、FA2 节点 +1，与之一致。故任务书设想的「同区间重建应为替换、仍 1 条括线」已被实测否证；F2-F4 验的是删除后重建不累积。
- dangling / stale 走了手写锚的夹具文档（锚指向 cid:nope / 非法锚文本），非经真实 UI 操作产生；UI 无法手工写出坏锚。B 组（删端点 → dangling）是经真实菜单删除触发的。
- 「边界补线」（island boundaryLinks）位次在本次文档（单岛、无升格中心）中未真实命中，故 DOM/SVG 层序断言 H/I 只钉了 背景→树线→括线→节点卡 四段，未独立钉 boundaryLinks 那一段。
- 缓存 / 重复布局：K4 用 3 次 Ctrl+0 后节点几何与括线 d 逐字一致做幂等判据（缓存命中无漂移），未直接读取缓存内部命中计数。
- 撤销/重做仅验 Ctrl+Z / Ctrl+Shift+Z 各一次的单步行为；未验深层撤销栈或多摘要撤销顺序。

## 九、边界声明

- 本轮**未** push / 合并 / 发布 / amend；未修改主工作树、旧提交、旧回执、既有证据。
- 浏览器验收仅 Chromium；原生文件选择器用桩；真实输入法未覆盖。
- bundle 文件名跨环境不稳定，本报告以**内容哈希**为准，不以文件名为准。
- Canvas 后端括线仍未支持。
