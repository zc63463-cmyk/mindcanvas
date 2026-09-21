/**
 * R1-1：锚引用迁移收敛到编辑管线。
 *
 * 契约（派遣计划 R1-A1/A2/A4）：
 * - 白名单 op（update-node 触及锚名 / move-node / add-child）在编辑管线内统一
 *   触发 planReferenceMigration：改名/缩进/反缩进/重排后边锚被重写且仍 well-formed
 *   （旧契约「改名 → dangling」在此反转——契约更新，强度不降）。
 * - 冲突（新路径不可唯一表示）→ 整批拒绝：root 未变、history 未变、信息可读。
 * - 迁移与结构 op 同一 history 条目：一次 undo 同时回滚文本与边锚。
 */
import { describe, expect, it, vi } from 'vitest';
import { astToEditable, makeEntityNode, makeTextNode, type EditableNode } from '@mindcanvas/kernel';
import { FrameScheduler } from '../src/render/scheduler.js';
import {
  collectFreeEdges,
  EditorController,
  type EdgeHealth,
  edgeHealthOf,
} from '../src/index.js';
import type { EditorControllerOptions } from '../src/edit/controller.js';

function ast(tree: EditableNode): EditableNode {
  const built = astToEditable(tree);
  if (built === null) throw new Error('fixture broken: astToEditable returned null');
  return built;
}

/** 真实控制器（node 环境无 rAF——同步 FrameScheduler，与 growdir-growth 同款） */
function makeController(root: EditableNode, opts: EditorControllerOptions = {}): EditorController {
  const frame = new FrameScheduler({
    raf: (cb) => {
      cb();
      return 1;
    },
    rafCancel: () => undefined,
  });
  return new EditorController(root, opts, frame);
}

function makeTree(): EditableNode {
  const root = ast(
    makeTextNode('根', [
      makeTextNode('任务', [makeTextNode('K3', [makeTextNode('K3子')]), makeTextNode('K4')]),
      makeTextNode('生活'),
    ]),
  );
  root.note = { edges: [{ from: 'node:根/任务', to: 'node:根/任务/K3', rel: 'relates-to' }] };
  return root;
}

function idOf(root: EditableNode, text: string): string {
  const found: string[] = [];
  const walk = (n: EditableNode): void => {
    if (n.text === text) found.push(n.id);
    n.children.forEach(walk);
  };
  walk(root);
  const hit = found[0];
  if (hit === undefined || found.length > 1) throw new Error(`fixture broken: ${text}`);
  return hit;
}

function edgeTexts(root: EditableNode): { from: string; to: string }[] {
  const raw = root.note?.edges;
  if (!Array.isArray(raw)) return [];
  const out: { from: string; to: string }[] = [];
  for (const e of raw) {
    if (typeof e === 'object' && e !== null && 'from' in e && 'to' in e) {
      const from = (e as { from?: unknown }).from;
      const to = (e as { to?: unknown }).to;
      if (typeof from === 'string' && typeof to === 'string') out.push({ from, to });
    }
  }
  return out;
}

/** 改名前后的原始对照（报告用：锚文本 + 三态） */
function edgeSnapshot(root: EditableNode): string {
  const e = edgeTexts(root)[0];
  const state = collectFreeEdges(root)[0]?.state ?? 'dropped';
  return `edges[0] = ${e ? `${e.from} → ${e.to}` : '(malformed)'}  |  state = ${state}`;
}

