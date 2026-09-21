/**
 * 摘要括线几何（S4）：`buildSummaryViews` 的纯几何契约。
 *
 * ## 与 S3 的边界（本文件最重要的一条）
 *
 * `buildSummaryViews` **只能消费布局产物**：`layout.satellites`（摘除判定 + 子树的
 * `side`/`box`）+ 扁表盒 + 成员实际布局盒 + kernel 导出的两个间距常量。
 *
 * 它**不得**重解析 raw `summary_of`、不得自行推断成员区间、不得重跑 `resolveSummaries`
 * —— 否则「摘除」与「画括线」会各有一套成员口径，两者漂移时括线覆盖范围与布局脱钩，
 * 而这是本批最隐蔽的失败形态（节点被摘走了、括线却画在别处）。
 *
 * 因此下列用例的夹具**一律经由真实 `layoutMindmap(..., { satellite: satelliteHook })`
 * 产出** —— 摘要视图是由布局结果派生的，不是由测试直接构造的。
 *
 * ## 判据口径
 *
 * - 几何量用 `toBeCloseTo(…, 5)`；结构性事实（有无视图 / 成员清单 / 方向）用精确相等。
 * - 右向单摘要的期望值是**按 kernel 契约独立推导**的（带外沿 + 常量间距），
 *   不是「跑一遍实现把结果抄进断言」——后者对实现回归零判别力。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  astToEditable,
  parseMm,
  layoutLogic,
  layoutMindmap,
  satelliteHook,
  SUMMARY_BRACKET_GAP,
  SUMMARY_STEM_GAP,
  type EditableNode,
  type LayoutNode,
  type LayoutResult,
} from '@mindcanvas/kernel';
import { buildSummaryViews } from '../src/render/summaryFrames.js';

/** 取「必须存在」的值（项目惯例：不用 `!`，避免新增非空断言债务）。 */
function req<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`测试前置缺失：${what}`);
  return v;
}

function at<T>(arr: readonly T[], i: number, what: string): T {
  return req(arr[i], `${what}[${i}]`);
}

const M = (): { w: number; h: number } => ({ w: 100, h: 30 });

function build(text: string): EditableNode {
  return req(astToEditable(req(parseMm(text).root, 'parseMm root')), 'astToEditable');
}

function findByText(node: EditableNode, text: string): EditableNode | undefined {
  if (node.text === text) return node;
  for (const c of node.children) {
    const hit = findByText(c, text);
    if (hit) return hit;
  }
  return undefined;
}

/** 在 parentText 下按 cid 锚挂一个摘要节点（与 S2 生产写入同形态）。 */
function addSummaryTo(
  root: EditableNode,
  parentText: string,
  members: [string, string],
  opts: { text?: string; children?: string[] } = {},
): EditableNode {
  const parent = findByText(root, parentText);
  if (!parent) throw new Error(`找不到父节点 ${parentText}`);
  const from = parent.children.find((c) => c.text === members[0]);
  const to = parent.children.find((c) => c.text === members[1]);
  if (!from || !to) throw new Error(`找不到成员 ${members.join('/')}`);
  // cid 直接写进夹具的 note（不调 ensureNodeCid —— 那是 note 级 API，
  // 返回 {rootNote, nodeNote}，签名不是 (root, node)）。
  const fromCid = `cid-${from.id}`;
  const toCid = `cid-${to.id}`;
  const withCids = mapChildren(root, parent.id, (kids) =>
    kids.map((k) => {
      if (k.id === from.id) return { ...k, note: { ...k.note, cid: fromCid } };
      if (k.id === to.id) return { ...k, note: { ...k.note, cid: toCid } };
      return k;
    }),
  );
  // 摘要 id 必须**逐个唯一**：首版硬编码 `${parent.id}::summary`，第二次调用
  // 会与第一次同 id —— `buildSatellitePlan` 按 summaryNodeId 索引时两者相互覆盖，
  // 多摘要用例因此静默退化为单摘要（实测两 view 皆指向 乙 的成员）。
  // 用 opts.text（或成员区间）派生后缀，保证每个摘要独立。
  const tag = opts.text ?? `${members[0]}-${members[1]}`;
  const summaryId = `${parent.id}::summary::${tag}`;
  const summary: EditableNode = {
    id: summaryId,
    type: 'text',
    text: opts.text ?? '摘要',
    note: { summary_of: { from: `cid:${fromCid}`, to: `cid:${toCid}` } },
    children: (opts.children ?? []).map((t) => ({
      id: `${summaryId}::${t}`,
      type: 'text' as const,
      text: t,
      children: [],
    })),
  };
  return mapChildren(withCids, parent.id, (kids) => [...kids, summary]);
}

