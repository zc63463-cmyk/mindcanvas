// @vitest-environment jsdom
/**
 * S2 · 摘要两跳交互（画布装配契约）—— **辅助模型证据（hook 级）**。
 *
 * ⚠️ 真实接线的证明不在本文件：本文件驱动的是 `apps/canvas/src/hooks/useSummaryHop.ts`
 * （生产与测试**消费同一份**实现，R3-(a) 的共同消费点），但它**不挂载 `MindmapStage`**
 * —— 因此「`onNodeClick` 首判的位置与顺序真的接上了」这条契约由
 * `summary-two-hop-host.test.tsx`（真挂载，R3-(b)）守。
 *
 * R2/R3 修复前，本文件内联复刻了整条状态机（自述「逐字同序的首判链」）—— 那一份是
 * **复制体**，生产接线改了它不会红。现在复制体已删除：本文件直接 `import { useSummaryHop }`。
 *
 * 覆盖（任务书 §六 + §七 12–23）：
 *  - 菜单 action 缺省 → 不显示；提供 → 显示「创建摘要…」；
 *  - 第一跳（`onStartSummary`）→ 进入 `draft` 等待态 + 引导文案；
 *  - 第二跳合法末成员 → 建摘要节点并**选中**；
 *  - **点回起点 = 单成员摘要**（设计稿 §4.5 合法，R1 修复支撑）；
 *  - 第二跳非法（跨父 / 根 / 倒序）→ **不创建、保留草稿、给提示**；
 *  - 点空白 / Esc → 清草稿；
 *  - **文档替换令牌变化 → 草稿失效**（R2 的复位信号）；
 *  - 创建失败 → 不留半成品（树 / cid / 历史）；
 *  - **既有 Shift 连线路径不被改变**（同一 `onNodeClick` 首判的回归保护）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useState } from 'react';
import {
  contextMenuItemsFor,
  EditorController as Controller,
  type EditorController,
  type SummaryMenuActions,
} from '@mindcanvas/react';
import {
  astToEditable,
  makeTextNode,
  resolveSummaries,
  summaryOf,
  type EditableNode,
} from '@mindcanvas/kernel';
import { makeSummaryActions } from '../src/nodeMenuBags.js';
import { useSummaryHop, type SummaryDraft } from '../src/hooks/useSummaryHop.js';

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 根下 A B C D；A 下有 F（跨父用） */
function buildController(): EditorController {
  const built = astToEditable(
    makeTextNode('根', [
      makeTextNode('A', [makeTextNode('F')]),
      makeTextNode('B'),
      makeTextNode('C'),
      makeTextNode('D'),
    ]),
  );
  if (built === null) throw new Error('fixture broken');
  return new Controller(built);
}

function idOf(root: EditableNode, text: string): string {
  let hit: string | undefined;
  const walk = (n: EditableNode): void => {
    if (n.text === text) hit = n.id;
    n.children.forEach(walk);
  };
  walk(root);
  if (hit === undefined) throw new Error(`fixture broken: ${text}`);
  return hit;
}

/** Probe 对外暴露的完整读写口（= 生产 hook 的返回值 + 宿主侧接线结果） */
interface ProbeHandle {
  controller: EditorController;
  draft: SummaryDraft | null;
  commandNotice: string | null;
  linkCalls: number;
  start: (id: string) => void;
  completeAt: (id: string) => boolean;
  cancel: () => void;
  hasDraft: () => boolean;
  /** 宿主侧 onNodeClick 首判链（S2 分支 → E7 Shift → 选择） */
  clickNode: (id: string, mods?: { shift?: boolean }) => boolean;
}

/**
 * 挂载**生产 hook**（`useSummaryHop`）并拿到实时读写口。
 *
 * 为什么用 ref 回写：`act()` 触发重渲染后，闭包变量存的是**首次渲染**的快照
 * （`draft` 会永远是 null）。每次渲染把最新 hook 返回值写进 ref，断言时经 getter
 * 读 ref 才是当前状态。
 *
 * `replaceDocument()` 模拟「文档被整体替换」（令牌 +1）：生产由 `useDocumentSwitch`
 * 在 `doc.source` 变化时经 `bumpDocumentToken` 调用 —— 见 `hooks/useDocumentToken.ts`。
 */
