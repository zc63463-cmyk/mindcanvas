/**
 * E1：边一等公民 schema 扩展单测（1.1.0 minor 增补）。
 * - resolveLinks 透传 dir/label/note/attrs；非法 dir → fwd + W 级告警
 * - .mm.md 文本协议 round-trip：links 扁平对象列表 parse → serialize 无损
 */
import { describe, expect, it } from 'vitest';
import { parseMm, serializeMm, astToEditable } from '../src/index.js';
import { resolveLinks } from '../src/registry/note-anchor.js';
import { makeTextNode } from '../src/tree/treeOps.js';
import type { EditableNode } from '../src/tree/treeOps.js';

function makeTree(): EditableNode {
  return makeTextNode('根', [
    makeTextNode('分支A', [makeTextNode('叶1')]),
    makeTextNode('里程碑', [makeTextNode('M2')]),
  ]);
}

describe('resolveLinks：边字段透传（1.1.0）', () => {
  it('dir/label/note/attrs 全字段透传', () => {
    const root = makeTree();
    const links = [
      {
        rel: 'blocks',
        to: 'node:根/里程碑/M2',
        dir: 'both',
        label: '硬依赖',
        note: '必须先合入网关协议',
        attrs: { severity: 'high' },
      },
    ];
    const [r] = resolveLinks(root, links);
    expect(r.state).toBe('well-formed');
    expect(r.nodeId).toBeDefined();
    expect(r.dir).toBe('both');
    expect(r.label).toBe('硬依赖');
    expect(r.note).toBe('必须先合入网关协议');
    expect(r.attrs).toEqual({ severity: 'high' });
  });
  it('缺省 dir → undefined（消费端默认 fwd）；部分字段缺省不产出', () => {
    const root = makeTree();
    const [r] = resolveLinks(root, [{ rel: 'relates-to', to: 'node:根/分支A/叶1' }]);
    expect(r.dir).toBeUndefined();
    expect(r.label).toBeUndefined();
    expect(r.note).toBeUndefined();
    expect(r.attrs).toBeUndefined();
    expect(r.warnings).toBeUndefined();
  });
  it('非法 dir → 回落 fwd + warnings 告警（W 级，不影响三态）', () => {
    const root = makeTree();
    const [r] = resolveLinks(root, [{ rel: 'blocks', to: 'node:根/里程碑/M2', dir: 'sideways' }]);
    expect(r.state).toBe('well-formed');
    expect(r.dir).toBe('fwd');
    expect(r.warnings).toEqual(['invalid-dir-defaulted-fwd']);
  });
  it('unparsable 锚 → stale 维持旧形状，新字段不产出', () => {
    const root = makeTree();
    const [r] = resolveLinks(root, [{ rel: 'x', to: 'no-colon', label: 'L' }]);
    expect(r.state).toBe('stale');
    expect(r.reason).toBe('unparsable-anchor');
    expect(r.label).toBeUndefined();
  });
});

describe('E1 golden：links 对象列表文本协议 round-trip', () => {
  const SRC = [
    '# 根',
    '',
    '<!--',
    'links:',
    '  - rel: blocks',
    '    to: "node:根/里程碑/M2"',
    '    dir: fwd',
    '    label: 硬依赖',
    '    note: 必须先合入网关协议',
    '    attrs: {"severity": "high"}',
    '-->',
    '## 任务A',
    '',
    '## 里程碑',
    '### M2',
    '',
  ].join('\n');

  it('parseMm：links 解析为扁平对象数组（非碎字符串）', () => {
    const p = parseMm(SRC);
    expect(p.diagnostics.filter((d) => d.code.startsWith('E-'))).toEqual([]);
    const taskA = p.root!.children[0]!;
    expect(taskA.text).toBe('任务A');
    const links = taskA.note?.links as Array<Record<string, unknown>>;
    expect(links).toHaveLength(1);
    expect(links[0]).toEqual({
      rel: 'blocks',
      to: 'node:根/里程碑/M2',
      dir: 'fwd',
      label: '硬依赖',
      note: '必须先合入网关协议',
      attrs: { severity: 'high' },
    });
  });
  it('serializeMm → parseMm 往返无损（AST 深度相等）', () => {
    const p1 = parseMm(SRC);
    const text = serializeMm(p1.root!);
    const p2 = parseMm(text);
    expect(JSON.stringify(p2.root)).toBe(JSON.stringify(p1.root));
  });
  it('端到端：文本 → 解析 → resolveLinks 全链路', () => {
    const p = parseMm(SRC);
    const root = astToEditable(p.root!)!;
    const taskA = root.children[0]!;
    const [r] = resolveLinks(root, taskA.note?.links);
    expect(r.state).toBe('well-formed');
    expect(r.dir).toBe('fwd');
    expect(r.label).toBe('硬依赖');
  });
  it('字符串列表兼容：qa 等旧格式行为不变', () => {
    const p = parseMm(
      [
        '# 根',
        '',
        '<!--',
        'qa:',
        '  - 评价观点，对比事实',
        '  - 形成自己的判断',
        '-->',
        '## 批判思考',
      ].join('\n'),
    );
    const n = p.root!.children[0]!;
    expect(n.note?.qa).toEqual(['评价观点，对比事实', '形成自己的判断']);
  });
});

describe('E7：对象标量（结构化标注的协议地基）', () => {
  it('顶层标量 {...} → JSON 对象；非法 JSON 回落字符串', () => {
    const p = parseMm(
      [
        '# 根',
        '',
        '<!--',
        'edge: {"rel":"blocks","label":"依赖"}',
        'broken: {"rel": xx}',
        '-->',
        '## A',
      ].join('\n'),
    );
    const a = p.root!.children[0]!;
    expect(a.note?.edge).toEqual({ rel: 'blocks', label: '依赖' });
    expect(a.note?.broken).toBe('{"rel": xx}');
  });
  it('对象标量 round-trip 无损（serializer 内联 JSON 回写）', () => {
    const src = [
      '# 根',
      '',
      '<!--',
      'edge: {"rel":"blocks","style":{"color":"#e24b4a"}}',
      '-->',
      '## A',
      '',
    ].join('\n');
    const p1 = parseMm(src);
    const text = serializeMm(p1.root!);
    const p2 = parseMm(text);
    expect(JSON.stringify(p2.root)).toBe(JSON.stringify(p1.root));
  });
});
