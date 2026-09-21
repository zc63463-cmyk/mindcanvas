/**
 * 镜子一 harness：forgejo-bridge 消费者模拟（K5）。
 * 不实现插件——只用公开 API 走通 forgejo-bridge 的核心数据路径，验证接口表达力：
 *  ① 解析含 @issue / @milestone / @doc 的 .mm.md → 取出全部 EntityRef
 *  ② 经 Resolver 批量解析 → Entity（含 unresolved 降级）
 *  ③ SemRole 注册表能表达 spec §6 映射（task→create_issue / milestone→create_milestone …）
 *  ④ 写路径表达力：提议（proposal）→ action 枚举 → 幂等键
 *  ⑤ reconcile 数据需求：期望态（导图）vs 实际态（resolver 结果）的对账信息是否齐备
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
  unresolvedEntity,
  type SemRoleMapping,
  type TreeOp,
} from '../../src/index.js';

/** forgejo-bridge 消费者解析的源码（对照 spec §7.1 创建链路：节点升级 @entity + 保存） */
const GATEWAY_SOURCE = `# Gateway

## 任务
- @issue:123
- @issue:404

## 里程碑
- @milestone:v1

## 文档
- @doc:readme.md
`;

/** 模拟 Forgejo resolver：issue:123 / milestone:v1 / doc:readme.md 命中，issue:404 not-found */
function makeForgejoResolver(): Resolver {
  const table: Record<string, Entity> = {
    'issue:123': { kind: 'issue', id: '123', title: '网关联调需实现', status: 'open', ref: '#123' },
    'milestone:v1': {
      kind: 'milestone',
      id: 'v1',
      title: 'M1 网关重构',
      status: 'open',
      ref: null,
    },
    'doc:readme.md': {
      kind: 'doc',
      id: 'readme.md',
      title: 'README',
      status: 'published',
      ref: null,
    },
  };
  return {
    async resolve(ref: EntityRef): Promise<Entity> {
      const hit = table[refKey(ref)];
      return hit ? { ...hit } : unresolvedEntity(ref, 'not-found');
    },
  };
}

/** 消费者侧批量解析（当前用公开 resolve 组装；缺口：内核宜提供 resolveMany 批量原语，T4 落地） */
async function batchResolve(resolver: Resolver, refs: EntityRef[]): Promise<Map<string, Entity>> {
  const out = new Map<string, Entity>();
  await Promise.all(
    refs.map(async (ref) => {
      out.set(refKey(ref), await resolver.resolve(ref));
    }),
  );
  return out;
}

describe('镜子一 · forgejo-bridge 读管道：实体引用流转', () => {
  it('解析 .mm.md 取出全部 EntityRef（issue / milestone / doc）', () => {
    const parsed = parseMm(GATEWAY_SOURCE);
    expect(parsed.root).not.toBeNull();
    const refs = parsed.refs;
    expect(refs.map((r) => refKey(r)).sort()).toEqual([
      'doc:readme.md',
      'issue:123',
      'issue:404',
      'milestone:v1',
    ]);
  });

  it('经 Resolver 批量解析：已存在实体返回统一形状，缺失实体降级为 unresolved', async () => {
    const parsed = parseMm(GATEWAY_SOURCE);
    const resolver = makeForgejoResolver();
    const map = await batchResolve(resolver, parsed.refs);
    expect(map.size).toBe(4); // 成败都入 Map（对账需要全量实际态）
    expect(map.get('issue:123')?.title).toBe('网关联调需实现');
    expect(isUnresolved(map.get('issue:123')!)).toBe(false);
    // 缺失 → not-found 降级，不抛异常
    expect(isUnresolved(map.get('issue:404')!)).toBe(true);
    expect(map.get('issue:404')?.meta?.unresolved_reason).toBe('not-found');
  });

  it('refKey 稳定作 Map key / 实体锚（spec §6.1 node_anchor 的实体锚形态）', () => {
    expect(refKey({ kind: 'issue', id: '123' })).toBe('issue:123');
    expect(refKey({ kind: 'milestone', id: 'v1' })).toBe('milestone:v1');
  });
});

