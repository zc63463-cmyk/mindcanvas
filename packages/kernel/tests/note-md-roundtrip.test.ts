/**
 * P1 · `note.md` 往返保真钉（所选形态 = 转义单行）。
 *
 * 背景（P1-N1 实测，报告 §N1）：自研 note YAML **不支持块标量**——
 * `md: |` 形态会让整个笔记块判 `E-INVALID-NOTE-YAML` 并**整条丢弃**（连 status 等
 * 合法字段一起）。故 `note.md` 的 `.mm.md` 表达取**转义单行**（双引号 + `\n`/`\t`/
 * `\\`/`\"` 转义），与 `note.desc` / `note_text` 的既有口径逐字一致；serializer 对
 * 含换行的字符串自动走该形态（`yamlScalar`），**零协议改动**。
 *
 * 本钉锁死（防"新元数据须 roundtrip"铁律之外的退化）：
 *   ① parse→serialize→parse：`note.md` 逐字相等（Object.is），含硬字符集；
 *   ② serialize 幂等（二次序列化字节稳定）；
 *   ③ 空串 `md` 不落键（写端不产出 `md:`，读端为 undefined）；
 *   ④ 与既有键共存 + 笔记绑定语义（文件顶部 → 绑根）往返保真。
 */
import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm, verifyRoundTrip } from '../src/protocol/serializer.js';
import type { MindNode } from '../src/protocol/types.js';

/** 读（可能绑定在根或其后节点的）note.md —— 测试里同时断言绑定位置 */
function mdOf(root: MindNode | null | undefined): unknown {
  return root?.note?.md;
}

describe('note.md 转义单行形态：解析', () => {
  it('双引号 + \\n 转义解析为带真实换行的多行源文', () => {
    const r = parseMm('<!--\nmd: "第一行\\n第二行"\n-->\n# 根');
    expect(mdOf(r.root)).toBe('第一行\n第二行');
  });

  it('与既有键共存（status / md 同块）', () => {
    const r = parseMm('<!--\nstatus: 进行中\nmd: "A\\nB"\n-->\n# 根');
    expect(mdOf(r.root)).toBe('A\nB');
    expect(r.root?.note?.status).toBe('进行中');
  });

  it('绑定「其后第一个结构节点」：块在根与分支之间 → 绑分支', () => {
    const r = parseMm('# 根\n\n<!--\nmd: "X"\n-->\n\n## 任务');
    expect(mdOf(r.root)).toBeUndefined();
    expect(mdOf(r.root?.children[0] ?? null)).toBe('X');
  });
});

describe('note.md 转义单行形态：往返保真', () => {
  it('parse → serialize → parse 逐字相等 + 幂等', () => {
    const src = '<!--\nmd: "## 设计取舍\\n- 卡不参与布局\\n- 链接 [跳转](node:根/任务/A)"\n-->\n# 根';
    const p1 = parseMm(src);
    const r1 = p1.root;
    if (r1 === null) throw new Error('解析失败：root 缺失');
    const s1 = serializeMm(r1);
    const p2 = parseMm(s1);
    const r2 = p2.root;
    if (r2 === null) throw new Error('解析失败：root 缺失');
    expect(Object.is(mdOf(r2), mdOf(r1))).toBe(true);
    expect(serializeMm(r2)).toBe(s1);
  });

  it('硬字符集（引号/反斜杠/冒号/尾空格/# 起首/note 块哨兵 -->）逐字往返', () => {
    const md = 'a "b" c \\ d\nkey: value\n- [ ] 任务\n# 起首\n尾空格行   \n--> 哨兵';
    const doc = serializeMm({
      type: 'text',
      text: '根',
      note: { md },
      children: [{ type: 'text', text: '任务', children: [] }],
    });
    // 转义单行形态：整个 md 保持**单物理行**（哨兵 `-->` 不触发笔记块闭合误判）
    const mdLines = doc.split('\n').filter((l) => l.startsWith('md: '));
    expect(mdLines.length).toBe(1);
    const back = parseMm(doc);
    expect(mdOf(back.root)).toBe(md);
    // 全文档级 self-check（保存前安全闸同款）
    const ast = parseMm(doc).root;
    expect(ast === null ? false : verifyRoundTrip(ast)).toBe(true);
  });

  it('空串 md 不落键（写端不产出，读端 undefined）', () => {
    const doc = serializeMm({ type: 'text', text: '根', note: { md: '' }, children: [] });
    expect(doc.includes('md:')).toBe(false);
    expect(mdOf(parseMm(doc).root)).toBeUndefined();
  });
});
