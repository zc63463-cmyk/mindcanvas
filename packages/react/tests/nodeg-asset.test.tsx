// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { astToEditable, layoutMindmap, makeEntityNode, makeTextNode } from '@mindcanvas/kernel';
import { ThemeProvider } from '../src/theme/ThemeContext.js';
import { MapView } from '../src/render/MapView.js';
import { createCharMeasure, createNodeMeasure } from '../src/render/domMeasure.js';
import { ScopedObjectUrls } from '../src/chrome/assetObjectUrls.js';

function assetLayout() {
  const root = makeTextNode('根', [
    makeEntityNode({ kind: 'img', id: 'demo-assets/demo-diagram.svg' }),
    makeEntityNode({ kind: 'draw', id: 'demo-assets/board.svg' }),
    makeEntityNode({ kind: 'issue', id: '1' }),
  ]);
  const editable = astToEditable(root)!;
  const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
  return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char };
}

describe('NodeG：@img/@draw 资产预览渲染', () => {
  it('img/draw 实体节点渲染 <image> 且 href 拼接 assetBaseUrl（导图根 + 相对路径）', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    const imgs = container.querySelectorAll('image');
    const hrefs = Array.from(imgs).map((i) => i.getAttribute('href'));
    expect(hrefs).toContain('/demo-assets/demo-diagram.svg');
    expect(hrefs).toContain('/demo-assets/board.svg');
  });

  it('非资产实体（@issue）不渲染 <image>', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    expect(container.querySelectorAll('image').length).toBe(2);
  });
});

/**
 * P0-1 资产 URL 宿主解析：上传资产（objectURL）无法经 assetBaseUrl 拼接加载——
 * NodeG 必须优先走宿主注入的 resolveAssetUrl，返回 undefined 时回落默认拼接。
 */
describe('NodeG：resolveAssetUrl 宿主解析（P0-1）', () => {
  it('宿主返回 URL → <image> href 用宿主值；undefined → 回落 assetBaseUrl 拼接', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetUrl={(ref) => (ref.kind === 'img' ? `blob:host-${ref.id}` : undefined)}
        />
      </ThemeProvider>,
    );
    const hrefs = Array.from(container.querySelectorAll('image')).map((i) =>
      i.getAttribute('href'),
    );
    expect(hrefs).toContain('blob:host-demo-assets/demo-diagram.svg');
    expect(hrefs).toContain('/demo-assets/board.svg');
  });

  it('未传 resolveAssetUrl → 行为不变（全部回落 assetBaseUrl 拼接）', () => {
    const { layout, char } = assetLayout();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    const hrefs = Array.from(container.querySelectorAll('image')).map((i) =>
      i.getAttribute('href'),
    );
    expect(hrefs).toContain('/demo-assets/demo-diagram.svg');
  });
});

/**
 * 编辑态文字层守卫（2026-09-03）：
 * 内联编辑器是浮在节点盒上的 <input>，若 SVG 仍绘制文字就是两层同时可见 ——
 * 暗色主题下 input 底色只有 7% 不透明度，底下文字会直接透出来。
 * 这条锁的是「编辑中的节点一个 <text> 都不许画」，含主题文字、kindLabel、
 * 多行，以及资产缺失占位文字（后者曾在 noText 之外，被审查发现后补上）。
 */
describe('编辑态：SVG 不再绘制节点文字（避免与内联编辑器双层重叠）', () => {
  const targetId = (): { layout: ReturnType<typeof assetLayout>['layout']; char: ReturnType<
    typeof assetLayout
  >['char']; id: string } => {
    const { layout, char } = assetLayout();
    // 取一个非根节点（根是 layout.nodes[0]）
    const id = layout.nodes[1]!.node.id;
    return { layout, char, id };
  };

  it('编辑中的节点不渲染任何 <text>，其他节点照常渲染', () => {
    const { layout, char, id } = targetId();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} editingId={id} />
      </ThemeProvider>,
    );
    const editing = container.querySelector(`[data-node-id="${id}"]`);
    expect(editing).not.toBeNull();
    expect(editing!.querySelectorAll('text').length).toBe(0);

    // 其他节点不受影响（否则就是误伤）
    const other = container.querySelector(
      `[data-node-id="${layout.nodes[2]!.node.id}"]`,
    );
    expect(other!.querySelectorAll('text').length).toBeGreaterThan(0);
  });

  it('非编辑态下该节点正常渲染文字（守卫没有过头）', () => {
    const { layout, char, id } = targetId();
    const { container } = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} />
      </ThemeProvider>,
    );
    const node = container.querySelector(`[data-node-id="${id}"]`);
    expect(node!.querySelectorAll('text').length).toBeGreaterThan(0);
  });

  it('资产加载失败时：非编辑态显示占位文字，编辑态不显示（虚线诊断框仍保留）', () => {
    const { layout, char } = assetLayout();
    // layout.nodes[1] 是 @img 实体节点（资产预览）
    const id = layout.nodes[1]!.node.id;

    // ① 非编辑态：触发 image 加载失败 → 应出现「✕ 资产缺失」
    const plain = render(
      <ThemeProvider>
        <MapView layout={layout} entities={new Map()} char={char} assetBaseUrl="/" />
      </ThemeProvider>,
    );
    fireEvent.error(plain.container.querySelector('image')!);
    const shown = Array.from(
      plain.container.querySelector(`[data-node-id="${id}"]`)!.querySelectorAll('text'),
    ).map((t) => t.textContent);
    expect(shown).toContain('✕ 资产缺失');
    plain.unmount();

    // ② 编辑态：同样触发失败，但一个 <text> 都不该有
    const editing = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          editingId={id}
        />
      </ThemeProvider>,
    );
    fireEvent.error(editing.container.querySelector('image')!);
    const node = editing.container.querySelector(`[data-node-id="${id}"]`)!;
    expect(node.querySelectorAll('text').length).toBe(0);
    // 虚线框是诊断标识，不是文字 —— 编辑态保留它
    expect(node.querySelector('[data-asset-broken]')).not.toBeNull();
  });
});

