# MindCanvas DELIVERY-CLOSE 深度收尾实施计划

> **For agentic workers:** 使用 `superpowers:executing-plans` 逐任务执行；不默认启动子代理。每项先核对已存在的成果，再补缺口。此次用户请求的是计划与外派材料，执行由外派任务启动。

**Goal:** 关闭 DC-R1/DC-R2/DC-R3，形成与当前未提交候选源码一致、能识别实际回归、可供主控复核的交付证据；为文件管理和图库增强建立稳定起点。

**Architecture:** 保留现有四子项目、保存协调器、离开决策器及布局拆分。以发布验收脚本、固定夹具、独立负控和候选指纹为主；只有新的正确断言复现真实产品缺陷时才最小修改产品。正常验收证明行为正确，负控证明断言有识别能力，两者分别记录。

**Tech Stack:** pnpm 10.33.2、TypeScript、Vitest、Vite、Chromium/现有 Playwright 工具、PowerShell、SHA256。

**Spec:** `docs/dispatch/2026-09-19-delivery-close-review.md`；`docs/superpowers/plans/2026-09-18-delivery-close.md` Task 4/5；`docs/specs/2026-09-18-depth-visual-hierarchy-design.md`（末尾修订优先）；包 1/2 最新复核结论。冲突时保护已复核的产品契约，并在回执中说明，不靠降低断言解决。

## 0. 本计划形成时的事实

- 2026-09-19 读取工作区：`<workspace>`，HEAD=`a2ce72b`。Git HEAD 不含工作区全部成果，**不能以新建一个只含 HEAD 的工作树代替当前候选**。
- 旧独立复核确认 gate/build/analyze 为 0，2485 测试、asCast 31/31、bigFiles 4/4。它们是历史证据，不能自动覆盖之后修改的产品源码。
- 磁盘上的 `tools/verify-release-123.mjs` 已有返修版及 4 个夹具，包含保存后 Undo、自由画布结构化检查、Canvas 查询参数入口。**本计划不宣称这些返修已通过独立验收，也不要求重新实现已有功能。**
- `MindmapStage.tsx` 已新增 backend 参数处理；CI 无 remote 旧注释和回执 lint 算术已修。执行者首先归属这些已有变更，避免重做。
- 当前脚本的 `neg-theme`/`neg-endpoints` 改预期值：这只能算断言自检，不能充当产品回归负控。当前内存句柄在 `write()` 即将内容加入重开来源，而 `close()` 才等待完成；需建立明确的“写入中/已完成”记录，才能声称核验最后成功快照。
- 本任务仅 MindCanvas。Forgejo bridge 的修订、容器、回执、已关闭项均不属于这里，不得迁入本计划状态。

## Global Constraints

- 不 commit/push/pull/rebase/reset/stash，不整树暂存，不发版、不升版本、不启动图库/文件管理实现或第 4 项 Agent 验证。
- 一个写入执行者串行操作候选源码。需要独立副本时包含现有 tracked/untracked 成果，排除用户私密文件/缓存，记录来源；不静默覆盖并发工作。
- 不动 `tools/graph-engine/`、`_tmp_93540_*`、`.codebuddy/` 及其他明确不归本批的历史产物。
- 不重写保存/离开架构、不删除既有导出、不改协议来迁就夹具、不调整布局或主题设计目标。
- 不提高预算或扩大排除项。硬上限：any=0、tsIgnore=0、bang≤90、asCast≤31、console≤4、todo≤1、defaultExport≤2、bigFiles≤4；当前更优指标（如 bang=89）不退步。
- 新增代码零新增 lint 告警；总水位及文件级差异一并核对。2485 是参考数，不是可通过删除测试凑出的目标。
- 系统选择器真实手势、真实 OS 输入法、触控、跨浏览器、离线、跨平台像素金图维持明确限制。可在当前 Chromium 自动化完成的计划内项目不得以“未覆盖”代替关闭。
- 停止不等于所有工作都停：单旅程阻断时记录其失败，继续与之无依赖的任务；到最终回执不得把阻断项算通过。

## 1. 执行边界与文件职责

