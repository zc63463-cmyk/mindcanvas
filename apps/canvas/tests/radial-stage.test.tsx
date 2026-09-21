/**
 * useRadialStage 行为测试（v1.8.0 Phase 2 深审补网）
 *
 * 为什么测它：环形菜单的纯逻辑已由 packages/react/tests/radial-actions.test.ts 锁住；
 * 但**接线层**（键盘意图分流、确认气泡生命周期、指针/滚轮守卫）此前无网——深审在这层
 * 审出五处问题（确认期换选中会删错节点 / 环开着 Tab 双触发 / 滚轮不撤环 / 蓄力期点击
 * 残留会话 / 气泡不随点击收起），本文件把这些行为钉死为回归基线。
 *
 * 环境：canvas 套件统一 jsdom + pretendToBeVisual:false（无 rAF）——蓄力弧的 rAF
 * 循环补最小实现（走假定时器），与 hold(250ms) / 确认(1600ms) 同钟推进。
 */
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RADIAL_IDLE, radialGeometryFor, subRingOf, subSeatCenterDeg, type RadialSubItem } from '@mindcanvas/react';
import { RadialStageOverlay, useRadialStage } from '../src/hooks/useRadialStage';
import type { RadialStage } from '../src/hooks/useRadialStage';

/** 造一个 keydown（宿主 MindmapStage.onKey 会把它转给 handleKey） */
function kd(k: string, over: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key: k, cancelable: true, bubbles: true, ...over });
}

function altUp(): void {
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' }));
}

function setup(
  sel: () => string | null = () => 'A',
  anchor: () => { x: number; y: number } = () => ({ x: 100, y: 100 }),
) {
  const setPreDir = vi.fn();
  const addChild = vi.fn();
  const editText = vi.fn();
  const removeNode = vi.fn();
  const openMenu = vi.fn();
  const { result } = renderHook(() =>
    useRadialStage({
      getSelectedId: sel,
      getAnchor: anchor,
      setPreDir,
      actions: { addChild, editText, removeNode, openMenu },
    }),
  );
  return { result, setPreDir, addChild, editText, removeNode, openMenu };
}

/** 驱动到「环已浮现」：Alt 按下（被消费）+ 越过 250ms 阈值 */
function openRing(r: { current: RadialStage }): void {
  let consumed = false;
  act(() => {
    consumed = r.current.handleKey(kd('Alt'));
  });
  expect(consumed).toBe(true);
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(r.current.state.phase).toBe('ring');
}

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom（pretendToBeVisual:false）无 rAF：补最小实现（蓄力进度弧用；走假定时器）
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
  vi.useRealTimers();
});

describe('useRadialStage · marking 双通道', () => {
  it('慢按 Alt 越阈值 → 出环；无高亮松键 → 关闭（不提交）', () => {
    const { result, addChild } = setup();
    act(() => {
      result.current.handleKey(kd('Alt'));
    });
    expect(result.current.state.phase).toBe('arming');
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.state.phase).toBe('ring');
    act(() => {
      altUp();
    });
    expect(result.current.state.phase).toBe('idle');
    expect(addChild).not.toHaveBeenCalled();
  });

  it('快击 Alt+方向键 → pre-dir（环永不浮现）；Tab 照常落画布消费预方向', () => {
    const { result, setPreDir } = setup();
    let tabConsumed = true;
    act(() => {
      result.current.handleKey(kd('Alt'));
      result.current.handleKey(kd('ArrowLeft'));
    });
    expect(setPreDir).toHaveBeenCalledWith('A', 'left');
    expect(result.current.state.phase).toBe('pre-dir');
    act(() => {
      vi.advanceTimersByTime(400); // tick 到达时已非 arming → 不出环
    });
    expect(result.current.state.phase).toBe('pre-dir');
    act(() => {
      tabConsumed = result.current.handleKey(kd('Tab'));
    });
    expect(tabConsumed).toBe(false); // 手势通道：Tab 落画布
    expect(result.current.state.phase).toBe('pre-dir');
  });

  it('环内方向键高亮 + 松键提交（add-child）', () => {
    const { result, addChild } = setup();
    openRing(result);
    act(() => {
      result.current.handleKey(kd('ArrowUp'));
    });
    expect(result.current.state.highlight).toBe('up');
    act(() => {
      altUp();
    });
    expect(addChild).toHaveBeenCalledWith('A');
  });
});

