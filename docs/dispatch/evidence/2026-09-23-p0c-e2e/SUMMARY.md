# P0-C §七 人工项补验（真浏览器）· 证据汇总

- 日期：2026-09-23
- 性质：**探明性补验**（不是 CT 测试、不进 CI 门禁 —— 见文末「门禁边界」）
- 环境（实测）：
  - 真仓库根 = `/Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5`
  - playwright **1.63.0**（`mindcanvas-s5/package.json:31` devDependencies），`node_modules/playwright` 存在
  - 浏览器缓存 `~/Library/Caches/ms-playwright/` 含 `chromium-1243` + `chromium_headless_shell-1243`
    —— 1.63.0 期望 chromium-1243，**命中原缓存，无需下载**（派单书建议的 1.58.2 期望 chromium-1208，缓存里没有）
  - smoke：`chromium.launch()` + `setContent` → `SMOKE_OK`，`browser.version()=153.0.8010.12`
  - 产物：`apps/canvas` 用 `vite build`（vite v8.2.2）重建，`main-EMdokVhU.js`；静态服务 `vite preview --port 5175`
---

## 1. 逐项结果

| # | 项 | 脚本 | 结果 | 归档 |
|---|---|---|---|---|
| A | P0-B **A1** 人工：连续切工作区 + 迟到结果（无闪烁／无错图） | `tools/verify-a1-workspace-switch.mjs` | **PASS** 14/14 | `A1-WORKSPACE-SWITCH.log` |
| B | P0-B **N1/N4**：真实「插入 → 保存 → 关闭 → 重开」 | `tools/verify-n1n4-reopen.mjs` | **FAIL** 15/24（①②③ 通过；④ 失败，见 §3） | `N1N4-REOPEN.log` |
| C | P0-A **F1 第③条**（租约期间 Ctrl+S 不发写入）+ **F2 IME** | `tools/verify-f1f2-browser.mjs` | **PASS** 12/12（两项标 unconfirmed，见 §4） | `F1F2-BROWSER.log` |
| D | **no-native-dialogs** 真实验证（confirm/alert/prompt 零调用） | `tools/verify-no-native-dialogs.mjs` | **PASS** 13/13 | `NO-NATIVE-DIALOGS.log` |

共享库：`tools/lib/browserHarness.mjs`（页面内文件系统访问 API 替身 + 原生对话框探针 + 像素取色 + 慢盘延迟）。

---

## 2. A1（PASS）关键证据

「无错图」用的是**像素级**判据：两份 `assets/a.png` 是真 PNG（红/蓝 1×1），把卡片 `<img>` 画到
canvas 取中心像素 —— 断言的是**真的画出了哪个颜色**。

- 挂载 A：`a.png` 卡片 store=`workspace-assets`，像素 `#ff0000`（红）
- 切到 B（断开→打开文件夹）：同一 `a.png` 像素 `#0000ff`（蓝），解析 URL 与 A **不同**（R-07 作用域化缓存键）
- 切回 A（A 侧字节已下毒为第三色）：像素**不等于蓝色**，URL 亦非 B 的 → **迟到结果未回填错图**
- 全程 `window.confirm/alert/prompt` 零调用

**观察项 `A1-RE-LIST-STALENESS`**（不计入判据）：同一挂载会话内直接「切换本地目录」到另一工作区后，
`MindmapStage` 的图库重扫 effect 依赖 `[assetHost, writeLedger, workspaceReady]`，`workspaceReady`
true→true 不触发重扫 → 清单短暂停留上一作用域（卡片显示为不可解析，**不是错图**）。
走「断开 → 打开文件夹」路径则正常（本脚本即走此路径）。

---

## 3. N1/N4（FAIL）—— 如实记录，**不阻塞 P0-C 主体范围**

通过（N1 ①②③）：

- N1.3 磁盘出现 `assets/a 2.png`（默认「保留两份」）；原 `assets/a.png` 字节不变（仍是红图）
- N1.6 插入提示「已在工作区 assets/ 保存了一份副本（assets/a 2.png）。」
- N1.8/N1.9 保存后磁盘文档为 `- @img:assets/a 2.png`（**不**指回裸 `assets/a.png`）
- N4.1/N4.2 内置图标落成自包含 `data:` 内联，**没有** `builtin:` 引用（CE-05 成因已消）
- N1.13 未挂载工作区时插入被拒绝、零副作用

失败（N1 ④「重开显示蓝图」及其字节前提）——**两个耦合缺陷，均已给出机制证据**：

### 缺陷 1（high）：`N1-ID-COLLISION` —— 字节复制读了错误存储

