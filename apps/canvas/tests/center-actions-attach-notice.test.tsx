// @vitest-environment jsdom
/**
 * R0-4：接回路径的迁移诊断宿主提示。
 *
 * planAttachIsland 的 diagnostics 此前被丢弃——现在 nodeMenuBags.onAttach 把
 * 「本来就是坏」类诊断经 onAttachError（宿主 = setCommandNotice）上报。
 * 断言：宿主回调收到含诊断汇总的文案，且接回本身仍成功（不阻断）。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { astToEditable, makeTextNode } from '@mindcanvas/kernel';
import { EditorController, planCutTreeEdge } from '@mindcanvas/react';
import { makeCenterActions } from '../src/nodeMenuBags.js';

function buildRoot() {
  // astToEditable 重建（赋会话 id），与画布启动同构；夹具坏即抛错（零 `!` 纪律）
  const root = astToEditable(
    makeTextNode('根', [makeTextNode('任务', [makeTextNode('K3', [makeTextNode('K3子')])])]),
  );
  if (root === null) throw new Error('fixture broken: astToEditable returned null');
  return root;
}

describe('nodeMenuBags.onAttach：迁移诊断经 onAttachError 上报（R0-4）', () => {
  beforeEach(() => {
    // canvas 套件统一 pretendToBeVisual:false（无 rAF）——controller 构造的调度需补桩
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 16) as unknown as number,
    );
    vi.stubGlobal('cancelAnimationFrame', (h: number) => {
      clearTimeout(h);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('旧文件已有 dangling 边 → 接回成功且宿主收到诊断文案', () => {
    const root = buildRoot();
    root.note = { edges: [{ from: 'node:根/任务', to: 'node:根/不存在', rel: 'relates-to' }] };
    const controller = new EditorController(root);

    // 先切断 K3（真实管线）；坏边在切断时已被 dangling-kept 保留
    const task = controller.root.children[0];
    if (!task) throw new Error('fixture broken: 任务 missing');
    const k3 = task.children.find((n) => n.text === 'K3');
    if (!k3) throw new Error('fixture broken: K3 missing');
    const cut = planCutTreeEdge(controller.root, k3.id);
    if (!cut.ok) throw new Error(`fixture broken: cut failed ${cut.error.message}`);
    const applied = controller.applyTransaction(cut.ops);
    if (!applied.ok) throw new Error('fixture broken: cut transaction failed');

    // 接回 → 坏边仍在 → 诊断应经宿主上报，且接回本身成功
    const onAttachError = vi.fn();
    const actions = makeCenterActions(controller, 't.mm.md', {
      setDescEditingId: vi.fn(),
      setPinnedNotePath: vi.fn(),
      onAttachError,
    });
    actions.onAttach(k3.id, controller.root.id);
    expect(onAttachError).toHaveBeenCalledTimes(1);
    expect(onAttachError).toHaveBeenCalledWith(expect.stringContaining('本来就是坏'));
  });
});
