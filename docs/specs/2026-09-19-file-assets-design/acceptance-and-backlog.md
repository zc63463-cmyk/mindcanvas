# 兼容迁移、联合验收与开发拆包（D3）

任务：FILE-ASSETS-DESIGN。日期：2026-09-19。

**声明**：本文件是**设计交付**，不要求本包实跑。下表的测试层指「应由哪一层承担」，不是「已完成」。本包未运行任何测试。

---

## 1. 兼容与迁移

迁移表（**M1–M11**）、归属证据规则（§6.2.1）、幂等与回退策略（§6.3）、以及「无法确定归属不得猜测合并」的硬规则见 `shared-contracts.md` §6。这里只补三条与验收相关的执行约定：

1. **迁移的触发点**：全部为**惰性**（首次进入文件面板 / 首次加载素材清单 / 首次按 `docKey` 取句柄），不提供「一键迁移」批量入口。理由：批量迁移一旦中断会留下半迁移状态；惰性迁移天然可续跑。
2. **迁移的可观测性**：迁移过程不产生用户可见进度（用户不该知道有索引，UD-5）；只在「N 条旧记录未关联工作区」这类需要用户判断的场景出现 UI，且**可跳过**。
3. **归属证据（本轮新增的硬约束）**：`isSameEntry` 成功返回、或用户显式确认，是**唯一**的归属证据；同名、路径字符串、对象引用、当前目录唯一命中**都不是**（I-13）。验收必须包含「唯一同名命中不得自动绑定」的负控。

---

## 2. 能力降级表

每格给：**可用操作 / 提示 / 恢复路径**。凡未在本工作区实测的浏览器支持差异，一律标「未验证」。

| # | 场景 | 可用操作 | 提示（用户可读） | 恢复路径 |
|---|---|---|---|---|
| G1 | File System Access API 完全不可用（`showDirectoryPicker` 缺失） | 单文件打开/保存（file input + 下载兜底）；浏览器文档库可用；图库只用浏览器素材库 | 『当前浏览器不支持直接读写本地文件夹。可以单文件打开/保存，或用浏览器模式管理文档。』 | 建议换 Chromium 系浏览器；或继续用单文件 + 下载 |
| G2 | 权限未授予（首次选择目录后未点「允许」） | 挂载不成立，回落浏览器模式 | 『没有获得访问这个文件夹的权限。』 | 「重新选择文件夹」；用户重选时再弹授权 |
| G3 | 权限已撤回（会话中/重启后） | 未挂载：回落浏览器模式。已挂载但 I/O 抛 `E-PERMISSION`：读/写/删除逐项失败，**不静默成功** | 『权限已被收回，无法保存到这个文件夹。』 + 『改用浏览器模式』 | 「重新授权」（需用户手势）；或「重新选择文件夹」 |
| G4 | IndexedDB 写入失败（隐私模式/配额） | 上传仍可用（会话级 objectURL）；文档编辑与磁盘保存不受影响 | 见 `asset-library.md` §5.4-①：『没有写入持久存储…刷新后可能消失』 | 「重试」；或把资产改存到工作区 `assets/`（若已挂载） |
| G5 | IndexedDB 整体不可用（读也失败） | 清单只剩静态打包资产；磁盘资产（若挂载工作区）仍可用 | 『浏览器素材库不可用（{原因}）。』 | 挂载工作区走磁盘；或换浏览器配置 |
| G6 | 浏览器数据被清理（站点数据/Cookie 清除） | 文档与磁盘资产不受影响；浏览器文档库记录、句柄、IDB 资产全部消失 | 打开文档时：『这张图片保存在浏览器素材库，本机已找不到。』 | 「重新定位」；改用工作区 `assets/` 存放 |
| G7 | 目录脱离（文件夹被移动/重命名/删除） | 面板进入失联态，只显示提示与动作；当前文档仍在编辑但目的地失效 | 『无法访问工作区「{名}」。』 + 原因推测 | 「重新授权」/「重新选择文件夹」/「断开回浏览器模式」 |
| G8 | 目录扫描失败（单层不可读、超限） | 能读到的部分正常显示；超限时截断 | 『文件夹内容太多，只显示了前 N 项。』/『有 K 个文件夹无法读取。』 | 缩小范围（直接打开子目录）；重试 |
| G9 | 离线 | 本地磁盘与 IDB 全部可用；无网络相关功能受影响 | 无（不打扰） | — |
| G10 | localStorage 不可用/满 | 文档读写不受影响；最近/收藏/索引降级为内存态 | 『浏览器本地存储不可用，最近记录与收藏这次不会被记住（不影响文件本身）。』 | 清理浏览器存储；或用工作区（文件在磁盘上） |
| G11 | 跨浏览器（Firefox / Safari） | **未验证**。设计不假设支持 `showDirectoryPicker` / `createWritable` / IDB 持久化豁免 | 未验证 → 上线前必须实测后再写文案 | 待验证；本包不承诺 |
| G12 | 嵌入 iframe / 预览环境 | 自由画布已显式抛 `fs-access-unavailable`（`canvasDocHost.ts:54`）；导图走 file input 兜底 | 『当前嵌入环境不支持直接读写本地文件。』 | 在新窗口打开 |
| G13 | **`isSameEntry` 不可用或比较抛错**（本轮新增） | **P0-0**：目录可正常读写，但**身份不持久**（`disk-session('unassociated')`）；注册表与裸键都不写。**P1-A**：提供人工关联 | **P0-0** 文案：『这个文件夹可能和以前记录的工作区是同一个，但当前无法自动确认；本次先不记住它。』**P1-A** 文案：『这个文件夹和以前记录的「{名}」是同一个吗？』+ 条目列表 | P1-A 的人工关联：确认 → 复用 `scopeId`（`via:'user-confirmed'`）；选「这是新文件夹」→ 新 `scopeId` |
| G14 | **工作区注册表写入失败**（本轮新增） | 本次会话可正常读写文件；`scopeId` 不跨刷新 | 『这次的工作区标识没能保存，刷新后需要重新选择文件夹。』 | 「重试保存标识」；或接受每次重选 |
| G15 | **注册表记录损坏**（本轮新增） | 不使用损坏记录、**不删除**；本次为 `disk-session('registry-corrupt')`；**三个入口（`pick`/`restore`/`requestPermission`）均不覆盖它**（G0 勘误） | 『工作区记录损坏，本次不会自动恢复上次的文件夹。』 | 暂无自动恢复；损坏记录的**显式重建**不在 P0-0（保守默认：不隐式覆盖）——待后续显式修复入口 |
| G16 | **注册表读取/存储不可用**（本轮新增） | **不 legacy adoption、不写任何键**；本次为 `disk-session('registry-unavailable')`；目录（若裸键可用）仍可读写 | 『无法读取工作区记录，本次不会记住这个文件夹。』 | 稍后重试；或在存储恢复后重新「打开本地文件夹」 |

**纪律**：G11 不得写成事实。任何「浏览器会自动保留 IDB 数据」的说法都不成立（浏览器可在存储压力下清除），这已由 G6 覆盖。

---

## 3. 联合验收清单

每项给：前置条件 / 用户动作 / 可观察结果 / 测试层 / 故障注入 / 负控（能命中该守点的反向用例）。**负控是本清单的核心**：一个只会通过的用例不构成验收。

层代号：`U`=纯函数或类单测；`C`=组件/集成（jsdom）；`M`=人工（真实浏览器、真实目录、真实手势/输入法，不可用替身冒充）。

### F1 当前文档 dirty 且正在写入时改名/移动

