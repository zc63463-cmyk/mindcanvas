/**
 * FA1-T3：节点图标 / 内联插图的布局度量。
 *
 * 为什么单测在 kernel：图标要占宽度、插图要占高度，这些**必须由布局预留**，
 * 否则渲染出来就是图标压文字、插图压文字（与 assetH 同类图文重叠问题）。
 * 渲染侧只是消费这些数值 —— 数值错了，测渲染也白测。
 */
import { describe, expect, it } from 'vitest';
import {
  displayMetrics,
  NODE_ICON_GAP,
  NODE_ICON_SIZE,
  nodeIcon,
  nodeMedia,
} from '../src/layout/nodeLayout.js';
import { makeEntityNode, makeTextNode } from '../src/tree/treeOps.js';

/** fake measure：每字符 10px */
const m10 = (s: string): number => s.length * 10;

describe('nodeIcon / nodeMedia 读取（note.icon / note.media）', () => {
  it('无 note → null', () => {
    expect(nodeIcon(makeTextNode('x'))).toBeNull();
    expect(nodeMedia(makeTextNode('x'))).toBeNull();
  });

  it('非空字符串 → 原值', () => {
    const n = { ...makeTextNode('x'), note: { icon: 'draw:assets/a.svg', media: 'img:a.png' } };
    expect(nodeIcon(n)).toBe('draw:assets/a.svg');
    expect(nodeMedia(n)).toBe('img:a.png');
  });

  it('空串 / 非字符串（脏数据）→ null（不当 URL 渲染）', () => {
    expect(nodeIcon({ note: { icon: '' } })).toBeNull();
    expect(nodeIcon({ note: { icon: 123 } })).toBeNull();
    expect(nodeIcon({ note: { icon: { a: 1 } } })).toBeNull();
    expect(nodeIcon({ note: null })).toBeNull();
    expect(nodeIcon({})).toBeNull();
  });
});

describe('图标占位：宽度预留（否则图标压文字）', () => {
  it('有 icon → 宽度增加 ICON + GAP，contentX 右移同量', () => {
    // 两侧都带 note：隔离出 icon 的净增量（否则 hasNote 的 +17 会混进来）
    const plain = displayMetrics(
      { ...makeTextNode('标题'), note: { one_liner: 'n' } },
      new Map(),
      m10,
    );
    const withIcon = displayMetrics(
      { ...makeTextNode('标题'), note: { one_liner: 'n', icon: 'draw:a.svg' } },
      new Map(),
      m10,
    );
    const delta = NODE_ICON_SIZE + NODE_ICON_GAP;
    expect(withIcon.w).toBe(plain.w + delta);
    expect(withIcon.contentX).toBe(plain.contentX + delta);
    expect(withIcon.iconW).toBe(delta);
    expect(withIcon.icon).toBe('draw:a.svg');
  });

  it('无 icon → iconW = 0，contentX 回到 PAD_X（既有布局零回归）', () => {
    const m = displayMetrics(makeTextNode('标题'), new Map(), m10);
    expect(m.icon).toBeNull();
    expect(m.iconW).toBe(0);
    expect(m.contentX).toBe(12);
  });

  it('entity 节点同样预留图标宽度（不因 kind chip 而丢失）', () => {
    const plain = displayMetrics(
      { ...makeEntityNode({ kind: 'doc', id: 'd1' }), note: { one_liner: 'n' } },
      new Map(),
      m10,
    );
    const withIcon = displayMetrics(
      { ...makeEntityNode({ kind: 'doc', id: 'd1' }), note: { one_liner: 'n', icon: 'draw:a.svg' } },
      new Map(),
      m10,
    );
    expect(withIcon.contentX).toBe(plain.contentX + NODE_ICON_SIZE + NODE_ICON_GAP);
  });
});

describe('内联插图：高度预留（否则插图压文字）', () => {
  it('有 media → 高度增加资产区 + 间隙，宽度不小于带图最小宽', () => {
    const plain = displayMetrics(makeTextNode('标题'), new Map(), m10);
    const withMedia = displayMetrics(
      { ...makeTextNode('标题'), note: { media: 'img:a.png' } },
      new Map(),
      m10,
    );
    expect(withMedia.media).toBe('img:a.png');
    expect(withMedia.assetH).toBeGreaterThan(0);
    expect(withMedia.h).toBeGreaterThan(plain.h);
    expect(withMedia.w).toBeGreaterThanOrEqual(72);
  });

  it('无 media → assetH = 0（普通文本节点不留空白）', () => {
    const m = displayMetrics(makeTextNode('标题'), new Map(), m10);
    expect(m.media).toBeNull();
    expect(m.assetH).toBe(0);
  });
});
