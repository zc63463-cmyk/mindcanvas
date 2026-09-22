import { defineConfig } from 'vitest/config';

/**
 * 反例 / 中性化入口：**仅**由 `test:counterexamples` 显式运行，
 * 绝不被默认 `vitest run` 收集（文件名 `*.counterexample.ts` 与默认
 * `tests/**\/*.test.{ts,tsx}` 模式互不匹配）。
 *
 * NC-5 三入口（计划 §5）：入口 1 在正式套件；入口 2（调用方旧快照逻辑反例）
 * 与入口 3（生产实现中性化）只在此处运行，预期 AssertionError / 退出非零。
 */
export default defineConfig({
  test: {
    include: ['tests/counterexamples/**/*.counterexample.ts'],
    environment: 'node',
    fileParallelism: false,
  },
});