| 项 | 内容 |
|---|---|
| 前置 | 工作区已挂载；打开 `研发/架构.mm.md`；编辑使其 dirty（**至少一次成功落盘**，以满足 I-14） |
| 动作 | ① 触发一次保存并使其在途 → 立刻在文件面板对该文件改名；② 改名完成前继续编辑 → 再按 Ctrl+S |
| 可观察 | ① 在途写入期间改名被**拒绝**：文案『上一份写入还没有结束，请稍后重试（本次未做任何改动）。』（`busy-physical`）；② 若尚无在途写入则租约立即授予；③ 租约期间 **Ctrl+S 不发起写入**，提示『正在处理上一步操作』类文案，且 `saving` 不闪、dirty 不变；④ 改名成功后，**下一次**保存写入新路径（新目的地）；⑤ 新文件内容 = 改名**前**已落盘的内容；改名期间的编辑在租约释放后由一次自动保存补写到新文件；⑥ 内容未再变化时 dirty 清除；⑦ 旧路径不再存在 |
| 层 | U（租约 + 目的地重绑）+ C（面板提示/禁用）+ M（真实句柄下的第 ⑤ 条） |
| 故障注入 | `createWritable` 延迟 500ms；`removeEntry` 抛 `E-PERMISSION`；让 `isSameEntry` 缺失 |
| 负控 | ① 移除 `rebindDestination`（目的地仍指旧句柄）→ 必须断言「后续保存不进新文件」而失败；② **只**清 auto 定时器、不取租约 → 必须断言「租约期间 Ctrl+S 未发起写入」而失败；③ 把 `waitForIdle` 当物理写静默 → 必须断言 `busy-physical` 拒绝路径存在而失败；④ 用「改名前不要求落盘」的实现 → 必须断言「新文件内容 = 改名时磁盘内容（旧）」而失败 |

### F2 删除当前文档或其父目录，含隐藏草稿/组合输入

| 项 | 内容 |
|---|---|
| 前置 | 打开文档；在节点标题内进入 IME 组合状态（未 commit）；另有用例注入未提交草稿 |
| 动作 | 删除当前文档；第二次对话删除其父目录 |
| 可观察 | ① 组合进行中 → 不弹模态框、不执行删除，提示『输入法正在输入，请先结束输入』，组合结束后自动续跑；② 草稿提交失败 → 保留草稿、中止删除、提示可修正；③ dirty → 三选（保存后删除 / 放弃修改并删除 / 取消）；④ 取消 → 文档、草稿、目的地、树、面板全部不变；⑤ 确认删除 → 文档关闭回空白态，**不残留**指向已删文件的 dirty 会话 |
| 层 | C（`draftFlush` + 离开决策器同族）+ M（真实 IME） |
| 故障注入 | `flushEdits()` 返回 `'failed'`；`flushEdits()` 返回 `'composing'`；`removeFile` 抛 `E-PERMISSION` |
| 负控 | 用「先删再询问」的实现 → 断言「取消后文档仍可编辑且内容完整」必须失败；用「放弃修改后仍自动保存一次」的实现 → 断言「文件未被重建」必须失败 |

### F3 移动目标写成、源删除失败

| 项 | 内容 |
|---|---|
| 前置 | 工作区含 `研发/架构.mm.md` 与目录 `归档/` |
| 动作 | 把文档拖到 `归档/` |
| 可观察 | ① 显示「部分完成」，同时列出 `归档/架构.mm.md` 与 `研发/架构.mm.md` 两份；② 三个动作可用（重试删除原始 / 保留两份 / 撤销新副本）；③ 「重试删除原始」只删源文件，**不重建目标**；④ 当前编辑的会话留在新位置，后续保存写新路径；⑤ 树里旧文件标「重复」 |
| 层 | U（host `*Safe` 结果）+ C（三选 UI） |
| 故障注入 | `removeEntry` 抛 `E-PERMISSION` |
| 负控 | 把 partial 当 failed 呈现（显示「移动失败」）→ 必须断言「UI 出现『两份』说明」而失败；盲目重试（第二次 `createFile`）→ 必须断言「目标内容未被覆盖」而失败 |

### F4 权限撤回、外部改名或目录失联后重新定位

| 项 | 内容 |
|---|---|
| 前置 | 打开工作区文档；准备三种故障：撤回写权限、把文件改名移出目录、让根目录不可遍历 |
| 动作 | 分别触发保存、打开、扫描 |
| 可观察 | ① 保存失败 → `SAVE_FAILED_NOTICE` 文案、dirty 保持、**不出现**「已保存」；② 打开时 `E-NOT-FOUND` → 出现「重新定位」入口；③ 扫描失败 → 失联提示 + 三动作；④ 重新定位成功后收藏与最近沿用（按 `lineageId`），**文件内容未被修改** |
| 层 | U + C + M（真实权限撤回只能用真实手势复现） |
| 故障注入 | `createWritable` 抛 `E-PERMISSION`；`getFile()` 抛 `E-NOT-FOUND`；`values()` 抛错 |
| 负控 | 按同名自动重绑（不询问、不比对）→ 必须断言「错误的同名文件未被当作原文件」而失败 |

### F5 同名文件位于不同目录 / 新句柄指向同一文件

| 项 | 内容 |
|---|---|
| 前置 | 工作区含 `研发/笔记.mm.md` 与 `个人/笔记.mm.md`，内容不同；两者都收藏 |
| 动作 | ① 分别打开；② 打开 `研发/笔记.mm.md` 后改名 |
| 可观察 | ① 收藏是两条独立条目，各自指向正确文件；② 当前文档高亮只命中真正打开的那一份；③ 改名后收藏跟随该文档（按 `lineageId`），不新增、不丢失；④ 改名后的新句柄**不**产生新的索引条目、不产生新收藏 |
| 层 | U（索引层）+ C（面板） |
| 故障注入 | 让新句柄与旧句柄的 `name` 相同（同目录改名到同名不允许，改用 `getFile()` 返回相同 `lastModified` 的夹具） |
| 负控 | 收藏键回退为 `fullPath` → 必须断言「改名后收藏仍在且指向同一逻辑文档」而失败 |

### A1 两工作区都有 `assets/a.png`，连续切换并出现迟到结果

| 项 | 内容 |
|---|---|
| 前置 | A 工作区 `assets/a.png`（红）与 B 工作区 `assets/a.png`（蓝）；同一文档引用 `assets/a.png` |
| 动作 | 挂载 A → 打开文档 → 切换到 B → 让 A 的 `listAssets` / `readAssetFile` 结果在切换后返回 |
| 可观察 | ① 预览与插入均来自当前作用域（B 的蓝图）；② A 的迟到结果被丢弃（无闪烁、无错图），开发诊断里有记录；③ 面板中两张同名卡片带不同归属徽章，不互相覆盖 |
| 层 | U（host 作用域键与 epoch）+ C（app 回填校验）+ M |
| 故障注入 | A 的 `readAssetFile` 延迟 800ms；切换后仍触发 `resolve` |
| 负控 | 去掉 epoch 校验 → 必须断言「预览来自当前作用域」而失败；把缓存键改回 `relPath` → 必须断言「两作用域不互相覆盖」而失败 |

### A2 同名不同内容上传、选择保留两份/替换/取消

| 项 | 内容 |
|---|---|
| 前置 | 工作区已有 `assets/diagram.png`（240KB），被 `架构.mm.md` 引用 1 处 |
| 动作 | 上传另一个不同的 `diagram.png`（310KB），分别选三种 |
| 可观察 | ① 保留两份 → 出现 `assets/diagram 2.png`，原文件字节**逐字节不变**，既有引用不变；② 替换 → 原文件内容变化，引用解析到新内容；③ 取消 → **磁盘零写入**，清单不变；④ 冲突面板列出已知引用处数 |
| 层 | U（host）+ C（冲突面板） |
| 故障注入 | 让 `hasAsset` 返回 true 但读元数据失败（降级为只按同名判定） |
| 负控 | 静默替换实现 → 断言「原文件字节不变 + 出现两份」必须失败 |

### A3 IDB / 磁盘写入失败，但 object URL 可用