describe('useRadialStage · 键盘意图分流（深审修复）', () => {
  it('环开着按 Tab/Del → 被吞（防「环外快捷键 + 环内提交」双触发），环保持', () => {
    const { result, addChild, removeNode } = setup();
    openRing(result);
    let tab = false;
    let del = false;
    act(() => {
      tab = result.current.handleKey(kd('Tab'));
      del = result.current.handleKey(kd('Delete'));
    });
    expect(tab).toBe(true);
    expect(del).toBe(true);
    expect(result.current.state.phase).toBe('ring'); // 吞掉 ≠ 关闭
    expect(addChild).not.toHaveBeenCalled();
    expect(removeNode).not.toHaveBeenCalled();
  });

  it('蓄力中按 Tab → 会话取消（不会事后弹环），按键照常落画布', () => {
    const { result } = setup();
    let tab = true;
    act(() => {
      result.current.handleKey(kd('Alt'));
    });
    act(() => {
      tab = result.current.handleKey(kd('Tab'));
    });
    expect(tab).toBe(false);
    expect(result.current.state.phase).toBe('idle');
    act(() => {
      vi.advanceTimersByTime(400); // 定时器已清，环不会再弹
    });
    expect(result.current.state.phase).toBe('idle');
  });

  it('环内 Esc → 取消（关闭、不提交）', () => {
    const { result } = setup();
    openRing(result);
    let esc = false;
    act(() => {
      esc = result.current.handleKey(kd('Escape'));
    });
    expect(esc).toBe(true);
    expect(result.current.state.phase).toBe('idle');
  });

  it('环内 Backspace → 取消（Windows 下 Alt+Esc 收不到 Esc；Backspace 为别且拦默认）', () => {
    const { result } = setup();
    openRing(result);
    const ev = kd('Backspace');
    let bs = false;
    act(() => {
      bs = result.current.handleKey(ev);
    });
    expect(bs).toBe(true);
    expect(ev.defaultPrevented).toBe(true); // 拦住浏览器默认（历史回退）
    expect(result.current.state.phase).toBe('idle');
  });

  it('蓄力中 Backspace → 撤会话且被消费（不再落画布，防误触 keys.ts 的「删除节点」）', () => {
    const { result, removeNode } = setup();
    act(() => {
      result.current.handleKey(kd('Alt'));
    });
    let bs = false;
    act(() => {
      bs = result.current.handleKey(kd('Backspace'));
    });
    expect(bs).toBe(true); // 宿主收到 true → 不再转给画布 → Backspace=删除 不会触发
    expect(result.current.state.phase).toBe('idle');
    expect(removeNode).not.toHaveBeenCalled();
  });
});

describe('useRadialStage · 指针/滚轮守卫（深审修复）', () => {
  it('环开着滚轮 → 撤环（环锚点随视口变化失准）', () => {
    const { result } = setup();
    openRing(result);
    act(() => {
      window.dispatchEvent(new Event('wheel'));
    });
    expect(result.current.state.phase).toBe('idle');
  });

  it('环开着右击 → 撤环让路（事件不被吞，右键菜单照常打开）', () => {
    const { result } = setup();
    openRing(result);
    let notPrevented = false;
    act(() => {
      notPrevented = document.body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 2 }),
      );
    });
    expect(notPrevented).toBe(true); // 未被 preventDefault → 事件继续流
    expect(result.current.state.phase).toBe('idle');
  });

  it('蓄力中点击画布 → 撤会话（不吞事件）', () => {
    const { result } = setup();
    act(() => {
      result.current.handleKey(kd('Alt'));
    });
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(result.current.state.phase).toBe('idle');
  });
});

