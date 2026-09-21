/**
 * L1：文本区域链接——解析纯函数判别测试（parseTextLinks / applySpanReplace）。
 *
 * 覆盖（计划 §3 L1-2）：
 *  - 基本：无链接 / 1 个 / 多个 / 首尾位置；括号与转义边界（`\]` / `\\)` / 嵌套 `[`）；
 *  - 三态（T-A5）：node: 命中 → well-formed；不存在 → dangling；同名歧义 → stale；
 *    cid: 命中/未命中；实体锚语法 well-formed；
 *  - 非链接形态不误伤：`[已归档]`（无目标）、`(node:x)` 裸串、
 *    `[a](http://…)`（Phase 1 外部链接不认，T-A6）；
 *  - applySpanReplace：多处替换从右往左（防位移）+ 越界/重叠防御。
 */
import { describe, expect, it } from 'vitest';
import { makeEntityNode, makeTextNode } from '@mindcanvas/kernel';
import {
  applySpanReplace,
  findEntityNodeId,
  parseTextLinks,
  preferredLinkAnchor,
} from '../src/edit/textLinks.js';

/** 测试树：根 → [任务 → A（cid:c1）, B] */
function tree(): { root: ReturnType<typeof makeTextNode>; aId: string } {
  const a = makeTextNode('A');
  a.note = { cid: 'c1' };
  const root = makeTextNode('根', [makeTextNode('任务', [a]), makeTextNode('B')]);
  return { root, aId: a.id };
}

describe('parseTextLinks · 基础形态', () => {
  it('空串 → 空数组', () => {
    expect(parseTextLinks('')).toEqual([]);
  });

  it('无链接 → 单一 text span 覆盖全文', () => {
    const spans = parseTextLinks('普通文本');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('text');
    expect(spans[0]?.text).toBe('普通文本');
    expect(spans[0]?.start).toBe(0);
    expect(spans[0]?.end).toBe(4);
  });

  it('单个链接（中部）：文本-链接-文本三段，label/anchorText/区间精确', () => {
    const text = '前 [名](node:根/任务/A) 后';
    const spans = parseTextLinks(text);
    expect(spans).toHaveLength(3);
    const link = spans[1];
    expect(link?.kind).toBe('link');
    expect(link?.label).toBe('名');
    expect(link?.anchorText).toBe('node:根/任务/A');
    expect(text.slice(link?.start ?? -1, link?.end ?? -1)).toBe('[名](node:根/任务/A)');
    expect(spans[0]?.text).toBe('前 ');
    expect(spans[2]?.text).toBe(' 后');
  });

  it('链接在首/尾位置：不产生多余空 text span', () => {
    const head = parseTextLinks('[名](node:根/B)尾');
    expect(head.map((s) => s.kind)).toEqual(['link', 'text']);
    const tail = parseTextLinks('首[名](node:根/B)');
    expect(tail.map((s) => s.kind)).toEqual(['text', 'link']);
  });

  it('多个链接与文本交替：顺序与锚原文精确', () => {
    const text = 'a[l1](node:根/A)b[l2](cid:c1)c[l3](@issue:88)d';
    const spans = parseTextLinks(text);
    expect(spans.map((s) => s.kind)).toEqual([
      'text',
      'link',
      'text',
      'link',
      'text',
      'link',
      'text',
    ]);
    expect(spans.filter((s) => s.kind === 'link').map((s) => s.anchorText)).toEqual([
      'node:根/A',
      'cid:c1',
      '@issue:88',
    ]);
  });

  it('target 区间覆盖括号间原文（含空白）；空白两端被 trim，替换只动该区间', () => {
    const text = '[名](  node:根/B  )';
    const spans = parseTextLinks(text);
    expect(spans[0]?.anchorText).toBe('node:根/B');
    expect(text.slice(spans[0]?.targetStart ?? -1, spans[0]?.targetEnd ?? -1)).toBe(
      '  node:根/B  ',
    );
  });
});