function mount() {
  const ref: { current: ProbeHandle | null } = { current: null };
  let replaceDocument: () => void = () => {
    throw new Error('probe not mounted');
  };
  function Probe() {
    const [token, setToken] = useState(0);
    const [notice, setNotice] = useState<string | null>(null);
    const [controller] = useState(() => buildController());
    const [linkCalls, setLinkCalls] = useState(0);
    const hop = useSummaryHop({ controller, setCommandNotice: setNotice, draftResetToken: token });
    const clickNode = (toId: string, mods?: { shift?: boolean }): boolean => {
      // ── S2 首判（生产：onNodeClick 第一段；闸门 = hook 的同步真理源）──
      if (hop.hasDraft()) {
        const done = hop.completeAt(toId);
        if (done) return true;
      }
      // ── E7 Shift 连线（既有路径；仅草稿为空时可达）──
      if (mods?.shift && controller.selectedId && controller.selectedId !== toId) {
        setLinkCalls((n) => n + 1);
        controller.select(toId);
        return true;
      }
      controller.select(toId);
      return false;
    };
    ref.current = {
      controller,
      draft: hop.draft,
      commandNotice: notice,
      linkCalls,
      start: hop.start,
      completeAt: hop.completeAt,
      cancel: hop.cancel,
      hasDraft: hop.hasDraft,
      clickNode,
    };
    replaceDocument = () => setToken((n) => n + 1);
    return null;
  }
  render(<Probe />);
  if (ref.current === null) throw new Error('hook not mounted');
  const get = (): ProbeHandle => {
    if (ref.current === null) throw new Error('hook unmounted');
    return ref.current;
  };
  return {
    get controller() {
      return get().controller;
    },
    get draft() {
      return get().draft;
    },
    get commandNotice() {
      return get().commandNotice;
    },
    get linkCalls() {
      return get().linkCalls;
    },
    start: (id: string) => act(() => get().start(id)),
    clickNode: (id: string, mods?: { shift?: boolean }) => act(() => get().clickNode(id, mods)),
    blank: () => act(() => get().cancel()),
    esc: () => act(() => get().cancel()),
    /** 模拟「文档被整体替换」：令牌 +1（生产由 useDocumentSwitch 触发） */
    replaceDocument: () => act(() => replaceDocument()),
  };
}

/* ─────────────────── 菜单入口 ─────────────────── */

describe('摘要菜单入口（画布装配）', () => {
  function menuItems(c: EditorController, id: string, actions?: SummaryMenuActions) {
    return contextMenuItemsFor(
      c,
      id,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      actions,
    );
  }

  it('未注入 summaryActions → 菜单无「创建摘要…」', () => {
    const c = buildController();
    expect(menuItems(c, idOf(c.root, 'A')).find((i) => i.label === '创建摘要…')).toBeUndefined();
  });

  it('注入 summaryActions → 出现「创建摘要…」，点击只发起第一跳', () => {
    const c = buildController();
    const onStartSummary = vi.fn();
    const items = menuItems(c, idOf(c.root, 'A'), { onStartSummary });
    const item = items.find((i) => i.label === '创建摘要…');
    expect(item).toBeDefined();
    const onSelect = item?.onSelect;
    if (!onSelect) throw new Error('expected onSelect');
    onSelect();
    expect(onStartSummary).toHaveBeenCalledWith(idOf(c.root, 'A'));
    // 单跳：菜单点击本身不建节点
    expect(resolveSummaries(c.root)).toHaveLength(0);
  });

  it('根节点无该入口', () => {
    const c = buildController();
    expect(
      menuItems(c, c.root.id, { onStartSummary: vi.fn() }).find((i) => i.label === '创建摘要…'),
    ).toBeUndefined();
  });

  it('makeSummaryActions 把宿主回调原样接通', () => {
    const seen: string[] = [];
    const actions = makeSummaryActions({
      setDescEditingId: () => undefined,
      setPinnedNotePath: () => undefined,
      onStartSummary: (id) => seen.push(id),
    });
    actions.onStartSummary('n1');
    expect(seen).toEqual(['n1']);
  });
});

/* ─────────────────── 两跳状态机（生产 hook） ─────────────────── */

