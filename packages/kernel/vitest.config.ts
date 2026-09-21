import { defineConfig } from 'vitest/config';

/**
 * kernel 测试配置。
 * K0 阶段从 T2 起逐步补充单测；passWithNoTests 保证「暂无测试文件」时 test 门禁仍绿，
 * K1 移植协议层 326 测试后移除该可选项。
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,

    // 单进程顺序执行，不建 worker 池。原因见下（2026-09-03 实测）：
    // Windows 下并行 worker 跑 jsdom 测试时，worker 结束但句柄未释放，
    // 主线程等不到 worker 退出 → 测试全部跑完、结果已打印，进程却永不退出，
    // 表现为「pnpm test 卡死」只能用 timeout 杀掉（exit 124）。
    // 副作用是**变快**：并行时每个 worker 各自 transform（react 实测 170s），
    // 单进程复用模块图后降到 1.8s。
    fileParallelism: false,
  },
});
