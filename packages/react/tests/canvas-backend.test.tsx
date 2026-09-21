import { describe, expect, it, } from 'vitest';
import {
  CanvasBackend,
  CanvasSurface,
  drawScene,
  type Ctx2D,
} from '../src/render/canvasBackend.js';
import type { ScenePrimitive } from '../src/render/backend.js';

/** 记录调用的 fake ctx（指令映射断言用） */
function fakeCtx(): Ctx2D & { calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(args.length > 0 ? `${name}(${args.join(',')})` : name);
    };
  return {
    calls,
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    scale: record('scale'),
    beginPath: record('beginPath'),
    roundRect: record('roundRect'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    font: '',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  } as never;
}

describe('CanvasBackend（R4：T8 L3 骨架）', () => {
  it('kind = canvas（与 SvgBackend 区分）', () => {
    expect(new CanvasBackend().kind).toBe('canvas');
  });

  it('rect 原语 → save/roundRect/fill/stroke/restore 序列 + shadow 解析', () => {
    const ctx = fakeCtx();
    drawScene(ctx, {
      type: 'rect',
      x: 10,
      y: 20,
      w: 100,
      h: 40,
      rx: 8,
      fill: '#fff',
      stroke: '#333',
      strokeWidth: 1.5,
      filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))',
    });
    expect(ctx.calls).toEqual([
      'save',
      'beginPath',
      'roundRect(10,20,100,40,8)',
      'fill',
      'stroke',
      'restore',
    ]);
    expect(ctx.shadowOffsetY).toBe(2);
    expect(ctx.shadowBlur).toBe(3);
    expect(ctx.fillStyle).toBe('#fff');
  });

  it('text 原语 → fillText + font/textBaseline', () => {
    const ctx = fakeCtx();
    drawScene(ctx, {
      type: 'text',
      x: 50,
      y: 30,
      value: '任务 A',
      fontSize: 11,
      fontWeight: 600,
      fill: '#333',
    });
    expect(ctx.font).toBe('600 11px sans-serif');
    expect(ctx.textBaseline).toBe('alphabetic');
    expect(ctx.calls.some((c) => c.startsWith('fillText(任务 A,50,30'))).toBe(true);
  });

  it('group 原语 → translate/scale 递归 + save/restore 包裹 + opacity', () => {
    const ctx = fakeCtx();
    const scene: ScenePrimitive = {
      type: 'group',
      transform: 'translate(10 20) scale(1.5)',
      opacity: 0.5,
      children: [
        { type: 'text', x: 0, y: 0, value: 'x', fontSize: 9, fontWeight: 500, fill: '#000' },
      ],
    };
    drawScene(ctx, scene);
    expect(ctx.calls).toContain('translate(10,20)');
    expect(ctx.calls).toContain('scale(1.5,1.5)');
    expect(ctx.calls).toContain('save');
    expect(ctx.calls).toContain('restore');
    expect(ctx.globalAlpha).toBe(0.5);
  });

  it('CanvasBackend.render → CanvasSurface 元素（useEffect 绘制面）', () => {
    const backend = new CanvasBackend({ width: 640, height: 480 });
    const el = backend.render({ type: 'group', transform: '', children: [] }) as {
      type: unknown;
      props: { width: number; height: number };
    };
    expect(el.type).toBe(CanvasSurface);
    expect(el.props.width).toBe(640);
    expect(el.props.height).toBe(480);
  });
});
