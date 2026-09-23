/**
 * useDocumentSwitch 判别测试 —— 编辑流保全（批次 E）消费端守卫。
 *
 * 判别核心：重建 effect 的 deps 必须锁在 `doc.source` 上 ——
 * source 不变（仅 savedSource/ts/handle 变）→ 零动作；
 * source 变 → reset / setEntities / setExpandedQaId / fit 各恰一次。
 * 若实现误用对象身份（deps=[doc]）或把 savedSource 放进 deps，t1 转红 ——
 * 两条阴性对照之一的判据。
 *
 * 搬迁纪律另两条在本文件锁定：
 * 1) 首挂跳过其后 4 个动作（controller 首次创建 + MapView 初始 fit 已处理）；
 * 2) 首挂**仍要**执行 entityHost.remember（跨文档实体复用）。
 */
import { cleanup, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import type { EditableNode, Entity, EntityRef } from '@mindcanvas/kernel';
import type { EntityHost, FsFileHandle, MapViewApi, MindDoc } from '@mindcanvas/react';
import { EditorController } from '@mindcanvas/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDocumentSwitch } from '../src/hooks/useDocumentSwitch';

const docA: MindDoc = { id: 'a.mm.md', name: 'a.mm.md', source: 'SRC-A', saved: true, ts: 0 };

beforeEach(() => {
  // canvas 套件 pretendToBeVisual:false（无 rAF）——t0 构造真 EditorController 需要调度桩
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal('cancelAnimationFrame', (h: number) => {
    clearTimeout(h);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/**
 * 每个 source 对应一棵**自己的**树（与生产一致：`buildEditable(doc.source)` 每次解析
 * 都产出新对象）。t2/t5(b) 的 source 变化因此同时换树 —— 这是真实语义。
 *
 * P0-FIX-R1 R1-3 后，`controller.reset` 的同步执行已移到 `performApplyDoc`；本 hook 的
 * effect 只在「树还不是新的」时补做。若测试夹具让 `editable` 恒定而 `root` 指向它，
 * 就等于伪造了「applyDoc 已 reset 过」的状态，t2 便测不到切换回归 —— 故按 source 派生树。
 */
function treeOf(source: string): EditableNode {
  return { id: `root-${source}`, title: 'root', children: [] } as unknown as EditableNode;
}

function setup(
  opts: { root?: EditableNode; controllerNull?: boolean; editableNull?: boolean } = {},
) {
  const reset = vi.fn();
  const fit = vi.fn();
  const apiRef: RefObject<MapViewApi | null> = { current: { fit } as unknown as MapViewApi };
  const entityHost = { remember: vi.fn() } as unknown as EntityHost;
  const setEntities = vi.fn();
  const setExpandedQaId = vi.fn();
  const refs: EntityRef[] = [];
  const entities = new Map<string, Entity>();
  // 首挂树的 source 固定为 SRC-A（docA）；切换后由 `treeFor` 按新 source 换树
  const firstEditable = treeOf('SRC-A');
  // 同一 source 必须拿到**同一个**对象引用（生产里 editable 由 useMemo([doc.source])
  // 派生，也满足这一点）——否则「树是否已换」的引用判据会每次渲染都判为不同。
  const treeCache = new Map<string, EditableNode>([['SRC-A', firstEditable]]);
  const treeFor = (source: string): EditableNode | null => {
    if (opts.editableNull === true) return null;
    let t = treeCache.get(source);
    if (t === undefined) {
      t = treeOf(source);
      treeCache.set(source, t);
    }
    return t;
  };
  // S2F：mock 增 `root` 字段（状态判据所需）——缺省与首挂树同引用（首挂同源跳过）
  const root = opts.root ?? firstEditable;
  const controller = { reset, root };
  const controllerRef: RefObject<EditorController | null> = {
    current: opts.controllerNull === true ? null : (controller as unknown as EditorController),
  };
  // S2G：同步标记（写点观察位；初值 null）
  const syncedSourceRef: RefObject<string | null> = { current: null };

  /** 模拟「树被换成该 source 的树」（生产的 applyDoc 同步 reset 就是这一步） */
  const applyTree = (source: string): void => {
    const t = treeFor(source);
    if (t !== null) controller.root = t;
  };

  const view = renderHook(
    ({ doc }: { doc: MindDoc }) =>
      useDocumentSwitch({
        doc,
        editable: treeFor(doc.source),
        refs,
        entities,
        entityHost,
        gatewayTitles: {},
        controllerRef,
        syncedSourceRef,
        setEntities,
        setExpandedQaId,
        apiRef,
      }),
    { initialProps: { doc: docA } },
  );
  return {
    view,
    editable: firstEditable,
    applyTree,
    syncedSourceRef,
    reset,
    fit,
    entityHost,
    setEntities,
    setExpandedQaId,
  };
}

describe('useDocumentSwitch · 文档切换语义（E 批判别）', () => {
  it('t1：source 不变的 doc 新对象（仅 savedSource/ts/handle 变）→ 四个动作零调用', () => {
    const { view, reset, fit, setEntities, setExpandedQaId } = setup();

    view.rerender({
      doc: { ...docA, savedSource: 'SRC-A-SAVED', ts: 123, handle: {} as FsFileHandle },
    });

    expect(reset).not.toHaveBeenCalled();
    expect(setEntities).not.toHaveBeenCalled();
    expect(setExpandedQaId).not.toHaveBeenCalled();
    expect(fit).not.toHaveBeenCalled();
  });

  it('t2：source 变化 → 四动作各恰一次（切换回归钉）+ 首挂只登记不动树', () => {
    const { view, reset, fit, entityHost, setEntities, setExpandedQaId } = setup();

    // 首挂：已登记实体（跨文档复用），但四个动作未执行（避免重复初始化）
    expect(entityHost.remember).toHaveBeenCalledTimes(1);
    expect(reset).not.toHaveBeenCalled();

    view.rerender({ doc: { ...docA, source: 'SRC-B' } });

    expect(reset).toHaveBeenCalledTimes(1);
    expect(setEntities).toHaveBeenCalledTimes(1);
    expect(setExpandedQaId).toHaveBeenCalledWith(null);
    expect(fit).toHaveBeenCalledTimes(1);
    // 切换时重新登记（实体宿主按文档名归档）
    expect(entityHost.remember).toHaveBeenCalledTimes(2);
  });
});

describe('useDocumentSwitch · S2F 状态判据（首挂不同源补做切换）', () => {
  it('t0：判据实证 —— 真实 EditorController 的 root 引用 = 构造/reset 的落点', () => {
    const editable = { id: 'root', title: 'root', children: [] } as unknown as EditableNode;
    const other = { id: 'other', title: 'other', children: [] } as unknown as EditableNode;
    const ctrl = new EditorController(editable);
    expect(ctrl.root).toBe(editable);
    ctrl.reset(other);
    expect(ctrl.root).toBe(other);
  });

  it('t3：首挂即不同源（root ≠ editable）→ 四动作各恰一次 + remember 照做', () => {
    const other = { id: 'other', title: 'other', children: [] } as unknown as EditableNode;
    const { editable, reset, fit, entityHost, setEntities, setExpandedQaId } = setup({ root: other });

    // 首挂即不同源（启动页出口这类「挂载前改 doc」路径）：补做切换四动作
    expect(reset).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledWith(editable);
    expect(setEntities).toHaveBeenCalledTimes(1);
    expect(setExpandedQaId).toHaveBeenCalledWith(null);
    expect(fit).toHaveBeenCalledTimes(1);
    // 首挂实体登记照做
    expect(entityHost.remember).toHaveBeenCalledTimes(1);
  });

  it('t4：controller 为 null → 不崩（落入四动作；reset 为 null 安全跳过）', () => {
    const { fit, entityHost, setEntities, setExpandedQaId } = setup({ controllerNull: true });

    // 不同源（undefined ≠ editable）→ 补做：reset 为 null 安全空调用，其余动作照做
    expect(setEntities).toHaveBeenCalledTimes(1);
    expect(setExpandedQaId).toHaveBeenCalledWith(null);
    expect(fit).toHaveBeenCalledTimes(1);
    expect(entityHost.remember).toHaveBeenCalledTimes(1);
  });
});

describe('useDocumentSwitch · S2G 置位钉（同步标记三写点之二）', () => {
  it('t5：首挂同源跳过置位 / source 变化 reset 后置位 / 首挂不同源同样置位 / editable=null 不置位', () => {
    // (a) 首挂同源（skip 分支写点②）→ 置位为当前 doc.source
    const a = setup();
    expect(a.syncedSourceRef.current).toBe(docA.source);

    // (b) 非首挂 source 变化（reset 分支写点③）→ 置位为新 source
    const b = setup();
    b.view.rerender({ doc: { ...docA, source: 'SRC-B' } });
    expect(b.syncedSourceRef.current).toBe('SRC-B');

    // (c) 首挂不同源（S2F t3 场景：reset 分支）→ 同样置位
    const other = { id: 'other', title: 'other', children: [] } as unknown as EditableNode;
    const c = setup({ root: other });
    expect(c.syncedSourceRef.current).toBe(docA.source);

    // (d) editable=null 早退 → 不置位（保持初值 null；对应「解析失败 → 后续写盘被拦」）
    const d = setup({ editableNull: true });
    expect(d.syncedSourceRef.current).toBeNull();
  });
});
