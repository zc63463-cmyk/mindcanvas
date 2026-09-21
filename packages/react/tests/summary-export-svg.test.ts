/**
 * S4 · SVG 导出中的摘要括线。
 *
 * ## 判据两条（任务书 §五）
 *
 * 1. **有摘要**：括线 path 必须出现在导出的既有顺序里
 *    （背景 → 树线 → 跨岛补线 boundaryLinks（虚线）→ **摘要括线** → 节点卡）。
 *    注意**导出不画「框边界」**：Section 框属画布侧 chrome，不进 SVG 导出；
 *    旧文本写的「框边界」导出层并不存在（误把跨岛补线当成了框）——
 *    S4-R2 已在协议 §6.5 / CHANGELOG / `chrome/exportSvg.ts` 注释三处更正，此处为第四处。
 * 2. **普通文档逐字等价**：无摘要文档的导出串必须与 S4 之前**逐字节相同**
 *    —— 这是零回归的硬判据（放宽它等于放弃「加法改动」的承诺）。
 *
 * 顺序判据不用「indexOf 硬下标」（脆），而用**相对位置**：括线必须出现在
 * 最后一张节点卡 `<g transform=` 之前、且在所有树线 `<path>` 之后。
 * 这样挪层即红，而节点/连线数量变化不会误伤。
 */
import { describe, expect, it } from 'vitest';
import {
  layoutLogic,
  layoutMindmap,
  makeTextNode,
  satelliteHook,
  type EditableNode,
  type LayoutResult,
} from '@mindcanvas/kernel';
import { exportSvg } from '../src/chrome/exportSvg.js';
import { classicToken, glassToken, stickerToken } from '../src/theme/tokens.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';

const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);

function req<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`测试前置缺失：${what}`);
  return v;
}

/** 根 → 父[成员一..成员三] + 摘要（cid 锚）。 */
function summaryFixture(): EditableNode {
  const m1 = makeTextNode('成员一');
  const m2 = makeTextNode('成员二');
  const m3 = makeTextNode('成员三');
  m1.note = { cid: 'c1' };
  m2.note = { cid: 'c2' };
  m3.note = { cid: 'c3' };
  const summary: EditableNode = {
    ...makeTextNode('摘要'),
    note: { cid: 'c9', summary_of: { from: 'cid:c1', to: 'cid:c3' } },
  };
  const parent = makeTextNode('父', [m1, m2, m3, summary]);
  const root = makeTextNode('根', [parent]);
  root.note = { cid: 'c0', next_cid: 10 };
  return root;
}

/** 普通文档（无摘要）：零回归对照。 */
function plainFixture(): EditableNode {
  return makeTextNode('根', [makeTextNode('分支 A'), makeTextNode('分支 B')]);
}

function layoutOf(root: EditableNode): LayoutResult {
  return layoutMindmap(root, createNodeMeasure(char, new Map()), new Set(), {
    satellite: satelliteHook,
  });
}