- **现象**：从**浏览器素材库**插入一张蓝色 `a.png`（工作区已有红色 `assets/a.png`）时，
  落盘的 `assets/a 2.png` 内容是**红图字节**，蓝图被静默丢弃 → 重开自然显示红图/断图。
- **机制（源码级）**：浏览器素材库项的 id 形态与磁盘项**同为 `assets/<name>`**
  （`packages/react/src/chrome/idbAssetHost.ts:192`）。插入归一化的字节来源
  `assetInsert.ts:221 bytesOf → :229 readAssetFile → host.resolveAssetState`，
  而 `assetHost.ts:262 isWorkspaceAssetRef` 只按 id 前缀判定 → 命中**工作区**引用 →
  读回磁盘上的红图字节。
- **P0-B 残留**：P0-B §7-1 修了 `alreadyInWorkspace` 的判定，但**字节来源**未随同修复。
- **证据**：`N1.5` detail `a2BytesIsBlue=false`；磁盘源码 `@img:assets/a 2.png` 却指向红图。

### 缺陷 2（medium）：`N1-REOPEN-BROKEN` —— 插入会话后重开仍断图

- **现象**：走完「插入 → 保存 → 新建 → 打开该文件」后，引用节点渲染为 `✕ 资产缺失`
  （`ent === undefined`，标签退化为 `@img` + `img:<id>`），无 `<image href>`。
- **对照实验**：同一磁盘状态、但**不经过插入会话**直接以树打开同一文档 → 正常解析出 `blob:`、
  `[data-asset-broken]` 计数 0。→ 重开机制本身可用，失败与「插入会话遗留的实体状态」相关。
- **证据**：`N1.10~N1.15`、`N4.3~N4.5` 全红；`reopenImages=[]`、`reopenedPixel={ok:false,reason:"no-image-href"}`。

> 注：P0-B 报告 §7-8 把「真实重开」标为 unconfirmed、以「归一化产物重新解析指向蓝图字节」的逻辑层
> 替代。**本轮真实重开实测证明该替代不成立** —— 逻辑层通过，真实旅程失败。

---

## 4. F1③ / F2（PASS，含 unconfirmed）

### F1 第③条（租约期间 Ctrl+S）

前置：打开工作区文档并 durable（I-14）；租约窗口用「改名第二步 `removeEntry` 延迟 5s」制造。

| 断言 | 结果 |
|---|---|
| F1③.2 提示**不是** `busy-physical`（「上一份写入还没有结束」） | PASS |
| F1③.3 3 次 Ctrl+S 期间 `saving` **不闪**（从未出现「保存中…」） | PASS |
| F1③.4 租约期间 dirty 不变（起始=结束，3 次采样恒定） | PASS |
| F1③.5 租约期间**零新增写入**（Ctrl+S 未触发任何写盘；旧文件内容不变） | PASS |
| F1③.6 租约结束后改名成功（旧路径消失、新路径出现） | PASS |
| F1③.7 改名后再 Ctrl+S 写入**新路径** | PASS |

- **F1③.1（busy-lease 文案「正在处理上一步操作…」）= unconfirmed**：租约窗口内连按 3 次 Ctrl+S
  未观测到该句（③.2~③.5 均通过 → 拒绝行为成立，但提示未以该句在本 harness 的采样中出现）。
  **不冒充已验证。**

**发现 `F1-S2G-INTERMITTENT-BLOCK`（medium，复现率 4/5）**：「打开工作区文档 → 编辑 → Ctrl+S」时，
首次保存会被 S2G 同步守卫拦截（提示「已阻止保存：当前画布内容与文档不同步（防误写）」），需再按一次才落盘。
判据是 `saveGuard.canWriteDoc` 的精确等值（`syncedSourceRef === doc.source`，`saveGuard.ts:17`），
簿记在 `useDocumentSwitch` 的 effect（`useDocumentSwitch.ts:86,90`）里置位 —— 打开后立即编辑时该 effect 可能尚未提交。
数据不丢（重试可存），但属可见的假失败。

- **连续 5 次复跑实测**：`attempts=5/s2g=4`（FAIL）、`1/None`（PASS）、`5/4`、`5/4`、`5/4`
  —— 即 **5 次里 4 次**该守卫把「编辑后首次 Ctrl+S」拦下，脚本据此把 F1③ 整组标为 **unconfirmed**
  （前置不成立时**不假装通过**）。
- 原始证据：`F1F2-S2G-BLOCKED-run.log`（拦截态一次完整 stdout，含 finding 与 unconfirmed）；
  `F1F2-BROWSER.log`（未被拦截的一次，F1③ 全绿）；`F1F2-S2G-NOTE.md`（机制与复现指引）。

