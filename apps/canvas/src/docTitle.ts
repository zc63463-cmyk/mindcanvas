/**
 * 文档内部标题提取（P1-A ②）—— **纯函数、零 I/O**。
 * ══════════════════════════════════════════════════════════════════════
 * 搜索内部标题消费的是 docIndex 的既有 `title` 字段（派单书 §3.4：
 * 「只消费 docIndex 既有 title 字段；不加文件读取、不加扫描」）。
 *
 * 标题从**哪来**：文档在应用里本来就是**已加载**状态（要渲染就得读全文），
 * 从内存快照取首个 H1 **不是新扫描、不是新读盘** —— 本函数只接收文本，
 * 调用方（MindmapStage 的载入/保存 effect）把已在手里的快照传进来即可。
 *
 * 与 kernel 解析器同一条规则（`parser.ts` 的 `RE_HEADING`，level 1 分支）：
 * 行首 `#` + 空白 + 标题文本；允许行尾空白。不做 trim 前缀（解析器也不做，
 * 缩进的 `#` 会被当成普通行），避免两套规则对同一份文档给出不同标题。
 *
 * 没有 H1 / H1 为空（`#` 后只有空白）→ null（标题字段是 `string | null`，
 * 空串不是合法标题；也避免空 H1 被搜索匹配到所有文档）。
 */

/** 与 kernel `RE_HEADING` 的 level-1 分支逐字同形（`[ \t]+` 要求井号后至少一个空白） */
const RE_H1 = /^#[ \t]+(.*?)[ \t]*$/;

/** 取首个一级标题文本；无 H1 或空 H1 → null */
export function firstHeadingOf(text: string): string | null {
  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = line.match(RE_H1);
    if (m !== null) {
      const title = m[1] ?? '';
      return title === '' ? null : title;
    }
  }
  return null;
}
