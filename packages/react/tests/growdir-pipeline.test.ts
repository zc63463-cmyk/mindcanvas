/**
 * 管线级验收（ADR-0009 第一步第 5 条）：
 * **断言渲染管线真的走了分支布局，而不是只测孤立函数。**
 *
 * 背景：D2′ 曾出现「layoutMindmapBranched 测试全绿、但零调用点」的假交付——
 * 管线未接线，菜单写了 note.dir 界面也无变化。本文件直接经 demo 管线入口
 * （buildEditable + layoutDemo）验证端到端分叉，锁死接线。
 */
import { describe, expect, it } from 'vitest';
import { buildEditable, layoutDemo } from '../src/demo/pipeline.js';
import { astToEditable, parseMm } from '@mindcanvas/kernel';

/** 定长度量：与 demo-pipeline.test.ts 同款（管线入口需 editable + entities + char） */
function layoutOf(markdown: string) {
  const parsed = parseMm(markdown).root;
  if (!parsed) throw new Error('解析失败：缺少根节点');
  const editable = astToEditable(parsed);
  if (!editable) throw new Error('astToEditable 返回空树');
  const { layout } = layoutDemo(editable, new Map(), (s: string) => s.length * 10);
  return layout;
}

const FORKED = `# 根

<!--
dir: left
-->
- 反方

- 正方
`;

const PLAIN = `# 根

- 分支A

- 分支B
`;

/** 与 FORKED 同结构、但不声明方向（局部性对照基准） */
const PLAIN2 = `# 根

- 反方

- 正方
`;

describe('管线级：note.dir 分叉真的生效（ADR-0009 第 5 条）', () => {
  it('★ 声明 dir:left 的子节点，经管线后落在根左侧', () => {
    const layout = layoutOf(FORKED);
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const left = layout.nodes.find((n) => n.node.text === '反方');
    expect(left).toBeDefined();
    expect(left!.box.x + left!.box.w).toBeLessThanOrEqual(root.box.x);
  });

  it('★ 局部性：未声明的兄弟保持经典布局位置（逐像素不变）', () => {
    const base = layoutOf(PLAIN2); // 同名结构、无 dir 声明
    const withDir = layoutOf(FORKED);
    const b = base.nodes.find((n) => n.node.text === '正方');
    const w = withDir.nodes.find((n) => n.node.text === '正方');
    expect(b).toBeDefined();
    expect(w).toBeDefined();
    expect(w!.box.x).toBe(b!.box.x);
    expect(w!.box.y).toBe(b!.box.y);
  });

  it('无 note.dir 的旧文档 → 管线行为不变（经典左右平衡，不被分叉逻辑扰动）', () => {
    const layout = layoutOf(PLAIN);
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const a = layout.nodes.find((n) => n.node.text === '分支A')!;
    const b = layout.nodes.find((n) => n.node.text === '分支B')!;
    // 经典 mindmap 布局的既有行为：子节点左右平衡分布（非「全在右侧」）。
    // 此断言锁死该行为——若某天两边都跑到同侧，即为回退路径被破坏。
    expect(a.box.x).toBeGreaterThanOrEqual(root.box.x + root.box.w);
    expect(b.box.x + b.box.w).toBeLessThanOrEqual(root.box.x);
  });

  it('buildEditable 解析 note.dir 不产生诊断（协议层容错）', () => {
    const { diagnostics } = buildEditable(FORKED);
    expect(diagnostics.length).toBe(0);
  });
});

describe('管线级：纵向（up/down）生长真的生效', () => {
  // 纵向声明需要落在「节点自身的 note」上——.mm.md 中即该节点标题前/后的注释块。
  // 与横向用例同构：经 demo 管线入口验证，而非只测 kernel 函数。
  const verticalOf = (markdown: string) => {
    const parsed = parseMm(markdown).root;
    if (!parsed) throw new Error('解析失败');
    const editable = astToEditable(parsed);
    if (!editable) throw new Error('空树');
    return layoutDemo(editable, new Map(), (s: string) => s.length * 10).layout;
  };

  it('★ dir:down 的子节点经管线后落在根下方', () => {
    const layout = verticalOf(`# 根

<!--
dir: down
-->
- 下沉分支
`);
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const child = layout.nodes.find((n) => n.node.text === '下沉分支')!;
    expect(child.box.y).toBeGreaterThan(root.box.y + root.box.h);
  });

  it('★ dir:up 的子节点经管线后落在根上方', () => {
    const layout = verticalOf(`# 根

<!--
dir: up
-->
- 上浮分支
`);
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const child = layout.nodes.find((n) => n.node.text === '上浮分支')!;
    expect(child.box.y + child.box.h).toBeLessThan(root.box.y);
  });

  it('★ up 与 down 同时存在：两侧都有，且层距对称', () => {
    const layout = verticalOf(`# 根

<!--
dir: up
-->
- 上子

<!--
dir: down
-->
- 下子
`);
    const root = layout.nodes.find((n) => n.parentId === null)!;
    const up = layout.nodes.find((n) => n.node.text === '上子')!;
    const down = layout.nodes.find((n) => n.node.text === '下子')!;
    expect(up.box.y + up.box.h).toBeLessThan(root.box.y);
    expect(down.box.y).toBeGreaterThan(root.box.y + root.box.h);
    const gapUp = root.box.y - (up.box.y + up.box.h);
    const gapDown = down.box.y - (root.box.y + root.box.h);
    expect(gapUp).toBe(gapDown); // 上下对称（up 曾误用 H_GAP 导致 4 倍差距）
  });
});
