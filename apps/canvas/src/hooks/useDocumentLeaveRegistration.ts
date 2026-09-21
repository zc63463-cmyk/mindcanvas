/**
 * Stage ↔ App 的 leave port 登记桥（MODE-GUARD）。
 *
 * 为什么单独一层：Stage 的端口方法必须读**实时**状态（controller / 会话 / 计时器），
 * 但登记上去的对象必须在整个挂载期内身份稳定（否则每次渲染都会重新登记）。
 * 这里登记一个方法转发的稳定对象，方法体经 ref 调用调用方给的 `buildPort()`。
 *
 * 用 `useLayoutEffect`：登记发生在**首次绘制之前** —— 模式入口不会因为在 effect 之前
 * 被点击而落到「未就绪」分支（jsdom 与真实浏览器同语义）。
 */
import { useLayoutEffect, useRef } from 'react';
import type { DocumentLeavePort } from '../documentLifecycle.js';

export function useLeavePortRegistration(
  register: ((port: DocumentLeavePort | null) => () => void) | undefined,
  buildPort: () => DocumentLeavePort,
): void {
  const buildRef = useRef(buildPort);
  buildRef.current = buildPort;
  useLayoutEffect(() => {
    if (register === undefined) return;
    return register({
      flushEdits: () => buildRef.current().flushEdits(),
      isDirty: () => buildRef.current().isDirty(),
      isSaving: () => buildRef.current().isSaving(),
      waitForIdle: () => buildRef.current().waitForIdle(),
      save: () => buildRef.current().save(),
      suppressPendingAuto: () => buildRef.current().suppressPendingAuto?.(),
    });
  }, [register]);
}