describe('useRadialStage · 删除二次确认（深审高危修复）', () => {
  /** 驱动到「确认气泡已升起」 */
  function armDelete(r: { current: RadialStage }): void {
    openRing(r);
    act(() => {
      r.current.handleKey(kd('ArrowDown'));
    });
    act(() => {
      altUp();
    });
    expect(r.current.confirm?.itemId).toBe('delete');
  }

  it('确认气泡捕获发起节点：期间选中变化，Enter 仍删原节点', () => {
    let sel: string | null = 'A';
    const { result, removeNode } = setup(() => sel);
    armDelete(result);
    expect(result.current.confirm?.nodeId).toBe('A');
    sel = 'B'; // 模拟期间选中已切到别的节点
    act(() => {
      result.current.handleKey(kd('Enter'));
    });
    expect(removeNode).toHaveBeenCalledTimes(1);
    expect(removeNode).toHaveBeenCalledWith('A'); // 绝不是 B
  });

  it('气泡期点别处 → 收起且不删（点气泡自身除外——由 data-radial-ignore 承担）', () => {
    const { result, removeNode } = setup();
    armDelete(result);
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    });
    expect(result.current.confirm).toBeNull();
    expect(removeNode).not.toHaveBeenCalled();
  });

  it('原始复现：气泡升起后换选中 + 新 Alt 会话 → 气泡收起，绝不误删新选中', () => {
    let sel: string | null = 'A';
    const { result, removeNode } = setup(() => sel);
    armDelete(result);
    sel = 'B'; // 期间选中切到 B（旧实现：确认时读实时选中 → 会删 B）
    act(() => {
      result.current.handleKey(kd('Alt')); // 新会话开始 → 气泡必须收起
    });
    expect(result.current.confirm).toBeNull();
    act(() => {
      result.current.handleKey(kd('Enter')); // 蓄力中 Enter → 撤会话放行，不触发确认
    });
    expect(removeNode).not.toHaveBeenCalled(); // 既不删 A 也不删 B：意图已撤回
  });

  it('Esc 取消气泡 → 不删', () => {
    const { result, removeNode } = setup();
    armDelete(result);
    act(() => {
      result.current.handleKey(kd('Escape'));
    });
    expect(result.current.confirm).toBeNull();
    expect(removeNode).not.toHaveBeenCalled();
  });

  it('Backspace 取消气泡（Windows 下 Alt+Esc 收不到）→ 不删 + 拦默认', () => {
    const { result, removeNode } = setup();
    armDelete(result);
    const ev = kd('Backspace');
    act(() => {
      result.current.handleKey(ev);
    });
    expect(result.current.confirm).toBeNull();
    expect(ev.defaultPrevented).toBe(true);
    expect(removeNode).not.toHaveBeenCalled();
  });

  it('确认超时（1.6s）自动收起 → 不删', () => {
    const { result, removeNode } = setup();
    armDelete(result);
    act(() => {
      vi.advanceTimersByTime(1700);
    });
    expect(result.current.confirm).toBeNull();
    expect(removeNode).not.toHaveBeenCalled();
  });
});

describe('RadialStageOverlay · 环内删除气泡渲染（2026-09-11 真浏览器实测修复）', () => {
  it('环内 ↓ 松键提交 → 气泡必须出现（旧实现读 state.origin，提交已归位 null → 永不显示）', () => {
    const removeNode = vi.fn();
    let radial: RadialStage | null = null;
    function Host() {
      const r = useRadialStage({
        getSelectedId: () => 'A',
        getAnchor: () => ({ x: 100, y: 100 }),
        setPreDir: () => {},
        actions: { addChild: () => {}, editText: () => {}, removeNode, openMenu: () => {} },
      });
      radial = r;
      return <RadialStageOverlay radial={r} />;
    }
    const { container } = render(<Host />);
    act(() => {
      radial!.handleKey(kd('Alt'));
    });
    act(() => {
      vi.advanceTimersByTime(300); // arming → ring
    });
    act(() => {
      radial!.handleKey(kd('ArrowDown')); // 直映射 ↓ = 删除节点
    });
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Alt' })); // 松键 = 提交（危险 → 转确认）
    });
    expect(radial!.confirm?.itemId).toBe('delete');
    const chip = container.querySelector('.confirm-chip');
    expect(chip, '气泡未渲染：锚点丢失（origin 归位）').not.toBeNull();
    expect(chip?.textContent ?? '').toContain('删除节点');
    // 气泡上的确认按钮 → 真删
    act(() => {
      radial!.handleKey(kd('Enter'));
    });
    expect(removeNode).toHaveBeenCalledWith('A');
  });
});

