import { describe, expect, it } from 'vitest';
import {
  astToEditable,
  defaultMeasure,
  layoutMindmap,
  makeTextNode,
  parseMm,
} from '@mindcanvas/kernel';
import type { Box, GrowDir } from '@mindcanvas/kernel';
import { buildEditable, layoutDemo } from '../src/demo/pipeline.js';
import { THEMES } from '../src/theme/tokens.js';
import { cubicMidNormal } from '../src/render/EdgeLabel.js';
import { collectDeclaredGrowDir } from '../src/render/growDir.js';
import {
  beamYForGroup,
  buildLinkPath,
  computeBranchIndex,
  linkEndpoints,
  linkOrientation,
  lodFor,
  lodSkipText,
  nodeCardStyle,
  nodeHitTest,
  verticalBeamMap,
} from '../src/render/geometry.js';

const classic = THEMES.classic;
const sticker = THEMES.sticker;
const glass = THEMES.glass;

/** 真实管线夹具（与 growdir-pipeline.test.ts 同款）：buildEditable + layoutDemo */
function geomOf(markdown: string) {
  const parsed = parseMm(markdown).root;
  if (!parsed) throw new Error('解析失败：缺少根节点');
  const editable = astToEditable(parsed);
  if (!editable) throw new Error('astToEditable 返回空树');
  const { layout } = layoutDemo(editable, new Map(), (s: string) => s.length * 10);
  const boxes = new Map(layout.nodes.map((n) => [n.node.id, n.box]));
  return { layout, boxes };
}

describe('nodeCardStyle：节点卡片样式（全令牌驱动）', () => {
  it('classic 分支卡 = 分支色板；叶卡 = 分支 leaf 浅化变体', () => {
    const b = classic.color.branches[0]!;
    const card = nodeCardStyle(classic, b, 'branch');
    expect(card.fill).toBe('#fef2e4');
    expect(card.stroke).toBe('#d97706');
    expect(card.radius).toBe(9);
    const leaf = nodeCardStyle(classic, b, 'leaf');
    expect(leaf.fill).toBe('#fff7ec');
    expect(leaf.stroke).toBe('#e8a34e');
    expect(leaf.radius).toBe(8);
  });

  it('sticker 叶卡回退 leafDefault（橄榄贴）；分支卡带 drop-shadow', () => {
    const card = nodeCardStyle(sticker, sticker.color.branches[1], 'branch');
    expect(card.filter).toContain('drop-shadow');
    const leaf = nodeCardStyle(sticker, sticker.color.branches[1], 'leaf');
    expect(leaf.fill).toBe('#eaf3de');
    expect(leaf.stroke).toBe('#639922');
  });

  it('glass 分支卡半透明白；叶卡霓虹（对照 V8 SVG）', () => {
    const card = nodeCardStyle(glass, glass.color.branches[0], 'branch');
    expect(card.fill).toBe('rgba(255,255,255,.05)');
    expect(card.stroke).toBe('rgba(255,255,255,.18)');
    const leaf = nodeCardStyle(glass, glass.color.branches[0], 'leaf');
    expect(leaf.fill).toBe('rgba(122,233,196,.08)');
    expect(leaf.stroke).toBe('rgba(122,233,196,.35)');
  });

  it('实体节点按 KIND_META 语义色描边（跨主题一致）', () => {
    for (const t of [classic, sticker, glass]) {
      const card = nodeCardStyle(t, t.color.branches[0], 'branch', 'issue');
      expect(card.stroke).toBe('#d97706'); // KIND_META.issue
      expect(card.fill).toBe(t.color.entityFill);
      expect(card.text).toBe(t.color.entityText);
    }
  });

  it('缺色板时回退 branches[0]（根节点）', () => {
    const card = nodeCardStyle(classic, undefined, 'branch');
    expect(card.fill).toBe('#fef2e4');
  });
});

