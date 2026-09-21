/**
 * F1：森林缓存通道（react 侧全链路）。
 *
 * 判别点：`layoutDemo` 必须把宿主缓存的 `cache / measureKey` 透传到**森林路径**
 * （此前森林分支调用 `layoutForest(centers, measure, collapsed)` 三参形式，
 * 缓存与度量键在接缝处丢失——多中心文档因此从不接管 LayoutCache）。
 *
 * 观测口径：缓存实例上的键位（`collapsedKey / measureKey`）由 kernel 森林入口
 * 统一记录——键被写入即证明通道到达 kernel 侧（不依赖内部 spy）。
 */
import { describe, expect, it } from 'vitest';
import { LayoutCache, type EditableNode } from '@mindcanvas/kernel';
import { buildCenterSpecs, layoutDemo } from '../src/demo/pipeline.js';
import { collectCenters, upsertCenter } from '../src/render/centers.js';

function t(id: string, children: EditableNode[] = []): EditableNode {
  return { id, type: 'text', text: id, children };
}

const char = (): number => 6;

const AT_WORK = 'node:总览/工作';

function forestDoc(): EditableNode {
  const base = t('总览', [t('工作', [t('项目A'), t('项目B')]), t('生活', [t('健身')])]);
  return { ...base, note: upsertCenter(undefined, AT_WORK, { dir: 'right', x: 400, y: 0 }) };
}

describe('F1：森林缓存通道（layoutDemo → layoutForest）', () => {
  it('★ 多中心文档：cache / measureKey 透传到森林入口（键被记录）', () => {
    const root = forestDoc();
    const specs = buildCenterSpecs(root, collectCenters(root));
    expect(specs).not.toBeNull();

    const cache = new LayoutCache();
    const collapsed = new Set<string>();
    expect(cache.collapsedKey).toBeNull();

    const demo = layoutDemo(
      root,
      new Map(),
      char,
      collapsed,
      null,
      cache,
      'K-demo',
      null,
      new Set(),
      specs,
    );

    expect(cache.collapsedKey).toBe(collapsed);
    expect(cache.measureKey).toBe('K-demo');
    // 输出仍是完整森林（通道不改变形状）
    expect(demo.layout.nodes.length).toBeGreaterThan(0);
  });

  it('measureKey 变化 → 森林路径同样作废缓存（身份比较契约在入口统一执行）', () => {
    const root = forestDoc();
    const specs = buildCenterSpecs(root, collectCenters(root));
    const cache = new LayoutCache();
    const collapsed = new Set<string>();

    layoutDemo(root, new Map(), char, collapsed, null, cache, 'K1', null, new Set(), specs);
    expect(cache.measureKey).toBe('K1');

    layoutDemo(root, new Map(), char, collapsed, null, cache, 'K2', null, new Set(), specs);
    expect(cache.measureKey).toBe('K2');
    expect(cache.collapsedKey).toBe(collapsed);
  });

  it('无 cache 调用（第三参缺省）→ 不抛错、森林输出不变', () => {
    const root = forestDoc();
    const specs = buildCenterSpecs(root, collectCenters(root));

    const noCache = layoutDemo(
      root,
      new Map(),
      char,
      new Set(),
      null,
      undefined,
      undefined,
      null,
      new Set(),
      specs,
    );
    const withCache = layoutDemo(
      root,
      new Map(),
      char,
      new Set(),
      null,
      new LayoutCache(),
      'K',
      null,
      new Set(),
      specs,
    );

    expect(noCache.layout.nodes.length).toBe(withCache.layout.nodes.length);
    expect(noCache.layout.nodes.length).toBe(6);
  });
});
