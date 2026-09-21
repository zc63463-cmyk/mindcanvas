import { describe, expect, it } from 'vitest';
import {
  type Entity,
  type EntityRef,
  type Resolver,
  isUnresolved,
  refKey,
  unresolvedEntity,
} from '../src/entity/entity.js';

/** 测试用 resolver：已知 issue:1 命中，其余按 kind 降级原因返回 unresolved */
function makeTestResolver(): Resolver {
  return {
    async resolve(ref: EntityRef): Promise<Entity> {
      if (ref.kind === 'issue' && ref.id === '1') {
        return { kind: 'issue', id: '1', title: '示例 issue', status: 'open', ref: '#1' };
      }
      return unresolvedEntity(ref, ref.kind === 'unknown' ? 'unknown-kind' : 'not-found');
    },
  };
}

describe('unresolvedEntity 工厂', () => {
  it('保留 kind/id，title/status/ref 降级，并写入 meta.unresolved_reason', () => {
    const ref: EntityRef = { kind: 'session', id: '42' };
    const entity = unresolvedEntity(ref, 'unreachable');
    expect(entity.kind).toBe('session');
    expect(entity.id).toBe('42');
    expect(entity.title).toBeNull();
    expect(entity.status).toBe('unresolved');
    expect(entity.ref).toBeNull();
    expect(entity.meta?.unresolved_reason).toBe('unreachable');
  });
});

describe('isUnresolved 判定', () => {
  it('对 unresolved Entity 返回 true', () => {
    expect(isUnresolved(unresolvedEntity({ kind: 'task', id: '17' }, 'not-found'))).toBe(true);
  });
  it('对已解析 Entity 返回 false', () => {
    const resolved: Entity = { kind: 'issue', id: '1', title: 't', status: 'open', ref: '#1' };
    expect(isUnresolved(resolved)).toBe(false);
  });
});

describe('refKey', () => {
  it('输出 kind:id 形态，可作为 Map key', () => {
    expect(refKey({ kind: 'issue', id: '1' })).toBe('issue:1');
  });
});

describe('Resolver 契约', () => {
  it('已知实体返回已解析 Entity（title/status/ref 填充，非 unresolved）', async () => {
    const resolver = makeTestResolver();
    const entity = await resolver.resolve({ kind: 'issue', id: '1' });
    expect(entity.title).toBe('示例 issue');
    expect(isUnresolved(entity)).toBe(false);
  });
  it('未知 kind 返回 unresolved（unknown-kind），而非抛异常', async () => {
    const resolver = makeTestResolver();
    const entity = await resolver.resolve({ kind: 'unknown', id: 'x' });
    expect(isUnresolved(entity)).toBe(true);
    expect(entity.meta?.unresolved_reason).toBe('unknown-kind');
  });
  it('不存在实体返回 unresolved（not-found），而非抛异常', async () => {
    const resolver = makeTestResolver();
    const entity = await resolver.resolve({ kind: 'task', id: '404' });
    expect(isUnresolved(entity)).toBe(true);
    expect(entity.meta?.unresolved_reason).toBe('not-found');
  });
  it('任何输入都不抛异常（契约保证）', async () => {
    const resolver = makeTestResolver();
    await expect(resolver.resolve({ kind: 'session', id: '42' })).resolves.toBeDefined();
  });
});
