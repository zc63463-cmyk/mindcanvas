/**
 * Entity 三件套（K1 接线版）。
 * K1 起 Entity 形状以协议层 types.ts 为准（事实源）：本模块 re-export 协议层实体原语
 * （EntityRef / Entity / UnresolvedReason / unresolvedEntity / refKey），
 * 并保留 K0 独有的 isUnresolved / Resolver 契约 —— 对外 API 不破坏。
 */
export { unresolvedEntity, refKey } from '../protocol/types.js';
export type { Entity, EntityRef, UnresolvedReason } from '../protocol/types.js';

import { refKey, unresolvedEntity } from '../protocol/types.js';
import type { Entity, EntityRef } from '../protocol/types.js';

/** 判断 Entity 是否为 unresolved 降级形态（`meta.unresolved_reason` 存在即视为未解析） */
export function isUnresolved(entity: Entity): boolean {
  return entity.meta?.unresolved_reason != null;
}

/**
 * Resolver 契约：ref → Entity。
 * 契约不变量：失败必须返回 unresolved Entity（见 `unresolvedEntity`），绝不抛异常。
 */
export interface Resolver {
  /** 解析单个实体引用；失败返回 unresolved Entity 而非抛异常 */
  resolve(ref: EntityRef): Promise<Entity>;
}

/**
 * 批量解析全部引用 → Map<refKey, Entity>（镜子一对账场景：一次拉全部实体而非 N 次单查）。
 * 部分失败语义：成功的实体入 Map；失败的也入 Map，但降级为 unresolved（not-found / unreachable）。
 * - resolver 返回 unresolved → 原样入 Map（保留原因）
 * - resolver 抛异常（违约） → 兜底为 unresolved(unreachable)，绝不整体失败
 * 消费者可自行实现批量 HTTP 并在 resolver 覆盖；本函数为纯组合的默认实现。
 */
export async function resolveAll(
  resolve: Resolver['resolve'],
  refs: EntityRef[],
): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  await Promise.all(
    refs.map(async (ref) => {
      let entity: Entity;
      try {
        entity = await resolve(ref);
      } catch {
        entity = unresolvedEntity(ref, 'unreachable');
      }
      out.set(refKey(ref), entity);
    }),
  );
  return out;
}