/** 在指定父下重写子列表（不可变）。 */
function mapChildren(
  node: EditableNode,
  parentId: string,
  fn: (kids: EditableNode[]) => EditableNode[],
): EditableNode {
  if (node.id === parentId) return { ...node, children: fn(node.children) };
  const kids = node.children.map((c) => mapChildren(c, parentId, fn));
  return kids.some((c, i) => c !== node.children[i]) ? { ...node, children: kids } : node;
}

/** 真实布局（S4 的唯一输入口径）。 */
function layoutOf(root: EditableNode, satellite = true): LayoutResult {
  return layoutMindmap(root, M, new Set(), satellite ? { satellite: satelliteHook } : {});
}

/** 扁平盒表（与 MapView 的 derived.boxes 同构）。 */
function boxMapOf(layout: LayoutResult): Map<string, { x: number; y: number; w: number; h: number }> {
  return new Map(layout.nodes.map((n) => [n.node.id, n.box]));
}

function viewsOf(root: EditableNode): ReturnType<typeof buildSummaryViews> {
  const layout = layoutOf(root);
  return buildSummaryViews({
    root,
    satellites: layout.satellites ?? [],
    nodes: layout.nodes,
  });
}

/** 成员子树包围盒（本文件自持，用于独立推导期望带外沿——刻意不复用实现）。 */
function bboxOf(ln: LayoutNode): { minX: number; minY: number; maxX: number; maxY: number } {
  const out = {
    minX: ln.box.x,
    minY: ln.box.y,
    maxX: ln.box.x + ln.box.w,
    maxY: ln.box.y + ln.box.h,
  };
  for (const c of ln.children) {
    const b = bboxOf(c);
    if (b.minX < out.minX) out.minX = b.minX;
    if (b.minY < out.minY) out.minY = b.minY;
    if (b.maxX > out.maxX) out.maxX = b.maxX;
    if (b.maxY > out.maxY) out.maxY = b.maxY;
  }
  return out;
}

/** 三成员 + 摘要（覆盖成员一..成员三）。 */
function threeMembers(extra = ''): EditableNode {
  const root = build(
    `# 根
## 父
- 成员一
- 成员二
- 成员三${extra}`,
  );
  return addSummaryTo(root, '父', ['成员一', '成员三']);
}

// ============================================================================
// 1. 右向单摘要几何
// ============================================================================