describe('R1-1 编辑管线内锚迁移：四类操作后边锚仍 well-formed', () => {
  it('改名（updateText）：边锚重写为新路径且 well-formed', () => {
    const controller = makeController(makeTree());
    const k3 = idOf(controller.root, 'K3');
    // 改名前对照
    expect(edgeSnapshot(controller.root)).toBe(
      'edges[0] = node:根/任务 → node:根/任务/K3  |  state = well-formed',
    );

    controller.updateText(k3, 'K33');

    // 改名后对照：锚文本已被重写（非 dangling）
    expect(edgeSnapshot(controller.root)).toBe(
      'edges[0] = node:根/任务 → node:根/任务/K33  |  state = well-formed',
    );
  });

  it('缩进（indent）：子路径锚随结构更新', () => {
    const controller = makeController(makeTree());
    const k4 = idOf(controller.root, 'K4');
    // 边先指到 K4（改写 to —— 经同一管线写边属未来批次，这里直接构造数据面）
    const root0 = controller.root;
    root0.note = { edges: [{ from: 'node:根/任务', to: 'node:根/任务/K4', rel: 'relates-to' }] };

    expect(controller.indent(k4)).toBe(true);

    expect(edgeTexts(controller.root)[0]).toEqual({ from: 'node:根/任务', to: 'node:根/任务/K3/K4' });
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
  });

  it('反缩进（outdent）：路径锚缩短且 well-formed', () => {
    const controller = makeController(makeTree());
    const k3 = idOf(controller.root, 'K3');
    const k3Child = idOf(controller.root, 'K3子');
    // 边指到 K3子（深路径）
    controller.root.note = {
      edges: [{ from: 'node:根/任务', to: 'node:根/任务/K3/K3子', rel: 'relates-to' }],
    };

    expect(controller.outdent(k3Child)).toBe(true);
    // K3子 上移一级后：K3 的路径未变，K3子 锚……outdent 的是 K3子 自己——
    // 它成为 任务 的后一兄弟，锚 = node:根/任务/K3子
    expect(k3).not.toBe('');
    expect(edgeTexts(controller.root)[0]).toEqual({
      from: 'node:根/任务',
      to: 'node:根/任务/K3子',
    });
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
  });

  it('重排（apply move-node）：跨父移动后边锚跟随新路径', () => {
    const controller = makeController(makeTree());
    const k3 = idOf(controller.root, 'K3');
    const rootId = controller.root.id;

    controller.apply({
      type: 'move-node',
      id: k3,
      targetParentId: rootId,
      index: controller.root.children.length,
    });

    expect(edgeTexts(controller.root)[0]).toEqual({ from: 'node:根/任务', to: 'node:根/K3' });
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
  });

  it('applyTransaction 批次（含 move-node）同样触发迁移', () => {
    const controller = makeController(makeTree());
    const k3 = idOf(controller.root, 'K3');
    const rootId = controller.root.id;

    const result = controller.applyTransaction([
      { type: 'move-node', id: k3, targetParentId: rootId, index: controller.root.children.length },
    ]);

    expect(result.ok).toBe(true);
    expect(edgeTexts(controller.root)[0]).toEqual({ from: 'node:根/任务', to: 'node:根/K3' });
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
  });

  it('新增同名实体（add-child）：既有裸实体锚重写为 #1 消歧且 well-formed', () => {
    const root = ast(
      makeTextNode('根', [makeTextNode('任务', [makeEntityNode({ kind: 'issue', id: '8' })])]),
    );
    root.note = { edges: [{ from: 'node:根/任务', to: '@issue:8', rel: 'relates-to' }] };
    const controller = makeController(root);
    const task = idOf(controller.root, '任务');

    controller.addEntityChild(task, { kind: 'issue', id: '8' });

    expect(edgeTexts(controller.root)[0]).toEqual({ from: 'node:根/任务', to: '@issue:8#1' });
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
  });
});

describe('R1-1 冲突：整批拒绝 + 可读信息（R1-A2）', () => {
  it('apply：改名撞同级同名 → 拒绝（root 未变、history 未变）+ 回调收到含冲突码的信息', () => {
    const onAnchorConflict = vi.fn();
    const controller = makeController(makeTree(), { onAnchorConflict });
    // 种子一条 history（证明冲突未入史：undo 撤的是种子）
    const life = idOf(controller.root, '生活');
    controller.updateText(life, '生活2');
    expect(controller.canUndo).toBe(true);

    const k3 = idOf(controller.root, 'K3');
    const before = controller.root;
    controller.updateText(k3, 'K4'); // 与同级 K4 撞名，且边锚指向 K3

    expect(controller.root).toBe(before); // root 未变
    expect(idOf(controller.root, 'K3')).toBe(k3); // 改名未生效
    controller.undo();
    expect(idOf(controller.root, '生活')).toBe(life);
    const lifeNode = controller.root.children.find((n) => n.text === '生活');
    expect(lifeNode).toBeDefined(); // undo 撤销的是种子动作 → 冲突批未入 history
    expect(onAnchorConflict).toHaveBeenCalledTimes(1);
    expect(String(onAnchorConflict.mock.calls[0]?.[0])).toContain('anchor-ambiguous-path');
    expect(String(onAnchorConflict.mock.calls[0]?.[0])).toContain('node:根/任务/K3');
  });

  it('applyTransaction：冲突 → ok:false（code=reference-conflict）且零副作用', () => {
    const controller = makeController(makeTree());
    const life = idOf(controller.root, '生活');
    controller.updateText(life, '生活2');
    const before = controller.root;

    const k3 = idOf(controller.root, 'K3');
    const result = controller.applyTransaction([
      { type: 'update-node', id: k3, patch: { text: 'K4' } },
    ]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('reference-conflict');
      expect(result.error.message).toContain('anchor-ambiguous-path');
    }
    expect(controller.root).toBe(before);
    controller.undo();
    const lifeNode = controller.root.children.find((n) => n.text === '生活');
    expect(lifeNode).toBeDefined(); // 撤的是种子 → 冲突批未入 history
  });
});

