/**
 * G6′ 端到端：note 标注 → buildCenterSpecs → layoutForest → 落位。
 *
 * 这条链路串起三个模块，是最容易在接缝处出错的地方：
 *   centers.ts（note 读写 / 路径锚）
 *   pipeline.ts（buildCenterSpecs：升格语义 + 虚拟根）
 *   kernel/layout/forest.ts（局部布局 → 平移 → 合并）
 */
import { describe, expect, it } from 'vitest';
import {
  astToEditable,
  defaultMeasure,
  layoutForest,
  parseMm,
  type EditableNode,
} from '@mindcanvas/kernel';
import { buildCenterSpecs, buildIslandView } from '../src/demo/pipeline.js';
import { collectCenters, removeCenter, upsertCenter } from '../src/render/centers.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

function root(): EditableNode {
  return t('总览', [t('工作', [t('项目A'), t('项目B')]), t('生活', [t('健身')])]);
}

const AT_WORK = 'node:总览/工作';
const measure = (): { w: number; h: number } => defaultMeasure(t('x'));

const boxOf = (layout: ReturnType<typeof layoutForest>, text: string) =>
  layout.nodes.find((n) => n.node.text === text)?.box;

const centerOf = (layout: ReturnType<typeof layoutForest>, text: string) => {
  const b = boxOf(layout, text);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : undefined;
};

describe('G6′ 端到端：升格 → 布局落位', () => {
  it('无中心标注 → 回退单树（buildCenterSpecs 返回 null）', () => {
    expect(buildCenterSpecs(root(), collectCenters(root()))).toBeNull();
  });

  it('★ 升格「工作」向右并指定坐标 → 中心精确落在该坐标', () => {
    const r = { ...root(), note: upsertCenter(undefined, AT_WORK, { dir: 'right', x: 400, y: -100 }) };
    const specs = buildCenterSpecs(r, collectCenters(r));
    expect(specs).not.toBeNull();

    const layout = layoutForest(specs!, measure, new Set());
    const c = centerOf(layout, '工作');
    expect(c?.x).toBeCloseTo(400, 6);
    expect(c?.y).toBeCloseTo(-100, 6);
  });

  it('★ 子树朝指定方向生长（right：子节点在中心右侧）', () => {
    const r = { ...root(), note: upsertCenter(undefined, AT_WORK, { dir: 'right', x: 0, y: 0 }) };
    const specs = buildCenterSpecs(r, collectCenters(r))!;
    const layout = layoutForest(specs, measure, new Set());
    expect(boxOf(layout, '项目A')!.x).toBeGreaterThan(boxOf(layout, '工作')!.x);
  });

  it('★ up 方向：子节点在中心上方', () => {
    const r = { ...root(), note: upsertCenter(undefined, AT_WORK, { dir: 'up', x: 0, y: 0 }) };
    const specs = buildCenterSpecs(r, collectCenters(r))!;
    const layout = layoutForest(specs, measure, new Set());
    expect(boxOf(layout, '项目A')!.y).toBeLessThan(boxOf(layout, '工作')!.y);
  });

  it('★ 未升格的兄弟仍渲染（虚拟根作为默认中心）', () => {
    const r = { ...root(), note: upsertCenter(undefined, AT_WORK, { dir: 'right', x: 900, y: 0 }) };
    const specs = buildCenterSpecs(r, collectCenters(r))!;
    const layout = layoutForest(specs, measure, new Set());
    // 「生活」未升格 → 归虚拟根（自动排列），不应消失
    expect(boxOf(layout, '生活')).toBeDefined();
    expect(boxOf(layout, '健身')).toBeDefined();
    // 且不应与被拖到 x=900 的「工作」重合
    const work = boxOf(layout, '工作')!;
    const life = boxOf(layout, '生活')!;
    expect(Math.abs(life.x + life.w / 2 - (work.x + work.w / 2))).toBeGreaterThan(0);
  });

  it('两个中心各自落位，互不干扰', () => {
    let note = upsertCenter(undefined, AT_WORK, { dir: 'right', x: 0, y: 0 });
    note = upsertCenter(note, 'node:总览/生活', { dir: 'down', x: 700, y: 300 });
    const r = { ...root(), note };
    const specs = buildCenterSpecs(r, collectCenters(r))!;
    const layout = layoutForest(specs, measure, new Set());
    expect(centerOf(layout, '工作')?.x).toBeCloseTo(0, 6);
    expect(centerOf(layout, '生活')?.x).toBeCloseTo(700, 6);
    expect(centerOf(layout, '生活')?.y).toBeCloseTo(300, 6);
  });

  it('降格 → 回到自动排列（坐标不再生效，但保留在历史区）', () => {
    const placed = { ...root(), note: upsertCenter(undefined, AT_WORK, { dir: 'right', x: 400, y: -100 }) };
    const demoted = { ...root(), note: removeCenter(placed.note, AT_WORK) };
    const specs = buildCenterSpecs(demoted, collectCenters(demoted));
    expect(specs).toBeNull(); // 全部中心都降格 → 回退单树

    // 再升格 → 吸附回 (400, -100)
    const again = { ...root(), note: upsertCenter(demoted.note, AT_WORK, { dir: 'right' }) };
    const specs2 = buildCenterSpecs(again, collectCenters(again))!;
    const layout = layoutForest(specs2, measure, new Set());
    expect(centerOf(layout, '工作')?.x).toBeCloseTo(400, 6);
    expect(centerOf(layout, '工作')?.y).toBeCloseTo(-100, 6);
  });

  it('全部节点数守恒（虚拟根 + 升格子树 = 原树除根外所有节点）', () => {
    const r = { ...root(), note: upsertCenter(undefined, AT_WORK, { dir: 'right', x: 0, y: 0 }) };
    const specs = buildCenterSpecs(r, collectCenters(r))!;
    const layout = layoutForest(specs, measure, new Set());
    // 原树：总览 / 工作 / 项目A / 项目B / 生活 / 健身 = 6
    // 森林：虚拟根(总览) + 生活 + 健身 | 工作 + 项目A + 项目B = 6
    expect(layout.nodes).toHaveLength(6);
  });
});