describe('useRadialStage · P1 打磨（边缘钳制 / 撤销白名单）', () => {
  it('锚点越出视口（右下）→ 收进安全边距（jsdom 视口 1024×768）', () => {
    const { result } = setup(
      () => 'A',
      () => ({ x: 5000, y: 5000 }),
    );
    act(() => {
      result.current.handleKey(kd('Alt'));
    });
    const pad = 92; // VIEWPORT_PAD = outerR(52) + 40
    expect(result.current.state.origin?.cx).toBe(window.innerWidth - pad);
    expect(result.current.state.origin?.cy).toBe(window.innerHeight - pad);
  });

  it('中央锚点不被钳制（环仍贴节点角）', () => {
    const { result } = setup();
    act(() => {
      result.current.handleKey(kd('Alt'));
    });
    expect(result.current.state.origin?.cx).toBe(100);
    expect(result.current.state.origin?.cy).toBe(100);
  });

  it('环开时 Ctrl+Z → 撤环让路（撤销落画布）；Ctrl+C 仍被吞（模态）', () => {
    const { result } = setup();
    openRing(result);
    let undo = true;
    act(() => {
      undo = result.current.handleKey(kd('z', { ctrlKey: true }));
    });
    expect(undo).toBe(false); // 未消费 → 宿主的撤销路径接管
    expect(result.current.state.phase).toBe('idle'); // 环已撤
    openRing(result);
    let copy = false;
    act(() => {
      copy = result.current.handleKey(kd('c', { ctrlKey: true }));
    });
    expect(copy).toBe(true); // 其余组合键仍吞
    expect(result.current.state.phase).toBe('ring');
  });
});

describe('RadialStageOverlay · ① 幽灵/删除预告渲染', () => {
  const mkRadial = (): RadialStage => ({
    state: RADIAL_IDLE,
    charge: 0,
    inDead: false,
    confirm: null,
    settleConfirm: () => {},
    handleKey: () => false,
    subItems: [],
    subPageCount: 0,
  });

  it('缺省零渲染；传入 ghost/dangerBoxes 即显', () => {
    const { container, rerender } = render(<RadialStageOverlay radial={mkRadial()} />);
    expect(container.querySelector('.ghost-node')).toBeNull();
    expect(container.querySelectorAll('.danger-box')).toHaveLength(0);
    rerender(
      <RadialStageOverlay
        radial={mkRadial()}
        ghost={{ x: 10, y: 20, w: 120, h: 30, label: '新节点' }}
        dangerBoxes={[{ x: 1, y: 2, w: 30, h: 10 }]}
      />,
    );
    expect(container.querySelector('.ghost-node')?.textContent).toContain('新节点');
    expect(container.querySelectorAll('.danger-box')).toHaveLength(1);
  });
});

/**
 * ② 二级环 · 画布接线（T5）
 * ══════════════════════════════════════════════════════════════════════
 * 锁三件事：
 * 1. **零影响**：未注入 `getSubModel` → 「更多」仍是「打开菜单」的普通提交（与接入前逐字节同路径）；
 * 2. **下钻/翻页/提交**：席位来自注入模型，提交调的是**模型给的命令闭包**（宿主与菜单同一闭包）；
 * 3. **页与灰显的接线**：方向页换页仍在二级深度、灰显席轮转跳过且点击无效、Esc/Backspace 收起整环。
 */
