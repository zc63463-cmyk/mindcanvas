/**
 * 链接协议安全化：渲染层统一过滤 href，拒绝可执行 scheme（javascript/data/vbscript/file）。
 * 放行 http/https、scheme-relative(//) 与相对路径；无 href 白名单的链接按纯文本渲染。
 */

const BLOCKED_SCHEME = /^(javascript|data|vbscript|file):/i;

/** 返回安全 href；危险 scheme/空值返回 null（调用方按纯文本渲染） */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  const s = href.trim();
  if (!s) return null;
  if (BLOCKED_SCHEME.test(s)) return null;
  return s;
}