describe('S4 · 括线几何：右向单摘要', () => {
  it('产出恰好一个 view，成员/方向/摘要 id 正确', () => {
    const root = threeMembers();
    const views = viewsOf(root);
    expect(views, '三成员摘要应产出 1 个 view').toHaveLength(1);
    const v = at(views, 0, 'views');
    expect(v.side, '右向（成员在根右侧）').toBe(1);
    expect(v.memberIds, '成员清单 = 布局给出的区间').toHaveLength(3);
    const summaryId = findByText(root, '摘要')?.id;
    expect(v.summaryId, 'summaryId 取自卫星节点 id').toBe(summaryId);
  });

  it('括线位于成员带右侧（bracketPath 是贴着带右沿的方括号）', () => {
    const root = threeMembers();
    const layout = layoutOf(root);
    const view = at(viewsOf(root), 0, 'views');
    const boxes = boxMapOf(layout);
    // 独立推导成员带（成员子树并集）
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const id of view.memberIds) {
      const ln = layout.nodes.find((n) => n.node.id === id);
      const b = bboxOf(req(ln, `成员 ${id} 布局盒`));
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxY > maxY) maxY = b.maxY;
    }
    const bracketX = maxX + SUMMARY_BRACKET_GAP;
    // 方括号 path：右向应含水平「指线」段（从带右沿到括线）+ 竖段
    expect(view.bracketPath.startsWith('M'), '是 path 命令串').toBe(true);
    // 竖段贴合 bracketX：path 内的所有 x 坐标都应 >= 带右沿
    for (const x of pathXs(view.bracketPath)) {
      expect(x, `括线 x=${x} 不得落入成员带内（带右沿 ${maxX}）`).toBeGreaterThanOrEqual(maxX);
    }
    expect(Math.max(...pathXs(view.bracketPath)), '括线最右 x = 带右沿 + BRACKET_GAP').toBeCloseTo(
      bracketX,
      5,
    );
    // 竖段跨带上下沿
    const ys = pathYs(view.bracketPath);
    expect(Math.min(...ys), '括线上端 = 带 minY').toBeCloseTo(minY, 5);
    expect(Math.max(...ys), '括线下端 = 带 maxY').toBeCloseTo(maxY, 5);
    expect(boxes.size, '盒表非空（前置）').toBeGreaterThan(0);
  });

  it('stem 从括线连到摘要节点盒（水平、gap = SUMMARY_STEM_GAP）', () => {
    const root = threeMembers();
    const layout = layoutOf(root);
    const view = at(viewsOf(root), 0, 'views');
    const sat = req(
      (layout.satellites ?? []).find((s) => s.node.id === view.summaryId),
      '卫星节点',
    );
    expect(view.stemY1, 'stem 水平（Y1 == Y2）').toBe(view.stemY2);
    // 右向：stem 从括线 x 向右到摘要盒左缘
    expect(view.stemX1).toBeLessThan(view.stemX2);
    expect(view.stemX2, 'stem 终点 = 摘要盒左缘').toBeCloseTo(sat.box.x, 5);
    expect(view.stemX2 - view.stemX1, 'stem 水平长度 = STEM_GAP').toBeCloseTo(
      SUMMARY_STEM_GAP,
      5,
    );
    // stem 的 y 取括线中点（= 带心）
    expect(view.stemY1).toBeCloseTo(view.memberBand.y + view.memberBand.h / 2, 5);
  });

  it('成员带信息随 view 暴露（供上层高亮/命中，且与括线同源）', () => {
    const view = at(viewsOf(threeMembers()), 0, 'views');
    expect(view.memberBand.y + view.memberBand.h).toBeGreaterThan(view.memberBand.y);
    expect(view.memberBand.x + view.memberBand.w).toBeGreaterThan(view.memberBand.x);
  });
});

// ============================================================================
// 2. 左向单摘要镜像
// ============================================================================

