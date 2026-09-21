/**
 * E6.1：RelationSchema 关系词汇表测试（markvault-js 采纳精简移植）。
 * 覆盖：构造校验（重复 id / reverseId 未注册 / 互指不一致）/ label 与反向查询 /
 * 分组与主动类型 / schema 词汇色接入 relVisualOf。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_RELATION_TYPES,
  RelationSchema,
  SEMANTIC_GROUPS,
  defaultRelationSchema,
} from '../src/chrome/relationSchema.js';
import { relVisualOf } from '../src/render/freeEdges.js';
import { glassToken } from '../src/theme/tokens.js';

describe('RelationSchema：构造校验', () => {
  it('重复 id → 告警并忽略后续定义', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const schema = new RelationSchema([
      { id: 'blocks', label: '阻断', isSymmetric: false, color: '#e24b4a', isActive: true },
      { id: 'blocks', label: '阻断2', isSymmetric: false, color: '#000', isActive: true },
    ]);
    expect(schema.getLabel('blocks')).toBe('阻断'); // 首个定义生效
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('重复关系类型 id'));
    warn.mockRestore();
  });
  it('reverseId 未注册 → 告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new RelationSchema([
      {
        id: 'a',
        label: 'A',
        reverseId: 'ghost',
        isSymmetric: false,
        color: '#000',
        isActive: true,
      },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('未注册'));
    warn.mockRestore();
  });
  it('非对称反向互指不一致 → 告警', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    new RelationSchema([
      { id: 'a', label: 'A', reverseId: 'b', isSymmetric: false, color: '#000', isActive: true },
      { id: 'b', label: 'B', reverseId: 'c', isSymmetric: false, color: '#000', isActive: true },
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('非互指'));
    warn.mockRestore();
  });
});

describe('RelationSchema：查询', () => {
  it('label / 反向查询 / 主动类型', () => {
    expect(defaultRelationSchema.getLabel('blocks')).toBe('阻断');
    expect(defaultRelationSchema.getLabel('unknown-rel')).toBe('unknown-rel'); // 未注册兜底
    expect(defaultRelationSchema.reverseOf('blocks')).toBe('isBlockedBy');
    expect(defaultRelationSchema.reverseOf('contrasts')).toBe('contrasts'); // 对称
    expect(defaultRelationSchema.reverseOf('unknown-rel')).toBeNull();
    expect(defaultRelationSchema.getActiveTypes()).not.toContain('isBlockedBy'); // 被动不进选择器
    expect(defaultRelationSchema.getAllTypes()).toContain('isBlockedBy');
  });
  it('语义分组只含主动类型', () => {
    const groups = defaultRelationSchema.getGroupedActiveTypes();
    expect(groups.find((g) => g.label === '动态')!.types).toContain('blocks');
    for (const g of groups) {
      for (const t of g.types) {
        expect(defaultRelationSchema.getActiveTypes()).toContain(t);
      }
    }
  });
  it('内建词汇完整性：blocks/causes/relates-to/duplicates 与既有 relVisualOf 对齐', () => {
    for (const rel of ['blocks', 'causes', 'relates-to', 'duplicates']) {
      expect(DEFAULT_RELATION_TYPES.some((c) => c.id === rel && c.isActive)).toBe(true);
    }
    expect(SEMANTIC_GROUPS.length).toBeGreaterThan(0);
  });
});

describe('relVisualOf 接 schema 语义色', () => {
  const token = glassToken;
  it('注册词汇 → schema 色', () => {
    expect(relVisualOf('blocks', token).stroke).toBe('#e24b4a');
    expect(relVisualOf('causes', token).stroke).toBe('#e11d48');
  });
  it('未注册 rel → 中性灰虚线兜底', () => {
    const v = relVisualOf('whatever-rel', token);
    expect(v.stroke).toBe(token.color.textMuted);
    expect(v.dashed).toBe(true);
  });
});

describe('relVisualOf dashed 语义（P2-2 · 从 schema 取，不再 default 一刀切）', () => {
  const token = glassToken;
  it('强语义（动态/论证/阐释）→ 实线', () => {
    for (const rel of ['blocks', 'causes', 'enables', 'precedes', 'proves', 'refutes', 'applies']) {
      expect(relVisualOf(rel, token).dashed).toBe(false);
    }
  });
  it('弱/结构关联 → 虚线', () => {
    for (const rel of ['relates-to', 'duplicates', 'supplements', 'references']) {
      expect(relVisualOf(rel, token).dashed).toBe(true);
    }
  });
  it('passive 反向跟正向同态（isBlockedBy 实线 / isReferencedBy 虚线）', () => {
    expect(relVisualOf('isBlockedBy', token).dashed).toBe(false);
    expect(relVisualOf('isReferencedBy', token).dashed).toBe(true);
  });
});
