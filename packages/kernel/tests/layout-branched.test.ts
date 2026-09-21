/**
 * D2′ 节点级生长方向（思想分叉）布局分组调度测试：
 * - 回归闸门：无显式 dir → 与 layoutMindmap 逐盒一致（旧文件零变更）
 * - 同节点多向分叉：左/右/下分组挂对应侧
 * - 继承链：缺省继承最近显式 → islandDir；孙节点可再覆盖
 * - 邻侧防叠：相邻方向组（left↔down 等）布局后 bounds 不相交
 * - 连线形态：right/left 组用贝塞尔（含 C 曲线），down/up 组用正交梁线（无 C）
 * - 折叠语义：折叠节点子女不布局
 */
import { describe, expect, it } from 'vitest';
import { layoutMindmapBranched } from '../src/layout/branching.js';
import { findOverlaps } from '../src/layout/separate.js';
import { layoutMindmap, type LayoutNode, type LayoutResult } from '../src/layout/mindmap.js';
import { makeTextNode, type EditableNode } from '../src/tree/treeOps.js';
import type { GrowDir } from '../src/layout/forest.js';

/** 布局结果的根布局节点（零重叠断言入口） */
function rootOf(res: LayoutResult): LayoutNode {
  const r = res.nodes.find((n) => n.parentId === null);
  if (!r) throw new Error('布局结果缺少根节点');
  return r;
}

/** 定长度量（可复现）：宽随文本长度，高固定 */
const measure = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 30 });

function boxOf(res: LayoutResult, id: string) {
  const ln = res.nodes.find((n) => n.node.id === id);
  if (!ln) throw new Error(`节点 ${id} 不在布局结果中`);
  return ln.box;
}

/** 指定方向组成员的并集包围盒 */
function unionBox(res: LayoutResult, ids: string[]) {
  const boxes = ids.map((id) => boxOf(res, id));
  return {
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.w)),
    maxY: Math.max(...boxes.map((b) => b.y + b.h)),
  };
}

function intersects(
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** 三向分叉标准夹具：议题 → 反方(left) / 正方(继承) / 细节(down) */
function forkFixture() {
  const root = makeTextNode('根', [
    makeTextNode('议题', [makeTextNode('反方'), makeTextNode('正方'), makeTextNode('细节')]),
  ]);
  const issue = root.children[0]!;
  const [against, inFavor, detail] = issue.children;
  const explicit = new Map<string, GrowDir>([
    [against!.id, 'left'],
    [detail!.id, 'down'],
  ]);
  return { root, issue, against: against!, inFavor: inFavor!, detail: detail!, explicit };
}

describe('layoutMindmapBranched：回归闸门（旧文件零变更）', () => {
  it('无显式 dir → 与 layoutMindmap 逐盒一致', () => {
    const root = makeTextNode('根', [
      makeTextNode('A', [makeTextNode('A1'), makeTextNode('A2')]),
      makeTextNode('B'),
    ]);
    const classic = layoutMindmap(root, measure, new Set());
    const branched = layoutMindmapBranched(root, measure, new Set());
    const boxesOf = (r: LayoutResult) =>
      r.nodes.map((n) => ({ id: n.node.id, ...n.box }));
    expect(boxesOf(branched)).toEqual(boxesOf(classic));
    expect(branched.bounds).toEqual(classic.bounds);
    expect(branched.links.length).toBe(classic.links.length);
  });

  it('explicit 映射存在但树中无命中节点 → 同样回退经典布局', () => {
    const root = makeTextNode('根', [makeTextNode('A')]);
    const explicit = new Map<string, GrowDir>([['ghost-id', 'left']]);
    const classic = layoutMindmap(root, measure, new Set());
    const branched = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
    });
    expect(branched.nodes.map((n) => ({ id: n.node.id, ...n.box }))).toEqual(
      classic.nodes.map((n) => ({ id: n.node.id, ...n.box })),
    );
  });
});