describe('S4 · 括线几何：左向严格镜像', () => {
  it('左向岛内的摘要产 side=-1 的 view，括线在成员带左侧', () => {
    const root = build(`# 根
- 左成员一
- 左成员二
- 左成员三`);
    // 用 layoutLogic（森林左/右岛的左岛路径）产出左向布局，再挂摘要
    const withSummary = addSummaryTo(root, '根', ['左成员一', '左成员三']);
    const layout = layoutLogic(withSummary, M, new Set(), -1, { satellite: satelliteHook });
    const views = buildSummaryViews({
      root: withSummary,
      satellites: layout.satellites ?? [],
      nodes: layout.nodes,
    });
    expect(views, '左岛摘要应产出 1 个 view').toHaveLength(1);
    const v = at(views, 0, 'views');
    expect(v.side, '左向').toBe(-1);
    let minX = Infinity;
    for (const id of v.memberIds) {
      const ln = layout.nodes.find((n) => n.node.id === id);
      const b = bboxOf(req(ln, `成员 ${id}`));
      if (b.minX < minX) minX = b.minX;
    }
    for (const x of pathXs(v.bracketPath)) {
      expect(x, `左向括线 x=${x} 不得越过成员带左沿 ${minX}`).toBeLessThanOrEqual(minX);
    }
    expect(Math.min(...pathXs(v.bracketPath)), '括线最左 x = 带左沿 − BRACKET_GAP').toBeCloseTo(
      minX - SUMMARY_BRACKET_GAP,
      5,
    );
  });

  it('左向 stem 方向相反（括线 → 摘要盒右缘）', () => {
    const root = build(`# 根
- 左成员一
- 左成员二
- 左成员三`);
    const withSummary = addSummaryTo(root, '根', ['左成员一', '左成员三']);
    const layout = layoutLogic(withSummary, M, new Set(), -1, { satellite: satelliteHook });
    const views = buildSummaryViews({
      root: withSummary,
      satellites: layout.satellites ?? [],
      nodes: layout.nodes,
    });
    const v = at(views, 0, 'views');
    const sat = req(
      (layout.satellites ?? []).find((s) => s.node.id === v.summaryId),
      '卫星节点',
    );
    expect(v.stemX1, '左向：stem 从括线向左到摘要盒').toBeGreaterThan(v.stemX2);
    expect(v.stemX2, 'stem 终点 = 摘要盒右缘').toBeCloseTo(sat.box.x + sat.box.w, 5);
    expect(v.stemX1 - v.stemX2, '水平长度 = STEM_GAP').toBeCloseTo(SUMMARY_STEM_GAP, 5);
  });
});

// ============================================================================
// 3. 多摘要
// ============================================================================

describe('S4 · 括线几何：多摘要', () => {
  it('两个互不重叠的摘要各产一个 view，互不覆盖', () => {
    let root = build(`# 根
## 父
- 甲一
- 甲二
- 甲三
- 乙一
- 乙二
- 乙三`);
    root = addSummaryTo(root, '父', ['甲一', '甲三'], { text: '摘要甲' });
    root = addSummaryTo(root, '父', ['乙一', '乙三'], { text: '摘要乙' });
    const views = viewsOf(root);
    expect(views, '两个摘要 → 两个 view').toHaveLength(2);
    const summaryIdOf = (t: string): string => req(findByText(root, t)?.id, t);
    const ids = views.map((v) => v.summaryId).sort();
    expect(ids).toEqual([summaryIdOf('摘要甲'), summaryIdOf('摘要乙')].sort());
    // 「互不覆盖」的正确判据是**纵向带不重叠**，不是「竖段 x 不同」：
    // 六个成员同列（x/w 相同），两条括线竖段必然共线；带只沿 y 分开。
    // （首版此处写「x 不重合」→ 实测两带共线而红，错在断言不在实现。）
    const sorted = [...views].sort((a, b) => a.memberBand.y - b.memberBand.y);
    const upper = at(sorted, 0, 'sorted');
    const lower = at(sorted, 1, 'sorted');
    expect(
      upper.memberBand.y + upper.memberBand.h,
      '上带下沿不得越过下带上沿（两条括线纵向分离）',
    ).toBeLessThanOrEqual(lower.memberBand.y + 1e-6);
    expect(upper.stemY1, '各自 stem 落在自己的带心（不串线）').toBeLessThan(lower.stemY1);
    for (const v of views) {
      for (const x of pathXs(v.bracketPath)) {
        expect(x, '括线不得落入成员带内').toBeGreaterThanOrEqual(v.memberBand.x + v.memberBand.w - 1e-6);
      }
    }
  });
});

// ============================================================================
// 4. 成员带包含子树（不是根节点盒）
// ============================================================================