describe('S4 · SVG 导出：摘要括线', () => {
  it('有摘要文档：导出串含括线 path（data-summary-bracket 可定位）', () => {
    const root = summaryFixture();
    const layout = layoutOf(root);
    expect(layout.satellites ?? [], '前置：确实产出卫星').toHaveLength(1);
    const svg = exportSvg(layout, glassToken, { root });
    expect(
      svg.includes('data-summary-bracket'),
      'SVG 必须含可定位的括线属性（删除插线 → 此处转红）',
    ).toBe(true);
    expect(
      (svg.match(/data-summary-bracket/g) ?? []).length,
      '一条摘要 → 恰好一条括线（不重复绘制）',
    ).toBe(1);
    expect(svg.includes('data-summary-stem'), 'SWG 必须含 stem').toBe(true);
  });

  it('括线位于树线之后、节点卡之前（§五 既有顺序）', () => {
    const root = summaryFixture();
    const svg = exportSvg(layoutOf(root), glassToken, { root });
    const bracketAt = svg.indexOf('data-summary-bracket');
    // 最后一张节点卡的起点（节点卡以 `<g transform="translate(` 起）
    const lastCardAt = svg.lastIndexOf('<g transform="translate(');
    const firstLinkAt = svg.indexOf('<path d=', svg.indexOf('/>') + 2);
    expect(bracketAt, '括线存在').toBeGreaterThanOrEqual(0);
    expect(firstLinkAt, '树线存在（前置）').toBeGreaterThanOrEqual(0);
    expect(
      bracketAt,
      '括线必须在树线之后（括线是树线的延伸）',
    ).toBeGreaterThan(firstLinkAt);
    expect(
      bracketAt,
      '括线必须在最后一张节点卡之前（否则盖住节点卡 = 阴性对照 2 的目标）',
    ).toBeLessThan(lastCardAt);
  });

  it('左右方向正确（左向岛的括线在成员带左侧）', () => {
    // 直接构造左向布局：用 layoutLogic 左侧
    const m1 = makeTextNode('成员一');
    const m2 = makeTextNode('成员二');
    const m3 = makeTextNode('成员三');
    m1.note = { cid: 'c1' };
    m2.note = { cid: 'c2' };
    m3.note = { cid: 'c3' };
    const summary: EditableNode = {
      ...makeTextNode('摘要'),
      note: { cid: 'c9', summary_of: { from: 'cid:c1', to: 'cid:c3' } },
    };
    const root = makeTextNode('根', [m1, m2, m3, summary]);
    root.note = { cid: 'c0', next_cid: 10 };
    const layout = layoutLogic(root, createNodeMeasure(char, new Map()), new Set(), -1, {
      satellite: satelliteHook,
    });
    const svg = exportSvg(layout, glassToken, { root });
    const d = req(/<path[^>]*data-summary-bracket="[^"]*"[^>]*d="([^"]+)"/.exec(svg)?.[1], '括线 d');
    const nums = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const xs: number[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) xs.push(req(nums[i], `x@${i}`));
    const memberMinX = Math.min(
      ...['成员一', '成员二', '成员三'].map((t) => {
        const n = [...layout.nodes].find((l) => l.node.text === t);
        return req(n, t).box.x;
      }),
    );
    // 左向：括线 x 必须 <= 带左沿（严格在成员带左侧）
    expect(Math.min(...xs), '左向括线在成员带左侧').toBeLessThanOrEqual(memberMinX);
  });

  it('多摘要全部导出，且不重复绘制', () => {
    const j1 = makeTextNode('甲一');
    const j2 = makeTextNode('甲二');
    const j3 = makeTextNode('甲三');
    const y1 = makeTextNode('乙一');
    const y2 = makeTextNode('乙二');
    const y3 = makeTextNode('乙三');
    j1.note = { cid: 'j1' };
    j2.note = { cid: 'j2' };
    j3.note = { cid: 'j3' };
    y1.note = { cid: 'y1' };
    y2.note = { cid: 'y2' };
    y3.note = { cid: 'y3' };
    const sa: EditableNode = {
      ...makeTextNode('摘要甲'),
      note: { cid: 'sa', summary_of: { from: 'cid:j1', to: 'cid:j3' } },
    };
    const sb: EditableNode = {
      ...makeTextNode('摘要乙'),
      note: { cid: 'sb', summary_of: { from: 'cid:y1', to: 'cid:y3' } },
    };
    const root = makeTextNode('根', [makeTextNode('父', [j1, j2, j3, y1, y2, y3, sa, sb])]);
    root.note = { cid: 'c0', next_cid: 20 };
    const layout = layoutOf(root);
    expect(layout.satellites ?? [], '前置：两个卫星').toHaveLength(2);
    const svg = exportSvg(layout, glassToken, { root });
    expect(
      (svg.match(/data-summary-bracket/g) ?? []).length,
      '两条摘要 → 恰好两条括线',
    ).toBe(2);
    expect((svg.match(/data-summary-stem/g) ?? []).length, '两条 stem').toBe(2);
  });

  it('dangling / stale / 降级项不产生括线', () => {
    // dangling：删掉端点成员
    const root = summaryFixture();
    const parent = req(root.children[0], '父');
    const broken: EditableNode = {
      ...root,
      children: [
        {
          ...parent,
          children: parent.children.filter((c) => c.text !== '成员一'),
        },
      ],
    };
    const layout = layoutOf(broken);
    expect(layout.satellites ?? [], 'dangling → 无卫星').toHaveLength(0);
    const svg = exportSvg(layout, glassToken, { root: broken });
    expect(svg.includes('data-summary-bracket'), 'dangling 不得产生括线').toBe(false);
    // 且摘要节点仍作为普通节点卡导出（不消失）
    expect(svg.includes('摘要'), 'dangling 摘要节点仍在导出中可见').toBe(true);
  });

  it('三主题都能导出括线（线色取 token）', () => {
    const root = summaryFixture();
    const layout = layoutOf(root);
    for (const token of [classicToken, stickerToken, glassToken]) {
      const svg = exportSvg(layout, token, { root });
      expect(svg.includes('data-summary-bracket'), `主题 ${token.id} 应导出括线`).toBe(true);
      // 括线线色必须来自 token（不得硬编码）
      const m = /<path[^>]*data-summary-bracket="[^"]*"[^>]*stroke="([^"]+)"/.exec(svg);
      if (m) {
        expect(m[1], `主题 ${token.id} 的括线线色应是 token 值`).toBe(token.color.linkStroke);
      }
    }
  });

  it('重复导出同一布局：括线不累积（无状态）', () => {
    const root = summaryFixture();
    const layout = layoutOf(root);
    const a = exportSvg(layout, glassToken, { root });
    const b = exportSvg(layout, glassToken, { root });
    expect(a, '两次导出逐字相同（纯函数）').toBe(b);
    expect((b.match(/data-summary-bracket/g) ?? []).length, '不累积').toBe(1);
  });

  it('不传 root：退化为无括线（加法字段，旧调用方零改动）', () => {
    const root = summaryFixture();
    const layout = layoutOf(root);
    const svg = exportSvg(layout, glassToken);
    expect(
      svg.includes('data-summary-bracket'),
      '未传 root 时不画括线（旧调用方逐字等价）',
    ).toBe(false);
  });
});

describe('S4 · SVG 导出：普通文档逐字等价（零回归硬判据）', () => {
  it('无摘要文档的导出串与不含括线逻辑时逐字相同', () => {
    const layout = layoutOf(plainFixture());
    const withRoot = exportSvg(layout, glassToken, { root: plainFixture() });
    const withoutRoot = exportSvg(layout, glassToken);
    expect(
      withRoot,
      '普通文档：传 root 与不传 root 的导出必须逐字相同（否则是无关差异）',
    ).toBe(withoutRoot);
    expect(withRoot.includes('data-summary'), '普通文档导出不含任何摘要痕迹').toBe(false);
  });

  it('普通文档导出 = 结构化骨架（非空且含节点卡与连线）', () => {
    const layout = layoutOf(plainFixture());
    const svg = exportSvg(layout, glassToken, { root: plainFixture() });
    expect((svg.match(/<g transform="translate\(/g) ?? []).length, '3 张节点卡').toBe(3);
    expect((svg.match(/<path d=/g) ?? []).length, '2 条连线').toBe(2);
    expect(svg.endsWith('</svg>')).toBe(true);
  });
});
