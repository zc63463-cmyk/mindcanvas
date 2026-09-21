/**
 * 实体输入转义（N4：M1 已知边界清债）。
 * M1 起「提交文本以 @ 开头 → 转实体 picker」，导致无法写 `@xxx` 纯文本。
 * 转义：`@@文本` 或 `\@文本` → 落为纯文本 `@文本`（去掉一个转义符），不触发 picker。
 */
/** 是否为转义输入（写纯文本 @ 内容） */
export function isEscapedEntityInput(text: string): boolean {
  return text.startsWith('@@') || text.startsWith('\\@');
}

/** 反转义：去掉首个转义符（非转义输入原样返回） */
export function unescapeEntityInput(text: string): string {
  if (text.startsWith('@@')) return text.slice(1);
  if (text.startsWith('\\@')) return text.slice(1);
  return text;
}