describe('layoutMindmapBranched：同节点多向分叉', () => {
  it('★ 左/右/下三向分组挂到父节点对应侧', () => {
    const { root, issue, against, inFavor, detail, explicit } = forkFixture();
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const p = boxOf(res, issue.id);
    const a = boxOf(res, against.id);
    const f = boxOf(res, inFavor.id);
    const d = boxOf(res, detail.id);
    // 反方(left)：整体在父左侧；细节(down)：整体在父下方 —— 显式声明必须落位
    expect(a.x + a.w).toBeLessThanOrEqual(p.x);
    expect(d.y).toBeGreaterThanOrEqual(p.y + p.h);
    // 正方**未声明** → 局部性优先：保持经典布局的基准位置，不再断言其左右
    // （经典布局是整体算法，它可能落在左侧）。局部性由下方对照测试严格保证。
  });

  it('★ 局部性：未声明方向的兄弟保持经典布局位置（不因旁支声明而重排）', () => {
    const { root, issue, inFavor, explicit } = forkFixture();
    // 基准：完全不声明任何方向
    const baseline = layoutMindmapBranched(root, measure, new Set(), { islandDir: 'right' });
    // 只给「反方」「细节」声明方向，「正方」不声明
    const withDir = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    // 未声明的「正方」坐标必须与基准完全一致（逐像素）
    const b = boxOf(baseline, inFavor.id);
    const w = boxOf(withDir, inFavor.id);
    expect(w.x).toBe(b.x);
    expect(w.y).toBe(b.y);
  });

  it('★ 局部性：只给一个深叶子声明方向 → 旁支整条分支坐标不变', () => {
    // 根 → 甲(甲一,甲二) / 乙(乙一,乙二) / 丙(丙一,丙二)
    const leaf = makeTextNode('丙二');
    const root = makeTextNode('根', [
      makeTextNode('甲', [makeTextNode('甲一'), makeTextNode('甲二')]),
      makeTextNode('乙', [makeTextNode('乙一'), makeTextNode('乙二')]),
      makeTextNode('丙', [makeTextNode('丙一'), leaf]),
    ]);
    const baseline = layoutMindmapBranched(root, measure, new Set(), { islandDir: 'right' });
    const withOne = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: new Map<string, GrowDir>([[leaf.id, 'up']]),
      islandDir: 'right',
    });
    // 甲、乙 两条旁支（含子孙）逐像素不变
    for (const text of ['甲', '甲一', '甲二', '乙', '乙一', '乙二']) {
      const b = baseline.nodes.find((n) => n.node.text === text);
      const w = withOne.nodes.find((n) => n.node.text === text);
      expect(b).toBeDefined();
      expect(w).toBeDefined();
      expect(w!.box.x).toBe(b!.box.x);
      expect(w!.box.y).toBe(b!.box.y);
    }
    // 声明的那个必须真的动到父节点上方（方向生效，不是「什么都没做」）
    const c = withOne.nodes.find((n) => n.node.text === '丙')!;
    const l = withOne.nodes.find((n) => n.node.text === '丙二')!;
    expect(l.box.y + l.box.h).toBeLessThan(c.box.y);
  });

  it('嵌套覆盖：无声明子节点继承最近显式祖先方向，孙节点可再覆盖', () => {
    const root = makeTextNode('根', [
      makeTextNode('议题', [
        makeTextNode('反方', [makeTextNode('论据A'), makeTextNode('论据B', [makeTextNode('要点')])]),
      ]),
    ]);
    const issue = root.children[0]!;
    const against = issue.children[0]!;
    const evA = against.children[0]!;
    const evB = against.children[1]!;
    const point = evB.children[0]!;
    const explicit = new Map<string, GrowDir>([
      [against.id, 'left'],
      [point.id, 'down'], // 孙节点显式覆盖：不随反方的 left
    ]);
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const a = boxOf(res, against.id);
    const ea = boxOf(res, evA.id);
    const eb = boxOf(res, evB.id);
    const pt = boxOf(res, point.id);
    // 论据A/B 继承反方的 left：挂在反方左侧
    expect(ea.x + ea.w).toBeLessThanOrEqual(a.x);
    expect(eb.x + eb.w).toBeLessThanOrEqual(a.x);
    // 要点显式 down：挂在论据B 下方而非左侧
    expect(pt.y).toBeGreaterThanOrEqual(eb.y + eb.h);
  });

  it('折叠语义：折叠父节点后其子女不参与布局', () => {
    const { root, issue, against, explicit } = forkFixture();
    const res = layoutMindmapBranched(root, measure, new Set([issue.id]), {
      explicitDirByNodeId: explicit,
    });
    expect(res.nodes.find((n) => n.node.id === against.id)).toBeUndefined();
    expect(res.nodes.find((n) => n.node.id === issue.id)).toBeDefined();
  });
});

