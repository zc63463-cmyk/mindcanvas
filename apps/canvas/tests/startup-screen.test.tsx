/**
 * 启动页（S2）行为测试
 *
 * 为什么能测：与 `MindmapStage` 不同，`StartupScreen` 是纯 UI 组件
 * （只依赖 CHROME token 与 MindDoc 类型），不挂载画布，jsdom 下不会挂起。
 *
 * 锁住的行为：继续上次 / 最近列表 / 新建 / 看示例 四条路径，
 * 以及「空最近列表时不显示继续上次」「必须提示文件需重新关联」这两个约束。
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { MindDoc } from '@mindcanvas/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StartupScreen } from '../src/StartupScreen';

// 本项目 vitest 未开 globals，@testing-library/react 不会自动注册 cleanup；
// 不手动清理的话多次 render 会累积在同一个 body 里，出现
// "Found multiple elements with the text" 的假失败。
afterEach(() => {
  cleanup();
});

function doc(name: string, ts: number, source = '# 根\n- a\n- b'): MindDoc {
  return { id: name, name, source, saved: true, ts } as MindDoc;
}

function setup(recent: MindDoc[]) {
  const onOpenRecent = vi.fn();
  const onNew = vi.fn();
  const onUseSample = vi.fn();
  render(
    <StartupScreen
      recent={recent}
      onOpenRecent={onOpenRecent}
      onNew={onNew}
      onUseSample={onUseSample}
    />,
  );
  return { onOpenRecent, onNew, onUseSample };
}

describe('StartupScreen · 有最近文档', () => {
  const recent = [doc('最近.mm.md', Date.now() - 60_000), doc('更早.mm.md', Date.now() - 86_400_000)];

  it('把最近的那条作为「继续上次」', () => {
    setup(recent);
    expect(screen.getByText('继续上次')).toBeTruthy();
    expect(screen.getByText('最近.mm.md')).toBeTruthy();
    expect(screen.getByText('更早.mm.md')).toBeTruthy();
  });

  it('点「继续上次」→ 回调收到最近那条', () => {
    const { onOpenRecent } = setup(recent);
    screen.getByText('最近.mm.md').click();
    expect(onOpenRecent).toHaveBeenCalledWith(recent[0]);
  });

  it('点最近列表项 → 回调收到对应文档', () => {
    const { onOpenRecent } = setup(recent);
    screen.getByText('更早.mm.md').click();
    expect(onOpenRecent).toHaveBeenCalledWith(recent[1]);
  });

  it('显示节点数与相对时间', () => {
    setup(recent);
    // '# 根\n- a\n- b' → 3 个节点（两处：继续上次 + 最近列表）
    expect(screen.getAllByText(/3 个节点/).length).toBe(2);
    // 注意：`{n} 个节点 · {时间}` 会被 React 拆成多个文本节点，
    // 元素 textContent 是整串，精确匹配 '1 分钟前' 找不到 —— 用正则部分匹配。
    expect(screen.getByText(/1 分钟前/)).toBeTruthy();
    expect(screen.getByText(/1 天前/)).toBeTruthy();
  });

  it('必须提示：恢复的文档保存时需重新选择原文件', () => {
    setup(recent);
    expect(screen.getByText(/保存时需重新选择原文件/)).toBeTruthy();
  });
});

describe('StartupScreen · 空最近列表（全新用户）', () => {
  it('不显示「继续上次」，也不显示恢复提示', () => {
    setup([]);
    expect(screen.queryByText('继续上次')).toBeNull();
    expect(screen.queryByText(/保存时需重新选择原文件/)).toBeNull();
  });

  it('仍提供新建与看示例入口', () => {
    const { onNew, onUseSample } = setup([]);
    screen.getByText('新建').click();
    screen.getByText('看内置示例').click();
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onUseSample).toHaveBeenCalledTimes(1);
  });
});

describe('StartupScreen · 通用', () => {
  it('点新建 / 看示例触发对应回调', () => {
    const { onNew, onUseSample } = setup([doc('a.mm.md', Date.now())]);
    screen.getByText('新建').click();
    screen.getByText('看内置示例').click();
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onUseSample).toHaveBeenCalledTimes(1);
  });

  it('提示进入后可打开其他文件（启动页不做半成品的「打开…」）', () => {
    setup([doc('a.mm.md', Date.now())]);
    expect(screen.getByText(/进入后点右上角/)).toBeTruthy();
  });
});
