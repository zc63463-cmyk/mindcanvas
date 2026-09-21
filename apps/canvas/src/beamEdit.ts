/**
 * 拖共享梁提交（v1.7.0；v1.11.0 双把手分流）：与 `lenEdit.ts` 同先例——
 * 写路径集中在薄模块里，**单条 undo**（全部经 `controller.updateNote`）。
 *
 * | 把手 | commit | 落盘 | 语义 |
 * |---|---|---|---|
 * | 梁中段（rail） | `lens` | `lens[dir] = len` | 整段层距（松手后子组外推） |
 * | 主干（trunk） | `bias` | `beamAt[dir] = at` | 梁比例位（子盒不动，短桩伸缩） |
 *
 * 一次拖拽只写一个字段（互不串写）；`bias` 回落到 ≈缺省（{@link BEAM_AT_EPS} 容差）时
 * **删该方向键**（最小面——缺省即中点，不落盘）；方向键全空 → 删整个 `beamAt` 键。
 */
import {
  BEAM_AT_DEFAULT,
  BEAM_AT_EPS,
  getNode,
  readBeamAtMap,
  readLensMap,
} from '@mindcanvas/kernel';
import type { BeamCommit, EditorController } from '@mindcanvas/react';

/** 提交一次梁拖拽（lens 或 bias；非法数值不落盘，防文档污染 → 布局 NaN 扩散） */
export function applyBeamCommit(
  controller: EditorController,
  id: string,
  commit: BeamCommit,
): void {
  const node = getNode(controller.root, id);
  if (!node) return;
  if (commit.kind === 'lens') {
    if (!Number.isFinite(commit.len)) return;
    // readLensMap 容错合并：手写文件的 lens 可能是字符串形态（深度审查修复）
    const lens = { ...(readLensMap(node.note) ?? {}) };
    lens[commit.dir] = commit.len;
    controller.updateNote(id, { lens });
    return;
  }
  if (!Number.isFinite(commit.at)) return;
  const beamAt = { ...(readBeamAtMap(node.note) ?? {}) };
  if (Math.abs(commit.at - BEAM_AT_DEFAULT) < BEAM_AT_EPS) delete beamAt[commit.dir];
  else beamAt[commit.dir] = commit.at;
  // 键全空 → 连键一起删（与 centers 降格同款「不留空壳」纪律）
  controller.updateNote(id, { beamAt: Object.keys(beamAt).length > 0 ? beamAt : undefined });
}
