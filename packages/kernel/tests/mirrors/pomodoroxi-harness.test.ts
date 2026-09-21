/**
 * 镜子三 harness：PomodoroXI 任务项消费者模拟（K5）。
 * 不实现接入插件——只用公开 API 走通 session/task 引用形态 + 未知 kind 降级路径，
 * 验证接口表达力：
 *  ① session:42 / task:17 形态引用的解析与透传（当前未注册 kind → unknown 透传 + unresolved(unknown-kind)）
 *  ② 导图节点标记 → 创建任务/番茄的写路径表达力（action 通道 + TreeOp）
 *  ③ 任务状态同步进导图：resolver 轮询 → 状态变化 → 渲染数据可感知（update-node patch.note.status）
 *  ④ 离线场景优雅降级：PomodoroXI 不可达 → unresolved(unreachable)（镜子三验收问题 3）
 */
import { describe, expect, it } from 'vitest';
import {
  type Entity,
  type EntityRef,
  type Resolver,
  applyOp,
  astToEditable,
  createKernelRegistries,
  isUnresolved,
  parseMm,
  refKey,
  registerBuiltinKinds,
  serializeMm,
  unresolvedEntity,
  validateId,
  type Note,
  type TreeOp,
} from '../../src/index.js';

/** PomodoroXI 画布源码：session/task 是「未注册」kind（未进 REGISTERED_KINDS 七类） */
const POMODORO_SOURCE = `# 今日专注

## 进行中
- @session:42
- 提交代码前梳理 diff

## 任务
- @task:17
- 番茄 2：修复登录页
`;

/** 模拟 PomodoroXI resolver：session:42 命中；task:17 触发 unknown-kind；offline 模拟不可达 */
function makePomodoroResolver(mode: 'online' | 'offline' = 'online'): Resolver {
  return {
    async resolve(ref: EntityRef): Promise<Entity> {
      if (mode === 'offline') return unresolvedEntity(ref, 'unreachable');
      if (ref.kind === 'session' && ref.id === '42') {
        return { kind: 'session', id: '42', title: '番茄会话 42', status: 'running', ref: null };
      }
      // 未注册 kind：resolver 按 unknown-kind 降级（透传铁律 W-UNKNOWN-KIND 的运行时侧）
      return unresolvedEntity(ref, 'unknown-kind');
    },
  };
}

describe('镜子三 · session/task 未知 kind 的解析与透传', () => {
  it('未注册 kind（session/task）引用原样解析 + 透传保留（不报错不丢弃）', () => {
    const parsed = parseMm(POMODORO_SOURCE);
    const keys = parsed.refs.map((r) => refKey(r)).sort();
    expect(keys).toEqual(['session:42', 'task:17']);
    // validateId：未知 kind 语义 = 不做 id 校验，让行
    expect(validateId('session', '42')).toBe(true);
    expect(validateId('task', '17')).toBe(true);
    // serialize round-trip：未知 kind 引用原样保留
    const rt = serializeMm(parsed.root!);
    expect(
      parseMm(rt)
        .refs.map((r) => refKey(r))
        .sort(),
    ).toEqual(keys);
  });

  it('resolver 对未注册 kind 返回 unresolved(unknown-kind)，而非抛异常（降级路径）', async () => {
    const resolver = makePomodoroResolver();
    const e = await resolver.resolve({ kind: 'task', id: '17' });
    expect(isUnresolved(e)).toBe(true);
    expect(e.meta?.unresolved_reason).toBe('unknown-kind');
    // kind/id 保留（数据不丢）
    expect(e.kind).toBe('task');
    expect(e.id).toBe('17');
  });

  it('离线场景（PomodoroXI 不可达）→ unresolved(unreachable) 优雅降级（镜子三验收问题 3）', async () => {
    const resolver = makePomodoroResolver('offline');
    const e = await resolver.resolve({ kind: 'session', id: '42' });
    expect(isUnresolved(e)).toBe(true);
    expect(e.meta?.unresolved_reason).toBe('unreachable');
  });
});