describe('摘要两跳状态机（生产 useSummaryHop）', () => {
  it('第一跳进入等待态，提示要求「末成员 + 同一父级」', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    expect(h.draft?.fromId).toBe(idOf(h.controller.root, 'A'));
    expect(h.commandNotice).toContain('末成员');
    expect(h.commandNotice).toContain('同一父级');
  });

  it('第二跳合法末成员 → 建摘要并选中；草稿清空', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.clickNode(idOf(h.controller.root, 'C'));
    expect(h.draft).toBeNull();
    expect(h.commandNotice).toBeNull();
    const resolved = resolveSummaries(h.controller.root);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    // 选中新摘要节点
    expect(h.controller.selectedId).toBe(resolved[0]?.summaryNodeId);
    // 成员是 A B C
    const texts = (resolved[0]?.memberIds ?? []).map(
      (id) => (id === h.controller.root.id ? '根' : nodeText(h.controller.root, id)),
    );
    expect(texts).toEqual(['A', 'B', 'C']);
  });

  it('第二跳跨父 → 不创建、保留草稿、给 command notice', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.clickNode(idOf(h.controller.root, 'F'));
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
    expect(h.draft).not.toBeNull(); // 草稿保留
    expect(h.commandNotice).toContain('创建摘要未完成');
    expect(h.commandNotice).toContain('同一父级');
  });

  it('第二跳为倒序 → 不创建、保留草稿、给提示', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'C'));
    h.clickNode(idOf(h.controller.root, 'A'));
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
    expect(h.draft).not.toBeNull();
    expect(h.commandNotice).toContain('起点在终点之后');
  });

  it('第二跳点到根 → 不创建、保留草稿、给提示', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.clickNode(h.controller.root.id);
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
    expect(h.draft).not.toBeNull();
    expect(h.commandNotice).toContain('文档根');
  });

  /**
   * 产品语义校正（R2/R3 本轮）：点回起点 = **单成员摘要**，合法。
   *
   * 设计稿 §4.5「单击同一节点 = 单成员摘要（允许）」；S1 数据层契约亦为「单成员
   * `from==to` 合法」。此前 S2 的「始终拒绝」是新增限制，且会把 R1 的数据层缺陷
   * （单成员两端各分配一个 cid → 创建即 dangling）用 UI 拒绝掩盖。本轮按契约接通：
   * 点回起点必须真的建出**一条 well-formed、成员恰为该节点**的摘要。
   */
  it('点回起点 → 建单成员摘要（well-formed，成员恰为该节点），草稿清空', () => {
    const h = mount();
    const a = idOf(h.controller.root, 'A');
    h.start(a);
    h.clickNode(a);
    const resolved = resolveSummaries(h.controller.root);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.state).toBe('well-formed');
    expect(resolved[0]?.memberIds).toEqual([a]);
    expect(h.draft).toBeNull();
    expect(h.commandNotice).toBeNull();
    expect(h.controller.selectedId).toBe(resolved[0]?.summaryNodeId);
  });

  it('点空白清草稿', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.blank();
    expect(h.draft).toBeNull();
    expect(h.commandNotice).toBeNull();
    expect(h.controller.selectedId).toBeNull();
  });

  it('Esc 清草稿', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.esc();
    expect(h.draft).toBeNull();
    expect(h.commandNotice).toBeNull();
  });

  it('非法第二跳后仍可用合法点击完成（草稿未丢）', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.clickNode(idOf(h.controller.root, 'F')); // 跨父，被拒
    expect(h.draft).not.toBeNull();
    h.clickNode(idOf(h.controller.root, 'B')); // 合法
    expect(h.draft).toBeNull();
    expect(resolveSummaries(h.controller.root)).toHaveLength(1);
  });

  it('取消后再次启动不复用旧 fromId（新草稿覆盖旧起点）', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.esc();
    h.start(idOf(h.controller.root, 'C'));
    expect(h.draft?.fromId).toBe(idOf(h.controller.root, 'C'));
    h.clickNode(idOf(h.controller.root, 'D'));
    const resolved = resolveSummaries(h.controller.root);
    expect(resolved).toHaveLength(1);
    const texts = (resolved[0]?.memberIds ?? []).map((id) => nodeText(h.controller.root, id));
    expect(texts).toEqual(['C', 'D']);
  });

  it('重复在同一 range 完成后再次启动 → 两条独立摘要（两次事务）', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.clickNode(idOf(h.controller.root, 'B'));
    h.start(idOf(h.controller.root, 'A'));
    h.clickNode(idOf(h.controller.root, 'B'));
    expect(resolveSummaries(h.controller.root)).toHaveLength(2);
    // 各自一条 undo（不在同一事务里）
    expect(h.controller.undo()).toBe(true);
    expect(resolveSummaries(h.controller.root)).toHaveLength(1);
  });

  it('同一 tick 内重复点击只产生一个事务（草稿在第一次点击即被消费）', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    const b = idOf(h.controller.root, 'B');
    act(() => {
      h.clickNode(b);
      h.clickNode(b); // 草稿已清 → 第二次退化为普通选择，不再建摘要
    });
    expect(resolveSummaries(h.controller.root)).toHaveLength(1);
  });

  it('创建失败不留半成品：无节点、无 cid、无历史', () => {
    const h = mount();
    const c = h.controller;
    h.start(idOf(c.root, 'A'));
    h.clickNode(idOf(c.root, 'F')); // 跨父 → 计划阶段即拒
    expect(resolveSummaries(c.root)).toHaveLength(0);
    expect(c.canUndo).toBe(false);
    // 端点 cid 未被补发（零部分写入）
    expect(summaryOf(c.root.children[0]?.note)).toBeUndefined();
    expect(summaryOf(c.root.children[1]?.note)).toBeUndefined();
  });
});

