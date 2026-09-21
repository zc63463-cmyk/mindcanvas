// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createSvgBackend, sceneToSvg } from '../src/render/backend.js';
import type { ReactElement } from 'react';

/** 渲染后端元素（React 元素）到 DOM 节点 */
function mount(el: unknown): Element {
  const { container } = render(el as ReactElement);
  return container.firstElementChild as Element;
}

describe('渲染后端抽象（M5-T7：原语集合 + SVG 适配器）', () => {
  const backend = createSvgBackend();

  it('nodeCard 原语 → rect（圆角/填充/描边/阴影滤镜）', () => {
    const el = mount(
      backend.render(
        backend.nodeCard({
          x: 0,
          y: 0,
          w: 60,
          h: 30,
          rx: 9,
          fill: '#fff',
          stroke: '#000',
          strokeWidth: 1.4,
          filter: 'none',
        }),
      ),
    );
    expect(el.tagName.toLowerCase()).toBe('rect');
    expect(el.getAttribute('width')).toBe('60');
    expect(el.getAttribute('rx')).toBe('9');
    expect(el.getAttribute('fill')).toBe('#fff');
    expect(el.getAttribute('stroke')).toBe('#000');
    expect(el.hasAttribute('style')).toBe(false); // filter none → 无 style
  });

  it('link 原语 → path（d/stroke/线宽）', () => {
    const el = mount(
      backend.render(
        backend.link({ d: 'M 0 0 C 10 5, 20 5, 30 0', stroke: '#2f9e44', strokeWidth: 2.2 }),
      ),
    );
    expect(el.tagName.toLowerCase()).toBe('path');
    expect(el.getAttribute('d')).toBe('M 0 0 C 10 5, 20 5, 30 0');
    expect(el.getAttribute('stroke')).toBe('#2f9e44');
    expect(el.getAttribute('stroke-width')).toBe('2.2');
  });

  it('text 原语 → text（字号/字重/填充/垂直对齐）', () => {
    const el = mount(
      backend.render(
        backend.text({
          x: 12,
          y: 15,
          value: '分支 A',
          fontSize: 11,
          fontWeight: 500,
          fill: '#633806',
        }),
      ),
    );
    expect(el.tagName.toLowerCase()).toBe('text');
    expect(el.getAttribute('font-size')).toBe('11');
    expect(el.getAttribute('font-weight')).toBe('500');
    expect(el.textContent).toBe('分支 A');
  });

  it('group 原语 → g（transform/opacity/指针豁免/data 锚点）', () => {
    const scene = backend.group(
      'translate(10 20) scale(2)',
      [
        backend.nodeCard({
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          rx: 2,
          fill: '#f00',
          stroke: '#00f',
          strokeWidth: 1,
        }),
      ],
      {
        opacity: 0.5,
        pointerEvents: false,
        dataId: 'nd-1',
      },
    );
    const el = mount(backend.render(scene));
    expect(el.tagName.toLowerCase()).toBe('g');
    expect(el.getAttribute('transform')).toBe('translate(10 20) scale(2)');
    expect(el.getAttribute('opacity')).toBe('0.5');
    expect(el.getAttribute('data-node-id')).toBe('nd-1');
    expect((el as HTMLElement).style.pointerEvents).toBe('none');
    expect(el.querySelector('rect')).not.toBeNull(); // 子原语递归渲染
  });

  it('sceneToSvg 与 render 等价（纯函数转换可独立测试）', () => {
    const scene = backend.link({ d: 'M 0 0 L 10 10', stroke: '#000', strokeWidth: 1 });
    const viaRender = backend.render(scene);
    const viaPure = sceneToSvg(scene);
    expect(mount(viaRender).getAttribute('d')).toBe('M 0 0 L 10 10');
    expect(mount(viaPure).getAttribute('d')).toBe('M 0 0 L 10 10');
  });

  it('后端种类 = svg（Canvas 为预留路径，本期不实现）', () => {
    expect(backend.kind).toBe('svg');
    // 接口形状：nodeCard/text/link/image/group/render 齐备（Canvas 后端可实现同一接口）
    const contract: Array<keyof ReturnType<typeof createSvgBackend>> = [
      'kind',
      'nodeCard',
      'text',
      'link',
      'image',
      'group',
      'render',
    ];
    for (const k of contract) expect(k in backend).toBe(true);
  });
});
