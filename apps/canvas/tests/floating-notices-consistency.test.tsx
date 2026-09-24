// @vitest-environment jsdom
/**
 * P1-A rider-A：**浮动提示条的唯一事实源**（P0-C-review §7-a 的验收方式）。
 * ══════════════════════════════════════════════════════════════════════
 * 要证明的两件事：
 *  ① **位置系统唯一**：四条浮动条的实际几何（top / zIndex / 居中）与
 *     `FLOATING_SLOTS` 逐值一致 —— 组件里再出现一个手写的 `top: 100`
 *     会让「渲染出的 top」与「表里的 top」分叉，本文件即红；
 *  ② **消退策略参数化且语义保留**：`auto(ms)` 槽位到点消退、`manual` 槽位
 *     **不**消退（派单书 §3.6：「错误类常驻」是语义不是 bug；
 *     §8 第 5 条明令禁止把错误条也改成自动消退）。
 *
 * 另一条**源码级守卫**：`MindmapStage.tsx` 里不得再出现浮动条的硬编码位置值
 * （`top: 64` / `top: 100` / `top: 16` / `top: 10` 紧邻 `position: 'absolute'`）——
 * 那是 rider-A 要消灭的「第 N 份拷贝」。守卫用**源码扫描**而不是断言组件，
 * 因为漏网的那一份恰恰是「新加的一条没人用的浮条」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  FLOATING_SLOTS,
  dismissMsOf,
  floatingSlotStyle,
  isPersistent,
  type FloatingSlot,
} from '../src/floatingNotices.js';
import { FloatingNotice } from '../src/FloatingNotice.js';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const SLOTS: FloatingSlot[] = ['command-notice', 'asset-notice', 'pre-dir-hint', 'scale-notice'];

/**
 * 源码文本（与 `no-native-dialogs.test.ts` 同一口径：Vite 的 `?raw` glob，
 * 而不是 `node:fs`）—— 这样 canvas 的测试类型检查不必引入 `@types/node`
 * （不新增依赖、不动 lockfile），语义不变：仍是静态扫源码文本。
 */
const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const stageSrc = (): string => {
  const src = SOURCES['../src/MindmapStage.tsx'];
  if (src === undefined) throw new Error('读不到 MindmapStage.tsx 源码（?raw glob 未命中）');
  return src;
};

describe('rider-A · 位置系统唯一事实源', () => {
  it('四个槽位各有唯一定位（居中 + 递增 top，互不重叠）', () => {
    for (const slot of SLOTS) {
      const s = floatingSlotStyle(slot);
      expect(s.position).toBe('absolute');
      expect(s.left).toBe('50%');
      expect(s.transform).toBe('translateX(-50%)');
      expect(s.top).toBe(FLOATING_SLOTS[slot].top);
      expect(s.zIndex).toBe(FLOATING_SLOTS[slot].zIndex);
    }
  });

  it('渲染出的几何与表**逐值一致**（组件不得自己算位置）', () => {
    for (const slot of SLOTS) {
      cleanup();
      const { container } = render(
        <FloatingNotice slot={slot} testId={`t-${slot}`}>
          x
        </FloatingNotice>,
      );
      const el = container.firstElementChild;
      if (el === null) throw new Error(`${slot} 没有渲染`);
      const style = (el as HTMLElement).style;
      expect(style.top).toBe(`${FLOATING_SLOTS[slot].top}px`);
      expect(style.left).toBe('50%');
      expect(style.zIndex).toBe(String(FLOATING_SLOTS[slot].zIndex));
      expect(el.getAttribute('data-floating-notice')).toBe(slot);
    }
  });

  it('四条浮条内边距 / 圆角 / 字号一致（rider-A 的「不是第六处重复」）', () => {
    const geoms = SLOTS.map((slot) => {
      cleanup();
      const { container } = render(
        <FloatingNotice slot={slot}>x</FloatingNotice>,
      );
      const el = container.firstElementChild as HTMLElement;
      return [el.style.padding, el.style.borderRadius, el.style.fontSize].join('|');
    });
    expect(new Set(geoms).size).toBe(1);
  });
});

describe('rider-A · 消退策略参数化（语义差异必须保留）', () => {
  it('auto 槽位到点消退；manual 槽位**不**消退', () => {
    expect(dismissMsOf('command-notice')).toBe(4000);
    expect(dismissMsOf('pre-dir-hint')).toBe(2500);
    // 错误/警示类常驻：不给毫秒（调用方据此不注册定时器）
    expect(dismissMsOf('asset-notice')).toBeNull();
    expect(dismissMsOf('scale-notice')).toBeNull();
    expect(isPersistent('asset-notice')).toBe(true);
    expect(isPersistent('scale-notice')).toBe(true);
    expect(isPersistent('command-notice')).toBe(false);
  });

  it('auto 槽位真的触发 onDismiss；manual 槽位永不触发', async () => {
    vi.useFakeTimers();
    for (const slot of SLOTS) {
      const onDismiss = vi.fn();
      cleanup();
      render(
        <FloatingNotice slot={slot} onDismiss={onDismiss}>
          x
        </FloatingNotice>,
      );
      vi.advanceTimersByTime(60_000);
      const ms = dismissMsOf(slot);
      expect(onDismiss.mock.calls.length).toBe(ms === null ? 0 : 1);
    }
  });
});

describe('rider-A · 源码守卫：MindmapStage 不得再硬编码浮动条位置', () => {
  it('MindmapStage.tsx 里没有旧浮条的硬编码位置（三个已归槽位表的值）', () => {
    const src = stageSrc();
    /*
     * 只扫**已迁移**的那三个值：`top: 10` 是 B1 文档栏（左上角玻璃条）的既有位置，
     * 它不是浮动提示条、也不由槽位表管理 —— 把既有非浮条 UI 一并扫掉会让守卫
     * 变成「谁都不能用 top: 10」，那不是 rider-A 要的东西（§3.6：统一的是浮条）。
     */
    const stale = ['top: 64', 'top: 100', 'top: 16,'];
    const found = stale.filter((s) => src.includes(s));
    expect(found, `MindmapStage 仍硬编码浮动条位置：${found.join(' / ')}`).toEqual([]);
  });

  it('四条浮条都经 FloatingNotice 渲染（不各自手写 div）', () => {
    const src = stageSrc();
    for (const slot of SLOTS) {
      expect(src).toContain(`slot="${slot}"`);
    }
    // 浮条数 = 组件调用数：多一个则说明有人又手写了一条
    expect(src.match(/<FloatingNotice/g)?.length).toBe(SLOTS.length);
  });

  it('旧的两处手写 setTimeout 消退已移除（唯一事实源在槽位表）', () => {
    const src = stageSrc();
    expect(src).not.toContain('setCommandNotice(null), 4000');
    expect(src).not.toContain('setPreDirHint(null), 2500');
  });
});
