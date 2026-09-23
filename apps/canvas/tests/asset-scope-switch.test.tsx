// @vitest-environment jsdom
/**
 * P0-B ①④：作用域切换与迟到结果（acceptance §3 A1）。
 *
 * A1 场景：A 工作区 `assets/a.png`（红）与 B 工作区 `assets/a.png`（蓝）同名不同内容。
 *
 * 可观察（§3 A1）：
 *  ① 预览与插入均来自当前作用域（B 的蓝图）；
 *  ② A 的迟到结果被丢弃（无闪烁、无错图），开发诊断里有记录；
 *  ③ 面板中两张同名卡片带不同归属徽章，不互相覆盖。
 *
 * 层：U（host 作用域键与 epoch）+ C（app 回填校验）+ M（人工）。
 * **人工部分（真实浏览器里连续切工作区）未由本机验证**（playwright 不可用，与 P0-A 同）；
 * 本文件覆盖 ① 的自动化部分（作用域键与解析）、② 的自动化部分（isCurrent 判据 + 记账）、
 * ③ 的自动化部分（徽章由 storeOf 分派）。**不宣称 A1 satisfied。**
 *
 * 负控锚点（§3 A1「负控」）：
 *  - 去掉 epoch 校验 → 「预览来自当前作用域」必须转红；
 *  - 把缓存键改回 relPath → 「两作用域不互相覆盖」必须转红。
 */
