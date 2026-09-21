import { describe, expect, it } from 'vitest';
import { parseMm } from '../src/protocol/parser.js';
import { serializeMm, verifyRoundTrip } from '../src/protocol/serializer.js';
import gateway from './fixtures/gateway.mm.md?raw';
import roadmap from './fixtures/roadmap.mm.md?raw';
import ideasPool from './fixtures/ideas-pool.mm.md?raw';

const demoFiles: Array<[string, string]> = [
  ['gateway.mm.md', gateway],
  ['roadmap.mm.md', roadmap],
  ['ideas-pool.mm.md', ideasPool],
];

describe('canonical writer · round-trip', () => {
  for (const [name, text] of demoFiles) {
    it(`演示图 ${name}：parse → serialize → parse 结构等价且零噪声`, () => {
      const p1 = parseMm(text);
      expect(p1.root).not.toBeNull();
      const out = serializeMm(p1.root!);
      const p2 = parseMm(out);
      expect(p2.root).toEqual(p1.root);
      expect(p2.refs).toEqual(p1.refs);
      expect(p2.diagnostics, 'canonical 输出应零噪声').toEqual([]);
    });
  }

  it('全 7 kind 注册实体 + 图像 + 笔记全字段 round-trip', () => {
    const text = [
      '# 全类型',
      '<!--',
      'one_liner: 根笔记一句话',
      'decisions:',
      '  - 决策甲',
      '  - 决策乙: 含冒号',
      'status: 设计中',
      'next: 下一步A',
      'reminder: "提醒: 带引号"',
      '-->',
      '## 实体集',
      '- @issue:42',
      '- @pr:17',
      '- @doc:docs/架构/网关设计.md',
      '- @milestone:门户显示优化',
      '- @note:meeting-2026-w36',
      '- @idea:42',
      '- @idea:forge-inbox:2',
      '- @annotation:ulid01ABC',
      '- ![](images/架构图.png)',
      '<!--',
      'one_liner: 实体的笔记',
      '-->',
      '- @issue:43',
      '  - 实体子节点',
      '  - @pr:18',
    ].join('\n');
    const p1 = parseMm(text);
    expect(p1.diagnostics).toEqual([]);
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.refs).toEqual(p1.refs);
    expect(p2.diagnostics).toEqual([]);
  });

  it('深度边界：H1–H6 全用 + 列表续到深度 16', () => {
    const lines = ['# D'];
    const heads = ['L2', 'L3', 'L4', 'L5', 'L6'];
    heads.forEach((h, i) => lines.push(`${'#'.repeat(i + 2)} ${h}`));
    for (let d = 7; d <= 16; d++) {
      lines.push(`${' '.repeat((d - 7) * 2)}- i${d}`);
    }
    const text = lines.join('\n');
    const p1 = parseMm(text);
    expect(p1.diagnostics).toEqual([]);
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics).toEqual([]);
  });

  it('笔记特殊值：含引号/反斜杠/冒号/列表值/数组 next', () => {
    const text = [
      '# 根',
      '<!--',
      'one_liner: "含: 冒号 与 [方括号]"',
      'decisions:',
      "  - '路径: docs/a.md [已归档]'",
      'next:',
      '  - 第一步',
      '  - 第二步',
      '-->',
      '## 分支',
    ].join('\n');
    const p1 = parseMm(text);
    expect(p1.diagnostics).toEqual([]);
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics).toEqual([]);
  });

  it('未知 kind 节点 round-trip 保持 W-UNKNOWN-KIND', () => {
    const p1 = parseMm('# 根\n- @task:5');
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.diagnostics.map((d) => d.code)).toEqual(['W-UNKNOWN-KIND']);
  });

  it('verifyRoundTrip 安全闸：正常树通过', () => {
    const p1 = parseMm(gateway);
    expect(verifyRoundTrip(p1.root!)).toBe(true);
  });

  it('混合子女（文本+实体兄弟）保持列表形态与兄弟关系', () => {
    const text = [
      '# 根',
      '## P0',
      '- 三栏布局 · 实体节点',
      '- @doc:docs/07-entity-ref-protocol.md',
      '## P1',
      '- Picker',
      '  - @issue:6',
      '- 保存回写',
    ].join('\n');
    const p1 = parseMm(text);
    expect(p1.diagnostics).toEqual([]);
    const p2 = parseMm(serializeMm(p1.root!));
    expect(p2.root).toEqual(p1.root);
    expect(p2.refs).toEqual(p1.refs);
    expect(p2.diagnostics).toEqual([]);
  });

  it('canonical 格式：2 空格缩进 / 分支间空行分段 / 笔记三行块 / 末尾 LF', () => {
    // 分支（heading）之间留一个空行：保住手写的分段可读性，
    // 否则首次保存会把整篇压成一坨，产生全量 diff（格式不保真）。
    // 注意此为刻意变更——旧格式无空行，见 CHANGELOG 1.3.1。
    const out = serializeMm(parseMm('# 根\n## 分支\n- 甲\n  - 乙').root!);
    expect(out).toBe('# 根\n\n## 分支\n\n### 甲\n\n#### 乙\n');
    // 笔记块归属其**后**的节点，故空行插在笔记块之前（不拆开「笔记 ↔ 所属节点」）
    const noted = serializeMm(parseMm('# 根\n<!--\none_liner: x\n-->\n## 分支').root!);
    expect(noted).toBe('# 根\n\n<!--\none_liner: x\n-->\n## 分支\n');
  });

  it('分段空行不影响往返：多次序列化幂等', () => {
    const once = serializeMm(parseMm('# 根\n## A\n- a\n## B\n- b').root!);
    const twice = serializeMm(parseMm(once).root!);
    expect(twice).toBe(once);
    expect(once).toContain('\n\n## B');
  });
});