describe('buildLinkPath：连线语言分支', () => {
  const parent: Box = { x: 0, y: 0, w: 100, h: 40 };
  const child: Box = { x: 200, y: 0, w: 80, h: 30 };
  it('classic color-curve：注入分支色后描边=分支色，曲线=compactBezier', () => {
    const p = buildLinkPath(classic, parent, child, classic.color.branches[2]);
    expect(p.stroke).toBe('#0c8599');
    expect(p.d.startsWith('M ')).toBe(true);
    expect(p.d.includes('C ')).toBe(true);
  });

  it('sticker wavy：任意曲线为双弧 S 形（两个 C 段）', () => {
    const p = buildLinkPath(sticker, parent, child);
    expect(p.stroke).toBe('#c9c4b8'); // 灰连线
    const cCount = (p.d.match(/C /g) ?? []).length;
    expect(cCount).toBe(2);
  });

  it('glass soft：柔和贝塞尔，退避灰连线', () => {
    const p = buildLinkPath(glass, parent, child);
    // #646b7d：对 glass 底色 #16181d 约 3.4:1；旧值 #3a3f4d 仅 2.3:1，深色主题下连线近乎不可见
    expect(p.stroke).toBe('#646b7d');
    expect(p.width).toBe(1.2);
  });

  it('wavy 支持左侧反向（dir=-1）且以 M 开头', () => {
    const leftChild: Box = { x: -300, y: 10, w: 80, h: 30 };
    const p = buildLinkPath(sticker, child, leftChild);
    expect(p.d.startsWith('M ')).toBe(true);
  });
});

describe('buildLinkPath：四向生长方向感知（垂直 = 组织架构正交梁线）', () => {
  // 宽父（展开描述区/宽主题的常见形态）+ 偏置上子 —— 用户截图回归场景：
  // 旧实现连「父右缘中点 → 子左缘中点」，产生横扫整块画布的大弧线
  const wideParent: Box = { x: 0, y: 100, w: 400, h: 80 };

  it('★ up 子节点：父顶边中点→共享梁→子底边中点的正交折线（不再横扫右缘）', () => {
    const child: Box = { x: 50, y: 0, w: 100, h: 40 };
    const p = buildLinkPath(classic, wideParent, child);
    // beamY 缺省 = 两端中点 (100+40)/2 = 70；orthogonalPath 圆角 r=5
    expect(p.d).toBe('M 200 100 L 200 75 Q 200 70, 195 70 L 105 70 Q 100 70, 100 65 L 100 40');
  });

  it('★ down 子节点：父底边中点→梁→子顶边中点的正交折线', () => {
    const parent: Box = { x: 0, y: 0, w: 400, h: 80 };
    const child: Box = { x: 250, y: 200, w: 100, h: 40 };
    const p = buildLinkPath(classic, parent, child);
    expect(p.d).toBe('M 200 80 L 200 135 Q 200 140, 205 140 L 295 140 Q 300 140, 300 145 L 300 200');
  });

  it('★ 传入共享 beamY（分组梁）时梁高采用传入值（与内核 makeLinkByDir 公式一致）', () => {
    const child: Box = { x: 50, y: 0, w: 100, h: 40 };
    const p = buildLinkPath(classic, wideParent, child, undefined, { beamY: 85 });
    expect(p.d).toBe('M 200 100 L 200 90 Q 200 85, 195 85 L 105 85 Q 100 85, 100 80 L 100 40');
  });

  it('居中上子（无水平梁段）退化为直梁线：无 C 段、端点正确', () => {
    const child: Box = { x: 150, y: 0, w: 100, h: 40 };
    const p = buildLinkPath(classic, wideParent, child);
    expect(p.d.startsWith('M 200 100 ')).toBe(true);
    expect(p.d.endsWith('L 200 40')).toBe(true);
    expect(p.d.includes('C ')).toBe(false);
    expect(p.d.includes('Q ')).toBe(true);
  });

  it('wavy 语言垂直连线同样走梁线（形状与语言无关，仅描边色不同）', () => {
    const child: Box = { x: 50, y: 0, w: 100, h: 40 };
    const p = buildLinkPath(sticker, wideParent, child);
    expect(p.d.startsWith('M 200 100 ')).toBe(true);
    expect(p.d.endsWith('L 100 40')).toBe(true);
    expect(p.d.includes('C ')).toBe(false);
  });

  it('经典右子（x 区间不重叠）保持水平端点——旧布局零回归', () => {
    const parent: Box = { x: 0, y: 0, w: 100, h: 40 };
    const child: Box = { x: 200, y: 0, w: 80, h: 30 };
    const p = buildLinkPath(classic, parent, child);
    expect(p.d).toBe('M 100 20 C 140 21, 160 14, 200 15');
  });

  it('左子保持水平反向（x 不重叠优先于垂直判定）', () => {
    const parent: Box = { x: 0, y: 0, w: 100, h: 40 };
    const child: Box = { x: -300, y: 10, w: 80, h: 30 };
    const p = buildLinkPath(classic, parent, child);
    expect(p.d.startsWith('M 0 20 ')).toBe(true);
    expect(p.d.endsWith('-220 25')).toBe(true);
  });

  it('右子完全在父上方但 x 不重叠 → 仍水平（经典高子树不误判为垂直）', () => {
    const parent: Box = { x: 0, y: 100, w: 100, h: 40 };
    const child: Box = { x: 164, y: 0, w: 80, h: 30 };
    const p = buildLinkPath(classic, parent, child);
    expect(p.d.startsWith('M 100 120 ')).toBe(true);
    expect(p.d.endsWith(' 164 15')).toBe(true);
  });
});