describe('R1-1 undo 契约：一次 Ctrl+Z 同时回滚文本与边锚', () => {
  it('改名 + 迁移后 undo：文本与边锚同回', () => {
    const controller = makeController(makeTree());
    const k3 = idOf(controller.root, 'K3');

    controller.updateText(k3, 'K33');
    expect(edgeTexts(controller.root)[0]?.to).toBe('node:根/任务/K33');

    expect(controller.undo()).toBe(true);

    const node = controller.root.children[0]?.children.find((n) => n.id === k3);
    expect(node?.text).toBe('K3');
    expect(edgeTexts(controller.root)[0]).toEqual({
      from: 'node:根/任务',
      to: 'node:根/任务/K3',
    });
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
  });
});

describe('R1-1 健康度联动（观测先行闭环）', () => {
  it('改名后 edgeHealthOf 无 dangling 病例', () => {
    const controller = makeController(makeTree());
    const k3 = idOf(controller.root, 'K3');
    controller.updateText(k3, 'K33');
    const health: EdgeHealth = edgeHealthOf(controller.root);
    expect(health.byState.dangling).toBe(0);
    expect(health.byState.stale).toBe(0);
    expect(health.problems).toEqual([]);
  });
});

describe('R1-2 结构编辑入口全枚举：操作后边锚存活（表驱动）', () => {
  /** 路径锚夹具：根[任务[K3[K3子], K4], 生活]，边 = 任务 → 任务/K3 */
  function makeFixture() {
    const controller = makeController(makeTree());
    const ids = {
      rootId: controller.root.id,
      task: idOf(controller.root, '任务'),
      k3: idOf(controller.root, 'K3'),
      k3Child: idOf(controller.root, 'K3子'),
      k4: idOf(controller.root, 'K4'),
    };
    return { controller, ids };
  }

  /** 重设边目标（数据面构造；表行各自关注不同端点） */
  function rewireEdge(controller: EditorController, to: string): void {
    controller.root.note = {
      edges: [{ from: 'node:根/任务', to, rel: 'relates-to' }],
    };
  }

  const pathCases: {
    name: string;
    run: (c: EditorController, ids: ReturnType<typeof makeFixture>['ids']) => void;
    edgeTo: string;
    expectTo: string | null;
  }[] = [
    {
      name: 'updateText 改名 → 锚重写',
      run: (c, ids) => c.updateText(ids.k3, 'K33'),
      edgeTo: 'node:根/任务/K3',
      expectTo: 'node:根/任务/K33',
    },
    {
      name: 'indent 缩进 → 子路径锚跟随',
      run: (c, ids) => {
        rewireEdge(c, 'node:根/任务/K4');
        c.indent(ids.k4);
      },
      edgeTo: 'node:根/任务/K4',
      expectTo: 'node:根/任务/K3/K4',
    },
    {
      name: 'outdent 反缩进 → 路径锚缩短',
      run: (c, ids) => {
        rewireEdge(c, 'node:根/任务/K3/K3子');
        c.outdent(ids.k3Child);
      },
      edgeTo: 'node:根/任务/K3/K3子',
      expectTo: 'node:根/任务/K3子',
    },
    {
      name: 'apply(move-node) 重排 → 跨父新路径',
      run: (c, ids) =>
        c.apply({ type: 'move-node', id: ids.k3, targetParentId: ids.rootId, index: c.root.children.length }),
      edgeTo: 'node:根/任务/K3',
      expectTo: 'node:根/K3',
    },
    {
      name: 'applyTransaction([move-node]) 批次重排 → 同样迁移',
      run: (c, ids) =>
        c.applyTransaction([
          { type: 'move-node', id: ids.k3, targetParentId: ids.rootId, index: c.root.children.length },
        ]),
      edgeTo: 'node:根/任务/K3',
      expectTo: 'node:根/K3',
    },
    {
      name: 'addSibling 新建同级 → 既有锚不受扰',
      run: (c, ids) => c.addSibling(ids.k3, 'K5'),
      edgeTo: 'node:根/任务/K3',
      expectTo: 'node:根/任务/K3',
    },
    {
      name: 'addChild 新建子节点 → 既有锚不受扰',
      run: (c, ids) => c.addChild(ids.task, '新节点'),
      edgeTo: 'node:根/任务/K3',
      expectTo: 'node:根/任务/K3',
    },
    {
      // 已知缺口（R1-A4 白名单只含 text patch）：kernel anchor-migrate 不支持
      // 路径锚→实体锚的重建+回验（migration-verify-failed）——转换后旧锚悬空，
      // 由 R0 健康度可见，留待后续批次；此行钉现状防无声回归。
      name: 'setEntityRef 转实体 → 已知缺口：锚不迁移（悬空可见）',
      run: (c, ids) => c.setEntityRef(ids.k3, { kind: 'issue', id: '8' }),
      edgeTo: 'node:根/任务/K3',
      expectTo: null,
    },
    {
      name: 'removeNode 删除被引用节点 → 悬空（偏差钉：删除不阻断，锚原样保留）',
      run: (c, ids) => c.removeNode(ids.k3),
      edgeTo: 'node:根/任务/K3',
      expectTo: null,
    },
  ];

  it.each(pathCases)('$name', ({ run, edgeTo, expectTo }) => {
    const { controller, ids } = makeFixture();
    rewireEdge(controller, edgeTo);
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed'); // 前置有效

    run(controller, ids);

    if (expectTo === null) {
      expect(edgeTexts(controller.root)[0]?.to).toBe(edgeTo); // 原样保留
      expect(collectFreeEdges(controller.root)[0]?.state).toBe('dangling');
    } else {
      expect(edgeTexts(controller.root)[0]?.to).toBe(expectTo);
      expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
    }
  });

  /** 实体锚夹具：根[任务[@issue:8]]，边 = 任务 → @issue:8 */
  function makeEntityFixture() {
    const root = ast(
      makeTextNode('根', [makeTextNode('任务', [makeEntityNode({ kind: 'issue', id: '8' })])]),
    );
    root.note = { edges: [{ from: 'node:根/任务', to: '@issue:8', rel: 'relates-to' }] };
    const controller = makeController(root);
    return { controller, task: idOf(controller.root, '任务') };
  }

  const entityCases: {
    name: string;
    run: (c: EditorController, task: string) => void;
    expectTo: string;
  }[] = [
    {
      name: 'addEntityChild 同名实体 → 裸锚重写为 #1 消歧',
      run: (c, task) => c.addEntityChild(task, { kind: 'issue', id: '8' }),
      expectTo: '@issue:8#1',
    },
  ];

  it.each(entityCases)('$name', ({ run, expectTo }) => {
    const { controller, task } = makeEntityFixture();
    run(controller, task);
    expect(edgeTexts(controller.root)[0]?.to).toBe(expectTo);
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
  });
});