| 文件/路径 | 职责和权限 |
|---|---|
| `tools/verify-release-123.mjs` | 发布矩阵入口，允许补强；保留现有旅程能力，不为缩短文件删除检查 |
| `tools/lib/releaseAcceptance.mjs`（按需要新增） | 成功写入账本、语义快照比较、结构化结果；只放共享验收逻辑，避免入口继续单体膨胀 |
| `tools/lib/snapshotCheck.mjs` | 复用加载 bundle 核验，不把其 mtime 检查当完整源码指纹 |
| `apps/canvas/tests/fixtures/release-123*.mm.md`、`release-123.mc.canvas.json` | 普通树、中心/嵌套框、纯树 Canvas、非空连接自由画布固定夹具；每个实体身份可定位 |
| `tools/verify-save-lifecycle.mjs`、`tools/verify-mode-guard.mjs` | 原产品旅程复跑；默认不改保护性断言 |
| `apps/canvas/src/MindmapStage.tsx` | 核对已有 Canvas 测试入口的边界；只有必要的限定修复，不能借机大重构 |
| `packages/react/src/render/geometry.ts`、主题 token、exportSvg、canvasBackend | 只读提取实际契约；若出现真实缺陷，最小修复并加针对性回归 |
| `docs/dispatch/2026-09-18-delivery-close-report.md` | 保留历史，追加有 RunId 的收尾章，指出旧结论被哪些新证据替代 |
| `outputs/delivery-close-finish/<RunId>/` | 独占证据目录：正常、负控、截图、导出、命令结果、指纹、最终清单；目录已存在就新建，禁止复用覆盖 |
| `docs/dispatch/2026-09-19-delivery-close-finish-report.md` | 最终候选报告入口，链接本轮具体目录和原回执追加章 |

建议顺序：T0 → T1 → T2/T3（同执行者串行）→ T4 → T5 → T6 → T7。检查点是记录与自检点，不要求每步都停下来问用户。

## Task T0：接管盘点与候选锁定

**Deliverable:** 初始候选指纹、已有成果清单、唯一 RunId。

- [ ] 核对 cwd、HEAD、branch、工作树差异，读取 AGENTS（若存在）和上述 Spec。再次读取已有返修脚本，逐项标为“已存在待复验/确实缺失/不在范围”。
- [ ] 记录所有本轮相关 tracked 和 untracked 文件：相对路径、SHA256、归属。候选指纹包括四包源码、测试/夹具、workspace/lockfile、构建/类型/门禁配置、验收工具。只对 HEAD 做指纹不合格。
- [ ] 初始化唯一目录并立即确定报告路径；截图与下载件通过运行参数指向该目录，正常与每个负控各有子目录，不能再共享 `verify-shots/exports/` 的同名文件。
- [ ] 固定 pnpm 版本，记录 Node/浏览器版本；确认预览端口未被他人使用。只能关闭本轮启动且已核对身份的服务。
- [ ] 对已有产品修改建立最小差异说明，尤其 backend 查询入口。若发现他方仍在修改同一批源码，不在其变动中继续构建；保留现场，使用包含完整候选的隔离副本或报告冲突。

```powershell
$env:PATH = '<local-path>' + $env:PATH
git rev-parse HEAD
git status --short
pnpm --version
node --version
```

**验收：** 任一后续证据可定位到一个具体候选；未知来源的修改没有被丢弃或当成本轮修复。

## Task T1：验收基础设施可信化

**Files:** 发布脚本、必要的共享 helper、证据目录。无需引入大型测试框架。

- [ ] 先复现旧主控独立副本的两个假绿，或读取已固化日志并执行当前脚本对应负控，说明现状；已有修复有效就复用。
- [ ] 写盘替身将文件身份在创建 handle 时固定，不在异步写入完成时读取可变的当前夹具名。每次写入保存 intent/content/destination 的记录。
- [ ] `write()` 只记录 pending；仅 `close()` 成功之后加入 committed。读文件从最后 committed 返回；close 失败或尚未完成不得当成可重开的成功快照。
- [ ] 显式保存前捕获完成序号，保存后等待对应新成功写入及 UI 非 saving；不能靠 `writes.length >= 1`、固定睡眠或历史“已保存”文本过关。
- [ ] 输出稳定 caseId、预期/实际、实际 bundle、结果状态与退出码。未捕获异常/pageerror/超时均不得被空 catch 变成 PASS。
- [ ] 验收程序启动前校验自己的驱动/依赖模块/夹具清单；不匹配则停止该运行。修改后生成新清单，保留旧清单及更改原因。

推荐新增 helper 接口（若复用已有等价实现，记录对应名称）：