| 项 | 内容 |
|---|---|
| 前置 | 浏览器素材库可写路径正常；准备注入 `putRecord` reject 与 `writable.write` reject |
| 动作 | 上传图片 |
| 可观察 | ① 卡片带「仅本次会话」徽章；② 文案含「未写入持久存储」；③ 新实例（模拟刷新）清单里没有该项，文档引用显示断图；④ 有「重试写入」入口 |
| 层 | U（host 三态）+ C（面板徽章/文案）+ M（真实刷新） |
| 故障注入 | `putRecord` reject；`writable.write` reject |
| 负控 | 沿用「只返回 AssetItem」的现状接口 → 必须断言「能区分三态」而失败；把 `session-only` 显示为「已保存」→ 必须断言文案不含「已保存」而失败 |

### A4 删除被当前/未打开/未知文档引用的资产

| 项 | 内容 |
|---|---|
| 前置 | ① 当前文档引用 `a.png`；② 另有一篇未打开文档也引用它；③ 存在一个不可读目录（制造扫描缺口） |
| 动作 | 在详情页点「删除图片文件」 |
| 可观察 | ① 只扫过当前文档时**不得**显示「没有引用」，必须显示「引用范围未知」；② 完整扫描后命中列表包含未打开文档；③ 存在不可读目录 → `complete=false`，文案含「无法确认」；④ 删除后引用变断图，**文档里的引用不被自动移除** |
| 层 | U（引用扫描纯函数 + coverage）+ C（确认文案）+ M |
| 故障注入 | 让某目录 `values()` 抛错；让某文档 `readFile` 抛错 |
| 负控 | 把「未扫描」当「无引用」→ 必须断言文案含「未知」而失败 |

### A5 嵌套目录文档移动、复制、另存为，包含相对图片引用

| 项 | 内容 |
|---|---|
| 前置 | 工作区含 `研发/架构.mm.md`（内含 `@img:assets/diagram.png`）与根级 `assets/diagram.png` |
| 动作 | ① 移动文档到 `归档/`；② 复制文档；③ 另存为到 `草稿/` |
| 可观察 | ① 三种操作后文档里的引用字符串**逐字不变**；② 三种产物重新打开后图片正常显示；③ 源文档在复制/另存为后内容不被改写 |
| 层 | U（host 移动/复制）+ M（真实重开） |
| 故障注入 | 在移动过程中让 `removeFile` 抛错（转到 F3 的部分成功分支） |
| 负控 | 把引用改写为「相对文档目录」（如 `../assets/diagram.png`）→ 必须断言「引用逐字不变」而失败 |

### A6 存有浏览器资产的文档换浏览器或清空本地数据

| 项 | 内容 |
|---|---|
| 前置 | 文档含通过浏览器素材库插入的图片（未落盘） |
| 动作 | 清空站点数据后重新打开该文档（或换隐私窗口） |
| 可观察 | ① 图像显示断图占位；② 详情/诊断说明「这张图片保存在浏览器素材库，本机已找不到」；③ 提供重新定位入口；④ 全流程**不出现**任何「单文件可携带」类表述 |
| 层 | C + M（真实清数据） |
| 故障注入 | 只清 IDB、保留 localStorage（验证索引仍在但资产缺失） |
| 负控 | 断言界面文案不含「图片已保存 / 可随身携带」等承诺 —— 若存在则验收失败 |

### A7 小 SVG、大 SVG、位图和断链远程图

| 项 | 内容 |
|---|---|
| 前置 | 准备 8KB SVG、40KB SVG、300KB PNG、`@img:https://example.com/x.png` |
| 动作 | 分别上传/插入；检查卡片徽章、文档序列化结果、导出 |
| 可观察 | ① 8KB SVG → 「已内联」，`note.icon` 为 data URL，脱离工作区仍显示；② 40KB SVG → 落 `assets/`，引用为相对路径；③ PNG → 落 `assets/`（挂载）或 IDB（未挂载）；④ 远程 → 断图 + 「外部引用，不在图库管理范围」；⑤ 导出 SVG 各形态正确；PNG 遇外链降级 SVG 并有提示 |
| 层 | U（阈值与净化）+ C + M（导出） |
| 故障注入 | 把 SVG 阈值上下各放一个 1 字节边界的文件 |
| 负控 | 把小 SVG 也写盘（或把大 SVG 内联）→ 必须断言「落点徽章与实际行为一致」而失败 |

### X1 导图和自由画布各完成「创建→插图→保存→关闭→重开」

| 项 | 内容 |
|---|---|
| 前置 | 工作区已挂载 |
| 动作 | 两条旅程各走一遍：新建 → 插入图片 → 保存 → 关闭 → 重开 |
| 可观察 | ① 内容与资产一致（图片可见、引用未变）；② 读的是**实际成功快照**（不是 UI 状态）；③ 插入的引用在重开后能**按 §1.5.1 的唯一规则**解析（工作区已挂载时指向 `<workspace>/assets/`） |
| 层 | M（必须真实产品入口） |
| 故障注入 | 在第②步注入一次保存失败 → 断言「未出现『已保存』」 |
| 负控 | 用替身 picker 冒充真实系统选择器手势 → **不算通过**（来源：`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md:52`） |
| 状态 | **只有导图部分构成 X1 的通过证据。** 自由画布：UD-1 已决定首期不纳入工作区与文件面板，其资产能力**未设计**；因此「自由画布里没有插图功能，但界面提示了不支持」**不算** X1 通过，也不算部分通过——它只是「未实现且已如实告知」。自由画布的完整 X1 必须在独立设计包落地后单独验收（`P1-C`，见 §5） |

### X2 资产替换/删除与文档 Undo/Redo、保存重开交叉

| 项 | 内容 |
|---|---|
| 前置 | 文档已插入图片并保存 |
| 动作 | Ctrl+Z 撤销插入 → Ctrl+Shift+Z 重做 → 保存 → 删除该资产文件 → 重开文档 → 再按 Ctrl+Z |
| 可观察 | ① 模型撤销能恢复/重做**引用**；② 删除外部文件后，模型撤销**不能**恢复文件（断图仍在）；③ UI 不承诺「撤销即恢复文件」；④ 重开后断图占位与诊断正确 |
| 层 | C + M |
| 故障注入 | 在撤销后立刻保存，验证磁盘快照与模型一致 |
| 负控 | 实现「撤销即把文件写回」的假承诺 → 若界面或文案存在此类承诺则验收失败 |

---

### 3.1 本轮契约补正对应的新增验收项

这些项对应 `../2026-09-19-file-assets-contract-close/contract-delta.md` 的 CD-01…CD-16；**设计预期 ≠ 实测通过**（见 §3.2）。

#### L1 租约关闭「等待空闲 → 新保存进入 → 复制删源」竞态

| 项 | 内容 |
|---|---|
| 前置 | 工作区已挂载；当前文档已成功落盘；准备一个会在等待期触发内容变化的编辑动作 |
| 动作 | 取得租约 → 在租约期间修改内容（使 auto 重排）→ 执行改名 |
| 可观察 | ① 租约期间所有 auto 请求返回 `blocked` 且**不入队**；② host 的 `renameFileSafe` 在租约内只被调用一次；③ 改名完成后仅有一次针对**新目的地**的自动保存；④ 新文件内容 = 改名前的落盘快照；⑤ 最终磁盘内容 = 最新编辑内容 |
| 层 | U（会话租约）+ C（编排） |
| 故障注入 | 让 auto 的 300ms 定时器在租约期间到期 |
| 负控 | 去掉租约（只清定时器）→ 断言「租约期间无写入请求进入队列」必须失败 |

#### L2 租约内 Ctrl+S / 另存为 / 切文档迟到回调