/**
 * 回归：外部探针（2026-09-05）发现的三个缺陷。
 * 这些场景在「48 条定向测试 + 类型检查全过」时依然存在 —— 定向测试只覆盖了
 * 一级升格的正常路径，没覆盖深层升格、全部升格、改名三类边界。
 */
describe('G6″ A3：递归投影替换一级过滤（深层/嵌套升格生效）', () => {
  it('★ 深层升格生效：独立成岛，不重复、节点数守恒（T02）', () => {
    // 升格一个**深层**节点（总览/工作/项目A）—— v1 一级过滤下它被静默忽略
    const deep = 'node:总览/工作/项目A';
    const r = { ...root(), note: upsertCenter(undefined, deep, { dir: 'right', x: 0, y: 0 }) };

    const specs = buildCenterSpecs(r, collectCenters(r))!;
    // 根岛（总览/工作(项目B)/生活(健身)）+ 项目A 岛
    expect(specs).toHaveLength(2);
    const layout = layoutForest(specs, measure, new Set());
    // 原树 6 节点全部出现，恰好一次
    expect(layout.nodes).toHaveLength(6);
    expect(layout.nodes.map((n) => n.node.text).filter((t) => t === '项目A')).toHaveLength(1);
    // 项目A 不再留在「工作」子树：工作（根岛内）只剩项目B
    const rootSpec = specs.find((s) => s.node.text === '总览')!;
    const work = rootSpec.node.children.find((c) => c.text === '工作')!;
    expect(work.children.map((c) => c.text)).toEqual(['项目B']);
  });

  it('★ 一级 + 深层同时升格：均生效且节点数守恒（T02 变体）', () => {
    let note = upsertCenter(undefined, AT_WORK, { dir: 'right', x: 0, y: 0 });
    note = upsertCenter(note, 'node:总览/工作/项目A', { dir: 'right', x: 500, y: 500 });
    const r = { ...root(), note };

    const specs = buildCenterSpecs(r, collectCenters(r))!;
    // 根岛（总览/生活/健身）+ 工作岛（工作/项目B）+ 项目A 岛
    expect(specs).toHaveLength(3);
    const layout = layoutForest(specs, measure, new Set());
    expect(layout.nodes).toHaveLength(6);
    const ids = layout.nodes.map((n) => n.node.text);
    expect(ids.filter((t) => t === '项目A')).toHaveLength(1);
  });

  it('★ 嵌套升格：B 与 C 均独立，C 不重复出现在 B 岛（T03）', () => {
    // R → A → B → C，B 与 C 均升格（G1：各自独立，互不隶属）
    const r = t('R', [t('A', [t('B', [t('C')])])]);
    let note = upsertCenter(undefined, 'node:R/A/B', { dir: 'right', x: 0, y: 0 });
    note = upsertCenter(note, 'node:R/A/B/C', { dir: 'down', x: 300, y: 300 });
    const doc = { ...r, note };

    const specs = buildCenterSpecs(doc, collectCenters(doc))!;
    // 根岛（R/A）+ B 岛（B，C 已被剔除）+ C 岛
    expect(specs).toHaveLength(3);
    const bSpec = specs.find((s) => s.node.text === 'B');
    expect(bSpec?.node.children).toHaveLength(0);
    const layout = layoutForest(specs, measure, new Set());
    expect(layout.nodes).toHaveLength(4); // R / A / B / C
    expect(layout.nodes.map((n) => n.node.text).filter((t) => t === 'C')).toHaveLength(1);
  });
});