describe('beamYForGroup / verticalBeamMap：垂直方向组共享梁（与内核公式一致）', () => {
  it('up 组：梁 = 父顶缘与最低子底缘的中点（多子共用一条梁）', () => {
    const parent: Box = { x: 0, y: 100, w: 400, h: 80 };
    // 子底缘分别 40 / 20 → max = 40 → beamY = (100+40)/2 = 70
    expect(beamYForGroup(parent, [{ x: 50, y: 0, w: 100, h: 40 }, { x: 250, y: -20, w: 100, h: 40 }], 'up')).toBe(70);
  });

  it('down 组：梁 = 父底缘与最高子顶缘的中点', () => {
    const parent: Box = { x: 0, y: 0, w: 400, h: 80 };
    // 子顶缘分别 200 / 220 → min = 200 → beamY = (80+200)/2 = 140
    expect(beamYForGroup(parent, [{ x: 50, y: 200, w: 100, h: 40 }, { x: 250, y: 220, w: 100, h: 40 }], 'down')).toBe(140);
  });

  it('verticalBeamMap：同父同向子树共享梁高；水平连线不入表', () => {
    const parent: Box = { x: 0, y: 100, w: 400, h: 80 };
    const upA = { fromId: 'p', from: parent, to: { x: 50, y: 0, w: 100, h: 40 } };
    const upB = { fromId: 'p', from: parent, to: { x: 250, y: -20, w: 100, h: 40 } };
    const rightC = { fromId: 'p', from: parent, to: { x: 500, y: 100, w: 80, h: 40 } };
    const map = verticalBeamMap([upA, upB, rightC]);
    expect(map.size).toBe(2);
    expect(map.get(upA)).toBe(70);
    expect(map.get(upB)).toBe(70);
    expect(map.has(rightC)).toBe(false);
  });

  it('linkEndpoints：垂直连线端点=父顶/底边中点 ↔ 子底/顶边中点', () => {
    const parent: Box = { x: 0, y: 100, w: 400, h: 80 };
    const upChild: Box = { x: 50, y: 0, w: 100, h: 40 };
    expect(linkEndpoints(parent, upChild)).toEqual({ sx: 200, sy: 100, ex: 100, ey: 40 });
    const downChild: Box = { x: 250, y: 200, w: 100, h: 40 };
    expect(linkEndpoints(parent, downChild)).toEqual({ sx: 200, sy: 180, ex: 300, ey: 200 });
  });
});

