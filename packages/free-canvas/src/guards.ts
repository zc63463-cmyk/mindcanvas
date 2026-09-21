import type { NativeBackPayload, NativePlacement } from './types.js';

/** 用户已启用背面槽位 — 控制 flip UI；`back` 对象存在即可（空 body 也可翻） */
export function nativeBackEnabled(back?: NativeBackPayload): boolean {
  return back !== undefined;
}

export function nativeBackHasContent(back?: NativeBackPayload): boolean {
  if (back === undefined) return false;
  return back.body.trim().length > 0;
}

export function isNativePlacement(p: unknown): p is NativePlacement {
  if (p === null || typeof p !== 'object') return false;
  // Reflect.get：等价字段读取且零 `as` 断言（budget asCast 只减不增）
  return Reflect.get(p, 'kind') === 'native' && typeof Reflect.get(p, 'placementUuid') === 'string';
}