describe('G6′ 回归：探针发现的缺陷', () => {
  it('★ 全部一级子节点都升格 → 不含虚拟根，且节点数守恒', () => {
    let note = upsertCenter(undefined, AT_WORK, { dir: 'right', x: 0, y: 0 });
    note = upsertCenter(note, 'node:总览/生活', { dir: 'left', x: 600, y: 0 });
    const r = { ...root(), note };

    const specs = buildCenterSpecs(r, collectCenters(r))!;
    // 两个中心，无虚拟根（restChildren 为空）
    expect(specs).toHaveLength(2);
    const layout = layoutForest(specs, measure, new Set());
    // 总览(根)不再渲染：6 - 1 = 5
    expect(layout.nodes).toHaveLength(5);
  });

  it('★ 中心标题改名后路径锚失效 → 该中心被安全忽略（不崩、不重复）', () => {
    const r = { ...root(), note: upsertCenter(undefined, AT_WORK, { dir: 'right', x: 0, y: 0 }) };
    // 改名：「工作」→「职业」
    const renamed: EditableNode = {
      ...r,
      children: [
        { ...r.children[0]!, text: '职业' },
        ...r.children.slice(1),
      ],
    };
    const collected = collectCenters(renamed);
    expect(collected[0]!.nodeId).toBeNull(); // 锚失效
    expect(collected[0]!.state).toBe('dangling');

    // 布局层应忽略失效中心并回退单树，而不是渲染半棵树
    const specs = buildCenterSpecs(renamed, collected);
    expect(specs).toBeNull();
  });

  it('★ 重复 nodeId → 只输出 first wins 的中心', () => {
    const r = root();
    const workId = r.children[0]!.id;
    const specs = buildCenterSpecs(r, [
      { nodeId: workId, at: AT_WORK, dir: 'down', pos: { x: 7, y: 9 }, state: 'well-formed' },
      { nodeId: workId, at: AT_WORK, dir: 'up', pos: { x: 70, y: 90 }, state: 'well-formed' },
    ])!;
    const workSpecs = specs.filter((s) => s.node.id === workId);
    expect(workSpecs).toHaveLength(1);
    expect(workSpecs[0]).toMatchObject({ dir: 'down', pos: { x: 7, y: 9 } });
  });

  it('state 非 well-formed 的标注被跳过：全部失效 → 回退单树', () => {
    const r = root();
    const workId = r.children[0]!.id;
    const specs = buildCenterSpecs(r, [
      { nodeId: workId, at: AT_WORK, dir: 'down', pos: { x: 7, y: 9 }, state: 'stale' },
    ]);
    expect(specs).toBeNull();
  });

  it('T24 外部文本编辑产生坏锚：文档可打开、提示 dangling、不自动重绑到错误节点', () => {
    // 语义有效的 .mm.md + 外部手改出的 centers 标注（指向不存在的路径）
    const source = [
      '<!--',
      'centers:',
      '  - at: "node:总览/不存在的节点"',
      '    dir: right',
      '    x: 100',
      '    y: 50',
      '-->',
      '# 总览',
      '',
      '## 工作',
      '',
      '## 生活',
    ].join('\n');
    const parsed = parseMm(source);
    expect(parsed.root).not.toBeNull(); // 可打开
    const reopened = astToEditable(parsed.root)!;
    const collected = collectCenters(reopened);
    expect(collected).toHaveLength(1);
    expect(collected[0]!.state).toBe('dangling'); // 坏锚显式提示
    expect(collected[0]!.nodeId).toBeNull(); // 不误绑到任何真实节点
    // 布局安全回退单树（不崩）
    expect(buildCenterSpecs(reopened, collected)).toBeNull();
  });
});