describe('cubicMidNormal：cubic 与正交梁线的标签定位', () => {
  it('cubic 路径：t=0.5 中点 + 法向朝上归一（既有行为不回归）', () => {
    const r = cubicMidNormal('M 0 0 C 10 0, 20 10, 30 10');
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(15);
    expect(r!.y).toBeCloseTo(5);
    expect(r!.ny).toBeLessThan(0);
  });

  it('★ 正交梁线路径（M/L/Q）：弧长中点落在水平梁段、法向朝上', () => {
    const d = 'M 200 100 L 200 75 Q 200 70, 195 70 L 105 70 Q 100 70, 100 65 L 100 40';
    const r = cubicMidNormal(d);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(150, 0);
    expect(r!.y).toBeCloseTo(70, 0);
    expect(r!.ny).toBeLessThan(0);
  });

  it('无法解析的路径 → null（既有容错不回归）', () => {
    expect(cubicMidNormal('M 1 1')).toBeNull();
    expect(cubicMidNormal('')).toBeNull();
  });
});

describe('左右方向全链路验证（真实管线布局 → 连线几何）', () => {
  /** 每条树边的水平台向断言：朝向、端点贴边、曲线形态、路径端点吻合 */
  function expectAllHorizontal(
    layout: ReturnType<typeof layoutDemo>['layout'],
    boxes: Map<string, Box>,
  ) {
    for (const ln of layout.links) {
      const parent = boxes.get(ln.fromId);
      const child = boxes.get(ln.toId);
      if (!parent || !child) throw new Error(`连线端点盒缺失：${ln.fromId} -> ${ln.toId}`);
      const msg = `边 ${ln.fromId}->${ln.toId}`;
      // ① 朝向：左右子树绝不误判为垂直（x 区间必然不重叠）
      const o = linkOrientation(parent, child);
      expect(o.kind, msg).toBe('horizontal');
      // ② 端点：贴父/子左右缘中点（而非顶底边）
      const { sx, sy, ex, ey } = linkEndpoints(parent, child);
      expect(sy, msg).toBe(parent.y + parent.h / 2);
      expect(ey, msg).toBe(child.y + child.h / 2);
      // ③ 路径：水平切线三次贝塞尔，M/C 段与端点精确吻合
      const p = buildLinkPath(classic, parent, child);
      expect(p.d.startsWith(`M ${sx} ${sy} `), msg).toBe(true);
      expect(p.d.endsWith(`${ex} ${ey}`), msg).toBe(true);
      expect(p.d.includes('C '), msg).toBe(true);
    }
  }

  it('★ 经典左右平衡文档：左侧分支连父左缘、右侧分支连父右缘', () => {
    const { layout, boxes } = geomOf('# 根\n\n- 分支A\n\n- 分支B\n');
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const a = layout.nodes.find((n) => n.node.text === '分支A')!;
    const b = layout.nodes.find((n) => n.node.text === '分支B')!;
    // 经典布局既有行为：A 右、B 左（growdir-pipeline 同款断言基础）
    expect(a.box.x).toBeGreaterThanOrEqual(root.box.x + root.box.w);
    expect(b.box.x + b.box.w).toBeLessThanOrEqual(root.box.x);
    // 端点方向逐边验证：右子取父右缘，左子取父左缘
    const pa = boxes.get(a.node.id)!;
    const pb = boxes.get(b.node.id)!;
    const pr = boxes.get(root.node.id)!;
    expect(linkEndpoints(pr, pa).sx).toBe(pr.x + pr.w); // A 在右 → 连父右缘
    expect(linkEndpoints(pr, pb).sx).toBe(pr.x); // B 在左 → 连父左缘
    expectAllHorizontal(layout, boxes);
  });

  it('★ dir:left 声明 + 深层左子树：分支布局下左右两侧全链路正确', () => {
    const { layout, boxes } = geomOf(
      '# 根\n\n<!--\ndir: left\n-->\n- 反方\n\n- 正方\n  - 正方子叶\n',
    );
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const left = layout.nodes.find((n) => n.node.text === '反方')!;
    const deep = layout.nodes.find((n) => n.node.text === '正方子叶')!;
    // 反方在根左侧；深层子叶随经典镜像布局继续向左长（经典 mindmap 惯例：
    // 左侧分支的子树整体向左生长，与 XMind 一致——growdir-pipeline 只锁了深度 1）
    expect(left.box.x + left.box.w).toBeLessThanOrEqual(root.box.x);
    const deepParent = layout.nodes.find((n) => n.node.text === '正方')!;
    expect(deep.box.x + deep.box.w).toBeLessThanOrEqual(deepParent.box.x);
    // 左侧镜像边：父左缘 → 子右缘
    expect(linkEndpoints(boxes.get(root.node.id)!, boxes.get(left.node.id)!).sx).toBe(root.box.x);
    expect(linkOrientation(boxes.get(root.node.id)!, boxes.get(left.node.id)!).kind).toBe(
      'horizontal',
    );
    expectAllHorizontal(layout, boxes);
  });
});