```js
export function createWriteLedger() {
  let issued = 0;
  const committed = [];
  return {
    begin(scope, handle) {
      const id = ++issued;
      let text;
      return {
        write(value) { text = value; },
        async close(finish) {
          await finish(); // 拒绝时不进入 committed
          if (typeof text !== 'string') throw new Error('Missing snapshot');
          committed.push({ id, scope, handle, text });
        },
      };
    },
    latest(scope) { return committed.findLast(x => x.scope === scope); },
  };
}
```

这一 helper 若用于 Node 端单测，至少用延迟 close 和 reject close 验证“pending 不可读、失败不新增成功记录”；issued 是尝试编号，允许失败时递增，不能拿它当成功完成序号。浏览器侧接线仍须实际使用同等完成语义，不能单测 helper 但运行脚本走旧账本。

## Task T2：DC-R1 保存后 Undo 与导图文件级保真

**Files:** 发布脚本 R1、普通树夹具；仅确有产品失败才触及保存 hook。

- [ ] 找到固定叶节点并记录 nodeId；旧标题用 `叶子甲一`，新标题用 `叶子甲一改`，保留包含关系以防子串判定复发。
- [ ] 用户操作编辑 → 显式保存 → 等待 T1 定义的本次确认完成，捕获单份 committed 快照，检查标题/描述/note/背面 md。
- [ ] 在同一文档会话执行 Undo，精确核对该 nodeId 的标题为旧值、新值不存在，且视口没有因保存 reset/fit；不能要求重开文档后延续旧 Undo 历史。
- [ ] 单独完成“保存→重开”旅程：明确是否保留 Undo 后的新内容，选定最终保存版本再重开；核对实际解析/显示内容与选定成功快照一致。
- [ ] 负控只省略 Ctrl+Z，保留正确预期，目标断言必须失败；原模式恢复后通过。记录受影响 caseId，不把无关超时当命中。

核心断言形式：

```js
assert.equal(await nodeTextById(leafId), LEAF);
assert.notEqual(await nodeTextById(leafId), LEAF_EDITED);
assert.equal(reopenedTitle, titleInLastCommittedSnapshot);
```

**出口：** Undo 在确认保存之后有效；最新单份快照正确；省略 Undo 可稳定使保护性断言转红。

## Task T3：DC-R2 自由画布语义往返

**Files:** 发布脚本 R6、`release-123.mc.canvas.json`。复用已有三个卡片/两个连接夹具。

- [ ] 固定 placementUuid/edgeUuid，确认夹具至少两个非空端点关系。用 UI 修改一张正面、一张背面并翻面；拖动目标卡，记录实际 viewport scale。
- [ ] 用户手势的屏幕位移换算成世界位移（除以 scale）；不得为通过检查直接把 120 屏幕像素写成 120 世界单位，或放宽到可掩盖误差的容差。
- [ ] 最后 committed JSON 可解析；按 uuid 精确检查 front/back/face/transform/连接端点。元数据时间戳可忽略，但记录忽略字段的理由。
- [ ] 退出/重新进入/打开同一文件后核对真实 UI：正背面、翻面状态、卡片相对位置以及按 edgeUuid 对应的端点；“2 条线/3 张卡”只能作辅助。
- [ ] 重开后再保存，按身份排序比较语义内容；遍历顺序变化不应假失败，实际正文/坐标/端点变化不得被归一化抹掉。
- [ ] 负控令 getFile 返回原始夹具，正确预期不变，至少重开内容或坐标断言失败；正常与负控的全部必跑 caseId 集合一致。

```js
const semanticCanvas = model => ({
  placements: [...model.placements].sort((a,b) => a.placementUuid.localeCompare(b.placementUuid))
    .map(p => ({ id:p.placementUuid, kind:p.kind, shell:p.shell,
      face:p.face, front:p.front, back:p.back, transform:p.transform, zIndex:p.zIndex })),
  edges: [...model.edges].sort((a,b) => a.edgeUuid.localeCompare(b.edgeUuid))
    .map(({createdAt,updatedAt,...edge}) => edge),
});
// fixture 只含 native 卡；其他类型不得未经协议核对就套用这一投影。
assert.deepEqual(semanticCanvas(reopenedSaved), semanticCanvas(lastCommitted));
```

**出口：** 脱离旧 UI 内存状态重开仍语义一致；返回旧文件必红。

## Task T4：DC-R3 三主题、动态几何与 LOD

**Files:** 发布矩阵、已有普通/中心夹具、必要辅助函数；读取 geometry/token/视觉规格。

