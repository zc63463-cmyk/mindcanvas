import { defineConfig } from 'vitest/config';

/** @mindcanvas/react 测试配置（K3：主题令牌 + 渲染核心 + 翻卡组件；jsdom 用于交互组件） */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'node',

    // 单进程顺序执行，不建 worker 池（2026-09-03 实测定位）：
    // 并行 worker 跑 jsdom 测试时，测试全部通过、结果也打印完了，
    // 进程却永不退出（挂满 timeout，exit 124）——Windows 下 worker 结束但句柄未释放，
    // 主线程一直等它退出。jsdom 默认开启的 pretendToBeVisual 会挂
    // requestAnimationFrame 循环，是句柄来源之一（关掉它进程能退，但会破坏 18 个测试）。
    // 单进程无 worker，绕开该问题；且**更快**：transform 170s → 1.8s（模块图复用）。
    fileParallelism: false,
  },
});
