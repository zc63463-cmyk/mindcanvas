/**
 * .mm.md 协议行为探测 —— 为编写协议 spec 提供**实测**依据，而非凭印象。
 *
 * 覆盖：结构装配（标题/列表/缩进/深度）、实体引用（9 kind + 非法形态）、
 *       笔记块（已知/未知字段、对象列表、JSON 标量、转义）、
 *       边界与诊断码、canonical 输出。
 *
 * 运行：cd apps/canvas && npx vite-node scripts/diag-protocol-probe.mts
 */
import { parseMm } from '../../packages/kernel/src/protocol/parser.ts';
import { serializeMm } from '../../packages/kernel/src/protocol/serializer.ts';

function show(label: string, text: string) {
  const p = parseMm(text);
  console.log(`\n── ${label} ──`);
  console.log('  输入:', JSON.stringify(text));
  const shape = (n: any, d = 0): string => {
    if (!n) return 'null';
    const tag =
      n.type === 'entity' ? `@${n.ref.kind}:${n.ref.id}` : n.type === 'image' ? `img(${n.url})` : `"${n.text ?? ''}"`;
    const note = n.note ? ` {note:${Object.keys(n.note).join(',')}}` : '';
    const kids = n.children.length ? `\n${' '.repeat(d + 4)}${n.children.map((c: any) => shape(c, d + 4)).join('\n' + ' '.repeat(d + 4))}` : '';
    return `${tag}${note}${kids}`;
  };
  console.log('  结构:');
  console.log('    ' + shape(p.root, 4));
  if (p.diagnostics.length) {
    for (const d of p.diagnostics) console.log(`  ⚠ [${d.code}] L${d.line} ${d.message}`);
  }
  if (p.refs.length) console.log('  refs:', p.refs.map((r) => `${r.kind}:${r.id}`).join(', '));
  if (p.root) console.log('  canonical:', JSON.stringify(serializeMm(p.root)));
}

console.log('════ 一、结构装配 ════');
show('H1→H2 标题链', '# 根\n## 分支\n### 叶');
show('列表缩进 0/2/4', '- a\n  - b\n    - c');
show('列表缩进 4/8（非 2 的倍数）', '- a\n    - b\n        - c');
show('tab 缩进（等价 4 空格）', '- a\n\t- b');
show('标题下混列表', '# 根\n## 分支\n- 项1\n- 项2');
show('列表转标题（全文本子节点）', '# 根\n## 分支\n- 甲\n  - 乙');

console.log('\n════ 二、实体引用 ════');
show('9 种已注册 kind', [
  '@issue:1',
  '@pr:12',
  '@doc:docs/a.md',
  '@milestone:M1',
  '@note:某笔记',
  '@idea:proj:3',
  '@annotation:anno-1',
  '@img:assets/a.svg',
  '@draw:assets/b.svg',
]
  .map((s) => `- ${s}`)
  .join('\n'));
show('未注册 kind（前向兼容）', '- @unknownkind:xyz');
show('大写 kind（引用意图但非法）', '- @ISSUE:42');
show('issue id 非法（非数字）', '- @issue:abc');
show('doc id 含路径逃逸', '- @doc:../../etc/passwd');
show('跨库前缀 org/repo', '- @issue:myorg/repo:42');

console.log('\n════ 三、笔记块 ════');
show('已知标量字段', '# 根\n<!--\none_liner: 摘要\nstatus: 进行中\n-->\n## 分支');
show('未知字段透传', '# 根\n<!--\ncustom_field: hello\n-->\n## 分支');
show('字符串列表 qa', '# 根\n<!--\nqa:\n  - 问题一\n  - 问题二\n-->\n## 分支');
show('对象列表 links', '# 根\n<!--\nlinks:\n  - rel: blocks\n    to: "@issue:1"\n-->\n## 分支');
show('JSON 标量', '# 根\n<!--\nedge: {"rel":"blocks","dir":"back"}\n-->\n## 分支');
show('多行 desc（\\n 转义）', '# 根\n<!--\ndesc: 第一行\\n第二行\n-->\n## 分支');
show('列表带缩进（公共缩进剥离）', '- a\n  <!--\n  one_liner: x\n  -->\n- b');

console.log('\n════ 四、边界与诊断 ════');
show('无根（E-NO-ROOT）', '## 分支\n- 项');
show('多根（E-MULTI-ROOT）', '# 根1\n# 根2');
show('笔记未闭合（E-UNCLOSED-NOTE）', '# 根\n<!--\none_liner: x');
show('笔记非法 YAML（E-INVALID-NOTE-YAML）', '# 根\n<!--\n这不是mapping\n-->\n## 分支');
show('孤儿笔记（W-ORPHAN-NOTE）', '## 分支\n<!--\none_liner: x\n-->');
show('杂行（W-STRAY-LINE）', '# 根\n这是一段普通文字');
show('超深（>16 层）', '- ' + Array.from({ length: 20 }, (_, i) => `L${i}`).join('\n' + '  '.repeat(1) + '- '));
