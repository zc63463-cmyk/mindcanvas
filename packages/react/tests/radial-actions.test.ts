/**
 * 环形快捷操作 · 纯逻辑测试（v1.8.0 Phase 1）。
 *
 * 锁定四组不变量：
 * 1. 几何命中：四向扇区 / 半开边界 / 死区与外缘宽容 / SE 缺口取消带；
 * 2. 可见弧：缺口只切相邻两槽（right 尾 / down 首），up/left 完整；
 * 3. 映射：方向键直映射（ArrowUp→up…）；
 * 4. 状态机：快击=pre-dir（环不浮现）、慢按=ring（open）、提交/取消/禁用各分支。
 */
import { describe, expect, it } from 'vitest';
import {
  hitTest,
  itemAt,
  RADIAL_IDLE,
  RADIAL_ITEMS_V1,
  radialGeometryFor,
  radialReduce,
  slotForArrowKey,
  visibleArcs,
} from '../src/edit/radialActions.js';
import type { RadialEffect, RadialEvent, RadialItem, RadialState } from '../src/edit/radialActions.js';

/** 极坐标取点（度；0°=右，顺时针为正） */
function at(deg: number, r = 40): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: r * Math.cos(a), y: r * Math.sin(a) };
}

const ORIGIN = { nodeId: 'n1', cx: 0, cy: 0 };
const geo = radialGeometryFor(0, 0);

/** 依序驱动状态机，返回终态与最后一个效果 */
function drive(
  events: RadialEvent[],
  items: readonly RadialItem[] = RADIAL_ITEMS_V1,
): { state: RadialState; effect: RadialEffect } {
  let state: RadialState = RADIAL_IDLE;
  let effect: RadialEffect = { kind: 'none' };
  for (const ev of events) {
    const step = radialReduce(state, ev, items, {});
    state = step.state;
    effect = step.effect;
  }
  return { state, effect };
}

describe('radialActions · 几何命中', () => {
  it('四向扇区：上/右/下/左', () => {
    expect(hitTest(geo, at(270).x, at(270).y)).toBe('up');
    expect(hitTest(geo, at(0).x, at(0).y)).toBe('right');
    expect(hitTest(geo, at(90).x, at(90).y)).toBe('down');
    expect(hitTest(geo, at(180).x, at(180).y)).toBe('left');
  });

  it('对角线边界半开：314.9° 归上、315.1° 归右', () => {
    expect(hitTest(geo, at(314.9).x, at(314.9).y)).toBe('up');
    expect(hitTest(geo, at(315.1).x, at(315.1).y)).toBe('right');
  });

  it('死区 → null；外缘 + 宽容内命中、之外 null', () => {
    expect(hitTest(geo, at(0, 10).x, at(0, 10).y)).toBeNull(); // < deadR 16
    expect(hitTest(geo, at(0, 60).x, at(0, 60).y)).toBe('right'); // ≤ outerR 52 + slack 10
    expect(hitTest(geo, at(0, 70).x, at(0, 70).y)).toBeNull();
  });

  it('朝节点角的缺口是取消带；调宽缺口可吞掉整槽', () => {
    expect(hitTest(geo, at(135).x, at(135).y)).toBeNull(); // 缺口中心 135°（朝节点角）
    const wide = radialGeometryFor(0, 0, { gapWidthDeg: 120 });
    expect(hitTest(wide, at(90).x, at(90).y)).toBeNull(); // 缺口 [75,195] 吞 down
    expect(hitTest(wide, at(180).x, at(180).y)).toBeNull(); // 与 left
  });
});

describe('radialActions · 可见弧与映射', () => {
  it('缺口只切相邻两槽：down 尾 58°、left 首 58°；up/right 完整 90°', () => {
    const arcs = visibleArcs(geo);
    const byKey = new Map(arcs.map((a) => [a.key, a]));
    expect(byKey.get('down')?.startDeg).toBe(45);
    expect(byKey.get('down')?.spanDeg).toBe(58);
    expect(byKey.get('left')?.startDeg).toBe(167);
    expect(byKey.get('left')?.spanDeg).toBe(58);
    expect(byKey.get('right')?.spanDeg).toBe(90);
    expect(byKey.get('up')?.spanDeg).toBe(90);
  });

  it('方向键直映射扇区', () => {
    expect(slotForArrowKey('ArrowUp')).toBe('up');
    expect(slotForArrowKey('ArrowRight')).toBe('right');
    expect(slotForArrowKey('ArrowDown')).toBe('down');
    expect(slotForArrowKey('ArrowLeft')).toBe('left');
    expect(slotForArrowKey('KeyW')).toBeNull();
  });
});