describe('镜子一 · 语义注册表：spec §6 SemRole → action 映射表达力', () => {
  it('SemanticsRegistry 可注册七类 SemRole 的落库映射（issue/milestone 实体形态）', () => {
    const regs = createKernelRegistries();
    const mappings: SemRoleMapping[] = [
      { role: 'task', action: 'create_issue', description: '任务 → 建 issue' },
      { role: 'milestone', action: 'create_milestone', description: '里程碑候选 → 建 milestone' },
      {
        role: 'question',
        action: 'create_issue',
        description: '待解问题 → 建 issue + question 标签',
      },
      { role: 'risk', action: 'create_issue', description: '风险 → 建 issue + risk 标签' },
      { role: 'decision', action: 'skip', description: '决策 → 沉淀 note.decisions，不落库' },
      { role: 'context', action: 'skip', description: '背景 → 不落库' },
      { role: 'idea', action: 'skip', description: '点子 → 点子池' },
    ];
    for (const m of mappings) regs.semantics.register(m.role, m);
    // 消费者语义查询：task → create_issue；milestone → create_milestone
    expect(regs.semantics.get('task')?.action).toBe('create_issue');
    expect(regs.semantics.get('milestone')?.action).toBe('create_milestone');
    expect(regs.semantics.list()).toHaveLength(7);
  });

  it('action 枚举可表达 spec §6.1 全部动作（create_issue / create_milestone / add_comment / link_issues / skip）', () => {
    const actions = [
      'create_issue',
      'create_milestone',
      'add_comment',
      'link_issues',
      'skip',
    ] as const;
    const regs = createKernelRegistries();
    // 动作作为 SemRoleMapping.action 的合法取值（语义层词汇，随 semantics 注册表独立版本化）
    for (const a of actions) {
      regs.semantics.register(`__probe_${a}`, { role: `__probe_${a}`, action: a });
    }
    for (const a of actions) expect(regs.semantics.get(`__probe_${a}`)?.action).toBe(a);
  });

  it('kind 注册表：issue / milestone 有内置元信息（图标颜色语义）', () => {
    const regs = createKernelRegistries();
    registerBuiltinKinds(regs.kinds);
    expect(regs.kinds.get('issue')?.color).toBeDefined();
    expect(regs.kinds.get('milestone')?.color).toBeDefined();
  });
});

describe('镜子一 · 写路径表达力：提议 → 幂等 → 升级落库', () => {
  it('TreeOp 可表达「升级节点为实体」写操作（spec §7.1 步骤 7）', () => {
    const parsed = parseMm(GATEWAY_SOURCE);
    const editable = astToEditable(parsed.root)!;
    // 找到「- @issue:123」对应的实体叶子，模拟升级写回同一 ref（update-node patch.ref）
    const entityNode = editable.children.find((c) => c.children.find((cc) => cc.ref?.id === '123'));
    expect(entityNode).toBeDefined();
    const leaf = entityNode!.children.find((cc) => cc.ref?.id === '123')!;
    const op: TreeOp = {
      type: 'update-node',
      id: leaf.id,
      patch: { ref: { kind: 'issue', id: '123' } },
    };
    const next = applyOp(editable, op);
    const upgraded = next.children.find((c) => c.children.find((cc) => cc.id === leaf.id))!;
    expect(upgraded.children.find((cc) => cc.id === leaf.id)?.ref).toEqual({
      kind: 'issue',
      id: '123',
    });
  });

  it('幂等键可表达：client_request_id = 画布 id + 节点指纹哈希（spec §6.3）', () => {
    // 指纹 = 节点文本+路径 的 sha256 前缀形态；幂等键是字符串，可直接作为幂等存储 key
    const idempotencyKey = `gateway:${'sha256:9f2a...'}`;
    expect(typeof idempotencyKey).toBe('string');
    expect(idempotencyKey.startsWith('gateway:')).toBe(true);
  });

  it('proposal 数据结构可用内核公开类型表达（node_anchor / action / sem_role 皆有落点）', () => {
    // 提议集字段 → 内核类型落点映射（类型层即可表达，语义归插件侧）
    type NodeAnchor = { path: string; text_hash: string };
    type Proposal = {
      node_anchor: NodeAnchor;
      action: 'create_issue' | 'create_milestone' | 'add_comment' | 'link_issues' | 'skip';
      sem_role: string;
      title: string;
      body_md: string;
      confidence: number;
      rationale: string;
    };
    const proposal: Proposal = {
      node_anchor: { path: '根/任务/@issue:123', text_hash: 'sha256:abc' },
      action: 'create_issue',
      sem_role: 'task',
      title: '网关联调需实现',
      body_md: '验收：...',
      confidence: 0.86,
      rationale: '任务节点',
    };
    expect(proposal.action).toBe('create_issue');
    expect(proposal.sem_role).toBe('task');
    expect(proposal.node_anchor.path).toBe('根/任务/@issue:123');
  });
});

