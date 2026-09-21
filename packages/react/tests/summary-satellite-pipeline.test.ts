/**
 * 摘要卫星 · 生产管线接入（S3 · react 侧）。
 *
 * 判据：`layoutDemo`（**真管线**，非组件层）必须把 `satelliteHook` 注入到
 * `layoutForest` / `layoutMindmapBranched`——否则 kernel 的卫星数据在应用里永远不可达，
 * S3 就等于没交付（「布局数据正确但没人接线」是本批最隐蔽的失败形态）。
 *
 * 另验证：无 `summary_of` 的文档，管线接线不改变任何既有布局（节点/连线数保持不变）。
 *
 * 夹具锚形态用 `node:` 路径锚（S1 读取兼容），避免依赖 cid 注释的写法细节；
 * cid 锚路径已由 kernel 侧 `summary-satellite*.test.ts` 覆盖。
 */
import { describe, expect, it } from 'vitest';
import { layoutDemo, buildEditable } from '../src/demo/pipeline.js';

const measure = (s: string): number => s.length * 10;

function req<T>(v: T | undefined | null, what: string): T {
  if (v === undefined || v === null) throw new Error(`测试前置缺失：${what}`);
  return v;
}

/** 无摘要：根 → 父 → 三个成员 */
const PLAIN = `# 根

## 父

- 成员一
- 成员二
- 成员三
`;

/**
 * 带摘要：摘要节点是根下**第四个**子节点（note 块写在节点**之前**——
 * 协议要求 note 块紧跟其目标节点之前，这与 S1 roundtrip 夹具同形）。
 */
const WITH_SUMMARY = `# 根

## 父

- 成员一
- 成员二
- 成员三

<!--
summary_of:
  from: node:根/父/成员一
  to: node:根/父/成员三
-->
- 摘要
`;

function layoutOf(mm: string) {
  const { editable, diagnostics } = buildEditable(mm);
  const doc = req(editable, `editable(${mm.slice(0, 12)}…)`);
  const { layout } = layoutDemo(doc, new Map(), measure);
  return { layout, diagnostics };
}

describe('S3 · 生产管线接入：layoutDemo 产出卫星', () => {
  it('无摘要文档：接线不改变既有布局（卫星为空）', () => {
    const { layout } = layoutOf(PLAIN);
    expect(layout.satellites ?? [], '无 summary_of → 不应有卫星').toHaveLength(0);
    // 结构不变：根 + 父 + 3 成员；根→父、父→3 成员 = 4 条线
    expect(layout.nodes.length).toBe(5);
    expect(layout.links.length).toBe(4);
  });

  it('带摘要文档：管线产出 satellites，且扁表含卫星、无 P→S', () => {
    const { layout } = layoutOf(WITH_SUMMARY);
    const sats = layout.satellites ?? [];
    expect(sats, '管线必须产出卫星（钩子已接线）').toHaveLength(1);
    const sat = req(sats[0], 'satellite');
    expect(sat.node.text).toBe('摘要');

    // 扁表含卫星（渲染 / 命中 / 选择零改动的前提）
    expect(
      layout.nodes.some((n) => n.node.id === sat.node.id),
      '扁表应含卫星',
    ).toBe(true);

    // 卫星在成员带外侧（右向：x 大于全部成员右缘）
    const memberRight = Math.max(
      ...layout.nodes
        .filter((n) => n.node.text?.startsWith('成员'))
        .map((n) => n.box.x + n.box.w),
    );
    expect(sat.box.x).toBeGreaterThan(memberRight);

    // 不含 P→S（父不再有该子节点）
    const parent = req(
      layout.nodes.find((n) => n.node.text === '父'),
      'parent',
    );
    expect(
      layout.links.some((l) => l.fromId === parent.node.id && l.toId === sat.node.id),
      'P→S 不得存在',
    ).toBe(false);
    // 但成员自身的 P→成员 链接必须仍在（成员未被摘除）
    for (const name of ['成员一', '成员二', '成员三']) {
      const mem = req(
        layout.nodes.find((n) => n.node.text === name),
        `member ${name}`,
      );
      expect(
        layout.links.some((l) => l.fromId === parent.node.id && l.toId === mem.node.id),
        `P→${name} 必须保留`,
      ).toBe(true);
    }
  });

  it('摘要节点不在带内（摘除生效）：不再作为父的子出现在布局树', () => {
    const { layout } = layoutOf(WITH_SUMMARY);
    const parent = req(
      layout.nodes.find((n) => n.node.text === '父'),
      'parent',
    );
    const sat = req((layout.satellites ?? [])[0], 'satellite');
    // 卫星的 parentId 仍指向父（视觉/语义归属），但它不在父的 children 里
    expect(sat.parentId).toBe(parent.node.id);
    expect(
      parent.children.some((c) => c.node.id === sat.node.id),
      '卫星不得留在父的 children（已摘除）',
    ).toBe(false);
  });
});