| 固定 caseId | 操作 | 必须证明 |
|---|---|---|
| VIS-THEME | classic/sticker/glass 各检查 root/branch/leaf，打开编辑框 | 指定主题身份正确；按现有 token/设计修订对应字号与颜色；可见文字不越盒；点击确实命中目标节点，输入框字号与对应绘制字号一致 |
| GEO-FRAME | 编辑框内长文本，观察嵌套框与挂出支 | 框壳包含所属行；不要求“嵌套框彼此不相交”，而是检查不应重叠的相邻行/挂出卡/外部卡；动画稳定后在同一世界坐标系检查 |
| GEO-EDGE | 定位固定语义跨框/跨中心边 | from/to 身份与夹具一致；端点贴对应可见壳/卡边界（按已有折叠投影契约），截图双端可见；全页 path 数量不作主要证据 |
| GEO-CENTER | UI 升格→拖中心→总览→返回 | 中心条目落盘、所属岛整体位移一致、另一岛不动；总览与 full 的表示切换符合现有契约，原始语义边不丢 |
| VIS-LOD | 两阈值附近连续缩小/放大及轻微抖动 | 手势中档位冻结，结束后有限次收敛；滞回带内不来回跳档；回 full 文字恢复 |

- [ ] 从当前代码确认 LOD_FULL_K=0.5、LOD_DETAIL_K=0.26、滞回宽度=0.02；若变化须解释，不硬套旧值。
- [ ] 可使用目标序列 full 起点 0.55→0.49→0.475→0.49→0.505；detail 起点 0.30→0.25→0.235→0.25→0.265。实际 wheel 到达值需记录，以实测 k 判断是否跨过目标边界，不要求不可能的精确滚轮落点。
- [ ] 采样逐帧 k、LOD、手势状态及关键标签；稳定等待有时限，静止重复采样不替代缩放过程检查。
- [ ] 给几何容差列单位和来源：DOM rounding/描边/动画结束误差，不允许“观察到差值后增大容差直至绿”。
- [ ] 现有 neg-theme/neg-endpoints 修改预期值仅归“断言自检”；补行为负控：固定正确预期，在独立导出/渲染副本中错改一个节点样式或一个语义边端点，目标检查应失败。不可借负控改正常样式或连线实现。
- [ ] LOD 检测器可用合成抖动序列自检，但另有真实 wheel 旅程才算产品证据。

**出口：** 表中 5 类正常旅程通过；主题/端点的行为扰动可识别；每项断言有实际节点身份和坐标依据。

## Task T5：DC-R3 导出与真正 Canvas 后端

**Files:** 发布脚本 R2/R5、纯树夹具、已有 backend 参数入口。

- [ ] 审阅已有 `?backend=canvas` 实现：默认行为不变；对含中心/高级边的文档，现有强制 SVG 保护优先，参数不得绕开能力边界。优先复用既有入口；若需隔离测试壳，明确它验证的是组件后端而非默认产品自动切换。
- [ ] 用小纯树强制 Canvas，同时断言 HUD 实际 backend、Canvas 表面存在且 SVG 普通节点层不存在；不能只看一个 canvas 元素（PNG 解码也可能创建 canvas）。
- [ ] 在真实绘制表面检查根/分支/叶指定区域有有效绘制；选中/命中至少一个已知节点并核对身份。画布整体非空不足以证明节点被画出。
- [ ] 不启用 Canvas 的行为负控保持 Canvas 预期，目标后端断言必须红；其余异常不替代目标命中。
- [ ] 三主题导出 SVG：按标题或稳定标识对应 root/branch/leaf，比较字号与颜色；普通树/中心/框的现有承诺分别列实际覆盖，不把一种夹具推广到所有能力。
- [ ] PNG 保留原下载件，实际解码成功、宽高合理、节点区域存在非背景内容。避免只看字节数/全图颜色多样性（背景渐变也会满足）。对 PNG 色彩做同环境代表区域或渲染后对照，容许抗锯齿误差，不要求跨平台逐像素金图。
- [ ] SVG、PNG、页面截图保存在本次正常运行目录；负控写入自己的目录，不能覆盖正常件。PNG 格式与 Canvas 后端是两条独立证据链。

**出口：** 真 Canvas 验证和 SVG/PNG 导出验证分别通过，有可查看原件，有边界声明。

## Task T6：包 1/2 联合回归与最终门禁

**Files:** 既有两个浏览器脚本、四子项目门禁；本任务不重做旧拆分。