describe('S4 · 括线几何：成员带口径 = 子树并集', () => {
  it('成员带包含成员的子树（不是成员自身盒）', () => {
    // 成员一有子节点「孙」，其盒更靠右/更宽 → 带必须把它算进去
    const root = build(`# 根
## 父
- 成员一
  - 孙节点很长的名字
- 成员二
- 成员三`);
    const withS = addSummaryTo(root, '父', ['成员一', '成员三']);
    const layout = layoutOf(withS);
    const view = at(
      buildSummaryViews({ root: withS, satellites: layout.satellites ?? [], nodes: layout.nodes }),
      0,
      'views',
    );
    const grandchild = req(findByText(withS, '孙节点很长的名字'), '孙节点');
    const grandBox = req(boxMapOf(layout).get(grandchild.id), '孙节点盒');
    // 带必须覆盖孙节点的右沿（若误用成员自身盒，带会偏窄）
    expect(
      view.memberBand.x + view.memberBand.w,
      '带右沿必须覆盖成员的子树（否则是「根盒代子树带」的阴性对照目标）',
    ).toBeGreaterThanOrEqual(grandBox.x + grandBox.w - 1e-6);
  });

  it('摘要子树高度变化 → 括线纵向仍贴合成员带（与摘要高度无关）', () => {
    const root = build(`# 根
## 父
- 成员一
- 成员二
- 成员三`);
    const withS = addSummaryTo(root, '父', ['成员一', '成员三']);
    const bare = viewsOf(withS);
    const bareView = at(bare, 0, 'views');
    const tall = addSummaryTo(withS, '父', ['成员一', '成员三'], {
      text: '摘要',
    });
    // 给摘要挂一串子主题（子树变高）
    const tallRoot: EditableNode = {
      ...tall,
      children: tall.children.map((c) =>
        c.text === '父'
          ? {
              ...c,
              children: c.children.map((s) =>
                s.text === '摘要'
                  ? {
                      ...s,
                      children: ['子一', '子二', '子三', '子四'].map((t) => ({
                        id: `${s.id}::${t}`,
                        type: 'text' as const,
                        text: t,
                        children: [],
                      })),
                    }
                  : s,
              ),
            }
          : c,
      ),
    };
    const tallView = at(viewsOf(tallRoot), 0, 'views');
    // 括线纵向范围只由成员带决定：摘要变高不改变括线上下端
    expect(tallView.bracketPath, '括线随带（与摘要子树高度无关）').toBe(bareView.bracketPath);
    expect(tallView.memberBand.y).toBeCloseTo(bareView.memberBand.y, 5);
    expect(tallView.memberBand.y + tallView.memberBand.h).toBeCloseTo(bareView.memberBand.y + bareView.memberBand.h, 5);
  });
});

// ============================================================================
// 5. 缺盒跳过
// ============================================================================

describe('S4 · 括线几何：缺盒跳过（不画半条括线）', () => {
  it('成员盒缺失 → 跳过该 view', () => {
    const root = threeMembers();
    const layout = layoutOf(root);
    const full = buildSummaryViews({ root, satellites: layout.satellites ?? [], nodes: layout.nodes });
    expect(full, '前置：正常应产出 1 view').toHaveLength(1);
    const dropped = at(full, 0, 'full');
    // 把全部成员从扁表移除（模拟「成员盒缺失」）
    const memberSet = new Set(dropped.memberIds);
    const stripped = layout.nodes.filter((n) => !memberSet.has(n.node.id));
    const views = buildSummaryViews({ root, satellites: layout.satellites ?? [], nodes: stripped });
    expect(views, '成员盒全缺 → 不产出 view').toHaveLength(0);
  });

  it('satellite 盒缺失 → 跳过该 view', () => {
    const root = threeMembers();
    const layout = layoutOf(root);
    const views = buildSummaryViews({ root, satellites: [], nodes: layout.nodes });
    expect(views, '无 satellites → 不产出 view（括线以卫星为锚）').toHaveLength(0);
  });

  it('卫星节点不在扁表盒内 → 跳过该 view', () => {
    const root = threeMembers();
    const layout = layoutOf(root);
    const satIds = new Set((layout.satellites ?? []).map((s) => s.node.id));
    const stripped = layout.nodes.filter((n) => !satIds.has(n.node.id));
    const views = buildSummaryViews({ root, satellites: layout.satellites ?? [], nodes: stripped });
    expect(views, '卫星盒缺失 → 不产出 view').toHaveLength(0);
  });
});

// ============================================================================
// 6. 降级项不绘制（dangling / stale / nestedSkip / 普通流降级）
// ============================================================================