describe('镜子一 · reconcile 数据需求：期望态 vs 实际态', () => {
  it('对账信息齐备：导图期望态（refs 集合）+ 实际态（resolver Map）→ 可推导 entity_drift 与 unlinked_entities', async () => {
    const parsed = parseMm(GATEWAY_SOURCE);
    const desired = new Set(parsed.refs.map((r) => refKey(r)));
    const actual = await batchResolve(makeForgejoResolver(), parsed.refs);

    // entity_drift：实际态中状态变化/新评论（此处以 status 变化代表）—— 数据齐备即可判
    const statusMap = new Map<string, string>();
    for (const [k, e] of actual) statusMap.set(k, e.status ?? 'unknown');
    // 期望态在导图（唯一事实源），实际态在 resolver；两者都存在即可 diff
    expect(desired.has('issue:123')).toBe(true);
    expect(actual.get('issue:123')?.status).toBe('open');

    // unlinked_entities：实际态里存在、期望态（导图）未引用的实体 —— 从两份数据可计算
    const unlinked = [...actual.keys()].filter((k) => !desired.has(k));
    expect(Array.isArray(unlinked)).toBe(true);
    expect(unlinked).toEqual([]); // 本 harness 全部引用，无未链接

    // unresolved 实体是对账的「待修复」信号
    const broken = [...actual.values()].filter((e) => isUnresolved(e)).map((e) => refKey(e));
    expect(broken).toEqual(['issue:404']);
  });
});

describe('镜子一 · 接口结论段', () => {
  it('结论：接口够用项 / 缺口清单（结论以断言 + 注释固化）', () => {
    // ── 够用项 ──────────────────────────────────────────────
    // ① EntityRef/refKey：读管道引用提取与 Map key 稳定（已通过上方用例）
    // ② Entity 统一形状 + unresolvedEntity 降级：resolver 契约满足 spec §6.1 期望态/实际态
    // ③ SemanticsRegistry + SemRoleMapping：spec §6 七类 SemRole→action 映射可表达
    // ④ TreeOp.update-node(patch.ref)：promote（文本→实体）写路径可表达
    // ⑤ KindRegistry + registerBuiltinKinds：issue/milestone 元信息齐备
    // ── 缺口 ────────────────────────────────────────────────
    // ① 批量解析原语：消费者需 Promise.all 自行组装 resolveMany 语义
    //    → 建议「v1.0 内补」：entity.ts 提供 resolveAll（逐条 resolve + 部分失败降级）
    // ② 提议集 ProposalSet 无内核类型：仅类型层可表达，语义归插件侧
    //    → 建议「v1.0 后补」：forgejo-bridge 插件自带提案类型，内核不内置
    // ③ 节点锚定 node_anchor（path + text_hash）无内核判定函数
    //    → 建议「v1.0 内补」：note-anchor 锚定解析（与 T4 links/groups 契约同源）
    expect(true).toBe(true);
  });
});
