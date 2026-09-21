import { describe, expect, it } from 'vitest';
import { tokenize, wrapText } from '../src/layout/wrap.js';
import { displayMetrics, LINE_H, TITLE_MAX_ENTITY } from '../src/layout/nodeLayout.js';
import { astToEditable, makeEntityNode, makeTextNode } from '../src/tree/treeOps.js';
import type { Entity } from '../src/protocol/types.js';

/** fake measure：每字符 10px */
const m10 = (s: string): number => s.length * 10;

describe('tokenize', () => {
  it('ASCII 词为整体 / 空白成串 / CJK 逐字', () => {
    expect(tokenize('ab cd')).toEqual(['ab', ' ', 'cd']);
    expect(tokenize('中文测试')).toEqual(['中', '文', '测', '试']);
    expect(tokenize('path/to-file.md')).toEqual(['path/to-file.md']);
    expect(tokenize('a  b')).toEqual(['a', '  ', 'b']);
  });

  it('空字符串返回空数组', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('wrapText', () => {
  it('空文本 → 单空行', () => {
    expect(wrapText('', 100, m10)).toEqual(['']);
  });

  it('词边界断行（行宽不超上限）', () => {
    expect(wrapText('ab cd ef', 50, m10)).toEqual(['ab cd', 'ef']);
  });

  it('超宽无空格 token 按字符硬切', () => {
    expect(wrapText('abcdefgh', 50, m10)).toEqual(['abcde', 'fgh']);
  });

  it('CJK 逐字断行', () => {
    expect(wrapText('一二三四五六', 30, m10)).toEqual(['一二三', '四五六']);
  });

  it('行首空格丢弃', () => {
    expect(wrapText('  ab', 50, m10)).toEqual(['ab']);
  });

  it('所有行宽 ≤ maxWidth（混合中英）', () => {
    const text = '设计文档 gateway-design-architecture 覆盖协议层与身份授权';
    for (const line of wrapText(text, 100, m10)) {
      expect(m10(line)).toBeLessThanOrEqual(100);
    }
  });

  it('maxWidth ≤ 0 时不换行', () => {
    expect(wrapText('abc def', 0, m10)).toEqual(['abc def']);
  });
});

describe('displayMetrics（换行度量）', () => {
  it('text 节点：短文本单行最小高', () => {
    const m = displayMetrics(makeTextNode('短'), new Map(), m10);
    expect(m.lines).toEqual(['短']);
    expect(m.h).toBeGreaterThanOrEqual(34);
    expect(m.w).toBeGreaterThanOrEqual(44);
  });

  it('text 节点：长文本多行、盒高随行数增长', () => {
    const long =
      '这是一个非常长的节点标题需要换行显示成多行才能看清楚的内容包括协议层身份授权只读工具写入门禁以及我的想法五个分支的完整梳理';
    const m = displayMetrics(makeTextNode(long), new Map(), m10);
    expect(m.lines.length).toBeGreaterThan(1);
    expect(m.h).toBe(Math.max(34, m.lines.length * LINE_H + 12));
    // 每行宽度受控
    for (const line of m.lines) expect(m10(line)).toBeLessThanOrEqual(260);
  });

  it('entity 节点：长标题换行、盒宽有硬上限', () => {
    const entities = new Map<string, Entity>([
      [
        'issue:1',
        {
          kind: 'issue',
          id: '1',
          title: 'S1 部署完成验证报告以及后续分支保护与画布目录放行策略的深度回顾',
          status: 'open',
          ref: 'http://x/1',
        },
      ],
    ]);
    const node = makeEntityNode({ kind: 'issue', id: '1' });
    const m = displayMetrics(node, entities, m10);
    expect(m.lines.length).toBeGreaterThan(1);
    // 盒宽 ≤ 左区 + 单行上限 + 徽章 + 图标 + padding
    const upperBound =
      12 + 100 + 10 + 6 + 16 + TITLE_MAX_ENTITY + (4 * 10 + 14) + 8 + 13 + 15 + 6 + 12 + 1;
    expect(m.w).toBeLessThanOrEqual(upperBound);
    expect(m.kindLabel).toBe('@issue');
    expect(m.badgeText).toBe('open');
    expect(m.warn).toBe(false);
  });

  it('entity 未解析：warn + kind:id 降级标题', () => {
    const node = makeEntityNode({ kind: 'pr', id: '99' });
    const m = displayMetrics(node, new Map(), m10);
    expect(m.warn).toBe(true);
    expect(m.lines.join('')).toBe('pr:99');
    expect(m.badgeText).toBeNull();
  });

  it('超长无空格 doc 路径硬切断行（不再长长一条）', () => {
    const entities = new Map<string, Entity>([
      [
        'doc:docs/very/long/path/without/any/spaces/architecture-deep-review.md',
        {
          kind: 'doc',
          id: 'x',
          title: 'docs/very/long/path/without/any/spaces/architecture-deep-review.md',
          status: null,
          ref: null,
        },
      ],
    ]);
    const node = makeEntityNode({
      kind: 'doc',
      id: 'docs/very/long/path/without/any/spaces/architecture-deep-review.md',
    });
    const m = displayMetrics(node, entities, m10);
    expect(m.lines.length).toBeGreaterThan(1);
    for (const line of m.lines) expect(m10(line)).toBeLessThanOrEqual(TITLE_MAX_ENTITY);
  });

  it('AST 来源节点同样支持（与编辑树一致）', () => {
    const editable = astToEditable({ type: 'text', text: 'hello', children: [] })!;
    const m = displayMetrics(editable, new Map(), m10);
    expect(m.lines).toEqual(['hello']);
  });
});
it('资产节点（@img/@draw）：布局为预览区预留高度，不与文本争空间（回归 1.0.1）', () => {
  // 回归动因：布局侧曾完全不知道资产存在，h 仅由文本行数决定 → 渲染时图片被压进
  // 26px 高的条带并与文字重叠（图文争用同一垂直空间）。
  const m = displayMetrics(makeEntityNode({ kind: 'img', id: 'a.png' }), new Map(), m10);
  const textOnly = displayMetrics(makeTextNode('a.png'), new Map(), m10);
  expect(m.assetH).toBeGreaterThan(0);
  // 盒高 = 文本区高 + 资产区高 + 间隙（远大于纯文本节点）
  expect(m.h).toBe(Math.max(34, m.lines.length * LINE_H + 12 + m.assetH! + 8));
  expect(m.h).toBeGreaterThan(textOnly.h + m.assetH! - 1);
  // 非资产实体不受影响（assetH 为 0，行为与修复前一致 → 无破坏性变更）
  const issue = displayMetrics(makeEntityNode({ kind: 'issue', id: '1' }), new Map(), m10);
  expect(issue.assetH).toBe(0);
  expect(issue.h).toBe(Math.max(34, issue.lines.length * LINE_H + 12));
});

it('@draw 与 @img 同属资产 kind，均预留预览高度', () => {
  for (const kind of ['img', 'draw']) {
    const m = displayMetrics(makeEntityNode({ kind, id: 'x.svg' }), new Map(), m10);
    expect(m.assetH).toBeGreaterThan(0);
  }
});