describe('声明方向覆盖几何判据（G6′ 用户回归：铺宽的上分支组）', () => {
  it('★ 声明 dir:up 的子节点即使被铺到父盒 x 区间之外，也走父顶边梁线', () => {
    const parent: Box = { x: 250, y: 300, w: 100, h: 60 };
    const farLeftChild: Box = { x: 0, y: 100, w: 100, h: 40 }; // 右缘 100 < 父左缘 250 → 无 x 重叠
    // 无声明 → 几何判据回退（旧行为）：误判水平 —— 锁死回退路径本身
    expect(linkOrientation(parent, farLeftChild).kind).toBe('horizontal');
    // 声明 up → 一律父顶边中心出发的梁线（beamY 缺省 = 两端中点 220）
    const p = buildLinkPath(classic, parent, farLeftChild, undefined, { dir: 'up' });
    expect(p.d).toBe('M 300 300 L 300 225 Q 300 220, 295 220 L 55 220 Q 50 220, 50 215 L 50 140');
  });

  it('声明 dir:left/right 恒为水平（盒子位置反常时声明优先于几何）', () => {
    const parent: Box = { x: 0, y: 100, w: 100, h: 40 };
    const aboveChild: Box = { x: 10, y: 0, w: 80, h: 40 }; // x 重叠 + 完全在上方 → 几何判垂直
    expect(linkOrientation(parent, aboveChild).kind).toBe('vertical');
    expect(linkOrientation(parent, aboveChild, 'left').kind).toBe('horizontal');
    expect(linkOrientation(parent, aboveChild, 'right').kind).toBe('horizontal');
    expect(linkOrientation(parent, aboveChild, 'down').kind).toBe('vertical');
  });

  it('verticalBeamMap 支持 dirOf：铺宽的上分支组外侧子节点并入共享梁', () => {
    const parent: Box = { x: 250, y: 300, w: 100, h: 60 };
    const upA = { fromId: 'p', from: parent, to: { x: 0, y: 100, w: 100, h: 40 } };
    const upB = { fromId: 'p', from: parent, to: { x: 500, y: 100, w: 100, h: 40 } };
    const classicC = { fromId: 'p', from: parent, to: { x: 600, y: 300, w: 80, h: 40 } };
    const dirOf = (l: typeof upA): GrowDir | undefined => (l === classicC ? undefined : 'up');
    // 无声明 → 纯几何：upA/upB 无 x 重叠 → 不入表（修复前外侧子节点被画成侧缘曲线的根源）
    expect(verticalBeamMap([upA, upB, classicC]).size).toBe(0);
    // 有声明 → 外侧子节点并入 up 组共享梁
    const map = verticalBeamMap([upA, upB, classicC], dirOf);
    expect(map.size).toBe(2);
    expect(map.get(upA)).toBe(220); // (父顶缘 300 + 最低子底缘 140) / 2
    expect(map.get(upB)).toBe(220);
    expect(map.has(classicC)).toBe(false);
  });

  it('★ 用户场景回归：四个上分支子节点铺得比父宽——全部从父顶边中心出发的梁线', () => {
    const { layout, boxes } = geomOf(
      '# 新节点\n\n<!--\ndir: up\n-->\n- 甲乙\n\n<!--\ndir: up\n-->\n- 丙丁\n\n<!--\ndir: up\n-->\n- 戊己\n\n<!--\ndir: up\n-->\n- 庚辛\n',
    );
    const parent = layout.nodes.find((n) => n.parentId === null)!;
    const kids = layout.nodes.filter((n) => n.parentId === parent.node.id);
    expect(kids.length).toBe(4);
    const pr = boxes.get(parent.node.id)!;
    let sawGeometricHorizontal = false;
    for (const k of kids) {
      const pb = boxes.get(k.node.id)!;
      // 回归对照：外侧子节点无 x 重叠 —— 纯几何判据会误判水平（修复前用户所见 bug）
      if (linkOrientation(pr, pb).kind === 'horizontal') sawGeometricHorizontal = true;
      // 声明 up → 一律父顶边中心出发的梁线
      expect(linkOrientation(pr, pb, 'up').kind).toBe('vertical');
      const p = buildLinkPath(classic, pr, pb, undefined, { dir: 'up' });
      expect(p.d.startsWith(`M ${pr.x + pr.w / 2} ${pr.y} `)).toBe(true);
      expect(p.d.includes('C ')).toBe(false);
    }
    expect(sawGeometricHorizontal).toBe(true); // 场景确实覆盖「铺出父盒」的形态
  });

  it('★ 中心特化回归：均衡模式下无声明左子的连线从根左缘出发（岛默认不得顶死右缘）', () => {
    // 用户场景：中心节点左右均衡（左侧/右侧锚定在经典基线），上方子节点声明 up。
    // 修复前：collectEffectiveGrowDir 把岛默认 'right' 当声明 → 左侧无声明子的连线
    // 从根【右缘】出发，横穿中心节点。
    const { layout, boxes } = geomOf(
      '# 根\n\n<!--\ndir: up\n-->\n- 上方\n\n- 左侧\n\n- 右侧\n',
    );
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const declared = collectDeclaredGrowDir(root.node);
    const leftKid = layout.nodes.find(
      (n) =>
        n.parentId === root.node.id &&
        n.node.text !== '上方' &&
        boxes.get(n.node.id)!.x + boxes.get(n.node.id)!.w <= root.box.x,
    );
    expect(leftKid).toBeDefined();
    // 无声明 → 不入声明表 → 几何自适应
    expect(declared.get(leftKid!.node.id)).toBeUndefined();
    const { sx } = linkEndpoints(root.box, boxes.get(leftKid!.node.id)!, declared.get(leftKid!.node.id));
    expect(sx).toBe(root.box.x); // 根【左缘】——而非右缘（修复前贯穿中心节点）
  });
});