describe('S4 · 括线几何：降级项不绘制括线', () => {
  it('dangling（from 被删）→ 无卫星 → 不绘制括线', () => {
    const root = threeMembers();
    const parent = req(findByText(root, '父'), '父');
    // 删掉端点成员一 → 锚 dangling
    const broken: EditableNode = {
      ...root,
      children: root.children.map((c) =>
        c.id === parent.id
          ? { ...c, children: c.children.filter((g) => g.text !== '成员一') }
          : c,
      ),
    };
    const layout = layoutOf(broken);
    const views = buildSummaryViews({ root: broken, satellites: layout.satellites ?? [], nodes: layout.nodes });
    expect(views, 'dangling 摘要不产卫星 → 不绘制括线').toHaveLength(0);
    // 且摘要节点仍在扁表内可见（降级为普通流节点，不消失）
    const summaryId = req(findByText(broken, '摘要')?.id, '摘要');
    expect(
      layout.nodes.some((n) => n.node.id === summaryId),
      'dangling 摘要节点必须仍可见（不得消失）',
    ).toBe(true);
  });

  it('stale（成员被移出同父）→ 不绘制括线，节点仍可见', () => {
    const root = threeMembers();
    const parent = req(findByText(root, '父'), '父');
    const moved = req(findByText(root, '成员三'), '成员三');
    // 把成员三移到根下（跨父 → stale）
    const broken: EditableNode = {
      ...root,
      children: [
        ...root.children.map((c) =>
          c.id === parent.id
            ? { ...c, children: c.children.filter((g) => g.id !== moved.id) }
            : c,
        ),
        { ...moved },
      ],
    };
    const layout = layoutOf(broken);
    const views = buildSummaryViews({ root: broken, satellites: layout.satellites ?? [], nodes: layout.nodes });
    expect(views, 'stale 摘要不产卫星 → 不绘制括线').toHaveLength(0);
    const summaryId = req(findByText(broken, '摘要')?.id, '摘要');
    expect(
      layout.nodes.some((n) => n.node.id === summaryId),
      'stale 摘要节点必须仍可见',
    ).toBe(true);
  });

  it('nestedSkip（成员区间含另一摘要）→ 不绘制括线，两摘要节点都可见', () => {
    let root = build(`# 根
## 父
- 成员一
- 成员二
- 成员三`);
    // 内层摘要覆盖 成员二..成员三
    root = addSummaryTo(root, '父', ['成员二', '成员三'], { text: '内层摘要' });
    // 外层摘要覆盖 成员一..内层摘要 —— 区间含另一摘要节点 → nestedSkip
    const parent = req(findByText(root, '父'), '父');
    const inner = req(findByText(root, '内层摘要'), '内层摘要');
    const first = req(findByText(root, '成员一'), '成员一');
    const outerId = `${parent.id}::outer`;
    // 外层锚：from=成员一，to=内层摘要（两者同父）→ 区间含另一摘要节点
    const withCids = mapChildren(root, parent.id, (kids) =>
      kids.map((k) =>
        k.id === first.id ? { ...k, note: { ...k.note, cid: `cid-${first.id}` } } : k,
      ),
    );
    const innerCid = ((): string => {
      const n = findByText(withCids, '内层摘要');
      return String(req(req(n, '内层摘要').note, 'inner note').cid ?? `cid-${inner.id}`);
    })();
    const outer: EditableNode = {
      id: outerId,
      type: 'text',
      text: '外层摘要',
      note: { summary_of: { from: `cid-${first.id}`, to: innerCid } },
      children: [],
    };
    const nested: EditableNode = mapChildren(withCids, parent.id, (kids) => [...kids, outer]);
    const layout = layoutOf(nested);
    const views = buildSummaryViews({ root: nested, satellites: layout.satellites ?? [], nodes: layout.nodes });
    const outerView = views.find((v) => v.summaryId === outerId);
    expect(outerView, 'nestedSkip 的外层摘要不得产出括线').toBeUndefined();
    expect(
      layout.nodes.some((n) => n.node.id === outerId),
      '外层摘要节点必须留在普通流内可见（不得消失）',
    ).toBe(true);
    expect(
      layout.nodes.some((n) => n.node.id === inner.id),
      '内层摘要节点可见',
    ).toBe(true);
  });

  it('无摘要文档 → 零 view（且布局无 satellites 字段）', () => {
    const root = build(`# 根
## 父
- 成员一
- 成员二`);
    const layout = layoutOf(root);
    expect(layout.satellites ?? [], '无摘要：无卫星').toHaveLength(0);
    const views = buildSummaryViews({ root, satellites: layout.satellites ?? [], nodes: layout.nodes });
    expect(views, '无摘要：零 view').toHaveLength(0);
  });
});