describe('G6″ A3-2：buildIslandView（跨岛边界边 + 诊断）', () => {
  it('深层升格产生跨岛边界边；parent_link: show 才透出，hide（缺省）不透出', () => {
    const deep = 'node:总览/工作/项目A';
    const workId = root().children[0]!.id;
    const projAId = root().children[0]!.children[0]!.id;
    const r = { ...root(), note: upsertCenter(undefined, deep, { dir: 'right', x: 0, y: 0 }) };
    // parentLink 由调用方（collectCenters）传入——直接构造 show / hide 两个视图
    const shown = buildIslandView(r, [
      { nodeId: projAId, at: deep, dir: 'right', pos: { x: 0, y: 0 }, state: 'well-formed', parentLink: 'show' },
    ]);
    expect(shown.specs).not.toBeNull();
    expect(shown.boundaryLinks).toEqual([{ fromId: workId, toId: projAId }]);

    const hidden = buildIslandView(r, [
      { nodeId: projAId, at: deep, dir: 'right', pos: { x: 0, y: 0 }, state: 'well-formed' },
    ]);
    expect(hidden.specs).not.toBeNull(); // 中心照常生效
    expect(hidden.boundaryLinks).toEqual([]); // 缺省 hide：边界边不透出
    expect(hidden.diagnostics).toEqual([]);
  });

  it('诊断透出：悬空 nodeId → center-node-not-found；重复 → duplicate-center', () => {
    const r = root();
    const workId = r.children[0]!.id;
    const ghost = buildIslandView(r, [
      { nodeId: 'ghost', at: 'node:总览/幽灵', dir: 'right', pos: null, state: 'well-formed' },
    ]);
    expect(ghost.specs).toBeNull(); // 无独立岛 → 回退
    expect(ghost.diagnostics.map((d) => d.code)).toContain('center-node-not-found');

    const dup = buildIslandView(r, [
      { nodeId: workId, at: AT_WORK, dir: 'right', pos: null, state: 'well-formed' },
      { nodeId: workId, at: AT_WORK, dir: 'up', pos: null, state: 'well-formed' },
    ]);
    expect(dup.diagnostics.map((d) => d.code)).toContain('duplicate-center');
  });
});
