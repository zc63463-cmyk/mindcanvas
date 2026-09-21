/**
 * 笔记格式化（chrome 翻卡背面内容；纯函数可测）。
 */
import type { Note } from '@mindcanvas/kernel';

export type NoteSection = { key: string; label: string; value: string };

/** Note → 有序分区（one_liner / status / next / reminder / decisions；未知键忽略） */
export function formatNote(note: Note | undefined): NoteSection[] {
  if (!note) return [];
  const out: NoteSection[] = [];
  if (note.one_liner) out.push({ key: 'one_liner', label: '一句话', value: note.one_liner });
  if (note.status) out.push({ key: 'status', label: '状态', value: note.status });
  if (note.next !== undefined) {
    const next = Array.isArray(note.next) ? note.next.join(' → ') : String(note.next);
    if (next) out.push({ key: 'next', label: '下一步', value: next });
  }
  if (note.reminder) out.push({ key: 'reminder', label: '提醒', value: note.reminder });
  if (Array.isArray(note.decisions) && note.decisions.length > 0) {
    out.push({ key: 'decisions', label: '决策', value: note.decisions.join('；') });
  }
  return out;
}
