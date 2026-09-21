/**
 * 文件系统 API 错误判定（类型守卫，避免 `(e as Error).name` 式断言）。
 *
 * File System Access API 在用户取消选择/保存对话框时抛 DOMException(name='AbortError')，
 * 这不是故障而是一种正常结果，各处调用点都需区分。守卫内部自行收窄，调用方零断言。
 */

/** 是否为用户取消（AbortError）。用 `in` 收窄，不依赖类型断言。 */
export function isAbortError(e: unknown): boolean {
  if (typeof e !== 'object' || e === null) return false;
  if (!('name' in e)) return false;
  return e.name === 'AbortError';
}