describe('parseTextLinks · 括号与转义边界', () => {
  it('label 含转义 \\] → 显示名还原、候选仍成立', () => {
    const spans = parseTextLinks('[a\\]b](node:根/B)');
    expect(spans[0]?.kind).toBe('link');
    expect(spans[0]?.label).toBe('a]b');
    expect(spans[0]?.anchorText).toBe('node:根/B');
  });

  it('label 含 \\\\ → 还原为单个反斜杠', () => {
    const spans = parseTextLinks('[a\\\\b](node:根/B)');
    expect(spans[0]?.label).toBe('a\\b');
  });

  it('target 含转义 \\) → 不提前终止（目标取到真正的右括号）', () => {
    const text = '[a](node:根/A\\)) 尾';
    const spans = parseTextLinks(text);
    expect(spans[0]?.kind).toBe('link');
    expect(spans[0]?.anchorText).toBe('node:根/A)');
    expect(spans[1]?.kind).toBe('text');
    expect(spans[1]?.text).toBe(' 尾');
  });

  it('嵌套 [（label 内含未转义 [）→ 候选作废，整体保持纯文本', () => {
    const spans = parseTextLinks('[a[b]](node:根/B)');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('text');
    expect(spans[0]?.text).toBe('[a[b]](node:根/B)');
  });

  it('[] 空 label 仍认（显示名为空）', () => {
    const spans = parseTextLinks('[](node:根/B)');
    expect(spans[0]?.kind).toBe('link');
    expect(spans[0]?.label).toBe('');
    expect(spans[0]?.anchorText).toBe('node:根/B');
  });

  it('label 后未紧跟 ( → 不是链接（裸方括号文本）', () => {
    const spans = parseTextLinks('见 [已归档] 记录');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('text');
  });
});

describe('parseTextLinks · 非链接形态不误伤', () => {
  it('裸串 (node:x)（无方括号）保持纯文本', () => {
    const spans = parseTextLinks('写作 (node:根/B) 引用');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('text');
  });

  it('空目标 / 空锚路径 → 不认（纯文本）', () => {
    for (const s of ['[a]()', '[a](node:)', '[a](cid:)', '[a](   )']) {
      const spans = parseTextLinks(s);
      expect(spans).toHaveLength(1);
      expect(spans[0]?.kind).toBe('text');
      expect(spans[0]?.text).toBe(s);
    }
  });

  it.each([
    '[a](http://example.com)',
    '[a](https://example.com/x)',
    '[a](mailto:a@b.com)',
    '[a](javascript:alert(1))',
  ])('外部 URL 形态不认作内部锚（T-A6）：%s', (s) => {
    const spans = parseTextLinks(s);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('text');
    expect(spans[0]?.text).toBe(s);
  });

  it('数字区间 [0,1] 与中文括注【】不受影响', () => {
    const spans = parseTextLinks('区间 [0,1] 与【注】');
    expect(spans).toHaveLength(1);
    expect(spans[0]?.kind).toBe('text');
  });
});

describe('parseTextLinks · 三态（提供 root）', () => {
  it('node: 命中 → well-formed + nodeId', () => {
    const { root, aId } = tree();
    const spans = parseTextLinks('[去](node:根/任务/A)', root);
    expect(spans[0]?.kind).toBe('link');
    expect(spans[0]?.state).toBe('well-formed');
    expect(spans[0]?.nodeId).toBe(aId);
  });

  it('node: 不存在 → dangling（path-not-found）', () => {
    const { root } = tree();
    const spans = parseTextLinks('[去](node:根/不存在)', root);
    expect(spans[0]?.state).toBe('dangling');
    expect(spans[0]?.reason).toBe('path-not-found');
  });

  it('同名歧义 → stale（宁可不猜）', () => {
    const root = makeTextNode('根', [makeTextNode('X'), makeTextNode('X')]);
    const spans = parseTextLinks('[去](node:根/X)', root);
    expect(spans[0]?.state).toBe('stale');
    expect(spans[0]?.reason).toBe('ambiguous-node-path');
  });

  it('cid: 命中 → well-formed；未命中 → dangling', () => {
    const { root, aId } = tree();
    const hit = parseTextLinks('[去](cid:c1)', root);
    expect(hit[0]?.state).toBe('well-formed');
    expect(hit[0]?.nodeId).toBe(aId);
    const miss = parseTextLinks('[去](cid:c9)', root);
    expect(miss[0]?.state).toBe('dangling');
    expect(miss[0]?.reason).toBe('cid-not-found');
  });

  it('实体锚 @issue:88 → 语法 well-formed（存在性不在内核纯函数范畴）', () => {
    const { root } = tree();
    const spans = parseTextLinks('[去](@issue:88)', root);
    expect(spans[0]?.state).toBe('well-formed');
    expect(spans[0]?.nodeId).toBeUndefined();
  });

  it('无 root：只做语法解析，不给三态', () => {
    const spans = parseTextLinks('[去](node:根/任务/A)');
    expect(spans[0]?.kind).toBe('link');
    expect(spans[0]?.anchor?.kind).toBe('node');
    expect(spans[0]?.state).toBeUndefined();
  });

  it('cidIndex 注入与现建索引同结果', () => {
    const { root, aId } = tree();
    const cidIndex = new Map([['c1', aId]]);
    const spans = parseTextLinks('[去](cid:c1)', root, cidIndex);
    expect(spans[0]?.nodeId).toBe(aId);
  });
});