/**
 * P0-B ⑥：ScopedObjectUrls 的 LRU 与统一 revoke（R-16 / §6.3）。
 *
 * 为什么放在渲染层测试文件里：LRU 上限的存在理由是「缩略图缓存不无限增长」
 * （§2.4 的 2000 项内存指标），与渲染层的对象生命周期是同一件事的两面；
 * 且这里的断言全部只关心**revoke 时机**，与 NodeG 渲染无关但同属资产生命周期。
 */
describe('P0-B：ScopedObjectUrls（LRU + 按作用域释放）', () => {
  function harness(max = 3) {
    const revoked: string[] = [];
    const urls = new ScopedObjectUrls(
      { revokeObjectURL: (u) => revoked.push(u) },
      max,
    );
    return { urls, revoked };
  }

  it('超上限 → 淘汰最久未用的那个（并 revoke 它）', () => {
    const { urls, revoked } = harness(3);
    urls.set('ws:A::a', 'blob:a');
    urls.set('ws:A::b', 'blob:b');
    urls.set('ws:A::c', 'blob:c');
    urls.set('ws:A::d', 'blob:d'); // 超限 → 淘汰 a
    expect(urls.size).toBe(3);
    expect(urls.has('ws:A::a')).toBe(false);
    expect(revoked).toEqual(['blob:a']);
  });

  it('get 刷新 LRU 位置：刚用过的不被淘汰', () => {
    const { urls } = harness(3);
    urls.set('ws:A::a', 'blob:a');
    urls.set('ws:A::b', 'blob:b');
    urls.set('ws:A::c', 'blob:c');
    urls.get('ws:A::a'); // a 变成最近使用
    urls.set('ws:A::d', 'blob:d'); // 应淘汰 b（最久未用）
    expect(urls.has('ws:A::a')).toBe(true);
    expect(urls.has('ws:A::b')).toBe(false);
  });

  it('同键替换 → revoke 旧 URL（同名替换路径，不泄漏）', () => {
    const { urls, revoked } = harness();
    urls.set('ws:A::a', 'blob:old');
    urls.set('ws:A::a', 'blob:new');
    expect(revoked).toEqual(['blob:old']);
    expect(urls.get('ws:A::a')).toBe('blob:new');
  });

  it('同 URL 重复 set 不 revoke 自己（避免自我作废）', () => {
    const { urls, revoked } = harness();
    urls.set('ws:A::a', 'blob:same');
    urls.set('ws:A::a', 'blob:same');
    expect(revoked).toEqual([]);
  });

  it('releaseScope 按前缀释放：**不影响**其他作用域（A1 的作用域隔离）', () => {
    const { urls, revoked } = harness(10);
    urls.set('ws:A::a', 'blob:A-a');
    urls.set('ws:A::b', 'blob:A-b');
    urls.set('ws:B::a', 'blob:B-a');
    const n = urls.releaseScope('ws:A');
    expect(n).toBe(2);
    expect(revoked.sort()).toEqual(['blob:A-a', 'blob:A-b']);
    expect(urls.has('ws:B::a')).toBe(true); // B 的完好
  });

  it('前缀匹配不会误伤（ws:A 不匹配 ws:A2）', () => {
    const { urls } = harness(10);
    urls.set('ws:A::a', 'blob:1');
    urls.set('ws:A2::a', 'blob:2');
    expect(urls.releaseScope('ws:A')).toBe(1);
    expect(urls.has('ws:A2::a')).toBe(true);
  });

  it('releaseAll 归零并逐个 revoke（组件卸载路径）', () => {
    const { urls, revoked } = harness(10);
    urls.set('ws:A::a', 'blob:1');
    urls.set('ws:B::b', 'blob:2');
    expect(urls.releaseAll()).toBe(2);
    expect(urls.size).toBe(0);
    expect(revoked.length).toBe(2);
  });

  it('release 不存在的键 → 无操作、不抛（幂等）', () => {
    const { urls, revoked } = harness();
    expect(() => urls.release('ws:A::nope')).not.toThrow();
    expect(revoked).toEqual([]);
  });
});