describe('radialActions · 时序状态机（marking 双通道）', () => {
  it('快击：Alt+方向键在阈值内 → pre-dir，环始终不浮现；松开复位', () => {
    const r = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'arrow', key: 'ArrowUp' },
    ]);
    expect(r.state.phase).toBe('pre-dir');
    expect(r.effect).toEqual({ kind: 'pre-dir', dir: 'up' });
    const r2 = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'arrow', key: 'ArrowUp' },
      { t: 'arrow', key: 'ArrowLeft' },
    ]);
    expect(r2.effect).toEqual({ kind: 'pre-dir', dir: 'left' }); // 连续按可改向
    // 松开 Alt 静默复位（不提交、不取消——手势通道的收尾）
    const r2b = radialReduce(r2.state, { t: 'alt-up' }, RADIAL_ITEMS_V1, {});
    expect(r2b.state).toEqual(RADIAL_IDLE);
  });

  it('慢按：tick 过阈值 → ring + open；箭头高亮；Alt 松开 → commit', () => {
    const r = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 200 }, // 未到阈值 → 仍 arming
    ]);
    expect(r.state.phase).toBe('arming');
    const opened = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 250 },
    ]);
    expect(opened.effect).toEqual({ kind: 'open' });
    const upState = radialReduce(opened.state, { t: 'arrow', key: 'ArrowUp' }, RADIAL_ITEMS_V1, {});
    expect(upState.state.highlight).toBe('up');
    const r3 = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 250 },
      { t: 'arrow', key: 'ArrowUp' },
      { t: 'alt-up' },
    ]);
    expect(r3.effect).toEqual({ kind: 'commit', itemId: 'add-child', slot: 'up' });
    expect(r3.state).toEqual(RADIAL_IDLE);
  });

  it('轻按 Alt（无高亮）松开 → close；Esc 取消 → close', () => {
    const tap = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'alt-up' },
    ]);
    expect(tap.effect).toEqual({ kind: 'none' });
    expect(tap.state).toEqual(RADIAL_IDLE);
    const ring = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 250 },
      { t: 'alt-up' },
    ]);
    expect(ring.effect).toEqual({ kind: 'close' });
    const esc = drive([
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 250 },
      { t: 'cancel' },
    ]);
    expect(esc.effect).toEqual({ kind: 'close' });
    expect(esc.state).toEqual(RADIAL_IDLE);
  });

  it('悬停：命中扇区高亮、缺口/死区 → null', () => {
    const ringUp: RadialEvent[] = [
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 250 },
    ];
    const down = drive([...ringUp, { t: 'hover', ...at(90) }]);
    expect(down.state.highlight).toBe('down');
    const gap = drive([...ringUp, { t: 'hover', ...at(135) }]);
    expect(gap.state.highlight).toBeNull();
    const dead = drive([...ringUp, { t: 'hover', ...at(0, 5) }]);
    expect(dead.state.highlight).toBeNull();
  });

  it('点击：命中即提交；死区/缺口 → close；confirm 提交高亮', () => {
    const ringUp: RadialEvent[] = [
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 250 },
    ];
    const click = drive([...ringUp, { t: 'click', ...at(90) }]);
    expect(click.effect).toEqual({ kind: 'commit', itemId: 'delete', slot: 'down' });
    const miss = drive([...ringUp, { t: 'click', ...at(135) }]);
    expect(miss.effect).toEqual({ kind: 'close' });
    const enter = drive([
      ...ringUp,
      { t: 'arrow', key: 'ArrowDown' },
      { t: 'confirm' },
    ]);
    expect(enter.effect).toEqual({ kind: 'commit', itemId: 'delete', slot: 'down' });
  });

  it('disabled 动作：不可高亮、点击仅取消', () => {
    const items: RadialItem[] = RADIAL_ITEMS_V1.map((it) =>
      it.slot === 'down' ? { ...it, disabled: true } : it,
    );
    expect(itemAt(items, 'down')).toBeNull();
    const ringUp: RadialEvent[] = [
      { t: 'alt-down', now: 0, origin: ORIGIN },
      { t: 'tick', now: 250 },
    ];
    const arrow = drive([...ringUp, { t: 'arrow', key: 'ArrowDown' }], items);
    expect(arrow.state.highlight).toBeNull();
    const click = drive([...ringUp, { t: 'click', ...at(90) }], items);
    expect(click.effect).toEqual({ kind: 'close' });
  });
});
