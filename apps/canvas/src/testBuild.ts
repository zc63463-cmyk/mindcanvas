/**
 * 测试构建开关（S2 收口）：把「测试专用接线」与「生产运行时」**在构建期**分开。
 *
 * 背景：R3 需要真实挂载 `MindmapStage` 的测试观测口（`window.__mindcanvasSummaryHost`），
 * 但该入口**不得无条件出现在生产运行时**。隔离手段必须是构建期常量，
 * 而非运行期判断——理由：
 *  - `typeof window !== 'undefined'` 只说明「有 DOM」，浏览器生产环境同样成立，不构成隔离；
 *  - `process.env.NODE_ENV` 在本仓未做明确判断，且 Vite 客户端包里它是被静态替换的裸变量，
 *    在未声明处读取会得到 `undefined`（不报错但也不隔离），属于不可靠判据。
 *
 * 做法：Vite 的 `define` 在**构建期**把 `__MINDCANVAS_TEST_BUILD__` 替换为字面量
 * `true` / `false`。生产 `vite build` 不注入（默认 `false`），Rollup 随即把整块
 * `if` 判为死代码并 tree-shake 掉——因此生产产物里**既没有注册语句，也没有该全局名**。
 * 测试（vitest）经 `define` 注入 `true`，观测口才存在。
 *
 * 用 `declare const` 而不是 `window.__X` / `globalThis.__X`：前者是编译期常量，
 * 可被静态消除；后两者是运行期属性读取，无法被 tree-shake，等于没隔离。
 */
declare const __MINDCANVAS_TEST_BUILD__: boolean | undefined;

/**
 * 是否为测试构建（构建期常量）。
 *
 * 读法用 `typeof` 守卫包住：未注入时该标识符在运行期不存在，直接读取会抛
 * `ReferenceError`；`typeof` 对未声明标识符安全返回 `'undefined'`，于是默认落在
 * `false`（= 生产行为）。这样即使某个构建路径忘了注入，也只会"没有观测口"，
 * 不会崩溃，更不会暴露入口。
 */
export const IS_TEST_BUILD: boolean =
  typeof __MINDCANVAS_TEST_BUILD__ !== 'undefined' && __MINDCANVAS_TEST_BUILD__ === true;
