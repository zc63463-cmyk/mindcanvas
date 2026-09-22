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
    // DF-R4：连线/箭头落笔需要的路径几何指令（与场景构造器输出的 M/L/Q/C/Z 一一对应）
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'),
    closePath: record('closePath'),
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

  /**
   * DF-R4：连线/箭头必须**落笔**。
   *
   * 修复前 `tracePath` 只对 `M` 调 `beginPath()`，不产出任何几何指令 → `stroke()` 画空路径，
   * Canvas 后端（`?backend=canvas` 或布局节点数 > 50000 的自动降级）看不到树线。
   * 下面用**场景构造器真实产出的格式**（含逗号分隔与箭头 Z）钉住解析结果。
   */
  it('path 原语 → 真实几何指令（M/L 逐点下发）', () => {
    const ctx = fakeCtx();
    drawScene(ctx, { type: 'path', d: 'M 10 10 L 80 80', stroke: '#f00', strokeWidth: 2 });
    expect(ctx.calls).toEqual(['save', 'beginPath', 'moveTo(10,10)', 'lineTo(80,80)', 'stroke', 'restore']);
  });

  it('path 原语 → 二次/三次贝塞尔（`bezierPath`/`orthogonalPath` 的「坐标, 坐标」逗号格式）', () => {
    const quad = fakeCtx();
    drawScene(quad, { type: 'path', d: 'M 0 0 L 5 0 Q 10 0, 10 5 L 10 20', stroke: '#f00', strokeWidth: 2 });
    expect(quad.calls).toContain('quadraticCurveTo(10,0,10,5)');
    expect(quad.calls).toContain('lineTo(10,20)');

    const cubic = fakeCtx();
    drawScene(cubic, {
      type: 'path',
      d: 'M 1 2 C 20 30, 60 70, 80 80',
      stroke: '#f00',
      strokeWidth: 2,
    });
    expect(cubic.calls).toContain('bezierCurveTo(20,30,60,70,80,80)');
    expect(cubic.calls).toContain('moveTo(1,2)');
  });

  it('path 原语 → 箭头三角 Z 闭合、负坐标不丢；tipD 一并落笔', () => {
    const arrow = fakeCtx();
    drawScene(arrow, {
      type: 'path',
      d: 'M 0 0 L 100 100',
      stroke: '#f00',
      strokeWidth: 1,
      tipD: 'M 100 100 L 92 96 L 92 104 Z',
    });
    expect(arrow.calls).toContain('closePath');
    expect(arrow.calls).toContain('lineTo(92,96)');
    expect(arrow.calls).toContain('lineTo(92,104)');
    // tipD 走独立 beginPath：整段序列里恰有两次 beginPath（主线 + 箭头）
    expect(arrow.calls.filter((c) => c === 'beginPath').length).toBe(2);
  });

  it('path 原语：未知指令不落笔也不抛错（有界解析）', () => {
    const ctx = fakeCtx();
    expect(() =>
      drawScene(ctx, { type: 'path', d: 'M 1 2 A 5 5 0 0 1 9 9', stroke: '#f00', strokeWidth: 1 }),
    ).not.toThrow();
    expect(ctx.calls).toEqual(['save', 'beginPath', 'moveTo(1,2)', 'stroke', 'restore']);
  });
});