// ============================================================================
// 7. 消费面纪律：不重解析 raw summary_of
// ============================================================================

describe('S4 · 消费面纪律', () => {
  it('buildSummaryViews 不读取 raw summary_of（卫星为空时一律零 view）', () => {
    const root = threeMembers();
    const layout = layoutOf(root);
    // 摘要节点在扁表内（被摘除后仍在 nodes 里），但 satellites 字段被清空 →
    // 若实现自行重解析 raw summary_of，此用例会产出 view（红）。
    const views = buildSummaryViews({ root, satellites: [], nodes: layout.nodes });
    expect(views, '摘除判定只能来自 satellites（单一事实源）').toHaveLength(0);
  });

  it('不修改输入（纯函数）', () => {
    const root = threeMembers();
    const layout = layoutOf(root);
    const nodesBefore = JSON.stringify(layout.nodes.map((n) => [n.node.id, n.box]));
    const spy = vi.fn();
    buildSummaryViews({ root, satellites: layout.satellites ?? [], nodes: layout.nodes });
    expect(JSON.stringify(layout.nodes.map((n) => [n.node.id, n.box])), '输入未被改写').toBe(
      nodesBefore,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

// ============================================================================
// 工具：从 path 串取坐标（M/L/H/V 命令；方括号用 L 命令写出）
// ============================================================================

function pathXs(d: string): number[] {
  const out: number[] = [];
  const re = /([MLHVmlhv])\s*([-\d.\s,]*)/g;
  let cx = 0;
  for (let m = re.exec(d); m !== null; m = re.exec(d)) {
    const cmd = req(m[1], 'cmd');
    const nums = (m[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s !== '')
      .map(Number);
    if (cmd === 'H') {
      cx = at(nums, 0, 'H');
      out.push(cx);
    } else if (cmd === 'h') {
      cx += at(nums, 0, 'h');
      out.push(cx);
    } else if (cmd === 'L') {
      for (let i = 0; i < nums.length; i += 2) {
        cx = at(nums, i, 'L');
        out.push(cx);
      }
    } else if (cmd === 'M') {
      cx = at(nums, 0, 'M');
      out.push(cx);
    } else if (cmd === 'V' || cmd === 'v') {
      out.push(cx);
    }
  }
  return out;
}

function pathYs(d: string): number[] {
  const out: number[] = [];
  const re = /([MLHVmlhv])\s*([-\d.\s,]*)/g;
  let cy = 0;
  for (let m = re.exec(d); m !== null; m = re.exec(d)) {
    const cmd = req(m[1], 'cmd');
    const nums = (m[2] ?? '')
      .trim()
      .split(/[\s,]+/)
      .filter((s) => s !== '')
      .map(Number);
    if (cmd === 'V') {
      cy = at(nums, 0, 'V');
      out.push(cy);
    } else if (cmd === 'v') {
      cy += at(nums, 0, 'v');
      out.push(cy);
    } else if (cmd === 'L') {
      for (let i = 1; i < nums.length; i += 2) {
        cy = at(nums, i, 'L');
        out.push(cy);
      }
    } else if (cmd === 'M') {
      cy = at(nums, 1, 'M');
      out.push(cy);
    } else if (cmd === 'H' || cmd === 'h') {
      out.push(cy);
    }
  }
  return out;
}
