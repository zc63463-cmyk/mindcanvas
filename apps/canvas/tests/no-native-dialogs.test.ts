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
 *
 * 读源码的方式（DELIVERY-CLOSE Task 2）：用 Vite 的 `?raw` glob，而不是 `node:fs`
 * —— 这样 canvas 的测试类型检查不必引入 @types/node（不新增依赖、不动 lockfile），
 * 语义不变：仍然是「静态扫源码文本」。
 */
import { describe, expect, it } from 'vitest';

/** 源码文本（键 = 相对本文件的路径，如 `../src/App.tsx`） */
const SOURCES: Record<string, string> = import.meta.glob('../src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** 存量例外：**已全部清除**（2026-09-12 债务腾挪批次 A）——空集保留：防将来回潮 */
const ALLOW = new Set<string>();

/** 裸调用（排除 `settleConfirm(` / `window.confirm(` 这类：前一个字符是词字符或点号即不算裸调用） */
const NATIVE_DIALOG = /(?<![\w.$])(confirm|prompt|alert)\s*\(/;

/** `../src/App.tsx` → `App.tsx`（与旧实现同一口径：相对 src/ 的路径） */
const relOf = (key: string): string => key.replace(/^\.\.\/src\//, '');

/**
 * 原生对话框**词形**（P0-C 加固，见「守卫加固」用例）。
 *
 * 原正则 `(?<![\w.$])(confirm|prompt|alert)\s*\(` 有一条**实测洞**：
 * 它的后行否定里含 `.`，于是 `window.confirm(` / `self.alert(` 这类**限定调用**
 * 反而被排除在外 —— 而它们恰恰是最常见的写法。我用一条临时的
 * `if (window.confirm('?'))` 注入 `assetNotices.ts` 验证过：
 * 旧正则命中 0 次，6 条守卫用例全绿（假绿）。
 *
 * 现在改成只排除**前面紧邻的普通标识符字符**（即排除 `settleConfirm(` /
 * `myConfirm(` 这类自定义名字），`window.` / `self.` / `globalThis.` 一律命中。
 * 代价是会把 `prettier.confirm(` 这类合法调用也算词形 —— 可接受：
 * 只需登记一次（见 `KNOWN_NON_DIALOG_HITS`），换来「真调用跑不掉」。
 */
const NATIVE_DIALOG_HITS = /(?<![\w])(confirm|prompt|alert)\s*\(/g;

/**
 * 归一化重音符号：`⚡confirm(` 这类写法在目视上极容易被读成方法调用，
 * 但后行否定看到的前一个字符是 `⚡`（非 `\w`）→ 仍会命中，符合预期。
 * 这里只做一层廉价确认：命中前的字符若是**普通标识符字符**才可能是自定义名字，
 * 该情形已被正则排除，故命中即可疑。
 */
const contextOfHit = (src: string, index: number): string => src.slice(Math.max(0, index - 16), index);

describe('画布壳体：原生对话框守卫（webview 静默吞掉 → 功能假死）', () => {
  it('除白名单外，不得使用 confirm / prompt / alert', () => {
    const hits: string[] = [];
    for (const [key, src] of Object.entries(SOURCES)) {
      const rel = relOf(key);
      if (ALLOW.has(rel)) continue;
      if (NATIVE_DIALOG.test(src)) hits.push(rel);
    }
    expect(hits, `新增原生对话框（webview 下会假死），请改用自定义 UI：${hits.join(', ')}`).toEqual([]);
  });

  it('白名单里的文件仍真实存在（防清单腐烂）', () => {
    const all = new Set(Object.keys(SOURCES).map(relOf));
    for (const rel of ALLOW) expect(all.has(rel), `白名单失效：${rel} 已不存在`).toBe(true);
  });
});

/**
 * 记录**已知的非文案例外**：这些 `.ts` 文件里出现 `alert(` / `prompt(` 等词形，
 * 但它们是组件 / 局部变量，不是原生对话框。
 *
 * 为什么需要这张表：`assetNotices.ts`（P0-C 唯一文案事实源）加入扫描面后，
 * 「画布壳体不得弹原生对话框」这条守卫就**必须**覆盖新文案源 —— 但纯正则
 * `(?<![\w.$])(alert|prompt|confirm)\s*\(` 会误伤合法的标识符（如
 * `useUnsavedTransition` 的 UI 状态变量 `prompt`）。用「按名字白名单整个文件」
 * 会留下大片盲区，所以这里**按命中片段**逐条登记，并要求：
 *  1. 每条都必须**真实出现**（防清单腐烂 —— 否则将来命中消失、例外还挂着）；
 *  2. 出现**次数**必须与登记值**精确相等**（多一处 → 红：新命中必须被人看过）。
 *
 * 这不是放行「新增原生对话框」：真调用会新增命中 → 计数不符 → 用例失败。
 *
 * **实测基线：本表为空**（2026-09-23，`node` 脚本按同一正则扫 `apps/canvas/src/**`
 * 共 68 个 `.ts`/`.tsx`，命中数为 0）。空表是正确状态 —— 存量例外在
 * 2026-09-12 债务腾挪批次 A 已清零，这里继续留空以防回潮。
 * 新增条目必须在注释里写明「为什么它不是原生对话框」。
 */
const KNOWN_NON_DIALOG_HITS: Record<string, Record<string, number>> = {};

/** 全部 native-dialog 词形命中（只留名字，便于报错时人眼定位） */
function dialogHits(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(NATIVE_DIALOG_HITS)) out.push(`${m[1]}(`);
  return out;
}

describe('画布壳体：原生对话框守卫 —— P0-C 新增文案源在范围内', () => {
  /**
   * 本测试的**存在理由**：`?raw` glob 让扫描面自动包含新文件，
   * 但「自动包含」是隐式事实 —— 若将来有人把 glob 收窄成显式清单，
   * `assetNotices.ts` 会**静默**掉出守卫。这条把它钉成显式断言。
   */
  it('assetNotices.ts 在扫描面内（新文案源不得掉出守卫）', () => {
    const all = new Set(Object.keys(SOURCES).map(relOf));
    expect(all.has('assetNotices.ts'), 'assetNotices.ts 未被 ?raw glob 扫到，守卫存在盲区').toBe(true);
  });

  it('assetNotices.ts 里没有任何原生对话框词形（含注释）', () => {
    const src = SOURCES['../src/assetNotices.ts'];
    // 不用非空断言：本用例的前提就是「它必须存在」，不存在即失败才是正确行为
    if (typeof src !== 'string') throw new Error('assetNotices.ts 取不到源码文本 — 守卫存在盲区');
    const hits = dialogHits(src);
    expect(hits, `assetNotices.ts 出现原生对话框词形：${hits.join(', ')}`).toEqual([]);
  });

  it('除已登记的例外外，任何文件都不得出现原生对话框词形', () => {
    const unexplained: string[] = [];
    for (const [key, src] of Object.entries(SOURCES)) {
      const rel = relOf(key);
      if (ALLOW.has(rel)) continue;
      const allowed = KNOWN_NON_DIALOG_HITS[rel] ?? {};
      const srcAll = src as string;
      const remaining = new Map(Object.entries(allowed));
      for (const m of srcAll.matchAll(NATIVE_DIALOG_HITS)) {
        const idx = m.index ?? 0;
        const ctx = contextOfHit(srcAll, idx);
        // 找一个上下文里真实出现、且还有配额的登记键
        let matched: string | null = null;
        for (const pat of remaining.keys()) {
          if ((remaining.get(pat) ?? 0) > 0 && ctx.includes(pat)) {
            matched = pat;
            remaining.set(pat, (remaining.get(pat) ?? 0) - 1);
            break;
          }
        }
        if (matched === null) {
          unexplained.push(`${rel} …${ctx}${m[1]}(`);
        }
      }
    }
    expect(
      unexplained,
      `出现未登记的原生对话框词形（请确认不是 window.confirm/prompt/alert，再登记到 KNOWN_NON_DIALOG_HITS）：\n${unexplained.join('\n')}`,
    ).toEqual([]);
  });

  it('登记表零腐烂：每条登记的片段真实出现且次数精确相等', () => {
    for (const [rel, expected] of Object.entries(KNOWN_NON_DIALOG_HITS)) {
      const key = `../src/${rel}`;
      const src = SOURCES[key];
      expect(typeof src, `登记表里的 ${rel} 已不存在（清单腐烂）`).toBe('string');
      for (const [pat, count] of Object.entries(expected)) {
        const actual = (src as string).split(pat).length - 1;
        expect(actual, `${rel} 的 ${JSON.stringify(pat)} 出现 ${actual} 次，登记为 ${count} 次`).toBe(count);
      }
    }
  });

  /**
   * **守卫加固**（P0-C）：把「限定调用」纳入词形。
   *
   * 这条用例来自一次实测假绿：我用临时改动往 `assetNotices.ts` 里插了
   * `if (window.confirm('?'))`，旧正则 `(?<![\w.$])…` 因后行否定含 `.`
   * 而**命中 0 次**，6 条守卫用例全绿。若不修，本文件吹的「新文案源在守卫范围内」
   * 就是**纸面承诺**：真调用照样溜过去。
   *
   * 下面用**负控**钉死修正后的行为（喂它真实调用片段必须命中），
   * 再用**正控**确认没有把普通标识符误判（否则守卫会天天误报、被人关掉）。
   */
  it('守卫加固：window.confirm / self.alert 这类限定调用也必须命中（负控）', () => {
    const mustHit = [
      "if (window.confirm('?')) return '';",
      "self.alert('x')",
      "globalThis.prompt('name')",
      "confirm('裸调用')",
    ];
    for (const snippet of mustHit) {
      expect(dialogHits(snippet), `漏检：${snippet}`).not.toEqual([]);
    }
  });

  it('守卫加固：普通标识符不得误判（正控，防守卫误报被人关掉）', () => {
    const mustNotHit = [
      'const prompt = null;',
      'return { ready, prompt, blockedNotice };',
      'prompt?.busy ?? false',
      'function UnsavedPrompt() {}',
      'settleConfirm(choice)',
      'confirmState,',
    ];
    for (const snippet of mustNotHit) {
      expect(dialogHits(snippet), `误报：${snippet}`).toEqual([]);
    }
  });
});