describe('② 二级环（T5 画布接线）', () => {
  const P0 = [
    'sub:add-sibling',
    'sub:edit-desc',
    'sub:edit-note',
    'sub:center',
    'sub:hub',
    'sub:copy-text',
    'sub:more-menu',
  ];
  const P1 = ['sub:center-right', 'sub:center-left', 'sub:center-down', 'sub:center-up', 'sub:back'];

  /** 与派生模型同形状的假模型：席位 id / 页 / 每席 spy；`sub:more-menu` 故意无 action（宿主兜底） */
  function makeModel(patch: { disabled?: string[] } = {}) {
    const spies = new Map<string, ReturnType<typeof vi.fn>>();
    const mk = (id: string, extra: Partial<RadialSubItem> = {}): RadialSubItem => {
      const spy = vi.fn();
      spies.set(id, spy);
      return { id, label: id, icon: [], disabled: patch.disabled?.includes(id) || undefined, ...extra };
    };
    const pages: RadialSubItem[][] = [
      [
        mk('sub:add-sibling'),
        mk('sub:edit-desc'),
        mk('sub:edit-note'),
        mk('sub:center', { opensPage: 1 }),
        mk('sub:hub'),
        mk('sub:copy-text'),
        { id: 'sub:more-menu', label: '打开完整菜单', icon: [] }, // 宿主兜底：不给 action
      ],
      [mk('sub:center-right'), mk('sub:center-left'), mk('sub:center-down'), mk('sub:center-up'), mk('sub:back', { opensPage: 0 })],
    ];
    const actions: Record<string, () => void> = {};
    for (const [id, spy] of spies) actions[id] = spy as unknown as () => void;
    return { pages, actions, spies };
  }

  function setupSub(model = makeModel()) {
    const openMenu = vi.fn();
    const { result } = renderHook(() =>
      useRadialStage({
        getSelectedId: () => 'A',
        getAnchor: () => ({ x: 400, y: 400 }),
        setPreDir: vi.fn(),
        getSubModel: () => model,
        actions: { addChild: vi.fn(), editText: vi.fn(), removeNode: vi.fn(), openMenu },
      }),
    );
    return { result, model, openMenu };
  }

  /** 出环 → 高亮「更多」→ Enter = 下钻二级 */
  function drill(r: { current: RadialStage }): void {
    openRing(r);
    act(() => {
      r.current.handleKey(kd('ArrowLeft'));
    });
    act(() => {
      r.current.handleKey(kd('Enter'));
    });
  }

  /** 外圈第 i 席中心（客户端坐标；环心 = (400,400)，与 getAnchor 同源） */
  function seatPoint(i: number, count = 7): { x: number; y: number } {
    const geo = radialGeometryFor(400, 400);
    const sub = subRingOf(geo, count);
    const rad = (subSeatCenterDeg(sub, i) * Math.PI) / 180;
    const r = (sub.innerR + sub.outerR) / 2;
    return { x: geo.cx + r * Math.cos(rad), y: geo.cy + r * Math.sin(rad) };
  }

  function clickAt(p: { x: number; y: number }): void {
    document.body.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: p.x, clientY: p.y }),
    );
  }

  it('下钻：一级「更多」提交 → level 2，席位与页数来自注入模型', () => {
    const { result } = setupSub();
    drill(result);
    expect(result.current.state.level).toBe(2);
    expect(result.current.state.subPage).toBe(0);
    expect(result.current.subItems.map((i) => i.id)).toEqual(P0);
    expect(result.current.subPageCount).toBe(2);
  });

  it('零影响：未注入 getSubModel → 「更多」仍提交给宿主（openMenu），不进二级', () => {
    const { result, openMenu } = setup();
    openRing(result);
    act(() => {
      result.current.handleKey(kd('ArrowLeft'));
    });
    act(() => {
      result.current.handleKey(kd('Enter'));
    });
    expect(result.current.state.level ?? 1).toBe(1);
    expect(result.current.state.phase).toBe('idle');
    expect(openMenu).toHaveBeenCalledWith('A', 100, 100);
    expect(result.current.subItems).toEqual([]);
  });

  it('悬停「更多」停顿 450ms → 自动下钻（鼠标通道，无需点击/Enter）', () => {
    const { result } = setupSub();
    openRing(result);
    act(() => {
      result.current.handleKey(kd('ArrowLeft')); // 高亮「更多」
    });
    expect(result.current.state.level ?? 1).toBe(1);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.state.level).toBe(2);
  });

  it('未注入模型时停顿不生效（零影响：环停在一级）', () => {
    const { result } = setup();
    openRing(result);
    act(() => {
      result.current.handleKey(kd('ArrowLeft'));
    });
    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(result.current.state.level ?? 1).toBe(1);
    expect(result.current.state.phase).toBe('ring');
  });

  it('席位轮转 + Enter 提交 → 调模型给的命令闭包（第 1 席「新建同级」），提交即收起', () => {
    const { result, model } = setupSub();
    drill(result);
    act(() => {
      result.current.handleKey(kd('ArrowRight'));
    });
    expect(result.current.state.subIndex).toBe(0);
    act(() => {
      result.current.handleKey(kd('Enter'));
    });
    expect(model.spies.get('sub:add-sibling')).toHaveBeenCalledTimes(1);
    expect(result.current.state.phase).toBe('idle');
  });

  it('翻页：选「升为中心」→ Enter 进方向页（仍二级）→ 选方向提交', () => {
    const { result, model } = setupSub();
    drill(result);
    act(() => {
      for (let i = 0; i < 4; i++) result.current.handleKey(kd('ArrowRight'));
    });
    expect(result.current.state.subIndex).toBe(3); // sub:center
    act(() => {
      result.current.handleKey(kd('Enter'));
    });
    expect(result.current.state.subPage).toBe(1);
    expect(result.current.state.subIndex).toBeNull();
    expect(result.current.state.level).toBe(2); // 同深度，不是三级
    expect(result.current.subItems.map((i) => i.id)).toEqual(P1);
    act(() => {
      result.current.handleKey(kd('ArrowRight'));
    });
    expect(result.current.state.subIndex).toBe(0);
    act(() => {
      result.current.handleKey(kd('Enter'));
    });
    expect(model.spies.get('sub:center-right')).toHaveBeenCalledTimes(1);
  });

  it('灰显席：轮转跳过 + 点击无效（保持二级）', () => {
    const { result, model } = setupSub(makeModel({ disabled: ['sub:edit-desc'] }));
    drill(result);
    act(() => {
      result.current.handleKey(kd('ArrowRight'));
    });
    act(() => {
      result.current.handleKey(kd('ArrowRight')); // 跳过灰显的席 1 → 席 2
    });
    expect(result.current.state.subIndex).toBe(2);
    act(() => {
      clickAt(seatPoint(1)); // 点灰显席
    });
    expect(result.current.state.level).toBe(2);
    expect(result.current.state.phase).toBe('ring');
    expect(model.spies.get('sub:edit-desc')).not.toHaveBeenCalled();
  });

  it('外圈悬停：命中可用席位即时高亮（二级不走一级的 60ms 防抖）', () => {
    const { result } = setupSub();
    drill(result);
    act(() => {
      window.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: seatPoint(0).x, clientY: seatPoint(0).y }));
    });
    expect(result.current.state.subIndex).toBe(0);
  });

  it('末席「打开完整菜单」→ 宿主兜底 openMenu（模型无该 action）', () => {
    const { result, openMenu } = setupSub();
    drill(result);
    act(() => {
      for (let i = 0; i < 7; i++) result.current.handleKey(kd('ArrowRight')); // 空高亮起 → 第 1 次到席 0
    });
    expect(result.current.state.subIndex).toBe(6);
    act(() => {
      result.current.handleKey(kd('Enter'));
    });
    expect(openMenu).toHaveBeenCalledWith('A', 400, 400);
  });

  it('二级 Esc / Backspace → 收起整环（不提交任何席位）', () => {
    const a = setupSub();
    drill(a.result);
    act(() => {
      a.result.current.handleKey(kd('Escape'));
    });
    expect(a.result.current.state.phase).toBe('idle');
    expect([...a.model.spies.values()].every((s) => s.mock.calls.length === 0)).toBe(true);

    const b = setupSub();
    drill(b.result);
    const ev = kd('Backspace');
    act(() => {
      b.result.current.handleKey(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(b.result.current.state.phase).toBe('idle');
  });

  it('点内圈（主环带）= 降级回一级（环保持、不提交）', () => {
    const { result, model } = setupSub();
    drill(result);
    act(() => {
      clickAt({ x: 440, y: 400 }); // 环心(400,400) + 40px → 主环带内
    });
    expect(result.current.state.level).toBe(1);
    expect(result.current.state.phase).toBe('ring');
    expect([...model.spies.values()].every((s) => s.mock.calls.length === 0)).toBe(true);
  });

  it('覆盖层：level 2 → 主环降透明 + 外圈渲染 + 席位浮标', () => {
    const { result } = setupSub();
    drill(result);
    act(() => {
      result.current.handleKey(kd('ArrowRight'));
    });
    const { container } = render(<RadialStageOverlay radial={result.current} />);
    expect(container.querySelector('.ring-dim')).not.toBeNull();
    expect(container.querySelector('.sub-ring')).not.toBeNull();
    expect(container.querySelector('.float-label')?.textContent ?? '').toContain('sub:add-sibling');
  });
});
