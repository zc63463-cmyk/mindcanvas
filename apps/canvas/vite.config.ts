import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 解析到 workspace 包源码的绝对路径（不依赖 @types/node）。
 *
 * 两点都不能省，否则路径里带空格就静默解析失败（Vite 报 UNLOADABLE_DEPENDENCY）：
 *  1. `decodeURIComponent`：`.pathname` 是**百分号编码**的 URL 片段，空格会原样变成
 *     `%20`，直接当文件路径用必然 ENOENT。含中文等非 ASCII 路径同理。
 *  2. 盘符前导斜杠：Windows 下 pathname 形如 `/E:/xxx`，剥掉才是可用的 `E:/xxx`。
 *
 * 不用 `node:url` 的 `fileURLToPath`：本包 devDeps 没有 `@types/node`，
 * 引用 `node:url` 会让 `pnpm typecheck`（tsc -b）报 TS2307。
 */
const pkgSrc = (rel: string): string =>
  decodeURIComponent(new URL(rel, import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');

/**
 * canvas 应用构建配置：Vite + React 组合入口（kernel + react 渲染器的消费方）。
 *
 * 注意 `define.__MINDCANVAS_TEST_BUILD__`：这是**构建期**的测试接线开关。
 * 生产构建在此固定注入 `'false'`（见 `src/testBuild.ts` 的长注释），
 * 于是 `MindmapStage` 里的测试观测口整块被 Rollup 判死并 tree-shake —— 生产产物中
 * 既无注册语句也无该全局名。测试侧由 `vitest.config.ts` 覆盖为 `'true'`。
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 直接吃 workspace 包的**源码**，而不是 packages/*/dist 构建产物。
      //
      // 不加这两个 alias 时，@mindcanvas/* 会按 package.json 的 exports 解析到
      // dist/index.js —— 改了源码却忘了 `npm run build`，浏览器里跑的仍是旧逻辑，
      // 排查时极易误判为"改动没生效"。这里统一指向 src，HMR 也能实时生效。
      '@mindcanvas/kernel': pkgSrc('../../packages/kernel/src/index.ts'),
      '@mindcanvas/react': pkgSrc('../../packages/react/src/index.ts'),
    },
  },
  define: {
    __MINDCANVAS_TEST_BUILD__: 'false',
  },
  build: {
    rollupOptions: {
      // 多页入口：主应用 + 环形快捷操作（含 ② 二级环沙盒）预览页（dev 下 /radial.html 直接可开）
      input: {
        main: 'index.html',
        radial: 'radial.html',
      },
    },
  },
});
