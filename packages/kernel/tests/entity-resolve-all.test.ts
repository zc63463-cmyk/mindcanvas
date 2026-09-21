/**
 * T4：resolveAll 批量解析单测（K5 镜子一缺口消化）。
 * 部分失败语义：成功入 Map；失败也入 Map 但带 unresolved_reason；resolver 违约抛异常兜底 unreachable。
 */
import { describe, expect, it } from 'vitest';
import {
  type Entity,
  type EntityRef,
  isUnresolved,
  refKey,
  resolveAll,
  unresolvedEntity,
} from '../src/entity/entity.js';

const ok = (kind: string, id: string): Entity => ({
  kind,
  id,
  title: `${kind}#${id}`,
  status: 'open',
  ref: null,
});

describe('resolveAll：批量解析（部分失败语义）', () => {
  it('全量成功：全部入 Map，key = refKey(kind:id)', async () => {
    const resolve = async (ref: EntityRef): Promise<Entity> => ok(ref.kind, ref.id);
    const map = await resolveAll(resolve, [
      { kind: 'issue', id: '1' },
      { kind: 'milestone', id: 'v1' },
    ]);
    expect(map.size).toBe(2);
    expect(map.get('issue:1')?.title).toBe('issue#1');
    expect(map.get('milestone:v1')?.title).toBe('milestone#v1');
  });

  it('部分失败：成功与 unresolved 都在 Map，失败带原因（对账需要全量实际态）', async () => {
    const resolve = async (ref: EntityRef): Promise<Entity> =>
      ref.id === '1' ? ok('issue', '1') : unresolvedEntity(ref, 'not-found');
    const map = await resolveAll(resolve, [
      { kind: 'issue', id: '1' },
      { kind: 'issue', id: '404' },
    ]);
    expect(map.size).toBe(2);
    expect(isUnresolved(map.get('issue:1')!)).toBe(false);
    expect(isUnresolved(map.get('issue:404')!)).toBe(true);
    expect(map.get('issue:404')?.meta?.unresolved_reason).toBe('not-found');
  });

  it('resolver 违约抛异常 → 兜底 unresolved(unreachable)，整体不失败', async () => {
    const resolve = async (ref: EntityRef): Promise<Entity> => {
      if (ref.id === 'boom') throw new Error('network');
      return ok(ref.kind, ref.id);
    };
    const map = await resolveAll(resolve, [
      { kind: 'session', id: '42' },
      { kind: 'session', id: 'boom' },
    ]);
    expect(map.size).toBe(2);
    expect(isUnresolved(map.get('session:42')!)).toBe(false);
    expect(map.get('session:boom')?.meta?.unresolved_reason).toBe('unreachable');
  });

  it('空数组 → 空 Map', async () => {
    const map = await resolveAll(async () => ok('issue', '1'), []);
    expect(map.size).toBe(0);
  });

  it('重复 ref → 后写覆盖（Map key 语义）', async () => {
    const resolve = async (ref: EntityRef): Promise<Entity> => ok(ref.kind, ref.id);
    const map = await resolveAll(resolve, [
      { kind: 'issue', id: '1' },
      { kind: 'issue', id: '1' },
    ]);
    expect(map.size).toBe(1);
    expect(refKey({ kind: 'issue', id: '1' })).toBe('issue:1');
  });
});
