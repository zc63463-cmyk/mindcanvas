/**
 * 富文本搜索（纯函数，无 DOM）：匹配节点标题（text/entity ref）+ 全部笔记字段
 * （one_liner / status / next / reminder / decisions / qa 等任意字符串字段）。
 * 返回命中 { id, label, snippet, pathLabel, node }，pathLabel 为祖先链路径。
 */
import type { EditableNode, Note } from '@mindcanvas/kernel';

export interface SearchHit {
  id: string;
  label: string;
  /** 命中上下文片段（截断 + 省略号） */
  snippet: string;
  /** 祖先链路径（根 / … / 节点） */
  pathLabel: string;
  node: EditableNode;
}

/** 节点标题：text 节点取文本；entity 取 kind:id；其余空 */
export function nodeTitle(n: EditableNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'entity') return n.ref ? `${n.ref.kind}:${n.ref.id}` : '（实体）';
  return '';
}

/** 展开笔记为可检索文本（字符串字段 + 字符串数组字段） */
function noteSearchText(note: Note | undefined): string {
  if (!note) return '';
  const parts: string[] = [];
  for (const v of Object.values(note)) {
    if (typeof v === 'string') parts.push(v);
    else if (Array.isArray(v)) parts.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  return parts.join('\n');
}

/** 命中片段：以命中词为中心截取窗口 */
function findSnippet(hay: string, q: string): string {
  const idx = hay.toLowerCase().indexOf(q);
  if (idx < 0) return hay.slice(0, 40);
  const start = Math.max(0, idx - 12);
  const end = Math.min(hay.length, idx + q.length + 20);
  return (start > 0 ? '…' : '') + hay.slice(start, end) + (end < hay.length ? '…' : '');
}

/** 搜索整棵树（标题 + 笔记字段）；空查询 → [] */
export function searchMind(root: EditableNode, query: string): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchHit[] = [];
  const path: EditableNode[] = [];
  const walk = (n: EditableNode): void => {
    path.push(n);
    const title = nodeTitle(n);
    const hay = `${title}\n${noteSearchText(n.note)}`.toLowerCase();
    if (hay.includes(q)) {
      out.push({
        id: n.id,
        label: title || '（无文本）',
        snippet: findSnippet(hay, q),
        pathLabel: path.map((p) => nodeTitle(p) || '根').join(' / '),
        node: n,
      });
    }
    for (const c of n.children) walk(c);
    path.pop();
  };
  walk(root);
  return out;
}