describe('R1-3 契约分层：数据层旧锚 vs 管线编辑（dangling 语义边界）', () => {
  it('数据层：旧文件/外部手改的失效锚 → dangling 仍是正确语义（R1-1 不波及）', () => {
    const controller = makeController(makeTree());
    // 模拟外部手改/旧文件遗留：边锚指向不存在的路径（未经管线写入，
    // collectFreeEdges 按锚解析三态直判——该语义与 §1.7 第 22 条的保留清单一致）
    controller.root.note = {
      edges: [{ from: 'node:根/任务', to: 'node:根/任务/不存在', rel: 'relates-to' }],
    };
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('dangling');
    expect(edgeHealthOf(controller.root).byState.dangling).toBe(1);
  });

  it('管线层：同一契约下经 controller 改名 → 锚重写、不再 dangling（新契约）', () => {
    const controller = makeController(makeTree());
    const k3 = idOf(controller.root, 'K3');
    // R1-1 之前：改名后此处 dangling（旧契约）；之后：重写 + well-formed
    controller.updateText(k3, 'K33');
    expect(edgeTexts(controller.root)[0]?.to).toBe('node:根/任务/K33');
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
    expect(edgeHealthOf(controller.root).byState.dangling).toBe(0);
  });
});

describe('R2-0：remove-node 入白名单（tolerateMissingTargets 条件式启用）', () => {
  /** 夹具：同名实体 @issue:8 出现两次，边锚用 #2 精确指到第二个出现 */
  function makeDupEntityTree(): { controller: EditorController; first: string; second: string } {
    const root = ast(
      makeTextNode('根', [
        makeTextNode('任务', [makeEntityNode({ kind: 'issue', id: '8' })]),
        makeTextNode('生活', [makeEntityNode({ kind: 'issue', id: '8' })]),
      ]),
    );
    const first = root.children[0]?.children[0]?.id;
    const second = root.children[1]?.children[0]?.id;
    if (first === undefined || second === undefined) throw new Error('fixture broken');
    // 两条边：#2 指向幸存出现（漂移修复对象）；#1 指向将被删除的出现
    //（无 tolerate 时该引用 target-lost → 整批拒绝 → 阴性对照可观测）
    root.note = {
      edges: [
        { from: 'node:根/任务', to: '@issue:8#2', rel: 'relates-to' },
        { from: 'node:根/任务', to: '@issue:8#1', rel: 'relates-to' },
      ],
    };
    return { controller: makeController(root), first, second };
  }

  it('删重复实体的一个出现 → 其余实体的边锚迁移为裸锚、仍 well-formed（不再漂移）', () => {
    const { controller, first } = makeDupEntityTree();
    expect(edgeTexts(controller.root)[0]?.to).toBe('@issue:8#2');
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');

    controller.removeNode(first);

    expect(controller.canUndo).toBe(true); // 删除不被阻断
    // 唯一出现 → 规范锚回裸锚；#2 越界会被重写（R1 时代此处静默漂移为 stale）
    expect(edgeTexts(controller.root)[0]?.to).toBe('@issue:8');
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('well-formed');
    // 指向被删出现的边：降级保留原锚文本（不阻断、不写坏）；
    // 解析层会把 #1 重解析到幸存出现（既有 #N 定位语义，非迁移改写）
    expect(edgeTexts(controller.root)[1]?.to).toBe('@issue:8#1');
    // 整体：无 stale 漂移
    expect(edgeHealthOf(controller.root).byState.stale).toBe(0);
  });

  it('删被边引用的普通节点 → 删除不被阻断 + 该边悬空 + target-lost-kept 诊断可见（R0-4 通道）', () => {
    const onMigrationDiagnostics = vi.fn();
    const controller = makeController(makeTree(), { onMigrationDiagnostics });
    const k3 = idOf(controller.root, 'K3');
    const before = controller.root;

    controller.removeNode(k3);

    expect(controller.root).not.toBe(before); // 删除未阻断
    expect(controller.canUndo).toBe(true); // history 前进
    expect(controller.root.children[0]?.children.some((n) => n.id === k3)).toBe(false);
    // 被引用的边：锚原样保留 → 数据层悬空（R0 口径），target-lost-kept 诊断经通知通道上报
    expect(edgeTexts(controller.root)[0]).toEqual({
      from: 'node:根/任务',
      to: 'node:根/任务/K3',
    });
    expect(collectFreeEdges(controller.root)[0]?.state).toBe('dangling');
    expect(onMigrationDiagnostics).toHaveBeenCalledTimes(1);
    expect(String(onMigrationDiagnostics.mock.calls[0]?.[0])).toContain('target-lost-kept');
  });
});