| 项 | 内容 |
|---|---|
| 动作 | 租约期间分别按 Ctrl+S、按另存为、切到另一篇文档 |
| 可观察 | ① 两者都返回 `blocked` + 同一文案，**不弹选择器**；② 切文档后 host 操作的完成回调因 `leaseId`/`opSeq` 不匹配而**零回填**（不写旧文档、不写新文档）；③ 租约不计入新会话 |
| 层 | U + C |
| 负控 | `finally` 无条件 `endExclusiveOp()` → 断言「新会话持有的租约未被旧请求释放」必须失败 |

#### L3 部分成功后继续编辑再撤销副本

| 项 | 内容 |
|---|---|
| 前置 | 制造 F3 的部分成功状态（目标已建、源删除失败） |
| 动作 | 在副本里继续编辑并保存一次 → 点「撤销新副本」 |
| 可观察 | ① 撤销被**拒绝**并提示『这份副本已有新的改动，删除会丢失它们』；② 只提供「放弃这些改动并删除副本」或「保留两份」；③ 未编辑未写入时撤销正常执行并回到旧位置 |
| 层 | U + C |
| 负控 | 无条件删除副本 → 断言「副本的新内容仍在」必须失败 |

#### L4 重试删源前源被外部修改

| 项 | 内容 |
|---|---|
| 前置 | 部分成功状态；在应用外修改源文件（内容/时间戳） |
| 动作 | 点「重试删除原始」 |
| 可观察 | ① 复查 `{size, lastModified}` 不一致 → **不删除**；② 提示『原文件已被外部修改，未删除』；③ 转为「保留两份」并标「重复」 |
| 层 | U + C（外部修改用夹具注入） |
| 负控 | 跳过复查直接 `removeEntry` → 断言「源文件仍存在」必须失败 |

#### S1 工作区身份（对应 T1 检查点）

| 项 | 内容 |
|---|---|
| 动作 | ① 同目录重新选择；② A→B→A；③ 断开再连接；④ 选择新目录（注册表为空）；⑤ 注册表损坏；⑥ 注册表写入失败；⑦ **IDB 打开/读取失败**；⑧ **关联不可证明**（无 `isSameEntry`）；⑨ **经 `requestPermission` 重新挂载**；⑩ **A→B 且 B 可证明与 A 不同**（CR2-1）；⑪ **两个独立调用方同时识别同一目录**（CR2-4） |
| 可观察 | ① `isSameEntry` 命中 → **同一 `scopeId`**；② A→B→A 后 A 的索引/收藏仍命中（A 条目为 `dormant` 未被删）；③ 断开不删条目，重连恢复同一 `scopeId`，且**裸键被删、注册表转 dormant 是在同一事务里发生**（无半更新）；④ 新目录 → 新 `scopeId`，旧条目保持 dormant；⑤ 损坏 → **不使用、不删除**，本次为 `disk-session('registry-corrupt')` 并如实提示；⑥ 写入失败 → `disk-session('registry-write-failed')`，本次可用但 `persisted:false`，UI 不承诺「下次自动恢复」；⑦ 读取失败 → `disk-session('registry-unavailable')`，**不 legacy adoption、不写任何键**（注册表不留新记录）；⑧ 关联不可证明 → `disk-session('unassociated')`，**注册表与裸键一字未改**，**不声称恢复旧身份**；⑨ `requestPermission` 在未挂载时得到的 `scopeId` 与 `restore` 一致；在已挂载时不改 `scopeId`、不变 `epoch` |
| 层 | U（`handleStore` + `directoryHost`）+ C（提示） |
| 负控 | ① 按目录名判定同一目录 → 断言「两个不同目录得到不同 `scopeId`」必须失败；② 注册表损坏时按裸句柄继续并**复用**某个历史 `scopeId` → 断言「改为生成新 scopeId」必须失败；③ 读取失败折叠成 `empty` → 断言「unavailable 不触发 legacy adoption」必须失败（NC-4）；④ `detach` 分两次写 → 断言「两键一致（都变或都不变）」必须失败（NC-1 同族）；⑤ **把「明确不同」并入「无法判定」→ 断言「B 被持久登记且刷新后仍为 B」必须失败**（NC-6）；⑥ **保留 `writeChain` 用同页并发做负控 → 断言「后写覆盖先写」必须失败**（即负控本身无效，NC-5 必须改为两实例 + 受控交错） |
| 分工 | ④⑤⑥⑦⑧⑨⑩⑪ 由 **P0-0** 交付（实现 + 用例）；②③ 的**人工关联**分支由 **P1-A** 交付（P0-0 只到 `unassociated` 为止） |

#### S2 旧裸句柄兼容与包装对象破坏风险

| 项 | 内容 |
|---|---|
| 前置 | IDB 里只有 `'workspace-root'` 裸句柄（无注册表） |
| 动作 | 启动并挂载 |
| 可观察 | ① `getDirectoryHandle()` 仍返回可用句柄（旧读路径不变）；② 触发 legacy adoption，生成**新** `scopeId`（不猜历史身份）；③ 同事务写入 `'workspace-root'` 裸句柄与注册表 |
| 层 | U |
| 负控 | 把 `{handle, scopeId, v}` 包装对象写进 `'workspace-root'` → 断言 `getDirectoryHandle()` 仍返回句柄 **必须失败** |

#### S3 唯一同名命中不构成归属证据

| 项 | 内容 |
|---|---|
| 前置 | `mindcanvas.starred.v1` 里有一条路径键；当前工作区恰好有唯一同名文档 |
| 动作 | 首次进入文件面板 |
| 可观察 | ① 该键**不自动绑定**，进入「未关联工作区记录」；② 用户点「关联到此工作区」后才写入绑定并记 `relinkEvidence`；③ 用户不处理也不丢 |
| 层 | U + C |
| 负控 | 按「当前目录唯一命中」自动绑定 → 断言「未关联列表中存在该条」必须失败 |

#### R1 回退的两种情形与降级投影

| 项 | 内容 |
|---|---|
| 动作 | ① R-A：只升级不改数据 → 删新键 → 用旧键运行；② R-B：升级后新增收藏/最近/句柄更新 → 回退 |
| 可观察 | ① R-A 无损失；② R-B 下 `mindcanvas.library.v1` / `mindcanvas.starred.v1` / 旧句柄键**含升级后的变更**（投影已写）；③ 投影失败时该次变更不可回退（在诊断中可查） |
| 层 | U |
| 负控 | 只保留旧键不做投影 → 断言「R-B 的收藏仍可见」必须失败 |

#### N1 插入归一化：浏览器素材 + 工作区同名 → 插入/保存/重开

| 项 | 内容 |
|---|---|
| 前置 | 工作区已挂载且 `assets/a.png` 存在（红）；浏览器素材库另有一张 `a.png`（蓝） |
| 动作 | 从浏览器素材库插入蓝图 → 保存 → 关闭 → 重开 |
| 可观察 | ① 插入时提示已复制到工作区；② 磁盘出现 `assets/a 2.png`（默认保留两份），原文件未变；③ 文档引用为 `assets/a 2.png`；④ 重开显示蓝图；⑤ 未挂载工作区时该插入被**拒绝**并说明 |
| 层 | U + C + M |
| 负控 | 只给卡片加 scope 徽章、插入仍写 `assets/a.png` → 断言「重开显示蓝图」必须失败（这是初版被打回的根因） |

#### N2 同名、同大小、同时间戳、不同字节

| 项 | 内容 |
|---|---|
| 前置 | 目标目录已有 `x.png`；构造一个 `size` 与 `lastModified` 相同但字节不同的 `x.png` |
| 动作 | 上传该文件 |
| 可观察 | ① **进入冲突三选**（不跳过、不静默替换）；② 默认焦点「保留两份」；③ 选「保留两份」后原文件字节不变 |
| 层 | U |
| 负控 | 用 `size`+`mtime` 判同内容并跳过 → 断言「新内容已保存」必须失败 |

#### N3 epoch 变化后写入已发生