describe('layoutMindmapBranched：邻侧防叠（布局期一次推开）', () => {
  it('★ left 组长子树与 down 组宽子树布局后 bounds 不相交', () => {
    // left 组：深链（纵向长）；down 组：多子（横向宽）——无防叠时两簇在左下象限相交
    const root = makeTextNode('根', [
      makeTextNode('议题', [
        makeTextNode('反方甲', [makeTextNode('链一', [makeTextNode('链二', [makeTextNode('链三')])])]),
        makeTextNode('反方乙'),
        makeTextNode('细节一', [makeTextNode('细A'), makeTextNode('细B'), makeTextNode('细C')]),
      ]),
    ]);
    const issue = root.children[0]!;
    const [l1, l2, d1] = issue.children;
    const leftIds = [l1!.id, l1!.children[0]!.id, l1!.children[0]!.children[0]!.id,
      l1!.children[0]!.children[0]!.children[0]!.id, l2!.id];
    const downIds = [d1!.id, ...d1!.children.map((c) => c.id)];
    const explicit = new Map<string, GrowDir>([
      [l1!.id, 'left'],
      [l2!.id, 'left'],
      [d1!.id, 'down'],
    ]);
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const leftBox = unionBox(res, leftIds);
    const downBox = unionBox(res, downIds);
    expect(intersects(leftBox, downBox)).toBe(false);
  });

  it('★ 升级为全对断言：任意两节点盒都不相交（separate 接管后不再只查相邻组）', () => {
    const { root, explicit } = forkFixture();
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const rootLn = rootOf(res);
    // 详尽的零重叠断言在 layout-separate.test.ts；此处锁住「本 describe 的主诉求」
    expect(findOverlaps(rootLn)).toHaveLength(0);
  });
});

describe('layoutMindmapBranched：连线形态按子方向选择', () => {
  it('right/left 组用贝塞尔（含 C 曲线），down 组用正交梁线（无 C）', () => {
    const { root, issue, against, inFavor, detail, explicit } = forkFixture();
    const res = layoutMindmapBranched(root, measure, new Set(), {
      explicitDirByNodeId: explicit,
      islandDir: 'right',
    });
    const linkTo = (id: string) => res.links.find((l) => l.toId === id);
    // 复审修复验证：down 组不得因方向桥接失效而回退贝塞尔
    expect(String(linkTo(against.id)!.path)).toContain('C');
    expect(String(linkTo(inFavor.id)!.path)).toContain('C');
    expect(String(linkTo(detail.id)!.path)).not.toContain('C');
  });
});

describe('上下生长对称性与层距（浏览器实测修复：up 曾误用 H_GAP）', () => {
  const fixed = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 24 });

  function withDir(text: string, dir: GrowDir, children: EditableNode[] = []): EditableNode {
    return { ...makeTextNode(text, children), note: { dir } };
  }

  it('★ up 与 down 的父子层距相等（对称，不再一远一近）', () => {
    const down = layoutMindmapBranched(
      makeTextNode('根', [withDir('子', 'down')]),
      fixed,
      new Set(),
    );
    const up = layoutMindmapBranched(makeTextNode('根', [withDir('子', 'up')]), fixed, new Set());
    const rootDown = boxOf(down, down.nodes[0]!.node.id);
    const childDown = boxOf(down, down.nodes[1]!.node.id);
    const rootUp = boxOf(up, up.nodes[0]!.node.id);
    const childUp = boxOf(up, up.nodes[1]!.node.id);

    const gapDown = childDown.y - (rootDown.y + rootDown.h);
    const gapUp = rootUp.y - (childUp.y + childUp.h);
    expect(gapDown).toBeGreaterThan(0);
    expect(gapUp).toBeGreaterThan(0);
    expect(gapUp).toBe(gapDown); // 对称：核心回归点
  });

  it('up 子节点完全位于父上方，且与父不重叠', () => {
    const res = layoutMindmapBranched(makeTextNode('根', [withDir('子', 'up')]), fixed, new Set());
    const root = boxOf(res, res.nodes[0]!.node.id);
    const child = boxOf(res, res.nodes[1]!.node.id);
    expect(child.y + child.h).toBeLessThan(root.y);
  });

  it('★ 多层 up：各层层距一致（不因层级加深而变远）', () => {
    const grand = withDir('孙', 'up');
    const child = withDir('子', 'up', [grand]);
    const res = layoutMindmapBranched(makeTextNode('根', [child]), fixed, new Set());
    const [r, c, g] = res.nodes;
    const gap1 = r!.box.y - (c!.box.y + c!.box.h);
    const gap2 = c!.box.y - (g!.box.y + g!.box.h);
    expect(gap1).toBe(gap2);
  });

  it('up + down 同存：两侧层距对称', () => {
    const res = layoutMindmapBranched(
      makeTextNode('根', [withDir('上子', 'up'), withDir('下子', 'down')]),
      fixed,
      new Set(),
    );
    const root = boxOf(res, res.nodes[0]!.node.id);
    const up = boxOf(res, res.nodes[1]!.node.id);
    const down = boxOf(res, res.nodes[2]!.node.id);
    const gapUp = root.y - (up.y + up.h);
    const gapDown = down.y - (root.y + root.h);
    expect(gapUp).toBe(gapDown);
  });

  it('up/down 组水平并排：子间距与经典 org（SUB_GAP）一致', () => {
    const res = layoutMindmapBranched(
      makeTextNode('根', [withDir('A', 'down'), withDir('B', 'down')]),
      fixed,
      new Set(),
    );
    const a = boxOf(res, res.nodes[1]!.node.id);
    const b = boxOf(res, res.nodes[2]!.node.id);
    expect(b.x).toBeGreaterThan(a.x + a.w); // 并排不重叠
    expect(b.x - (a.x + a.w)).toBe(28); // SUB_GAP
  });
});

