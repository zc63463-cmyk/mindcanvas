/**
 * 镜子二 harness：MindFlow 标注系统消费者模拟（K5）。
 * 不实现标注插件——只用公开 API 走通 MindFlow 标注的读/写数据路径：
 *  ① annotation kind（已注册）EntityRef 流转：解析 → Entity 形状
 *  ② note 键透传：L1/L2/L3 分层信息（mastery/needsCorrection/reviewPriority）放透传键的形态
 *  ③ 标注渲染数据访问：hover 浮窗内容（note 字段）、颜色→背景映射的 meta 通道
 *  ④ decisions 决策沉淀：note.decisions 读写往返（TreeOp）
 */
import { describe, expect, it } from 'vitest';
import {
  type Entity,
  type EntityRef,
  type Resolver,
  applyOp,
  astToEditable,
  isUnresolved,
  parseMm,
  refKey,
  serializeMm,
  unresolvedEntity,
  validateId,
  type Note,
  type TreeOp,
} from '../../src/index.js';

/** MindFlow 标注消费者解析的源码（标注节点引用） */
const ANNOTATED_SOURCE = `# 学习计划

## 核心概念
- 向量空间
- 线性代数
- @annotation:uuid-abc-123
  - 关键定义：x 是 y 的推广形式
- 特征值
`;

/** 模拟 MarkVault resolver：annotation uuid 命中，缺失降级 */
function makeAnnotationResolver(): Resolver {
  return {
    async resolve(ref: EntityRef): Promise<Entity> {
      if (ref.kind === 'annotation' && ref.id === 'uuid-abc-123') {
        return {
          kind: 'annotation',
          id: 'uuid-abc-123',
          title: '关键定义：x 是 y 的推广形式',
          status: 'active',
          ref: null,
          meta: { color: 'yellow', motivation: 'explaining' },
        };
      }
      return unresolvedEntity(ref, 'not-found');
    },
  };
}

describe('镜子二 · annotation kind 校验与引用流转', () => {
  it('annotation kind 已注册：id 校验合法让行 / 非法拒绝', () => {
    expect(validateId('annotation', 'uuid-abc-123')).toBe(true);
    expect(validateId('annotation', 'abc.def_gh12')).toBe(true);
    expect(validateId('annotation', '带空格 非法')).toBe(false);
  });

  it('解析含 @annotation 的 .mm.md → 取出 EntityRef，保留为 entity 子节点', () => {
    const parsed = parseMm(ANNOTATED_SOURCE);
    expect(parsed.refs.some((r) => refKey(r) === 'annotation:uuid-abc-123')).toBe(true);
    const annNode = parsed.root?.children.find((c) =>
      c.children.find((cc) => cc.ref?.id === 'uuid-abc-123'),
    );
    expect(annNode).toBeDefined();
  });

  it('经 Resolver 解析 annotation → Entity 形状（含 meta 颜色/动机通道）', async () => {
    const resolver = makeAnnotationResolver();
    const e = await resolver.resolve({ kind: 'annotation', id: 'uuid-abc-123' });
    expect(e.title).toContain('关键定义');
    expect(isUnresolved(e)).toBe(false);
    // meta 通道：渲染需要 color（背景色）/ motivation（边框语义色）
    expect(e.meta?.color).toBe('yellow');
    expect(e.meta?.motivation).toBe('explaining');
  });
});