describe('几何工具', () => {
  it('nodeHitTest：盒内命中 + pad 外扩', () => {
    const box: Box = { x: 10, y: 10, w: 100, h: 40 };
    expect(nodeHitTest(box, 60, 30)).toBe(true);
    expect(nodeHitTest(box, 5, 30)).toBe(false);
    expect(nodeHitTest(box, 5, 30, 6)).toBe(true);
  });

  it('computeBranchIndex：一级分支=自身序，深层继承', () => {
    const root = makeTextNode('root', [
      makeTextNode('b1', [makeTextNode('b1-1')]),
      makeTextNode('b2'),
    ]);
    const layout = layoutMindmap(root, defaultMeasure, new Set());
    const idx = computeBranchIndex(layout.nodes);
    expect(idx.get(root.id)).toBe(0);
    expect(idx.get(layout.nodes.find((n) => n.node.text === 'b1')!.node.id)).toBe(0);
    expect(idx.get(layout.nodes.find((n) => n.node.text === 'b1-1')!.node.id)).toBe(0);
    expect(idx.get(layout.nodes.find((n) => n.node.text === 'b2')!.node.id)).toBe(1);
  });

  it('LOD：阈值化简、省略叶文本', () => {
    expect(lodFor(1)).toBe('full');
    expect(lodFor(0.3)).toBe('detail');
    expect(lodFor(0.2)).toBe('skeleton');
    expect(lodSkipText('full', 3)).toBe(false);
    expect(lodSkipText('detail', 2)).toBe(true);
    expect(lodSkipText('detail', 1)).toBe(false);
    expect(lodSkipText('skeleton', 0)).toBe(true);
  });
});
