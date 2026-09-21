import { describe, expect, it } from 'vitest';
import { safeHref } from '../src/protocol/uri.js';

describe('protocol/uri：safeHref 链接协议白名单', () => {
  it('放行 http/https 与相对路径', () => {
    expect(safeHref('https://a.b/c')).toBe('https://a.b/c');
    expect(safeHref('http://a.b/c')).toBe('http://a.b/c');
    expect(safeHref('/assets/canvas/index.html')).toBe('/assets/canvas/index.html');
    expect(safeHref('docs/01.md')).toBe('docs/01.md');
    expect(safeHref('#anchor')).toBe('#anchor');
  });

  it('拒绝可执行 scheme（javascript/data/vbscript/file）', () => {
    expect(safeHref('javascript:alert(1)')).toBe(null);
    expect(safeHref('JaVaScRiPt:alert(1)')).toBe(null); // 大小写不敏感
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBe(null);
    expect(safeHref('vbscript:x')).toBe(null);
    expect(safeHref('file:///c:/windows')).toBe(null);
  });

  it('拒绝空白/空链接，并容忍首尾空格', () => {
    expect(safeHref('')).toBe(null);
    expect(safeHref('   ')).toBe(null);
    expect(safeHref('  https://a.b/c  ')).toBe('https://a.b/c');
  });
});