/* ─────────────────── R2：文档替换使草稿失效 ─────────────────── */

describe('R2 · 文档替换使摘要草稿失效', () => {
  it('文档替换令牌变化 → 草稿清空、等待态提示清空', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    expect(h.draft).not.toBeNull();
    h.replaceDocument();
    expect(h.draft).toBeNull();
    expect(h.commandNotice).toBeNull();
  });

  it('替换后第一次普通点击正常选择（不被旧草稿吞掉）', () => {
    const h = mount();
    h.start(idOf(h.controller.root, 'A'));
    h.replaceDocument();
    h.clickNode(idOf(h.controller.root, 'B'));
    // 关键：选中真的发生了（旧实现下这次点击被摘要首判吞掉）
    expect(h.controller.selectedId).toBe(idOf(h.controller.root, 'B'));
    // 且没有建出任何摘要（旧草稿的 fromId 不该落到写路径）
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
  });

  it('替换后点击旧起点的同 id 节点也不建摘要（同 id 碰撞不得沿用旧草稿）', () => {
    const h = mount();
    const a = idOf(h.controller.root, 'A');
    h.start(a);
    h.replaceDocument();
    h.clickNode(a); // 同 id 存在（同内容替换的典型形态）
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
    expect(h.controller.selectedId).toBe(a);
  });

  it('替换后 Shift+点击走既有连线分支（草稿不再挡路）', () => {
    const h = mount();
    const a = idOf(h.controller.root, 'A');
    const b = idOf(h.controller.root, 'B');
    h.start(a);
    h.replaceDocument();
    h.clickNode(a);
    h.clickNode(b, { shift: true });
    expect(h.linkCalls).toBe(1);
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
  });
});

/* ─────────────────── Shift 连线回归 ─────────────────── */

describe('既有 Shift 连线路径不被改变', () => {
  it('无草稿时 Shift+点击仍走连线分支（原行为）', () => {
    const h = mount();
    const a = idOf(h.controller.root, 'A');
    const b = idOf(h.controller.root, 'B');
    act(() => h.controller.select(a));
    h.clickNode(b, { shift: true });
    expect(h.linkCalls).toBe(1);
    expect(h.controller.selectedId).toBe(b);
    // 未创建任何摘要
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
  });

  it('草稿存在时点击被摘要消费（不触发连线），草稿清空后连线恢复', () => {
    const h = mount();
    const a = idOf(h.controller.root, 'A');
    const b = idOf(h.controller.root, 'B');
    h.start(a);
    h.clickNode(b, { shift: true }); // 被摘要消费
    expect(h.linkCalls).toBe(0);
    expect(resolveSummaries(h.controller.root)).toHaveLength(1);
    // 草稿已清 → Shift 连线恢复
    act(() => h.controller.select(a));
    h.clickNode(b, { shift: true });
    expect(h.linkCalls).toBe(1);
  });

  it('普通点击（无 shift 无草稿）仍是选择，不建摘要', () => {
    const h = mount();
    const b = idOf(h.controller.root, 'B');
    h.clickNode(b);
    expect(h.controller.selectedId).toBe(b);
    expect(h.linkCalls).toBe(0);
    expect(resolveSummaries(h.controller.root)).toHaveLength(0);
  });
});

/* ─────────────────── helpers ─────────────────── */

function nodeText(root: EditableNode, id: string): string {
  let out = '';
  const walk = (n: EditableNode): void => {
    if (n.id === id) out = n.text ?? '';
    n.children.forEach(walk);
  };
  walk(root);
  return out;
}