| 项 | 内容 |
|---|---|
| 前置 | 工作区 A 挂载；准备切换到 B |
| 动作 | 发起上传（写盘延迟）→ 期间切换到 B → 结果返回 |
| 可观察 | ① 当前清单**不展示**该资产；② 索引/清单里存在一条 `unconfirmed: true` 且属于 A 的记账；③ 切回 A 后 `listAssets` 重新发现并清除标记；④ 文案与 `asset-library.md` §6.2 一致 |
| 层 | U + C |
| 负控 | epoch 变化后什么都不做 → 断言「切回 A 后能发现该文件」必须失败 |

#### N4 child 路径的内置图标重开

| 项 | 内容 |
|---|---|
| 前置 | 选中一个节点 |
| 动作 | 用内置图标以「子分支」语义插入 → 保存 → 关闭 → 重开 |
| 可观察 | ① 子节点的图标正常显示；② 文档里不是 `@draw:builtin:<id>`（应为内联 data URL 或归一化后的工作区引用） |
| 层 | U + C + M |
| 负控 | child 直接写 `builtin:` 引用 → 断言「重开后无断图」必须失败（对应 `counterexamples.md` CE-05） |

### 3.2 证据等级（不得混淆）

| 等级 | 含义 | 本文件中的用法 |
|---|---|---|
| **设计预期** | 上表全部「可观察」列的内容 | 未经实跑，不得写成「通过」 |
| **逻辑反例** | `counterexamples.md` 中的 CE-xx | 由代码路径推导，验证方法随附 |
| **读码结论** | `current-state.md` 的【事实】 | 可直接引用为设计依据 |
| **实跑证据** | 尚未产生 | 本包未运行任何测试 |

---

## 4. 测试映射（核对实际文件名与现状断言）

**扩展**=在既有文件里加用例；**新增**=需要新文件。文件路径相对工作区根。

| 场景 | apps/canvas 侧 | packages/react 侧 |
|---|---|---|
| F1 | 扩展 `tests/save-destination.test.tsx`（同族：另存为换目的地、排队写入）；扩展 `tests/useAutoSave.test.tsx`；新增 `tests/rename-current-doc.test.tsx` | 扩展 `tests/directory-host.test.ts`（`renameFile` 返回新句柄，现 `:318-327`） |
| F2 | 扩展 `tests/file-manager-dialogs.test.tsx`（现有删除确认用例 `:131-203`）；扩展 `tests/unsaved-transition.test.tsx`、`tests/note-back-leave.test.tsx`、`tests/leave-entry-matrix.test.tsx` | — |
| F3 | 扩展 `tests/file-manager-tree.test.tsx`（拖入目录用例 `:191-227`）；新增 `tests/file-op-partial.test.tsx` | 扩展 `tests/directory-host.test.ts`（`moveFile` `:343-355`） |
| F4 | 新增 `tests/workspace-relink.test.tsx`；扩展 `tests/useDocumentActions.test.tsx` | 扩展 `tests/directory-host.test.ts`（权限/失联组 `:186-220`） |
| F5 | 扩展 `tests/file-manager-tree.test.tsx`（收藏组 `:388-445`）；新增 `tests/doc-index.test.ts` | — |
| A1 | 新增 `tests/asset-scope-switch.test.tsx` | 扩展 `tests/workspace-asset-host.test.ts`（`mounted=false` 组 `:169-184`） |
| A2 | 新增 `tests/asset-conflict.test.tsx` | 扩展 `tests/workspace-asset-host.test.ts`、`tests/idb-asset-host.test.ts`（同名替换组 `:54-63`） |
| A3 | 扩展 `tests/side-panels-search-refresh.test.tsx`（刷新语义） | 扩展 `tests/idb-asset-host.test.ts`（新实例持久化组 `:34-52`） |
| A4 | 新增 `tests/asset-ref-scan.test.tsx` | 扩展 `tests/asset-diagnostics.test.ts`（现 `:23-48`）+ 新增纯函数 `assetRefScan` |
| A5 | 新增端到端清单（人工）+ `tests/file-op-copy.test.tsx` | 扩展 `tests/directory-host.test.ts`（`writeAsset`/`readAssetFile` 组 `:357-390`） |
| A6 | 人工 + `tests/asset-missing-copy.test.tsx` | 扩展 `tests/asset-broken.test.tsx`（`isMissing` 组 `:49-82`） |
| A7 | 人工导出 + `tests/svg-persist-matrix.test.tsx` | 扩展 `tests/svg-tint.test.ts`（阈值组 `:105-123`）、`tests/workspace-asset-host.test.ts`（分诊组 `:91-105`） |
| X1 | `tests/smoke.test.tsx` 同族的人工清单；`tests/free-canvas-stage.test.tsx` | — |
| X2 | 扩展 `tests/useDocumentActions.test.tsx`、`tests/free-canvas-save-lifecycle.test.tsx` | 扩展 `tests/editor-controller.test.ts`、`tests/nodeg-asset.test.tsx` |
| 门禁相关 | 扩展 `tests/no-native-dialogs.test.ts`（新增入口不得引入原生对话框） | — |

**必须一起核对的既有断言边界**（不得因为新设计而改错期望）：

| 现有断言 | 为什么不能动 |
|---|---|
| `save-destination.test.tsx:207-237`「另存为取消：目的地不变，后续 auto 仍写原文件」 | 这是目的地语义的基线；改名重绑必须与之同构 |
| `save-destination.test.tsx:238-278`「附属记录失败 → saved/current、dirty 清、只发附属警告」 | 主事实/附属记录两分，新流程必须沿用 |
| `idb-asset-host.test.ts`「新实例仍见上传项」 | 持久化语义基线 |
| `workspace-asset-host.test.ts:169-184`「未挂载 → 全部降级 fallback、磁盘零写入」 | 降级语义基线 |
| `asset-virtual.test.tsx:17-37`「500 项只渲染可视窗口」 | 性能改造后此断言必须仍成立（不能改回全量） |
| `asset-panel-grid.test.tsx:41-61`「卡片 80px / 预览 48×48」 | 视觉规格，性能改造不得顺手改掉 |
| `directory-host.test.ts:304-311`「createFile 同名不覆盖」 | 现有行为；本设计在**上传资产**路径改为三选，**文档新建**路径保留静默加序号（并在 UI 提示）——两者不要混淆 |
| `directory-host.test.ts:343-355`「moveFile 内容迁到目标目录、源目录不再有它」 | 现有断言只覆盖**成功**路径；新增 `*Safe` 不得改动它的期望，部分成功另开用例 |
| `handle-store.test.ts:134-190`「往返与容错」 | 注册表是**新增键**，这些用例的语义（裸键往返、垃圾数据返回 null、IDB 不可用静默降级）必须全部继续成立 |
| `no-native-dialogs.test.ts` | 所有新增确认（冲突、删除、部分成功、人工关联工作区）必须用内联 UI，不得引入 `window.confirm/prompt/alert` |

### 4.1 本轮新增/扩展的测试文件清单（供 P0 各包认领）

| 文件 | 包 | 类型 |
|---|---|---|
| `packages/react/tests/workspace-scope.test.ts` | P0-0 | 新增 |
| `packages/react/tests/handle-store.test.ts` | P0-0 | 扩展 |
| `packages/react/tests/directory-host.test.ts` | P0-0 / P0-A | 扩展 |
| `packages/react/tests/file-ops.test.ts` | P0-A | 新增（`FileOpOutcome` 纯函数层） |
| `packages/react/tests/asset-scope-key.test.ts` | P0-B | 新增（`AssetKey` 组装/解析纯函数） |
| `apps/canvas/tests/doc-index.test.ts` | P0-D | 新增 |
| `apps/canvas/tests/file-op-lease.test.tsx` | P0-A | 新增 |
| `apps/canvas/tests/file-op-partial.test.tsx` | P0-A | 新增 |
| `apps/canvas/tests/rename-current-doc.test.tsx` | P0-A | 新增 |
| `apps/canvas/tests/asset-scope-switch.test.tsx` | P0-B | 新增 |
| `apps/canvas/tests/asset-insert-normalize.test.tsx` | P0-B | 新增 |
| `apps/canvas/tests/notices-consistency.test.tsx` | P0-C | 新增 |

