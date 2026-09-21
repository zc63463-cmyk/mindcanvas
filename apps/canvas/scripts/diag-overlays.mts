/**
 * 验证 MapView 与拆出的 overlays 模块可正常加载（无循环依赖、无顶层崩溃）。
 *
 * 存在的意义：本环境 vitest 改源码后冷启动会 SIGTERM，
 * 用 vite-node 做等价的「模块可加载」验证更稳定。
 *
 * 运行：cd apps/canvas && npx vite-node scripts/diag-overlays.mts
 */
// 注意扩展名是 .tsx（含 JSX），写 .ts 会 ERR_MODULE_NOT_FOUND
import * as overlays from '../../packages/react/src/render/overlays.tsx';
import { MapView } from '@mindcanvas/react';

console.log('=== overlays 模块导出 ===');
for (const [name, val] of Object.entries(overlays)) {
  console.log(`  ${name.padEnd(24)} ${typeof val}`);
}

const required = ['DescOverlays', 'ExpandCommentOverlay', 'NodeTextOverlay', 'commentAreaH'];
const missing = required.filter((n) => !(n in overlays));
console.log(`\n必需导出: ${missing.length === 0 ? '✅ 齐全' : `❌ 缺失 ${missing.join(', ')}`}`);
console.log(`commentAreaH 值: ${overlays.commentAreaH}`);

console.log('\n=== MapView 模块 ===');
console.log(`  MapView: ${typeof MapView}`);
console.log(`  ${typeof MapView === 'function' ? '✅ 可加载' : '❌ 加载失败'}`);
