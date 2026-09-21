/** 节点盒内从上到下分配的附属区域。所有区域都已由布局层计入高度。 */
export interface NodeAuxiliaryRegions {
  body: { y: number; h: number };
  desc: { y: number; h: number } | null;
  qa: { y: number; h: number } | null;
  fixedNote: { y: number; h: number } | null;
}

/**
 * 保持所有调用方使用同一套纵向坐标：正文 -> 描述 -> 快速注释 -> 固定 note 笔记。
 * 未启用的区域不分配空间；异常输入被收敛为零，避免浮层脱离节点盒。
 *
 * ⚠️ 预留是**布局契约**，与缩放档位无关：note 卡片在 k<0.65 时会被 LOD 隐藏
 * （只留角标），但这里仍按原样预留槽位。原因：预留若随缩放变化，滚轮每一帧都会
 * 触发全图重排（代价远高于留白），且节点会在缩放时上下跳动。
 */
export function nodeAuxiliaryRegions(
  boxHeight: number,
  {
    descHeight = 0,
    qaHeight = 0,
    fixedNoteHeight = 0,
  }: { descHeight?: number; qaHeight?: number; fixedNoteHeight?: number },
): NodeAuxiliaryRegions {
  const total = Math.max(0, boxHeight);
  const descH = Math.max(0, descHeight);
  const qaH = Math.max(0, qaHeight);
  const noteH = Math.max(0, fixedNoteHeight);
  const bodyH = Math.max(0, total - descH - qaH - noteH);
  let y = bodyH;
  const desc = descH > 0 ? { y, h: descH } : null;
  y += descH;
  const qa = qaH > 0 ? { y, h: qaH } : null;
  y += qaH;
  const fixedNote = noteH > 0 ? { y, h: noteH } : null;
  return { body: { y: 0, h: bodyH }, desc, qa, fixedNote };
}