/**
 * hub 标记的容错读取（v1.8.x 修复 · 存档重开即静默失效）。
 *
 * `.mm.md` 的标量经 parseMm 一律是**字符串**（`hub: true` 读回 `'true'`，与 len/lens 同源），
 * 而 hub 的两处判定曾用严格 `=== true`：存盘再打开后内核侧 hub 全线失效——左右组回贝塞尔
 * （渲染层仍按 readHubFlag 画共享竖梁 → 两端几何不一致）、纵向闸门钳制不执行。
 * 判据统一走 readHubFlag：布尔 `true` 与字符串 `'true'` 必须等价。
 */
describe('hub 标记容错读取（字符串 "true" 与布尔 true 等价）', () => {
  /** 枢纽夹具：根 → 枢纽（note.hub = flag）→ 右子（继承枢纽的 right） */
  function hubFixture(flag: unknown) {
    const right = makeTextNode('右子');
    const hub = makeTextNode('枢纽', [right]);
    // Note.hub 声明是 boolean，但解析侧不收敛类型（`hub: true` 读回字符串）——按宽形状直写
    const note: Record<string, unknown> = { dir: 'right' };
    if (flag !== undefined) note.hub = flag;
    hub.note = note;
    const root = makeTextNode('根', [makeTextNode('前置'), hub]);
    return { root, hub, right };
  }
  const pathTo = (res: LayoutResult, to: EditableNode): string =>
    String(res.links.find((l) => l.toId === to.id)?.path);

  it('★ hub: "true"（存档形态）与 hub: true（会话形态）产出同一条共享竖梁线', () => {
    const archived = hubFixture('true');
    const live = hubFixture(true);
    const pArchived = pathTo(
      layoutMindmapBranched(archived.root, measure, new Set()),
      archived.right,
    );
    const pLive = pathTo(layoutMindmapBranched(live.root, measure, new Set()), live.right);
    expect(pArchived).not.toBe('');
    expect(pArchived).toBe(pLive); // 容错等价：两种形态同一条线
    expect(pArchived).not.toContain('C'); // hub 左右组 = 共享竖梁（正交），不是贝塞尔
  });

  it('回归闸门：未标记 hub 的左右组仍是贝塞尔（老文档一根线不变）', () => {
    const plain = hubFixture(undefined);
    expect(pathTo(layoutMindmapBranched(plain.root, measure, new Set()), plain.right)).toContain(
      'C',
    );
  });

  it('★ 纵向闸门钳制同样认字符串 "true"（左右组避开上下组）', () => {
    // 夹具：枢纽（3 个右子拉开纵向跨度）+ 一个「宽下子」（横跨竖梁 x 且上缘顶到梁高程带）
    // → clampBeamGroupVertical 应当把右组沿 y 平移；无 hub 则不钳制。
    const build = (flag: unknown) => {
      const leaves = (prefix: string, n: number) =>
        Array.from({ length: n }, (_, i) => makeTextNode(`${prefix}${i}`));
      const hub = makeTextNode('枢纽', [
        ...leaves('右', 3),
        { ...makeTextNode('下子', leaves('孙', 3)), note: { dir: 'down' as GrowDir } },
      ]);
      const note: Record<string, unknown> = { dir: 'right' };
      if (flag !== undefined) note.hub = flag;
      hub.note = note;
      return makeTextNode('根', [hub]);
    };
    const rightYs = (flag: unknown): number[] => {
      const res = layoutMindmapBranched(build(flag), measure, new Set());
      const hubId = res.nodes.find((n) => n.node.text === '枢纽')!.node.id;
      return res.nodes.filter((n) => n.parentId === hubId && n.node.text?.startsWith('右'))
        .map((n) => n.box.y);
    };
    const noHub = rightYs(undefined);
    const live = rightYs(true);
    const archived = rightYs('true');
    expect(archived).toEqual(live); // 容错等价：串/布产生同一布局
    expect(archived).not.toEqual(noHub); // 且钳制确实生效（否则本用例空转）
  });
});