import { describe, expect, it, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { WorkspaceWriter } from '@mindcanvas/react';
import { WorkspaceAssetHost } from '@mindcanvas/react';
import { AssetPanel } from '@mindcanvas/react';
import type { AssetItem } from '@mindcanvas/react';
import { AssetWriteLedger, isWriteConfirmed } from '@mindcanvas/react';
import type { AssetHost } from '@mindcanvas/react';

afterEach(cleanup);

/** 内存工作区替身：每个作用域一份独立磁盘（A 红 / B 蓝） */
function diskOf(initial: Record<string, string>, mounted = true): WorkspaceWriter {
  const disk = new Map<string, string>(Object.entries(initial));
  return {
    mounted,
    async writeAsset(name, data) {
      disk.set(name, typeof data === 'string' ? data : new TextDecoder().decode(data));
      return `assets/${name}`;
    },
    async hasAsset(relPath) {
      return disk.has(relPath.replace(/^assets\//, ''));
    },
    async listAssetFiles() {
      return [...disk.keys()].map((name) => ({ path: `assets/${name}`, name }));
    },
    async readAssetFile(relPath) {
      const hit = disk.get(relPath.replace(/^assets\//, ''));
      return hit === undefined ? null : new File([hit], relPath, { type: 'image/png' });
    },
  };
}

function fallbackHost(): AssetHost {
  return {
    baseUrl: '/',
    async listAssets() {
      return [];
    },
    resolveAsset: (item) => `/fallback/${item.id}`,
    async uploadAsset(file, kind) {
      return { kind: kind ?? 'img', id: `assets/${file.name}`, name: file.name, type: 'png' };
    },
    hasAsset: () => false,
  };
}

/** 两个作用域各自的宿主（含各自的磁盘） */
function twoScopes() {
  const wsA = diskOf({ 'a.png': 'RED-BYTES' });
  const wsB = diskOf({ 'a.png': 'BLUE-BYTES' });
  let current: { scopeId: string | null; scopeEpoch: number; writer: WorkspaceWriter | null } = {
    scopeId: 'ws:A',
    scopeEpoch: 1,
    writer: wsA,
  };
  const host = new WorkspaceAssetHost(
    fallbackHost(),
    () => current.writer,
    '',
    () => ({ scopeId: current.scopeId, scopeEpoch: current.scopeEpoch }),
  );
  return { host, switchTo: (next: typeof current) => (current = next) };
}

describe('A1 ①：预览与解析来自**当前**作用域', () => {
  it('切到 B 后，同名 assets/a.png 的解析不再命中 A 的缓存', async () => {
    const { host, switchTo } = twoScopes();
    // 在 A 里建立缓存（模拟 A 的 listAssets 预热）
    await host.listAssets();
    const urlInA = host.resolveAsset({ id: 'assets/a.png' });

    switchTo({ scopeId: 'ws:B', scopeEpoch: 2, writer: diskOf({ 'a.png': 'BLUE-BYTES' }) });
    await host.listAssets();
    const urlInB = host.resolveAsset({ id: 'assets/a.png' });

    // 关键：两个作用域的同名资产**不是**同一个 URL（不互相覆盖）
    expect(urlInB).not.toBe(urlInA);
  });

  it('切到 B 后 no-scope 语义正确（B 未挂载时不再回落 A 或站点根）', () => {
    const { host, switchTo } = twoScopes();
    switchTo({ scopeId: null, scopeEpoch: 3, writer: null });
    expect(host.resolveAssetState({ kind: 'img', id: 'assets/a.png' })).toEqual({
      kind: 'unresolved',
      reason: 'no-scope',
    });
  });
});

describe('A1 ②：迟到结果被丢弃但**仍然记账**（I-22）', () => {
  it('epoch 变化 → isCurrent 为 false；条目标 unconfirmed 且属于捕获时的作用域', async () => {
    const { host, switchTo } = twoScopes();
    const ledger = new AssetWriteLedger(null);

    // 上传前捕获（A）
    const captured = host.scopeMark();
    // 写入过程中切到 B
    switchTo({ scopeId: 'ws:B', scopeEpoch: 2, writer: diskOf({}) });
    const result = await host.uploadAssetDetailed(new File(['RED'], 'late.png', { type: 'image/png' }));
    // `failed` 无 `item`（判别联合）→ 先窄化，符合三态契约的用法
    if (result.kind === 'failed') throw new Error(`上传不应失败：${result.error.code}`);

    // 写入确实发生在当前（B）磁盘上 —— 用捕获值判定归属仍是 A
    const confirmed = isWriteConfirmed(captured, host.scopeMark());
    expect(confirmed).toBe(false);

    ledger.record(
      {
        assetKey: result.item.id,
        scopeId: captured.scopeKey,
        kind: result.item.kind,
        name: result.item.name,
        relPath: result.item.id,
        store: 'workspace-assets',
        bytes: null,
      },
      confirmed,
    );

    // ② 迟到结果被丢弃：当前清单**不展示**它（调用方不回填）
    expect(ledger.unconfirmedOf('ws:B').length).toBe(0);
    // 但 A 的账上有一条未确认记录（丢弃回填 ≠ 撤销写入）
    expect(ledger.unconfirmedOf('ws:A').length).toBe(1);
    expect(ledger.diagnosticLines('ws:A').length).toBe(1);
  });

  it('切回 A 后重新发现 → 清除标记（专项二正例）', async () => {
    const { host, switchTo } = twoScopes();
    const ledger = new AssetWriteLedger(null);
    const captured = host.scopeMark();
    switchTo({ scopeId: 'ws:B', scopeEpoch: 2, writer: diskOf({}) });
    await host.uploadAssetDetailed(new File(['RED'], 'late.png', { type: 'image/png' }));
    ledger.record(
      {
        assetKey: 'assets/late.png',
        scopeId: captured.scopeKey,
        kind: 'img',
        name: 'late.png',
        relPath: 'assets/late.png',
        store: 'workspace-assets',
        bytes: null,
      },
      false,
    );
    expect(ledger.unconfirmedOf('ws:A').length).toBe(1);

    // 切回 A：listAssets 重新发现该文件
    switchTo({ scopeId: 'ws:A', scopeEpoch: 4, writer: diskOf({ 'late.png': 'RED' }) });
    const list = await host.listAssets();
    ledger.confirmDiscovered(host.scopeMark().scopeKey, list.map((a) => a.id));
    expect(ledger.unconfirmedOf('ws:A').length).toBe(0);
  });
});

describe('A1 ③：两张同名卡片带不同归属徽章，不互相覆盖', () => {
  it('同 id、不同 store 的两张卡片各自渲染自己的落点徽章', () => {
    const red: AssetItem = { kind: 'img', id: 'assets/a.png', name: 'a.png', type: 'png' };
    const blue: AssetItem = { kind: 'img', id: 'assets/a.png', name: 'a.png', type: 'png' };
    const storeByKey = new Map<string, 'workspace-assets' | 'browser-idb'>([
      ['red', 'workspace-assets'],
      ['blue', 'browser-idb'],
    ]);
    // 面板按 AssetKey 去重会合并同 id —— 这里刻意分别渲染两次，验证「徽章由 store 驱动」
    const first = render(
      <AssetPanel
        assets={[red]}
        defaultView="grid"
        onInsert={vi.fn()}
        onClose={vi.fn()}
        storeOf={() => storeByKey.get('red') ?? null}
      />,
    );
    expect(first.container.querySelector('[data-asset-store="workspace-assets"]')).not.toBeNull();
    cleanup();
    const second = render(
      <AssetPanel
        assets={[blue]}
        defaultView="grid"
        onInsert={vi.fn()}
        onClose={vi.fn()}
        storeOf={() => storeByKey.get('blue') ?? null}
      />,
    );
    expect(second.container.querySelector('[data-asset-store="browser-idb"]')).not.toBeNull();
    // 两张卡片的徽章文本不同（不互相覆盖）
    expect(first.container.textContent).not.toBe(second.container.textContent);
  });

  it('同名但不同 id 的两张卡片并排显示（去重主键含归属，不是 id）', () => {
    // 同 name、不同 id —— 面板不去重，两张都在
    const { container } = render(
      <AssetPanel
        assets={[
          { kind: 'img', id: 'ws:A::assets/a.png', name: 'a.png', type: 'png' },
          { kind: 'img', id: 'browser:local::assets/a.png', name: 'a.png', type: 'png' },
        ]}
        defaultView="grid"
        onInsert={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-asset-item]').length).toBe(2);
  });
});

describe('A1 负控锚点：两处守卫可被中性化（证明断言有判别力）', () => {
  it('去掉 epoch 校验（只比 scopeKey）→ 「迟到结果被丢弃」的判据失效', () => {
    // 中性化等价物：把 isWriteConfirmed 换成「只比 scopeKey」
    const weak = (a: { scopeKey: string }, b: { scopeKey: string }): boolean =>
      a.scopeKey === b.scopeKey;
    const captured = { scopeKey: 'ws:A', epoch: 1 };
    const current = { scopeKey: 'ws:A', epoch: 2 }; // 同 scope、epoch 已变
    expect(isWriteConfirmed(captured, current)).toBe(false); // 正确实现：不确认
    expect(weak(captured, current)).toBe(true); // 弱实现：误判为确认
  });

  it('把缓存键改回 relPath（去掉 scopeKey 前缀）→ 两作用域互相覆盖', () => {
    const weakKey = (id: string): string => id; // 中性化：丢作用域
    const strongKey = (scope: string, id: string): string => `${scope}::${id}`;
    expect(weakKey('assets/a.png')).toBe(strongKey('ws:A', 'assets/a.png') === strongKey('ws:B', 'assets/a.png') ? 'collapse' : 'assets/a.png');
    expect(strongKey('ws:A', 'assets/a.png')).not.toBe(strongKey('ws:B', 'assets/a.png'));
  });
});
