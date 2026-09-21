/**
 * T3 · Section 帧模型纯几何测试（buildSectionViews，node 环境无 DOM）。
 *
 * 断言要点：
 * - AABB = 成员盒并集；外扩 = 左右下 SECTION_PADDING、上侧 SECTION_TITLE_H+6
 * - 取盒注入（boxOf）即预览偏移通道：偏移盒 → 框跟随（中心拖拽预览复用验证）
 * - 折叠：memberCount 计全量子树（含隐藏），collapsed 标记驱动 +N 徽标
 * - dangling/stale → ghost 无几何；标题回退链 spec.title → titleOf → spec.id
 */
import { describe, expect, it } from 'vitest';
import type { Box, ResolvedSection } from '@mindcanvas/kernel';
import {
  buildSectionViews,
  SECTION_PADDING,
  SECTION_PALETTE,
  SECTION_TITLE_H,
  type SectionFrame,
  type SectionGhost,
} from '../src/render/sectionFrames.js';

const PAD = SECTION_PADDING;
const TOP = SECTION_TITLE_H + 6;

function mkResolved(over: Partial<ResolvedSection> & { id: string }): ResolvedSection {
  const { id, ...rest } = over;
  return {
    spec: { id, root: 'cid:c1', ...(rest.spec ?? {}) },
    state: 'well-formed',
    rootId: 'n1',
    ...rest,
  } as ResolvedSection;
}

const BOXES: Record<string, Box> = {
  n1: { x: 100, y: 50, w: 120, h: 40 },
  n2: { x: 260, y: 60, w: 100, h: 36 },
  n3: { x: 120, y: 130, w: 90, h: 30 },
};

function baseArgs(resolved: ResolvedSection[]) {
  return {
    resolved,
    titleOf: (id: string) => `标题:${id}`,
    memberIdsOf: () => ['n1', 'n2', 'n3'],
    boxOf: (id: string) => BOXES[id],
    collapsedIds: new Set<string>(),
  };
}

describe('T3 · buildSectionViews 几何', () => {
  it('AABB = 成员盒并集，外扩左右下 PAD、上侧 TOP（含标题栏）', () => {
    const views = buildSectionViews(baseArgs([mkResolved({ id: 'sec_1' })]));
    expect(views).toHaveLength(1);
    const f = views[0] as SectionFrame;
    expect(f.kind).toBe('frame');
    // 并集：x [100, 360]，y [50, 160]
    expect(f.bounds).toEqual({
      x: 100 - PAD,
      y: 50 - TOP,
      w: 260 + PAD * 2,
      h: 110 + TOP + PAD,
    });
    expect(f.memberCount).toBe(3);
    expect(f.collapsed).toBe(false);
    expect(f.title).toBe('标题:n1'); // spec.title 缺省 → titleOf 回退
  });

  it('spec.title 优先于 titleOf；两者皆缺回退 spec.id（ghost 场景）', () => {
    const views = buildSectionViews(
      baseArgs([
        mkResolved({ id: 'sec_t', spec: { id: 'sec_t', root: 'cid:c1', title: '显式标题' } }),
        mkResolved({ id: 'sec_g', state: 'dangling', rootId: undefined, reason: 'cid-not-found' }),
      ]),
    );
    expect((views[0] as SectionFrame).title).toBe('显式标题');
    const g = views[1] as SectionGhost;
    expect(g.kind).toBe('ghost');
    expect(g.state).toBe('dangling');
    expect(g.reason).toBe('cid-not-found');
  });

  it('缺盒成员跳过 AABB；全部缺盒 → 不产出 frame', () => {
    const partial = buildSectionViews({
      ...baseArgs([mkResolved({ id: 'sec_p' })]),
      boxOf: (id: string) => (id === 'n2' ? BOXES[id] : undefined),
    });
    const f = partial[0] as SectionFrame;
    expect(f.bounds).toEqual({
      x: 260 - PAD,
      y: 60 - TOP,
      w: 100 + PAD * 2,
      h: 36 + TOP + PAD,
    });
    const none = buildSectionViews({
      ...baseArgs([mkResolved({ id: 'sec_x' })]),
      boxOf: () => undefined,
    });
    expect(none).toEqual([]);
  });

  it('boxOf 注入偏移（中心拖拽预览通道）：框随偏移跟随', () => {
    const views = buildSectionViews({
      ...baseArgs([mkResolved({ id: 'sec_d' })]),
      boxOf: (id: string) => {
        const b = BOXES[id];
        return b ? { ...b, x: b.x + 40, y: b.y + 24 } : undefined;
      },
    });
    const f = views[0] as SectionFrame;
    expect(f.bounds.x).toBe(100 + 40 - PAD);
    expect(f.bounds.y).toBe(50 + 24 - TOP);
  });

  it('折叠：collapsed=true 且 memberCount 仍计全量子树（+N 徽标语义）', () => {
    const views = buildSectionViews({
      ...baseArgs([mkResolved({ id: 'sec_c' })]),
      // 折叠后仅根有盒（子节点隐藏）
      boxOf: (id: string) => (id === 'n1' ? BOXES[id] : undefined),
      collapsedIds: new Set(['n1']),
    });
    const f = views[0] as SectionFrame;
    expect(f.collapsed).toBe(true);
    expect(f.memberCount).toBe(3); // 全量子树 → 徽标显示 +2
    // 框收缩为仅包根卡
    expect(f.bounds.w).toBe(120 + PAD * 2);
  });

  it('六色调色板齐全；未知 color token 的 spec 经 sectionColorOf 回退 slate', () => {
    expect(Object.keys(SECTION_PALETTE).sort()).toEqual(
      ['amber', 'blue', 'green', 'rose', 'slate', 'violet'].sort(),
    );
    const weird = mkResolved({ id: 'sec_w' });
    weird.spec = { ...weird.spec, color: 'neon' as never };
    const views = buildSectionViews(baseArgs([weird]));
    expect((views[0] as SectionFrame).color).toBe('slate');
  });
});