/**
 * ── P0-FIX-R1 R1-2：五态资产解析的渲染面 ──────────────────────────────────
 *
 * 字符串契约（`resolveAssetUrl`）把「解析出来了」与「没解析出来」压成同一个
 * `undefined`，渲染端只能回落 `baseUrl + id` —— 对 `assets/` 引用那是**必然 404** 的
 * 站点根路径：用户看到一次无意义的加载失败 + ✕，而且 `@draw:data:` 这类自包含引用
 * 也会被它误伤（N4 同根）。五态把三件事分开了，这里逐条钉住。
 */
describe('NodeG：五态解析（R1-2）', () => {
  /** 单节点资产布局：`kind` 决定实体类型，`id` 决定引用形态 */
  function singleAssetLayout(kind: 'img' | 'draw', id: string) {
    const root = makeTextNode('根', [makeEntityNode({ kind, id })]);
    const editable = astToEditable(root);
    if (!editable) throw new Error('fixture broken: astToEditable returned null');
    const char = createCharMeasure({ family: 'sans-serif', size: 11 }, null);
    return { layout: layoutMindmap(editable, createNodeMeasure(char, new Map()), new Set()), char };
  }

  function hrefsOf(container: HTMLElement): Array<string | null> {
    return Array.from(container.querySelectorAll('image')).map((i) => i.getAttribute('href'));
  }

  it('resolved → 用宿主给的 URL 出图（不透传 baseUrl 拼接）', () => {
    const { layout, char } = singleAssetLayout('img', 'assets/a 2.png');
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetState={() => ({ kind: 'resolved', url: 'blob:primed-a2' })}
        />
      </ThemeProvider>,
    );
    expect(hrefsOf(container)).toContain('blob:primed-a2');
  });

  it('pending → **不出图**：既没有 <image>，也没有 ✕ 断图占位', () => {
    const { layout, char } = singleAssetLayout('img', 'assets/a 2.png');
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetState={() => ({ kind: 'pending', reason: 'scope-loading' })}
        />
      </ThemeProvider>,
    );
    // 不出图
    expect(hrefsOf(container)).toEqual([]);
    // 也不画断图（这正是「加载中」与「真缺失」必须分开的理由）
    expect(container.querySelector('[data-asset-broken]')).toBeNull();
    // 更不能回落一个必然 404 的站点根地址
    expect(hrefsOf(container)).not.toContain('/assets/a 2.png');
  });

  it('unresolved(missing) → **保留 ✕ 资产缺失信号**，且不发起必然 404 的加载', () => {
    const { layout, char } = singleAssetLayout('img', 'assets/gone.png');
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetState={() => ({ kind: 'unresolved', reason: 'missing' })}
        />
      </ThemeProvider>,
    );
    // 用户信号不得因「隐藏 404」而消失
    expect(container.querySelector('[data-asset-broken]')).not.toBeNull();
    // 没有 <image> → 也就没有那次必然失败的请求
    expect(hrefsOf(container)).toEqual([]);
    expect(container.querySelector('[data-asset-broken]')?.textContent).toContain('资产缺失');
  });

  it('unresolved(no-scope) → 同样保留 ✕（未挂载不是「没有这张图」，但信号一致）', () => {
    const { layout, char } = singleAssetLayout('img', 'assets/a.png');
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetState={() => ({ kind: 'unresolved', reason: 'no-scope' })}
        />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-asset-broken]')).not.toBeNull();
    expect(hrefsOf(container)).toEqual([]);
  });

  it('N4 同根：`@draw:data:` 自包含引用在未接五态时也能出图（data: 特判不靠宿主）', () => {
    const dataUrl = 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E';
    const { layout, char } = singleAssetLayout('draw', dataUrl);
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          // 宿主实现五态：data: 应直接 resolved（不经任何缓存/磁盘查找）
          resolveAssetState={(ref) =>
            ref.id.startsWith('data:') ? { kind: 'resolved', url: ref.id } : undefined
          }
        />
      </ThemeProvider>,
    );
    expect(hrefsOf(container)).toContain(dataUrl);
    expect(container.querySelector('[data-asset-broken]')).toBeNull();
  });

  it('未提供 resolveAssetState → 回落旧字符串契约（升级前行为逐字不变）', () => {
    const { layout, char } = singleAssetLayout('img', 'assets/a.png');
    const { container } = render(
      <ThemeProvider>
        <MapView
          layout={layout}
          entities={new Map()}
          char={char}
          assetBaseUrl="/"
          resolveAssetState={() => undefined}
          resolveAssetUrl={(ref) => `blob:legacy-${ref.id}`}
        />
      </ThemeProvider>,
    );
    expect(hrefsOf(container)).toContain('blob:legacy-assets/a.png');
  });
});