> 因此 F1③ 的「PASS 12/12」需理解为：**在前置达成（durable）的那些运行里**，③.2~③.7 全部成立；
> 前置本身受上述守卫间歇拦截，未经修复时该组断言并非每次都能进入。

### F2 IME

- 用 **CDP `Input.imeSetComposition`**（Chromium 真实输入法通道）驱动组合态，**不用合成 CompositionEvent**。
  页面内事件日志确认 `compositionstart`→`compositionend` 真实到达产品。
- F2.0 组合态建立（编辑框值 `zhong`）PASS；F2.1 组合中删除**不弹**三选模态 PASS；
  F2.2 组合中删除**文档未被删除** PASS。
- **F2.3（结束组合后自动续跑）= unconfirmed**：组合事件确实到达，但结束后未出现确认条/三选。
  无法区分「产品未续跑」与「CDP 组合态收尾时机与产品订阅错开」→ 不判红、不冒充。
- **F2 第⑤条（候选串完整上屏 / 候选窗口行为）= unconfirmed**（与 P0-A §8.2 同纪律）。

---

## 5. no-native-dialogs（PASS）

双通道任一命中即判红：

1. **页面内探针**（`addInitScript`，页面脚本执行前替换 `window.confirm/alert/prompt` 为记录器）
2. **Playwright `page.on('dialog')`**

覆盖旅程（全部走真实 UI）：启动/看内置示例 → 挂载工作区（`showDirectoryPicker`）→ 删除非当前文档
（**内联确认条**，非 `window.confirm`）→ 取消 → 打开并编辑 → 未保存点「新建」（离开决策）→ 取消 →
改名冲突 → 上传同名资产 → Ctrl+S → 适配视图 → 节点右键菜单。

**结果：13/13 全绿，累计 `confirm/alert/prompt` 调用 = 0，Playwright dialog 事件 = 0。**
未覆盖：IDE 内嵌 webview 的「静默吞掉」行为（本守卫的起因）无法在独立 Chromium 复现，二者不等价。

---

## 6. 未覆盖清单（如实）

1. **真实 OS 文件系统 I/O**：工作区用页面内**内存磁盘替身**顶替系统目录选择手势
   （§3 X1 允许替身 picker 顶替**手势**，但真实 OS 文件系统的读延迟/失败模式未覆盖）。
2. **真实系统文件选择器**（`showDirectoryPicker` / 打开/另存为手势）：未覆盖。
3. **逐帧「无闪烁」采样**：用真实点击 + `img.decode()` + canvas 取像素逼近，未做 rAF 逐帧采样。
4. **F1③.1 busy-lease 文案**：未观测到（见 §4）。
5. **F2.3 自动续跑 / F2 第⑤条**：unconfirmed（见 §4）。
6. **浏览器刷新后的重开**：本 harness 的替身句柄无法跨 reload 结构化克隆，N1 的「重开」在同一页面
   会话内完成（真实 IndexedDB 跨会话未覆盖）。
7. **跨浏览器**（Firefox/Safari）：未覆盖（G11）。

---

## 7. 门禁边界（补验脚本**不进 CI**）

- 门禁命令：`pnpm gate` / `gate:fast`（`typecheck && test && depcruise && lint && budget`）；
  CI 见 `.github/workflows/ci.yml`（`check:public / typecheck / build / test / depcruise / lint / budget`）。
- 实测排除：`"lint": "biome lint packages apps"`（**不含 `tools/`**）；
  `scripts/check-code-budget.mjs` 扫 `apps/canvas/src` + `packages/*`（不含 `tools/`）；
  `apps/canvas/vitest.config.ts:27` `include: ['tests/**/*.test.{ts,tsx}']`（不含 `tools/`）。
- 因此本目录 4 个 `tools/verify-*.mjs` 与 `tools/lib/browserHarness.mjs` **不在任何门禁项内**，
  失败不转红主门禁（本次 N1/N4 即为失败态，主门禁不受影响）。

## 8. 复跑方式

```bash
cd "/Users/xin020/Desktop/temp workbase/mindcanvas-portable-20260921/mindcanvas-s5"
# 1) 构建产物（快照新鲜度守卫会卡）
( cd apps/canvas && ./node_modules/.bin/vite build )
# 2) 静态服务托管 dist
( cd apps/canvas && ./node_modules/.bin/vite preview --port 5175 --strictPort & )
# 3) 逐项
node tools/verify-a1-workspace-switch.mjs
node tools/verify-n1n4-reopen.mjs
node tools/verify-f1f2-browser.mjs
node tools/verify-no-native-dialogs.mjs
```