describe('镜子二 · note 键透传：分层信息与渲染数据形态', () => {
  it('L1/L2/L3 分层信息可放 note 透传键（mastery / needsCorrection / reviewPriority）并 round-trip', () => {
    // MindFlow flags：mastery(1~3) / needsCorrection / reviewPriority(high) —— 全为透传键
    const note: Note = {
      one_liner: '向量空间是线性代数基础',
      motivation: 'classifying',
      color: 'yellow',
      mastery: 2,
      needs_correction: true,
      review_priority: 'high',
      confidence: 'low',
      tags: ['ch1', 'exam_topics'],
    };
    const source = `# 根

## 节点
<!--
${Object.entries(note)
  .map(([k, v]) => `${k}: ${typeof v === 'boolean' ? String(v) : JSON.stringify(v)}`)
  .join('\n')}
-->
- 内容
`;
    const parsed = parseMm(source);
    const roundTrip = serializeMm(parsed.root!);
    const reparsed = parseMm(roundTrip);
    const n = reparsed.root?.children?.[0]?.children?.[0]?.note;
    // 协议层 note 透传键为字符串形态（parseNoteYaml 字符串化）；断言值保留
    expect(String(n?.mastery)).toBe('2');
    expect(String(n?.needs_correction)).toBe('true');
    expect(String(n?.review_priority)).toBe('high');
    expect(String(n?.motivation)).toBe('classifying');
  });

  it('hover 浮窗内容可访问：note 字段 + resolver 的 Entity（合并视图数据源两端齐备）', () => {
    const parsed = parseMm(ANNOTATED_SOURCE);
    const annNode = parsed.root?.children.find((c) =>
      c.children.find((cc) => cc.ref?.id === 'uuid-abc-123'),
    );
    const child = annNode?.children.find((cc) => cc.ref?.id === 'uuid-abc-123')!;
    return makeAnnotationResolver()
      .resolve(child.ref!)
      .then((e) => {
        expect(typeof e.title).toBe('string');
        expect(Object.keys(e.meta ?? {}).length).toBeGreaterThan(0);
      });
  });

  it('决策沉淀：note.decisions 读写往返（TreeOp update-node patch.note）', () => {
    const parsed = parseMm(ANNOTATED_SOURCE);
    const editable = astToEditable(parsed.root)!;
    const target = editable.children.find((c) =>
      c.children.find((cc) => cc.ref?.id === 'uuid-abc-123'),
    );
    expect(target).toBeDefined();
    const leaf = target!.children.find((cc) => cc.ref?.id === 'uuid-abc-123')!;
    const op: TreeOp = {
      type: 'update-node',
      id: leaf.id,
      patch: { note: { decisions: ['确认向量空间为进阶前置知识'] } },
    };
    const next = applyOp(editable, op);
    const updated = next.children.find((c) => c.children.find((cc) => cc.id === leaf.id))!;
    const note = updated.children.find((cc) => cc.id === leaf.id)?.note as Note;
    expect(note?.decisions).toEqual(['确认向量空间为进阶前置知识']);

    // round-trip：decisions 键协议层保留
    const serialized = serializeMm({
      type: 'entity' as const,
      ref: { kind: 'issue', id: 'x' },
      children: [{ ...updated.children.find((cc) => cc.id === leaf.id)!, children: [] }],
    });
    expect(serialized).toContain('decisions');
  });
});

describe('镜子二 · 接口结论段', () => {
  it('结论：接口够用项 / 缺口清单', () => {
    // ── 够用项 ──────────────────────────────────────────────
    // ① annotation kind 已注册：validateId 校验 + 解析流转（已通过上方用例）
    // ② Entity.meta 通道：color / motivation 渲染映射可承载（标注覆盖 Overlay 数据源）
    // ③ Note 透传键：L1/L2/L3 分层 flags（mastery/needs_correction/review_priority）round-trip 零丢失
    // ④ TreeOp.update-node(patch.note)：decisions 决策沉淀写路径可表达 + 可往返
    // ── 缺口 ────────────────────────────────────────────────
    // ① 渲染器注册表：annotation kind 需按 type 提供渲染策略（内核为泛型槽位，react 侧注入）
    //    → 建议「v1.0 内补」：渲染器槽位契约已存在（RendererRegistry），无需内核修订
    // ② motivation → 语义色映射无内核枚举：消费者自维护调色板
    //    → 建议「v1.0 后补」：语义调色板住语义层 semantics.json（spec §5.5 双层定义）
    // ③ hover 浮窗需「Entity + 树内 note 合并视图」：内核无组合 API（读管道分体）
    //    → 建议「v1.0 后补」：插件侧组合，内核保持分体（读管道最小）
    expect(true).toBe(true);
  });
});
