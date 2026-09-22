/**
 * S4 · 生产构建隔离门禁（构建产物口径）。
 *
 * ## 为什么需要一条**产物级**用例
 *
 * `apps/canvas/src/testBuild.ts` 的隔离手段是构建期常量：`vite build` 不注入
 * `__MINDCANVAS_TEST_BUILD__` → `IS_TEST_BUILD === false` → Rollup 把整块判为死代码
 * 并 tree-shake，于是**生产产物里既没有注册语句、也没有该全局名**。
 *
 * 这条链路的每一环都可能被无意打断（例如有人把 `if (IS_TEST_BUILD && …)` 改成运行期
 * 判断、或在别处直接写 `window.__mindcanvasSummaryHost`）。源码级 grep 抓不到「被
 * Rollup 内联后仍留在产物里」的情形 —— 只有**读产物**才算数，故本用例直接扫 dist。
 *
 * ## 读产物的方式（沿用 `no-native-dialogs.test.ts` 的既有约定）
 *
 * 用 Vite 的 `?raw` glob，而**不是** `node:fs` —— 这样 canvas 的测试类型检查
 * 不必引入 `@types/node`（不新增依赖、不动 lockfile）。语义不变：仍是静态读文本。
 *
 * ## S4-R2：产物缺失 = 明确失败（不再静默通过）
 *
 * 原实现在 `files.length === 0` 时 `return`（静默通过），于是「观测口命中 0」这条结论
 * 可被「dist 根本不存在」满足 —— 门禁在最强的地方失效，却看起来是绿的。
 * S4 独立复核把它列为 finding（severity low，非缺陷但属真实缺口）。
 *
 * 现改为：**产物缺失即断言失败**，错误信息写明「先构建」。
 * 这样本用例成为真正的门禁 —— 只有「dist 存在且干净」才能通过。
 * （构建由门禁的 build 步骤保证；本用例不再替它兜底。）
 */
import { describe, expect, it } from 'vitest';

/** dist 下全部 js 文本（键 = 相对本文件的路径；无 dist 时为空对象） */
const DIST_JS: Record<string, string> = import.meta.glob('../dist/**/*.js', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** dist/index.html（用于确认产物真实存在且有入口引用） */
const DIST_HTML: Record<string, string> = import.meta.glob('../dist/index.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const files = Object.keys(DIST_JS);

/** 产物缺失时的统一失败信息（含修复指令，避免读者只看到「expected 0 to be > 0」） */
const MISSING_DIST =
  '生产产物缺失（apps/canvas/dist 下没有 .js）—— 本门禁必须在已构建的产物上运行。' +
  '先执行：cd apps/canvas && <vite build>（或仓库根 pnpm -r build），再重跑本用例。';

describe('S4 · 生产构建：测试观测口零暴露', () => {
  it('dist 内不含 __mindcanvasSummaryHost / __MINDCANVAS_TEST_BUILD__', () => {
    expect(files.length, MISSING_DIST).toBeGreaterThan(0);
    const hits: Array<{ file: string; pat: string; n: number }> = [];
    for (const pat of [
      '__mindcanvasSummaryHost',
      '__MINDCANVAS_TEST_BUILD__',
      'mindcanvasSummaryHost',
    ]) {
      for (const [file, text] of Object.entries(DIST_JS)) {
        const n = text.split(pat).length - 1;
        if (n > 0) hits.push({ file, pat, n });
      }
    }
    expect(hits, `生产产物出现测试观测口：${JSON.stringify(hits)}`).toEqual([]);
  });

  it('资产清单里确有入口 bundle（证明 dist 是真实构建，不是空目录）', () => {
    expect(files.length, MISSING_DIST).toBeGreaterThan(0);
    const mains = files.filter((f) => /main-[A-Za-z0-9_-]+\.js$/.test(f));
    expect(mains.length, '应恰好一个 main-*.js 入口').toBe(1);
    const html = Object.values(DIST_HTML)[0] ?? '';
    expect(html, 'index.html 应引用该入口').toContain(mains[0]?.split('/').pop() ?? '');
  });
});
