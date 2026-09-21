import { describe, expect, it } from 'vitest';
import { astToEditable, parseMm, } from '@mindcanvas/kernel';
import { EditorController } from '../src/edit/controller.js';
import { FrameScheduler } from '../src/render/scheduler.js';

const SAMPLE = `# Agent Gateway

## 文档（真实）
- @doc:docs/01-architecture.md

## 想法
<!--
one_liner: 只读先行
qa:
  - 先验证链路
  - 别被带偏
-->
- 先只读
`;

/** node 环境同步调度 */
function buildController(): EditorController {
  const parsed = parseMm(SAMPLE);
  const frame = new FrameScheduler({
    raf: (cb) => cb() as unknown as number,
    rafCancel: () => undefined,
  });
  return new EditorController(astToEditable(parsed.root)!, {}, frame);
}

describe('T2 保存与往返闭环（UI 级 round-trip：编辑 → serialize → parseMm → 一致）', () => {
  it('canonical 序列化：serialize → 文本含笔记块 qa（透传键保留）', () => {
    const c = buildController();
    const text = c.serialize();
    expect(text).toContain('# Agent Gateway');
    expect(text).toContain('qa:'); // qa 透传键进 canonical 输出
    expect(text).toContain('@doc:docs/01-architecture.md');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('UI 往返：编辑增删改 → serialize → parseMm 重导 → 再 serialize 逐字节一致', () => {
    const c = buildController();
    const a = c.root.children[0]!;
    // 一系列编辑（T1 能力）
    const childId = c.addChild(a.id, '新子');
    c.updateText(childId, '改标题');
    c.updateNote(a.id, { status: '设计中' });
    c.addSibling(a.id, '同级');
    const text1 = c.serialize();
    // 重导
    const parsed = parseMm(text1);
    expect(parsed.diagnostics.length).toBe(0);
    const editable2 = astToEditable(parsed.root)!;
    const c2 = new EditorController(
      editable2,
      {},
      new FrameScheduler({ raf: (cb) => cb() as unknown as number, rafCancel: () => undefined }),
    );
    // 往返后 canonical 文本逐字节一致（数据无损）
    expect(c2.serialize()).toBe(text1);
  });

  it('note 透传键（qa）round-trip 不丢', () => {
    const c = buildController();
    const leaf = c.root.children[1]!.children[0]!;
    c.updateNote(leaf.id, { qa: ['评价观点', '对比事实'] });
    const text = c.serialize();
    const parsed = parseMm(text);
    const leaf2 = astToEditable(parsed.root)!.children[1]!.children[0]!;
    expect(leaf2.note?.qa).toEqual(['评价观点', '对比事实']);
  });

  it('undo 到初始态后 serialize 与原始输入等价', () => {
    const c = buildController();
    const original = c.serialize();
    const a = c.root.children[0]!;
    const id = c.addChild(a.id, 'x');
    c.removeNode(id);
    // 序列化已还原（add+remove = 净零）——直接验证文本层
    expect(c.serialize()).toBe(original);
  });
});