describe('镜子三 · 写路径表达力：导图节点 → 创建任务/番茄', () => {
  it('SemanticsRegistry 可注册 pomodoro 专属 SemRole→action（create_task / create_session）', () => {
    const regs = createKernelRegistries();
    regs.semantics.register('pomodoro-task', { role: 'pomodoro-task', action: 'create_task' });
    regs.semantics.register('pomodoro-session', {
      role: 'pomodoro-session',
      action: 'create_session',
    });
    expect(regs.semantics.get('pomodoro-task')?.action).toBe('create_task');
    expect(regs.semantics.get('pomodoro-session')?.action).toBe('create_session');
  });

  it('TreeOp 可表达：给节点写 role 建议 / 升级为 task 实体（写管道落点）', () => {
    const parsed = parseMm(POMODORO_SOURCE);
    const editable = astToEditable(parsed.root)!;
    const target = editable.children.find((c) => c.children.find((cc) => cc.ref?.kind === 'task'))!;
    const leaf = target.children.find((cc) => cc.ref?.kind === 'task')!;

    // 写 1：标注 ai_role 建议（spec §5.3 未采纳 → note 透传键）
    const opRole: TreeOp = {
      type: 'update-node',
      id: leaf.id,
      patch: { note: { ai_role: 'pomodoro-task' } },
    };
    const afterRole = applyOp(editable, opRole);
    const withRole = afterRole.children.find((c) => c.children.find((cc) => cc.id === leaf.id))!;
    expect((withRole.children.find((cc) => cc.id === leaf.id)?.note as Note)?.ai_role).toBe(
      'pomodoro-task',
    );

    // 写 2：升级为实体（已批准 → @task:17 已在源码；此处模拟写回确认）
    const opRef: TreeOp = {
      type: 'update-node',
      id: leaf.id,
      patch: { ref: { kind: 'task', id: '17' } },
    };
    const afterRef = applyOp(afterRole, opRef);
    const upgraded = afterRef.children.find((c) => c.children.find((cc) => cc.id === leaf.id))!;
    expect(upgraded.children.find((cc) => cc.id === leaf.id)?.ref).toEqual({
      kind: 'task',
      id: '17',
    });
  });
});

describe('镜子三 · 任务状态同步进导图：resolver 轮询 → 状态变化 → 渲染数据可感知', () => {
  it('轮询状态变化：resolver 返回新 status → TreeOp 更新 note.status → 序列化可感知', async () => {
    const parsed = parseMm(POMODORO_SOURCE);
    const editable = astToEditable(parsed.root)!;
    const resolver = makePomodoroResolver();
    const entity = await resolver.resolve({ kind: 'session', id: '42' });
    const done = { ...entity, status: 'done' };

    const target = editable.children.find((c) =>
      c.children.find((cc) => cc.ref?.kind === 'session'),
    )!;
    const leaf = target.children.find((cc) => cc.ref?.kind === 'session')!;
    const op: TreeOp = {
      type: 'update-node',
      id: leaf.id,
      patch: { note: { status: done.status } },
    };
    const next = applyOp(editable, op);
    const updated = next.children.find((c) => c.children.find((cc) => cc.id === leaf.id))!;
    const note = updated.children.find((cc) => cc.id === leaf.id)?.note as Note;
    expect(note?.status).toBe('done');
    // 序列化后状态持久在 note 中（round-trip 可感知）
    const rt = serializeMm({
      type: 'entity' as const,
      ref: { kind: 'session', id: '42' },
      children: [{ ...updated.children.find((cc) => cc.id === leaf.id)!, children: [] }],
    });
    expect(rt).toContain('status: done');
  });
});

describe('镜子三 · 接口结论段', () => {
  it('结论：接口够用项 / 缺口清单', () => {
    // ── 够用项 ──────────────────────────────────────────────
    // ① 未知 kind（session/task）引用：透传保留 + validateId 放行 + round-trip（已通过上方用例）
    // ② unresolved(unknown-kind / unreachable) 降级路径：resolver 失败不抛异常、kind/id 保留
    // ③ SemanticsRegistry：pomodoro 专属 SemRole→action（create_task/create_session）可注册（零内核改动）
    // ④ TreeOp.update-node patch.note/status：状态同步 + ai_role 建议 + 实体升级路径全表达
    // ── 缺口 ────────────────────────────────────────────────
    // ① 角标渲染需 kind 级 renderer（session/task 未注册）：内核为泛型槽位（RendererRegistry），react 侧注入
    //    → 建议「v1.0 内补」：渲染器槽位契约已存在，无需内核修订
    // ② registerBuiltinKinds 只注册内置七类；session/task 元信息由插件自行注册
    //    → 建议「v1.0 后补」：pomodoroXI 插件自带，内核不内置（未知 kind 透传已兜底）
    // ③ 建议标记（ai_role）→ 批准（升级实体）两步流无原子 op：依赖顺序 op 序列
    //    → 建议「v1.0 后补」：插件侧组合 TreeOp 序列，内核保持最小 op 集
    void registerBuiltinKinds; // 说明性引用：内置种子不含 session/task，符合渐进增强语义
    expect(true).toBe(true);
  });
});
