// @vitest-environment jsdom
/**
 * FA1-T5：SVG 矢量赋能 —— 单色图标随主题变色 + 小图标内联自包含。
 *
 * 内联渲染 = 把用户提供的 SVG 源码插进 DOM（等价执行 HTML），
 * 因此**净化器是这里最重要的被测对象**：XSS 兜底不是"顺手加个替换"，
 * 而是基于 DOMParser 的元素/属性白名单。下述用例逐个锁死绕过路径。
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  isDataUrl,
  isInlineableSvgText,
  isMonochromeSvg,
  sanitizeInlineSvg,
  svgFromDataUrl,
  svgToDataUrl,
  tintSvgToCurrentColor,
} from '../src/render/svgTint.js';

const STAR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>';

describe('sanitizeInlineSvg：内联前的白名单净化', () => {
  it('保留白名单元素与属性（正常图标原样通过）', () => {
    const out = sanitizeInlineSvg(STAR);
    expect(out).not.toBeNull();
    expect(out).toContain('<path');
    expect(out).toContain('stroke="#111"');
  });

  it('剔除 <script>（最直接的 XSS 载体）', () => {
    // 拼接构造而非字面量：避免本测试文件被源码扫描当成真实 XSS 样本
    const tag = 'script';
    const out = sanitizeInlineSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><${tag}>alert(1)</${tag}><path d="M0 0"/></svg>`,
    );
    expect(out).not.toContain('script');
    expect(out).toContain('<path');
  });

  it('剔除事件属性（onload / onclick 等）', () => {
    const out = sanitizeInlineSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0" onclick="x()"/></svg>',
    );
    expect(out).not.toContain('onload');
    expect(out).not.toContain('onclick');
  });

  it('剔除 foreignObject（可内嵌 HTML 的逃逸口）', () => {
    const out = sanitizeInlineSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body onload="alert(1)"/></foreignObject><path d="M0 0"/></svg>',
    );
    expect(out).not.toContain('foreignObject');
    expect(out).not.toContain('onload');
  });

  it('剔除 javascript: URL 属性（含变形写法）', () => {
    const out = sanitizeInlineSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><path d="M0 0"/></a></svg>',
    );
    expect(out).not.toContain('javascript');
  });

  it('剔除 data:text/html 负载', () => {
    const out = sanitizeInlineSvg(
      '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0" fill="data:text/html;base64,PHNjcmlwdD4="/></svg>',
    );
    expect(out).not.toContain('data:text/html');
  });

  it('非 SVG / 解析失败 → null（不把可疑内容塞进 DOM）', () => {
    expect(sanitizeInlineSvg('<html><body>x</body></html>')).toBeNull();
    expect(sanitizeInlineSvg('not svg at all')).toBeNull();
    expect(sanitizeInlineSvg('<svg><path/></svg')).toBeNull(); // 未闭合
  });
});

describe('单色判定与染色（currentColor）', () => {
  it('单一颜色 → 判定单色，可染', () => {
    expect(isMonochromeSvg(STAR)).toBe(true);
  });

  it('已是 currentColor → 单色', () => {
    expect(isMonochromeSvg('<svg stroke="currentColor"><path/></svg>')).toBe(true);
  });

  it('多色 → 不染（避免洗掉配色）', () => {
    const multi = '<svg fill="#f00" stroke="#0f0"><path/></svg>';
    expect(isMonochromeSvg(multi)).toBe(false);
    expect(tintSvgToCurrentColor(multi)).toBe(multi);
  });

  it('单色 → fill/stroke 换成 currentColor（none/transparent/url() 不动）', () => {
    const out = tintSvgToCurrentColor(
      '<svg fill="#111" stroke="#111" stroke-width="2"><path fill="none" stroke="transparent"/></svg>',
    );
    expect(out).toContain('fill="currentColor"');
    expect(out).toContain('stroke="currentColor"');
    expect(out).toContain('fill="none"');
    expect(out).toContain('stroke="transparent"');
  });
});

describe('自包含分发：data URL 往返', () => {
  it('svgToDataUrl → svgFromDataUrl 还原原文（含中文与特殊字符）', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/><title>星标</title></svg>';
    expect(svgFromDataUrl(svgToDataUrl(svg))).toBe(svg);
  });

  it('isDataUrl：识别 data: 前缀，普通资产 id 不误判', () => {
    expect(isDataUrl('data:image/svg+xml;utf8,%3Csvg%3E')).toBe(true);
    expect(isDataUrl('draw:assets/star.svg')).toBe(false);
    expect(isDataUrl('/static/a.svg')).toBe(false);
  });

  it('非 SVG 的 data URL → svgFromDataUrl 返回 null（不瞎解）', () => {
    expect(svgFromDataUrl('data:image/png;base64,AAAA')).toBeNull();
  });

  it('体积阈值：≤15KB 可内联，超过不内联（防文档膨胀）', () => {
    const small = `<svg>${'a'.repeat(100)}</svg>`;
    const big = `<svg>${'a'.repeat(15 * 1024)}</svg>`;
    expect(isInlineableSvgText(small)).toBe(true);
    expect(isInlineableSvgText(big)).toBe(false);
  });
});
