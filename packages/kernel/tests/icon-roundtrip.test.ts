/**
 * FA1-T5 的落点验证：图标写进 .mm.md 后能不能**原样读回来**。
 *
 * 这条比渲染测试更关键 —— 内联 data URL 的价值是「脱离本机 IndexedDB 也能显示」，
 * 前提是协议层能无损往返。data URL 里满是 `:` `%` `#` 等特殊字符，
 * 极易被自研 YAML 序列化器/解析器吃掉，所以单独锁死。
 */
import { describe, expect, it } from 'vitest';
import { parseMm, serializeMm, type MindNode } from '../src/index.js';

const ICON =
  'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22none%22%20stroke%3D%22currentColor%22%3E%3Cpath%20d%3D%22M5%2013l4%204L19%207%22%2F%3E%3C%2Fsvg%3E';

/** parseMm 的 root 可能为 null：测试里显式收窄，不用非空断言（债务预算） */
function rootOf(md: string): MindNode {
  const root = parseMm(md).root;
  if (root === null) throw new Error('parseMm 未产出根节点');
  return root;
}

function withNote(note: Record<string, string>): MindNode {
  return {
    type: 'text',
    text: '带图标的节点',
    note: { ...note } as MindNode['note'],
    children: [],
  };
}

describe('note.icon / note.media 协议往返（FA1-T3/T5）', () => {
  it('icon（data URL，含 : % # 特殊字符）序列化后原样读回', () => {
    const md = serializeMm(withNote({ icon: ICON }));
    expect(md).toContain('icon:');
    const back = rootOf(md);
    expect(back.note?.icon).toBe(ICON);
  });

  it('media（资产引用 kind:id）往返一致', () => {
    const md = serializeMm(withNote({ media: 'img:assets/photo.png' }));
    const back = rootOf(md);
    expect(back.note?.media).toBe('img:assets/photo.png');
  });

  it('icon + media 共存时互不覆盖（两个字段都保住）', () => {
    const back = rootOf(serializeMm(withNote({ icon: ICON, media: 'draw:assets/a.svg' })));
    expect(back.note?.icon).toBe(ICON);
    expect(back.note?.media).toBe('draw:assets/a.svg');
  });

  it('带图标的节点在多子女树里往返后标题与结构不丢', () => {
    const root: MindNode = {
      type: 'text',
      text: '根',
      children: [withNote({ icon: ICON }), { type: 'text', text: '普通', children: [] }],
    };
    const back = rootOf(serializeMm(root));
    expect(back.children).toHaveLength(2);
    expect(back.children[0]?.note?.icon).toBe(ICON);
    expect(back.children[1]?.text).toBe('普通');
  });

  it('图标值里的换行/引号不破坏笔记块（仍可解析）', () => {
    const tricky = 'data:image/svg+xml;utf8,%3Csvg%3E%3Ctext%3Ea"b%3C%2Ftext%3E%3C%2Fsvg%3E';
    const back = rootOf(serializeMm(withNote({ icon: tricky })));
    expect(back.note?.icon).toBe(tricky);
  });
});
