import { defineConfig, mergeConfig } from 'vitest/config';
// 注意：不要给 './vite.config' 加 .ts 扩展名 —— 实测会让 vitest 加载配置时挂起（SIGTERM）。
// 代价是 Vite 提示 configLoader: 'native' 警告，仅为告警，不影响运行。
import viteConfig from './vite.config';

/**
 * apps/canvas 测试配置。
 *
 * 合并 vite.config.ts 以复用 @mindcanvas 各包 → src 的 alias ——
 * 不加 alias 会解析到 packages 下的 dist 构建产物，测到陈旧代码（与浏览器同坑）。
 * jsdom：应用层组件需要 DOM 环境。
 *
 * 注意：块注释内不要写「星号紧跟斜杠」的字面组合，它会提前终止注释。
 */
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['tests/**/*.test.{ts,tsx}'],
      environment: 'jsdom',

      // 单进程顺序执行，不建 worker 池。同 packages/react/vitest.config.ts：
      // 并行 worker 跑 jsdom 时进程跑完不退出（Windows），单进程无此问题且更快。
      fileParallelism: false,

      // 2026-09-06 实测：pretendToBeVisual 的 rAF 循环让事件循环永不排空——
      // 套件打印完成后进程不退出（pre-push 门禁挂起 480s 超时的根因）。
      // react 包有 18 个测试依赖该行为不能关；canvas 56 个测试实测不依赖（全绿）。
      environmentOptions: {
        jsdom: { pretendToBeVisual: false },
      },
    },
  }),
);
