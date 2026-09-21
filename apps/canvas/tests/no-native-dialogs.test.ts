// @vitest-environment node
/**
 * 原生对话框守卫（2026-09-11 用户实测后补）
 * ══════════════════════════════════════════════════════════════════════
 * IDE 内嵌 webview 会**静默吞掉** confirm / prompt / alert：不是「弹窗被拒」，
 * 而是调用后立即返回 false/undefined、界面毫无反应——
 * 于是「确认后删除」退化成「不弹气泡也删不掉」（Del 键删节点的实测症状：
 * `MindmapStage` 键盘删除路径残留 `confirm()`，右键菜单那批已按裁决 M2 改直删，唯独漏了它）。
 *
 * 规则：画布壳体（apps/canvas/src）不得再引入原生对话框；
 * 存量例外已于 2026-09-12（债务腾挪批次 A）**全部清零**——空集继续保留：防将来回潮。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = new URL('../src/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** 存量例外：**已全部清除**（2026-09-12 债务腾挪批次 A）——空集保留：防将来回潮 */
const ALLOW = new Set<string>();

/** 裸调用（排除 `settleConfirm(` / `window.confirm(` 这类：前一个字符是词字符或点号即不算裸调用） */
const NATIVE_DIALOG = /(?<![\w.$])(confirm|prompt|alert)\s*\(/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(full));
    else if (e.name.endsWith('.ts') || e.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

const relOf = (full: string): string => full.slice(SRC_DIR.length).replace(/\\/g, '/');

describe('画布壳体：原生对话框守卫（webview 静默吞掉 → 功能假死）', () => {
  it('除白名单外，不得使用 confirm / prompt / alert', () => {
    const hits: string[] = [];
    for (const full of sourceFiles(SRC_DIR)) {
      const rel = relOf(full);
      if (ALLOW.has(rel)) continue;
      if (NATIVE_DIALOG.test(readFileSync(full, 'utf8'))) hits.push(rel);
    }
    expect(hits, `新增原生对话框（webview 下会假死），请改用自定义 UI：${hits.join(', ')}`).toEqual([]);
  });

  it('白名单里的文件仍真实存在（防清单腐烂）', () => {
    const all = new Set(sourceFiles(SRC_DIR).map(relOf));
    for (const rel of ALLOW) expect(all.has(rel), `白名单失效：${rel} 已不存在`).toBe(true);
  });
});
