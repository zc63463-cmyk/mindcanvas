/**
 * R5-3：Canvas 自动降级提示（同一文档只提示一次；切换文档后重新允许）。
 *
 * 背景：>5 万可见节点（纯树文档）自动降级 Canvas —— 树线标签与 note 角标不渲染，
 * 但用户此前零感知（全仓无任何降级提示）。本 hook 把「进入降级」映射为一条命令
 * 告警条；`backend` 来自 `MapStats.backend`（已并入材料字段：后端变化必然触发一次上报）。
 *
 * 去重语义（判别测试：tests/useCanvasDegradeNotice.test.tsx）：
 * - 同一文档重复上报（stats 材料字段每 200ms 可能变化）→ 只提示一次（防刷屏）；
 * - 切换文档后再进入降级 → 再提示一次（去重键 = 文档，而非会话级布尔）。
 * 记忆用 ref（不引发重渲；重渲也不会重复触发——同步置位在 notify 之前）。
 */
import { useEffect, useRef } from 'react';

/**
 * 降级提示文案。损失项以实测为准（packages/react/tests/canvas-degrade.test.tsx：
 * 同夹具 svg→canvas diff，`data-tree-edge-label` 1→0、`data-note-badge` 1→0、
 * `data-center` 1→0（C4 追加））。
 * 「折叠部分分支可回到完整渲染」= 判据吃的是**折叠裁剪后的可见节点数**（layout.nodes.length），
 * 折回阈值以下自动恢复 SVG。
 */
export const CANVAS_DEGRADE_NOTICE =
  '已进入大图模式（Canvas）：为保住帧率，边标签、注释角标与中心标记暂不渲染（可见节点超过 5 万自动切换）。折叠部分分支可回到完整渲染。';

export function useCanvasDegradeNotice(opts: {
  /** 当前渲染后端（MapStats.backend；stats 未就绪 → undefined） */
  backend: 'svg' | 'canvas' | undefined;
  /** 当前文档 id（切文档重置提示依据） */
  docId: string | null;
  /** 提示通道（宿主命令告警条 setCommandNotice） */
  notify: (message: string) => void;
}): void {
  const { backend, docId, notify } = opts;
  const shownForRef = useRef<string | null>(null);
  useEffect(() => {
    if (backend !== 'canvas' || docId === null) return;
    if (shownForRef.current === docId) return;
    shownForRef.current = docId; // 先记后报：notify 引发的重渲不会二次进入
    notify(CANVAS_DEGRADE_NOTICE);
  }, [backend, docId, notify]);
}