describe('applySpanReplace', () => {
  it('单处替换', () => {
    expect(applySpanReplace('abcdef', [{ start: 2, end: 4, text: 'XY' }])).toBe('abXYef');
  });

  it('空替换列表 → 原文', () => {
    expect(applySpanReplace('abc', [])).toBe('abc');
  });

  it('多处替换：从右往左（前段替换变长也不位移后段）', () => {
    const text = 'A [l1](node:根/X) B [l2](node:根/Y) C';
    const links = parseTextLinks(text).filter((s) => s.kind === 'link');
    const [l1, l2] = links;
    if (!l1 || !l2) throw new Error('夹具解析失败：应有两个链接');
    // 传入顺序故意「左在前」；实现必须自行排序后从右往左应用
    const out = applySpanReplace(text, [
      { start: l1.targetStart ?? -1, end: l1.targetEnd ?? -1, text: 'node:根/X-更长的替换目标' },
      { start: l2.targetStart ?? -1, end: l2.targetEnd ?? -1, text: 'node:根/Z' },
    ]);
    expect(out).toBe('A [l1](node:根/X-更长的替换目标) B [l2](node:根/Z) C');
  });

  it('区间重叠 → 抛错（编程错误早暴露）', () => {
    expect(() =>
      applySpanReplace('abcdef', [
        { start: 1, end: 3, text: 'X' },
        { start: 2, end: 4, text: 'Y' },
      ]),
    ).toThrow();
  });

  it('越界 → 抛错', () => {
    expect(() => applySpanReplace('abc', [{ start: 0, end: 9, text: 'X' }])).toThrow();
  });
});

describe('findEntityNodeId（实体锚 → 树中节点）', () => {
  it('命中：返回携带该实体引用的首个节点 id（@ 前缀与裸 kind:id 两种写法）', () => {
    const e1 = makeEntityNode({ kind: 'issue', id: '88' });
    const root = makeTextNode('根', [e1, makeTextNode('B')]);
    expect(findEntityNodeId(root, '@issue:88')).toBe(e1.id);
    expect(findEntityNodeId(root, 'issue:88')).toBe(e1.id);
  });

  it('未命中 / #N 消歧写法 → null（宁可不猜）', () => {
    const root = makeTextNode('根', [makeEntityNode({ kind: 'issue', id: '88' })]);
    expect(findEntityNodeId(root, '@issue:99')).toBeNull();
    expect(findEntityNodeId(root, '@issue:88#2')).toBeNull();
  });
});

describe('preferredLinkAnchor（插入链接的首选锚，T-A7）', () => {
  it('目标节点有 cid → 写 cid:（稳定身份）；无 cid → 用回退锚（路径）', () => {
    const { root, aId } = tree();
    expect(preferredLinkAnchor(root, aId, 'node:根/任务/A')).toBe('cid:c1');
    const bNode = root.children[1];
    if (!bNode) throw new Error('夹具解析失败：B 缺失');
    expect(preferredLinkAnchor(root, bNode.id, 'node:根/B')).toBe('node:根/B');
  });

  it('nodeId 不在树中 → 回退锚原样', () => {
    const { root } = tree();
    expect(preferredLinkAnchor(root, 'no-such-id', 'node:根/B')).toBe('node:根/B');
  });
});