**命名与位置纪律**：新测试一律放在包各自的 `tests/` 下（`packages/react/tests/`、`apps/canvas/tests/`），与现有命名风格一致（`kebab-case.test.ts[x]`）。`packages/react/vitest.config.ts` 已用 `include: ['tests/**/*.test.{ts,tsx}']` 覆盖；`apps/canvas` 同规。需要 jsdom 的文件在首行加 `// @vitest-environment jsdom`（现有 `handle-store.test.ts:1` 即此写法）。

---

## 5. 分期与开发拆包（本轮重排）

---

## 5. 分期与开发拆包（本轮重排）

分期按任务书 §7 的三阶段：**P0 可靠性 → P1 日常工作流 → P2 可携带性**。

规模用 S/M/L 表示相对量级（不是工期承诺）。**本包不编造精确工期。**

### 5.1 责任归属原则（本轮定案）

> **原则 1**：**操作自身的失败反馈随该操作所在包交付**。P0-C 只做「跨操作的统一呈现」，不为前面已经交付的、缺反馈的危险操作打补丁。
>
> **原则 2**：**没有消费者的空实现不做**。任何类型、方法、字段必须在其所属包内被真实代码路径调用（不是只被测试调用），否则不引入。
>
> **原则 3**：公共结果类型放在合法共享层（`packages/react/src/edit/**` 与 `packages/react/src/chrome/**`），并经 `packages/react/src/index.ts` 再导出；**不得**放在 `apps/canvas` 后要求包反向依赖应用（`.dependency-cruiser.js` 现状不拦该方向，属真实风险）。
>
> **原则 4**：共享接线文件（`apps/canvas/src/MindmapStage.tsx`、`FileManager.tsx`、`SidePanels.tsx`）默认由同一包独占修改；未来若要并行，必须先把这些文件的接线责任切分清楚，**不得**以「文件面不同」笼统放行。

### 5.2 串行总览（默认串行）

```text
P0-0 身份与存储基础（S，首发）
  → P0-D 索引、迁移与回退（M）
    → P0-A 文件操作：租约、目的地、失败/冲突/部分成功反馈（L）
      → P0-B 资产上传：三态、同名策略、作用域捕获、插入归一化（L）
        → P0-C 跨操作统一呈现（S）
          → P1-A 文件导航与归档（M）
            → P1-B 图库发现与断图恢复（L）
              → P2-A 可携带项目包（L）
```

**为什么默认串行**：P0-0 定义身份与存储键（被后面全部包读取）；P0-D 定义索引键与迁移（P0-A 的目的地、P1-A 的收藏都依赖它）；P0-A 定义租约与 `FileOpOutcome`（P0-B 的写入与 P1-B 的删除复用同一互斥域）；P0-B 定义 `AssetWriteResult` 与归一化（P1-B 的删除/引用查询依赖）；P1-A 与 P1-B 都改 `MindmapStage.tsx` 接线。

**必须串行的共享改动**：工作区注册表键与事务、索引键定义、`DocumentSaveSession` 新增方法、`FileOpOutcome`/`AssetWriteResult` 类型、`MindmapStage.tsx` 的接线。

---

### P0-0 身份与存储基础（S）

| 项 | 内容 |
|---|---|
| 问题 | 现有代码没有任何可跨会话稳定的工作区身份；`handleStore` 只有 `'workspace-root'` 一个裸句柄键，无法表达 A→B→A，也不能安全地加包装对象 |
| 依赖 | 无 |
| **范围（本轮收窄）** | ① 工作区注册表（§1.2.2 的键、版本、单事务读写）；② `ScopeId` 生成与 `isSameEntry` 识别；③ 八类场景的行为（§1.2.6）；④ legacy adoption（M11）；⑤ `DirectoryWorkspaceHost` 的 `pick/restore/detach` 全部走注册表并暴露 `scopeState`/`scopeId`/`scopeEpoch`；⑥ `FsDirectoryHandle`/`FsFileHandle` 补 `isSameEntry?` 可选声明 |
| **排除（本轮明确）** | 不做 `rebindDestination`（P0-A）；不做 `uploadAssetDetailed`（P0-B）；不做 `*Safe` 变体（P0-A）；不做索引（P0-D）；不做任何 UI 改动；**不做无消费者类型模块** |
| **消费者（证明不是空壳）** | `DirectoryWorkspaceHost` 的挂载/恢复/断开三条既有真实路径；被 `packages/react/tests/directory-host.test.ts` 的挂载/恢复/断开用例覆盖；P0-D 直接消费 `scopeId` 作为索引主键前缀 |
| 文件与接口归属 | 修改 `packages/react/src/edit/handleStore.ts`（新增注册表读写 + 保裸键）；修改 `packages/react/src/edit/directoryHost.ts`（接线 + 访问器）；修改 `packages/react/src/edit/directoryTypes.ts`（`isSameEntry?`）；修改 `packages/react/src/index.ts`（导出面）；新增 `packages/react/src/edit/workspaceScope.ts`（`ScopeId` 生成/校验/记录形状的纯函数） |
| 测试 | 新增 `packages/react/tests/workspace-scope.test.ts`；扩展 `packages/react/tests/handle-store.test.ts`（注册表事务、损坏记录、写入失败）；扩展 `packages/react/tests/directory-host.test.ts`（同目录重选、A→B→A、断开再连、新目录、旧裸句柄） |
| 负控 | ① 把注册表记录写入 `'workspace-root'`（包装对象）→ 断言旧读路径 `getDirectoryHandle()` 仍返回句柄 **必须失败**；② 去掉 `isSameEntry` 比对、按目录名同判 → 断言两个不同目录得到**不同** `scopeId` 必须失败；③ 注册表损坏时按旧裸句柄继续并**生成新 scopeId**（不猜历史身份） |
| 回执与停止点 | 交付注册表实测（写→读→A→B→A→回退版本可读裸键）+ `isSameEntry` 缺失的保守降级实测；**停止**等主控确认后再开 P0-D |

### P0-D 索引、迁移与回退（M）

| 项 | 内容 |
|---|---|
| 问题 | 收藏按 `fullPath` 存（改名即丢）；「最近」混用 mtime 与访问时间（违反 UD-2）；无法表达血统；无归属证据规则；「删新键即回退」的说法不成立 |
| 依赖 | P0-0 |
| 范围 | 索引层（`DocIndexEntry`/`AssetIndexEntry`，含 `openedAt: number \| null`、`ephemeral`、`relinkEvidence`、`legacyKeys`）；M4–M9 与 M11 的惰性迁移；**归属证据规则**（§6.2.1）与历史池；**降级投影**（§6.3）；`lineageId` 生成与继承；收藏与「最近」从此读写索引 |
| 排除 | 不改 `DocLibrary` 既有键的读写（只做双读 + 投影写）；不做内容指纹；不改 UI 结构（只换数据源）；不做旧键删除 |
| 文件与接口归属 | 新增 `apps/canvas/src/docIndex.ts`（唯一写入口，含投影写入）；`apps/canvas/src/FileManager.tsx` 数据源换为索引 + 树；`fileManagerShared.ts` 的 `useStarredKeys` 改为读写索引；`packages/react/src/edit/docLibrary.ts` 只加**读**入口 |
| 测试 | 扩展 `packages/react/tests/doc-library.test.ts`（双读与投影兼容）；新增 `apps/canvas/tests/doc-index.test.ts`（幂等、续跑、**降级投影内容**、历史池不自动绑定） |
| 负控 | ① 旧键损坏 → 断言索引仍可用且不崩；② 同一旧键迁移两次 → 断言结果一致（幂等）；③ 某旧键在当前目录**唯一同名命中** → 断言**不自动绑定**且进历史池；④ 升级后新增收藏 → 断言降级投影里能看到（证明回退不是「旧键还在」而已） |
| 回执与停止点 | 交付迁移实测 + 回退实测（区分 R-A：无新写入；R-B：有新写入 + 投影）；停止点：旧键删除时序由主控决定（DS-10） |