/**
 * 单成员方向组：中心连线笔直（用户裁决）。
 *
 * 旧口径一律「按**子树包围盒**在父中线居中」：单子节点只要自己的子树不对称
 * （例如它挂了 up 分支），子盒就被推离父中线，连线被迫斜成 S 弯。
 * 新口径：**该方向组只有单个成员时按子节点盒居中** —— 二者连线笔直；子树的不对称
 * 部分交给消解 / 钳制 / 出边外推去避让与延长。多成员组保持子树包围盒居中
 * （兄弟不重叠 + 整侧平衡）。
 *
 * 真实场景（用户文档）：section 根只有一个右子（枢纽），枢纽自己挂着 up 分支 ⇒
 * 旧口径下根→枢纽这条线竖直错位 83px 斜弯；新口径下二者盒心同高、线是笔直的。
 */
describe('单成员方向组：中心连线笔直（子树不对称交给避让）', () => {
  const fixed = (n: EditableNode) => ({ w: (n.text?.length ?? 1) * 10 + 20, h: 30 });
  const asDir = (text: string, dir: GrowDir, children: EditableNode[] = []): EditableNode => ({
    ...makeTextNode(text, children),
    note: { dir },
  });
  /** 子树包围盒（纵向；多成员回归断言用） */
  const subBBoxY = (ln: LayoutNode): { minY: number; maxY: number } => {
    let r = { minY: ln.box.y, maxY: ln.box.y + ln.box.h };
    for (const c of ln.children) {
      const b = subBBoxY(c);
      r = { minY: Math.min(r.minY, b.minY), maxY: Math.max(r.maxY, b.maxY) };
    }
    return r;
  };

  it('★ right 组单子（枢纽挂着 up 分支）→ 父盒心与子盒心同高', () => {
    // 子 = 枢纽（存档形态的字符串标记也算），它自己挂一个 up 分支 ⇒ 子树竖直不对称
    const hubNote: Record<string, unknown> = { dir: 'right', hub: 'true' };
    const hub: EditableNode = { ...makeTextNode('枢纽', [asDir('上分支', 'up')]), note: hubNote };
    const res = layoutMindmapBranched(makeTextNode('根', [hub]), fixed, new Set());
    const p = boxOf(res, res.nodes[0]!.node.id);
    const c = boxOf(res, res.nodes[1]!.node.id);
    expect(c.y + c.h / 2).toBeCloseTo(p.y + p.h / 2, 6);
  });

  it('★ up 组单子（子挂着 right 分支）→ 父盒心与子盒心同列', () => {
    const child = asDir('子', 'up', [asDir('右分支', 'right')]);
    const res = layoutMindmapBranched(makeTextNode('根', [child]), fixed, new Set());
    const p = boxOf(res, res.nodes[0]!.node.id);
    const c = boxOf(res, res.nodes[1]!.node.id);
    expect(c.x + c.w / 2).toBeCloseTo(p.x + p.w / 2, 6);
  });

  it('回归：多成员组仍按子树包围盒居中（兄弟子树上下不重叠）', () => {
    const mk = (id: string, withUp: boolean): EditableNode =>
      asDir(id, 'right', withUp ? [asDir(`${id}上`, 'up')] : []);
    const res = layoutMindmapBranched(
      makeTextNode('根', [mk('甲', true), mk('乙', false)]),
      fixed,
      new Set(),
    );
    const parentId = res.nodes[0]!.node.id;
    const kids = res.nodes.filter((n) => n.parentId === parentId);
    expect(kids).toHaveLength(2);
    const a = subBBoxY(kids[0]!);
    const b = subBBoxY(kids[1]!);
    expect(a.maxY).toBeLessThanOrEqual(b.minY); // 上下堆叠不重叠
  });
});