- [ ] 产品代码与正式测试最后一次修改后，冻结候选源指纹；需要构建的所有配置也在指纹内。运行一次 `pnpm gate`、`pnpm build`、`pnpm analyze`，真实记录退出码，不只匹配日志中的 PASS。
- [ ] 最终产物上顺序运行发布矩阵、save-lifecycle、mode-guard；不能同时占同一预览端口/截图目录。每次核对页面实际 bundle 与 dist hash。
- [ ] 保护慢写期间继续编辑、另存为新目的地、下载不离开、IME 候选不提交、隐藏 Markdown 草稿、端口代次、异步目标互斥、草稿失败可重试/放弃的既有回归。
- [ ] 门禁若仅文档改变无需再次全跑；脚本/夹具变更只重跑受影响旅程和负控；产品代码/构建配置变更则作废受影响构建证据并重建、重跑相关门禁。不得拿“HEAD 没变”替代判断。
- [ ] 布局/度量/缓存实现有变才追加同机性能复测；否则引用旧测量并注明旧候选与无相关运行时变更，不机械重复基准。

```powershell
pnpm gate
pnpm build
pnpm analyze
node tools/verify-release-123.mjs http://127.0.0.1:5175
node tools/verify-save-lifecycle.mjs http://127.0.0.1:5175
node tools/verify-mode-guard.mjs http://127.0.0.1:5175
```

实际端口以本轮独占端口为准；新证据输出参数在 T1 落地后写入 runbook。先正常通过，再执行各负控；正常模式非 0 必须解释为失败，负控非 0 只有命中预定检查且无环境异常才能算“负控有效”。

## Task T7：复核包与交接

- [ ] 报告按 DC-R1/DC-R2/DC-R3 三项映射：原缺口→现有代码是否已修→本轮新增→正常证据→负控证据→限制。禁止把断言自检写成业务负控。
- [ ] 提交建议覆盖视觉/度量、保存、离开、类型门禁、结构拆分、验收工具、文档；列混合文件按块归属或整体组合理由，**只给建议，不暂存**。
- [ ] 更新准确的 CI/README/CHANGELOG/open-items；已修说明只核对，O3/O4 未做不划完成，版本仍标“未发布/待交付”。旧报告追加章节说明被替代条目，不覆写历史主控复核。
- [ ] 汇总后生成 `manifest.sha256`，逐项重算并记录 missing/mismatch 数；清单自身和复算回执排除并说明。运行输入冻结清单与交付产物清单分别维护。
- [ ] 报告列出本轮占用服务/端口、清理结果；只停止本轮预览服务，不删除共享缓存或其他任务资源。
- [ ] 开工/收尾两次源指纹比较：除了申报修改，没有未归属变化；候选构建后发生相关变更时，必须补测或标记证据不再适用。

最小交付布局：

```text
outputs/delivery-close-finish/<RunId>/
  baseline.json            # HEAD + 工作区源码/配置哈希与归属
  candidate.json           # 最终候选、工具版本、bundle hash
  inputs.sha256            # 每次正式运行前验证的输入集
  cases.json               # 固定 caseId、必跑与限制、负控命中目标
  normal/                 # results、浏览器日志、shots、exports
  controls/               # 每种负控独立目录及预期命中结果
  gates/                  # gate/build/analyze 日志与退出码
  commands.md              # 可直接复跑的实际命令
  manifest.sha256
  recompute-receipt.txt
```

## 最终放行判据

1. DC-R1/R2 正常旅程通过，原两个假绿负控明确转红。
2. DC-R3 的主题/输入命中、动态框/中心/端点、LOD、Canvas 后端和 SVG/PNG 覆盖齐全；未出现改预期凑负控。
3. 包 1/2 同候选回归通过；最终 gate/build/analyze 为 0，预算及导出兼容性不退步。
4. 本次正常与各负控属于可核对的候选和冻结用例，原件未互相覆盖，清单复算无差异。
5. 回执准确区分当前已跑、引用旧证据、预期失败、环境失败和系统能力限制。

满足后交主控复核，只能自称“收尾候选可复核”，不能自行宣称主控放行或发布。存在必跑缺口则逐项交阻断，不开启下一开发包。

## 与图库/文件管理设计的并行边界

可另开**只读设计任务**盘点文件改名/移动与保存句柄、资产命名/归属/引用/打包；独占设计文件，不改本轮候选源码/验收脚本/夹具，不占同一预览服务。本计划不启动该设计任务，也不把它加入 DELIVERY-CLOSE 的完成条件。实现等主控关闭本批后再启动。