### P0-A 文件操作：租约、目的地与反馈（L）

| 项 | 内容 |
|---|---|
| 问题 | 改名/移动当前文档后目的地不更新（R-01）；改名读磁盘旧快照（I-14）；无操作互斥（竞态见 `shared-contracts.md` §3.5.1）；所有失败无用户可见通道（R-03）；同名静默覆盖（R-09）；部分成功不可见且撤销/重试无保护 |
| 依赖 | P0-D |
| 范围 | ① 操作租约（`beginExclusiveOp`/`endExclusiveOp`、`physicalWritesInFlight`、每个 await 后的归属校验、条件释放）；② 目的地显式化与 `rebindDestination`（单一事实源，I-20）；③ 当前文档改名/移动的完整编排（含 I-14 前置）；④ `renameFileSafe`/`moveFileSafe`/`removeFileSafe`/`removeDirSafe` + `FileOpOutcome`；⑤ 删除当前文档的 F2 流程；⑥ **连同失败/冲突/部分成功反馈一起交付**：错误码 → 文案、内联冲突三选、部分成功三选（含撤销副本的保护与重试删源的外部修改复查）；⑦ 创建副本（`duplicate`） |
| 排除 | 不做文件夹移动；不做跨目录复制；不做批量；不做自由画布；不改离开决策器；不做引用扫描（P1-B） |
| 文件与接口归属 | `apps/canvas/src/hooks/useDocumentSaveSession.ts`（租约 + `rebindDestination` + 物理写计数）；`apps/canvas/src/hooks/useDocumentActions.ts`（编排）；`apps/canvas/src/FileManager.tsx` + `FileManagerModal.tsx`（UI、前置校验、冲突与部分成功面板）；`apps/canvas/src/MindmapStage.tsx`（`openWorkspaceFile`/`workspacePath` 同步）；`packages/react/src/edit/fileOps.ts`（**新增**：`FileOpError`/`FileOpOutcome`/错误码）；`packages/react/src/edit/directoryHost.ts`（`*Safe`，修 `removeEntry?.` 静默成功）；`packages/react/src/index.ts`（导出面） |
| 测试 | 扩展 `apps/canvas/tests/save-destination.test.tsx`、`useAutoSave.test.tsx`、`file-manager-tree.test.tsx`、`file-manager-dialogs.test.tsx`、`unsaved-transition.test.tsx`；扩展 `packages/react/tests/directory-host.test.ts`；新增 `apps/canvas/tests/rename-current-doc.test.tsx`、`tests/file-op-partial.test.tsx`、`tests/file-op-lease.test.tsx` |
| 负控 | F1/F2/F3/F5 的全部负控（§3）；专项：去掉租约 → 断言「等待空闲期间新保存进入」的场景必须失败；把 `waitForIdle` 当物理写静默 → 断言 `busy-physical` 拒绝必须失败；无条件删除副本/源 → 断言保护分支必须失败 |
| 回执与停止点 | 交付 F1/F2/F3/F5 自动化 + F1 第③条与 F2 IME 的人工结果 + 租约 6 类时序的自动化；停止点：**不自动进入 P1** |

### P0-B 资产上传：三态、同名与归一化（L）

| 项 | 内容 |
|---|---|
| 问题 | 缓存键无作用域（R-07）；无 epoch 捕获；上传结果不可判别（R-08）；`persisted` 被读成可携带（I-12）；`size`+`mtime` 被当作同内容判定（CE-03）；`resolve` 回落站点根（R-15）；插入的引用与内存 scope 脱节（I-10） |
| 依赖 | P0-A（复用租约与 `FileOpError`） |
| 范围 | ① `AssetKey` 化缓存键 + `scopeKey/epoch` 捕获与记账（`unconfirmed`）；② `uploadAssetDetailed` 三态 + `AssetPortability`；③ 同名策略（首期不去重，一律三选，默认「保留两份」）；④ `resolveAssetState`（`no-scope`/`missing`/`wrong-scope`/`external`/`unavailable`）；⑤ **插入归一化**（`normalizeForInsert`，I-10）与 child 路径的内联修正；⑥ 统一 revoke + LRU；⑦ 落点/可携带性徽章文案 |
| 排除 | 不做懒加载/分页（P1-B）；不做删除/引用查询/断图修复（P1-B）；不改 `AssetHost` 既有方法签名；不做内容指纹 |
| 文件与接口归属 | `packages/react/src/chrome/assetHost.ts`（增量接口 + 结果类型）、`workspaceAssetHost.ts`、`idbAssetHost.ts`；`packages/react/src/chrome/AssetPanel.tsx` + `assetViews.tsx`（徽章与文案）；`apps/canvas/src/SidePanels.tsx`（归一化调用点 + child 内联修正）；`apps/canvas/src/MindmapStage.tsx`（scope 捕获与回填校验、`uploadToGallery`） |
| 测试 | 扩展 `packages/react/tests/workspace-asset-host.test.ts`、`idb-asset-host.test.ts`、`asset-host.test.ts`、`asset-panel.test.tsx`、`asset-panel-grid.test.tsx`、`nodeg-asset.test.tsx`；新增 `apps/canvas/tests/asset-scope-switch.test.tsx`、`tests/asset-insert-normalize.test.tsx` |
| 负控 | A1/A2/A3 的全部负控；专项：把 `size`+`mtime` 相同判为同内容 → 断言「同名同大小同时间戳不同字节」场景失败；epoch 变化后什么都不做（不记账）→ 断言「切回后能发现该文件」必须失败；child 直接写 `builtin:` → 断言重开后无断图必须失败 |
| 回执与停止点 | 交付 A1/A3 自动化 + A1 人工（切工作区与迟到结果）+ 插入归一化的保存重开自动化；停止点：不做删除入口 |

### P0-C 跨操作统一呈现（S）

| 项 | 内容 |
|---|---|
| 问题 | P0-A/P0-B 各自交付了自己的失败文案，但两处可能出现措辞不一致、提示位置不同、重复实现 |
| 依赖 | P0-A、P0-B |
| 范围 | **只做统一呈现**：错误码 → 文案的唯一映射表（`assetNotices.ts`）、提示位置与停留时间的一致化、`no-native-dialogs` 守卫、重复点击禁用的一致化 |
| 排除 | **不补救**前面已交付的无反馈危险操作（原则 1）；不新增操作入口；不改 P0-A/P0-B 的判定逻辑 |
| 文件与接口归属 | `apps/canvas/src/assetNotices.ts`（唯一文案事实源）；`apps/canvas/src/FileManagerChrome.tsx`（提示条容器）；`packages/react/src/chrome/AssetPanel.tsx`（复用同一文案键） |
| 测试 | 新增 `apps/canvas/tests/notices-consistency.test.tsx`（同一错误码在两处产生同一文案）；扩展 `no-native-dialogs.test.ts` |
| 负控 | 断言未捕获 Promise 拒绝数为 0；断言两处文案表不是各自硬编码（改一处即两处同步） |
| 回执与停止点 | 交付文案一致性实测；停止点：P0 阶段结束，进入主控评审 |

---

### P1-A 文件导航与归档（M）

