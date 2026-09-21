# 快赢批（A2+A3+A4+B3）交付报告

> 日期：2026-08-29 · 范围：T8 降级策略落地（L1 接线 / L4 提示）+ 门禁稳定 + 资产失效诊断
> 提交：`feat(perf): A2/A3/A4` + `feat(assets): B3` 四个 commit（3c0df58 → e6b9385）
> 基线：react 198 → **211**（+13 测试）；kernel 281 不变；`pnpm -r build / typecheck` 0 错误

## 一、交付内容

| 任务 | 内容 | 关键点 |
|---|---|---|
| **A2 L1 激进 LOD 接线** | `lodFor(k, nodeCount?)`：>5000 节点 → detail 阈值 0.26→0.4（skeleton 覆盖扩大，更早省叶文本）；k≥0.5 始终 full（不牺牲眼前阅读）；≤阈值行为完全不变 | T8 降级策略 L1 从「建议」变「默认行为」 |
| **A3 L4 用户提示** | `scaleNoticeFor(totalNodes)`：>20K 激进简化提示 / >50K 建议折叠；Stage 顶部 warn 提示条（pointer-events none） | T8 降级策略 L4 接线 |
| **A4 门禁放宽** | kernel 线性度：小 N 段容差 3→5、大段 3→3.5（超线性 O(N²)=4x 仍被抓）；react viewMs：8ms 单次 → 3 采样中位数 + 12ms | M5-report B1/B2 落地；连跑 3 次稳定 |
| **B3 失效诊断入解析层** | `assetDiagnostics(refs, assetList)` 纯函数 → W-ASSET-MISSING；Stage 合并 parse 诊断 + 资产诊断 → 左下角诊断条 | 顺带启用此前未展示的 parse 诊断 |

## 二、验收

- react **211/211**（36 files）、kernel **281/281**；typecheck / build 0 错误
- 浏览器验收（:5174 热更新）：
  1. 把某节点 `@img` 引用改为 `assets/不存在.png` → **左下角出现 `W-ASSET-MISSING：资产缺失…` 诊断条** + 节点渲染 warn 占位（P2 联动闭环）
  2. 拖入一张图片 → 上传后诊断条消失（清单更新自动重算）
  3. 大图（>20K）时顶部出现规模提示（用 PerfPanel 大数据导入方式验证）

## 三、工程说明

- 全走 minor：`lodFor` 加可选第二参数、新文件（scaleNotice/assetDiagnostics）、Stage 新增 UI；冻结面零破坏
- A4 放宽保留超线性捕捉：O(N²) 的理论比率 4x 仍被 3.5 大段阈值抓出；仅小 N 噪声段放大容差
- B3 的诊断 line=0（解析层后置判定，react 层无行号）；与 kernel parse 诊断同形状，未来可合并进统一诊断面板

## 四、至此闭环

- **T8 降级阶梯 L0–L4 全部落地**：L0 全功能（默认）/ L1 激进 LOD（A2）/ L2 动画降级（M5-T2 已有）/ L3 Canvas 后端（T7 接口预留，未实现）/ L4 提示（A3）
- 资产线 P0–P3 + B3 全闭环：宿主/上传/失效态/虚拟滚动/诊断

## 五、后续候选（未变）

主战役 B1 多文档+持久化（需定文件层：Forgejo API vs 本地 FS）、攻坚 A1 Canvas 后端、战略 C1 导图↔关系图联动。
