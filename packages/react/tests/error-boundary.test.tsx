// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ErrorBoundary } from '../src/chrome/ErrorBoundary.js';

/** 必炸子组件 */
function Bomb({ boom }: { boom: boolean }): never | null {
  if (boom) throw new Error('测试崩溃：画布渲染失败');
  return null;
}

describe('ErrorBoundary（S3：应用级崩溃边界）', () => {
  it('子组件崩溃 → fallback 出现（错误摘要 + 恢复提示 + 重载按钮）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, getByRole } = render(
      <ErrorBoundary>
        <Bomb boom />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('画布遇到问题');
    expect(container.textContent).toContain('测试崩溃：画布渲染失败');
    expect(container.textContent).toContain('最近');
    expect(getByRole('button', { name: '重载页面' })).not.toBeNull();
    spy.mockRestore();
  });

  it('正常子树 → 不出现 fallback', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(
      <ErrorBoundary>
        <div data-ok>正常内容</div>
      </ErrorBoundary>,
    );
    expect(container.querySelector('[data-ok]')).not.toBeNull();
    expect(container.textContent).not.toContain('画布遇到问题');
    spy.mockRestore();
  });
});
