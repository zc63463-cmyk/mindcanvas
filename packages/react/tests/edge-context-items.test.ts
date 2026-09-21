/**
 * edgeContextItems（R4-1）：边右键菜单项纯数据。
 *
 * 禁用矩阵（测试钉死，不预设）：
 * - 编辑 / 重挂源锚 / 重挂靶锚 / 反向 / 复制一条 / 失效(恢复) / 删除 七项固定产出；
 *   对应回调缺省 → 该项禁用（宿主可按能力逐步接线，R4-2/R4-4 增量启用）
 * - manual 存在 → 重挂**不禁用**（R2 起重挂与 manual 正交）
 * - 源/靶任一未解析 → 反向 / 复制一条 仍可用（数据操作不依赖解析）
 * - invalidAt 有无 → 失效 / 恢复 动态文案
 */
import { describe, expect, it, vi } from 'vitest';
import { edgeContextItems, type EdgeContextFacts } from '../src/edit/edgeContextItems.js';

function facts(overrides: Partial<EdgeContextFacts> = {}): EdgeContextFacts {
  return {
    key: 'e0',
    rel: 'causes', // 成对反向（reverseOf → isCausedBy）
    dir: 'fwd',
    hasManual: false,
    sourceResolved: true,
    targetResolved: true,
    relRegistered: true,
    relSymmetric: false,
    ...overrides,
  };
}

const allActions = {
  onEdit: vi.fn(),
  onReattach: vi.fn(),
  onReverse: vi.fn(),
  onDuplicate: vi.fn(),
  onToggleInvalid: vi.fn(),
  onDelete: vi.fn(),
};

describe('edgeContextItems（R4-1）', () => {
  it('全回调注入 → 七项齐全：编辑/失效/删除（常用）+ 重挂源锚/重挂靶锚/反向/复制一条（锚与方向）', () => {
    const items = edgeContextItems(facts(), allActions);
    expect(items.map((i) => i.label)).toEqual([
      '编辑',
      '失效（可恢复）',
      '删除',
      '重挂源锚',
      '重挂靶锚',
      '反向',
      '复制一条',
    ]);
    expect(items.find((i) => i.label === '删除')?.danger).toBe(true);
    expect(items.find((i) => i.label === '编辑')?.section).toBe('常用');
    expect(items.find((i) => i.label === '重挂源锚')?.section).toBe('锚与方向');
  });

  it('invalidAt 存在 → 文案切「恢复」', () => {
    const items = edgeContextItems(facts({ invalidAt: '2026-09-13T00:00:00.000Z' }), allActions);
    expect(items.map((i) => i.label)).toContain('恢复');
    expect(items.map((i) => i.label)).not.toContain('失效（可恢复）');
  });

  it('回调缺省 → 对应项禁用（宿主增量接线的兼容路径）', () => {
    const items = edgeContextItems(facts(), {
      onEdit: allActions.onEdit,
      onDelete: allActions.onDelete,
    });
    const byLabel = new Map(items.map((i) => [i.label, i]));
    expect(byLabel.get('编辑')?.disabled).toBeUndefined();
    expect(byLabel.get('删除')?.disabled).toBeUndefined();
    expect(byLabel.get('重挂源锚')?.disabled).toBe(true);
    expect(byLabel.get('反向')?.disabled).toBe(true);
    expect(byLabel.get('复制一条')?.disabled).toBe(true);
    expect(byLabel.get('失效（可恢复）')?.disabled).toBe(true);
  });

  it('manual 存在 → 重挂仍可用（R2 起重挂与 manual 正交）', () => {
    const items = edgeContextItems(facts({ hasManual: true }), allActions);
    expect(items.find((i) => i.label === '重挂源锚')?.disabled).toBeUndefined();
    expect(items.find((i) => i.label === '重挂靶锚')?.disabled).toBeUndefined();
  });

  it('源/靶任一未解析 → 反向 / 复制一条 仍可用（数据操作不依赖解析）', () => {
    const items = edgeContextItems(
      facts({ sourceResolved: false, targetResolved: false }),
      allActions,
    );
    expect(items.find((i) => i.label === '反向')?.disabled).toBeUndefined();
    expect(items.find((i) => i.label === '复制一条')?.disabled).toBeUndefined();
  });

  it('对称 / 未注册 rel → 反向仍可用（R4-A2：rel 不变 + 提示，不阻断）', () => {
    const symmetric = edgeContextItems(facts({ relSymmetric: true }), allActions);
    expect(symmetric.find((i) => i.label === '反向')?.disabled).toBeUndefined();
    const unregistered = edgeContextItems(
      facts({ rel: 'weird-rel', relRegistered: false }),
      allActions,
    );
    expect(unregistered.find((i) => i.label === '反向')?.disabled).toBeUndefined();
  });

  it('onSelect 闭包接到对应动作（编辑/删除/失效各一次）', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onToggleInvalid = vi.fn();
    const items = edgeContextItems(facts(), {
      onEdit,
      onDelete,
      onToggleInvalid,
    });
    items.find((i) => i.label === '编辑')?.onSelect?.();
    items.find((i) => i.label === '删除')?.onSelect?.();
    items.find((i) => i.label === '失效（可恢复）')?.onSelect?.();
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onToggleInvalid).toHaveBeenCalledTimes(1);
  });
});