| 项 | 内容 |
|---|---|
| 问题 | 当前文档标识缺失；「最近」排序语义混用；搜索不覆盖标题；无键盘导航与 a11y 语义；不支持的文件无反馈；无归档替代 |
| 依赖 | P0-A（**归档依赖可靠移动**，UD-3）、P0-D |
| 范围 | 当前文档高亮与状态行；单一「最近」按 `openedAt` 排序（`openedAt === null` 显示「未记录打开时间」，**不回落 mtime**）；搜索内部标题（限已索引文档）；排序依据可选；roving tabindex + tree 语义 + `aria-current`；「显示其他文件」；「改为归档」；「创建副本」的 UI 入口 |
| 排除 | 文件夹移动、跨目录复制、批量操作（论证见 `file-management.md` §6） |
| 文件与接口归属 | `apps/canvas/src/FileManager.tsx`、`FileManagerTree.tsx`、`FileManagerChrome.tsx`、`fileTreeModel.ts`、`FileManagerContextMenu.tsx` |
| 测试 | 扩展 `apps/canvas/tests/file-manager-tree.test.tsx`、`file-manager-dialogs.test.tsx`；新增 `tests/file-manager-keyboard.test.tsx`、`tests/file-manager-archive.test.tsx` |
| 负控 | 焦点在重命名输入框内时方向键**不得**移动树焦点；两个同名不同目录文件不得同时高亮；`openedAt === null` 的条目**不得**出现在按打开时间排序的前部 |
| 回执与停止点 | 交付 a11y 键盘走查 + X1 导图部分的人工旅程 |

### P1-B 图库发现与断图恢复（L）

| 项 | 内容 |
|---|---|
| 问题 | 网格全量渲染、缩略图无懒加载、清单一次读全部二进制（R-10）；`isMissing` 未接线（R-11）；落点语义未接线（R-12）；无删除/引用查询/断图修复；四类删除未区分 |
| 依赖 | P0-B、P0-C |
| 范围 | 懒加载 + 网格窗口化 + 清单元数据/二进制分离；详情与引用面板；引用扫描（**§1.6 的五个字面量**）；四类删除入口与各自确认；「从素材库隐藏」；断图修复（选择文件/移除引用/忽略；**不含「只在本次会话使用」**）；画布落点语义接线；落点与可携带性徽章 |
| 排除 | 资产改名（`asset-library.md` §4.4）；自动垃圾回收（I-7）；远程 URL 新入口；内容精确去重 |
| 文件与接口归属 | `packages/react/src/chrome/AssetPanel.tsx`、`assetViews.tsx`、`assetHost.ts`、`workspaceAssetHost.ts`、`idbAssetHost.ts`；新增 `packages/react/src/chrome/assetRefScan.ts`（纯函数）；`packages/react/src/render/MapView.tsx`（接线不改实现）；`apps/canvas/src/SidePanels.tsx`、`MindmapStage.tsx` |
| 测试 | 扩展 `asset-virtual.test.tsx`（保留 500 项断言并加 2000 项）、`asset-panel-grid.test.tsx`、`asset-broken.test.tsx`、`asset-diagnostics.test.ts`、`mapview-drop-sensing.test.tsx`、`mapview-upload.test.tsx`；新增 `asset-ref-scan.test.ts`、`apps/canvas/tests/asset-ref-scan.test.tsx`、`tests/asset-delete.test.tsx` |
| 负控 | A4/A6/A7 的全部负控；性能负控：2000 项时首屏 DOM ≤ 200（目标待测，不达标则记录而非放宽断言） |
| 回执与停止点 | 交付 A4/A6/A7 自动化 + A5/A7 人工；交付性能测量报告（**区分目标值与实测值**）；停止点：不做资产改名 |

### P1-C 自由画布能力（单列，不在串行链上）

| 项 | 内容 |
|---|---|
| 状态 | **未设计**。UD-1 只决定「首期不纳入工作区与文件面板」，**不构成**对任何自由画布资产实施方案的批准 |
| 依赖 | 需要独立的自由画布资产设计（格式、宿主、作用域、断图语义），并单独评审 |
| 本包不入链 | 它不阻塞 P0/P1 的完成，也**不得**用「无功能但提示不支持」当作 X1 的通过证据（见 §3 的 X1） |
| 回执与停止点 | 本轮只登记为独立后续项；启动前必须先有设计 |

---

### P2-A 可携带项目包（L）

| 项 | 内容 |
|---|---|
| 问题 | 浏览器素材库的资产换机器即失；单文件文档可携带但资产不可携带 |
| 依赖 | P0/P1 全部契约（尤其 `AssetKey`、插入归一化、`AssetPortability`） |
| 范围（先契约后切片） | **契约**：包形态（目录或压缩包）、manifest 字段（版本、作用域、资产清单、外链清单、可携带性声明）、导入冲突策略、重复导入幂等、版本兼容与拒绝规则。**切片 1**：导出包（含 `assets/` 与 manifest）。**切片 2**：导入包（冲突三选、缺失外链诊断） |
| 排除 | 不做云同步；不做增量同步；不做自动合并；不做跨设备直传 |
| 文件与接口归属 | 新增 `apps/canvas/src/projectPack.ts`（编排）+ `packages/react/src/edit/projectPackFormat.ts`（纯函数：manifest 读写与校验） |
| 测试 | 新增 `packages/react/tests/project-pack-format.test.ts`（往返、版本拒绝、外链声明）+ `apps/canvas/tests/project-pack-import.test.tsx`（重复导入幂等、冲突三选） |
| 负控 | ① 篡改 manifest 版本 → 断言被拒绝而非猜测性导入；② 重复导入同一包 → 断言不产生重复资产、不覆盖已改动的同名资产；③ 包内缺少被引用资产 → 断言显示断图诊断而不是报「导入失败」 |
| 回执与停止点 | 交付契约文档 + 导出/导入各一次人工旅程；停止点：**不做**跨设备同步 |

---

## 6. 收口判据（供主控评审）

一个开发包算完成，需要同时满足：

1. 该包范围内每个核心操作都有**成功 / 取消 / 失败 / 部分成功**四条路径的自动化或人工证据；
2. 该包声明的每条负控都实际跑过并失败（证明断言有判别力）。**普通边界测试不能冒称阴性对照**——阴性对照必须说明：中性化了哪块守卫、正确断言保持不变、预计哪条转红（写法见 `../2026-09-19-file-assets-contract-close/p0-0-implementation-plan.md` §5）。**三条硬性判据**：(a) **负控与正例使用同一份正确期望**，不得把「错误结果」写成通过条件（例如用 `not.toEqual` 断言丢更新）；(b) 转红的判据是**命令退出非零**（记录真实退出码），不得把 expected failure 捕获成 exit 0 后再宣称转红；(c) **常态必红的反例不得进入默认门禁**——「调用方逻辑反例」与「生产实现中性化验证」是两类证据，前者常态失败、只能由独立入口显式运行，后者才证明实现受保护；不得用 `it.fails`、反转断言或宽泛 `skip` 掩盖；
3. 每个新增入口都明确它属于哪种画布 / 哪种存储场景（工作区磁盘 / 浏览器 / 内置 / 会话级），且 UI 文案与之一致；
4. 未验证项（跨浏览器、触控、真实 IME、离线、跨平台像素、物理 I/O 可否撤回）**如实标注为未验证**，不用替身冒充；
5. 不重开 DELIVERY-CLOSE（`docs/dispatch/2026-09-19-delivery-close-final-acceptance.md`），也不把 `docs/roadmap/2026-09-15-open-items.md` 的 O3/O4 或其他未实施项记为完成；
6. **不引入无消费者实现**（§5.1 原则 2）：新增的每个公共类型/方法/字段都能指出其在本包内的真实调用点；
7. **不得为了让验收通过而修改正确期望**：既有断言如需变更，必须在回执中逐条说明「原断言 → 新断言 → 为什么原断言是错的」，否则视为掩盖回归；
8. **不引用历史 2489 全绿作为未来改动通过的证明**：每个包必须给出本包实际跑过的命令与输出摘要。
