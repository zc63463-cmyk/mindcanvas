/**
 * FreeCanvasView —— 自由画布视图（C+1 · FC-D：视口 + 两壳 + 翻面/编辑 + 卡间连线）。
 *
 * 受控：`doc` + `onChange(doc)`（不可变更新；事实源 `*.mc.canvas.json`）。
 * 数据操作全部经 @mindcanvas/free-canvas 纯模型；与导图 MapView / NotePopover 零耦合
 * （D6：与导图分 Stage 挂载，不共用指针栈）。
 * 工具：选择 / 便签 / 面板 / 连线（connect：从卡拖到另一卡建边，保持工具可连续连）。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  addBack,
  addEdge,
  createNativePlacement,
  movePlacement,
  nativeBackEnabled,
  panBy,
  patchBack,
  patchFront,
  removeEdge,
  removePlacement,
  screenToWorld,
  setViewport,
  toggleFace,
  upsertPlacement,
  viewportCssTransform,
  zoomAt,
  type Face,
  type McCanvasDocument,
  type NativeFrontPayload,
} from '@mindcanvas/free-canvas';
import { ContextMenu, type ContextMenuItem } from '../chrome/ContextMenu.js';
import { CHROME } from '../theme/tokens.js';
import { EdgeLayer, type ConnectDraft } from './EdgeLayer.js';
import { NativeCard, type CanvasCardActions } from './NativeCard.js';
import { Toolbar } from './Toolbar.js';
import type { CanvasTool } from './toolTypes.js';

export type { CanvasTool } from './toolTypes.js';

/** 空白拖拽启动平移的最小位移（px）：小于视为点击 */
const DRAG_SLOP = 3;
/** 滚轮缩放灵敏度（指数系数） */
const WHEEL_ZOOM_RATE = 0.0015;

export interface FreeCanvasViewProps {
  /** 受控文档（事实源：*.mc.canvas.json） */
  doc: McCanvasDocument;
  /** 不可变更新回调 */
  onChange: (doc: McCanvasDocument) => void;
  style?: CSSProperties;
  className?: string;
}

interface PanState {
  pointerId: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

interface EditingState {
  uuid: string;
  face: Face;
}

interface CardMenuState {
  uuid: string;
  x: number;
  y: number;
}

export function FreeCanvasView({ doc, onChange, style, className }: FreeCanvasViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [tool, setTool] = useState<CanvasTool>('select');
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [selectedEdgeUuid, setSelectedEdgeUuid] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [cardMenu, setCardMenu] = useState<CardMenuState | null>(null);
  const [connectDraft, setConnectDraft] = useState<ConnectDraft | null>(null);

  // 受控文档的「最新镜像」：window 级手势监听不随 render 重绑定，
  // 用 ref 保证连续手势始终基于最新文档做不可变更新。
  const docRef = useRef(doc);
  docRef.current = doc;

  const panRef = useRef<PanState | null>(null);
  const suppressClickRef = useRef(false);

  const commit = useCallback(
    (next: McCanvasDocument) => {
      docRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  const localPoint = useCallback((clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    return { x: clientX - (rect?.left ?? 0), y: clientY - (rect?.top ?? 0) };
  }, []);

  /** 卡片动作袋（宿主收口全部文档写操作；NativeCard 保持纯视图） */
  const actions = useMemo<CanvasCardActions>(
    () => ({
      select: (uuid) => {
        setSelectedUuid(uuid);
        setSelectedEdgeUuid(null);
      },
      move: (uuid, x, y) => commit(movePlacement(docRef.current, uuid, x, y)),
      requestEdit: (uuid, face) => setEditing({ uuid, face }),
      closeEdit: (uuid) =>
        setEditing((prev) => (prev !== null && prev.uuid === uuid ? null : prev)),
      toggleFace: (uuid) => commit(toggleFace(docRef.current, uuid)),
      addBack: (uuid) => {
        commit(addBack(docRef.current, uuid));
        setEditing({ uuid, face: 'back' }); // 「添加背面」→ 自动进入背面编辑
      },
      commitFront: (uuid, front: NativeFrontPayload) =>
        commit(patchFront(docRef.current, uuid, front)),
      commitBack: (uuid, body) => commit(patchBack(docRef.current, uuid, body)),
      remove: (uuid) => {
        commit(removePlacement(docRef.current, uuid));
        setEditing((prev) => (prev !== null && prev.uuid === uuid ? null : prev));
        setSelectedUuid((prev) => (prev === uuid ? null : prev));
      },
      openMenu: (uuid, clientX, clientY) => {
        const pt = localPoint(clientX, clientY);
        setSelectedUuid(uuid);
        setCardMenu({ uuid, x: pt.x, y: pt.y });
      },
      /** 连线手势：起点卡按住 → 拖到目标卡松手 → addEdge（模型层防自环/缺端点） */
      beginConnect: (uuid, clientX, clientY) => {
        const pt = localPoint(clientX, clientY);
        const w0 = screenToWorld(pt.x, pt.y, docRef.current.viewport);
        setConnectDraft({ fromPlacementUuid: uuid, x: w0.x, y: w0.y });
        const onMoveEv = (ev: PointerEvent) => {
          const p2 = localPoint(ev.clientX, ev.clientY);
          const w2 = screenToWorld(p2.x, p2.y, docRef.current.viewport);
          setConnectDraft({ fromPlacementUuid: uuid, x: w2.x, y: w2.y });
        };
        const onUpEv = (ev: PointerEvent) => {
          const el =
            typeof Element !== 'undefined' && ev.target instanceof Element
              ? ev.target.closest('[data-fc-card]')
              : null;
          const toUuid = el?.getAttribute('data-fc-uuid') ?? null;
          if (toUuid !== null && toUuid !== uuid) {
            commit(addEdge(docRef.current, { fromPlacementUuid: uuid, toPlacementUuid: toUuid }));
          }
          setConnectDraft(null);
          window.removeEventListener('pointermove', onMoveEv);
          window.removeEventListener('pointerup', onUpEv);
          window.removeEventListener('pointercancel', onUpEv);
        };
        window.addEventListener('pointermove', onMoveEv);
        window.addEventListener('pointerup', onUpEv);
        window.addEventListener('pointercancel', onUpEv);
      },
    }),
    [commit, localPoint],
  );

  // 滚轮缩放：React 的 onWheel 委托为 passive（无法 preventDefault）→ 走原生监听
  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const pt = localPoint(ev.clientX, ev.clientY);
      const cur = docRef.current;
      const next = zoomAt(
        cur.viewport,
        pt.x,
        pt.y,
        cur.viewport.scale * Math.exp(-ev.deltaY * WHEEL_ZOOM_RATE),
      );
      commit(setViewport(cur, next));
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [commit, localPoint]);

  /** 空白按下：进入平移候选（未越阈值前不算平移，click 仍可落卡） */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    if (
      target?.closest('[data-fc-card], [data-fc-toolbar], [data-context-menu], [data-fc-edge]') !=
      null
    ) {
      return;
    }
    panRef.current = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY, moved: false };
    const onMoveEv = (ev: PointerEvent) => {
      const cur = panRef.current;
      if (cur === null || ev.pointerId !== cur.pointerId) return;
      const dx = ev.clientX - cur.lastX;
      const dy = ev.clientY - cur.lastY;
      if (!cur.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      cur.moved = true;
      cur.lastX = ev.clientX;
      cur.lastY = ev.clientY;
      const d = docRef.current;
      commit(setViewport(d, panBy(d.viewport, dx, dy)));
    };
    const onUpEv = (ev: PointerEvent) => {
      const cur = panRef.current;
      if (cur === null || ev.pointerId !== cur.pointerId) return;
      if (cur.moved) suppressClickRef.current = true;
      panRef.current = null;
      window.removeEventListener('pointermove', onMoveEv);
      window.removeEventListener('pointerup', onUpEv);
      window.removeEventListener('pointercancel', onUpEv);
    };
    window.addEventListener('pointermove', onMoveEv);
    window.addEventListener('pointerup', onUpEv);
    window.addEventListener('pointercancel', onUpEv);
  };

  /** 空白点击：便签/面板落卡；其余工具（选择/连线）取消选中 */
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const target = e.target instanceof Element ? e.target : null;
    if (
      target?.closest('[data-fc-card], [data-fc-toolbar], [data-context-menu], [data-fc-edge]') !=
      null
    ) {
      return;
    }
    if (tool !== 'sticky' && tool !== 'panel') {
      setSelectedUuid(null);
      setSelectedEdgeUuid(null);
      return;
    }
    const pt = localPoint(e.clientX, e.clientY);
    const cur = docRef.current;
    const world = screenToWorld(pt.x, pt.y, cur.viewport);
    const shell = tool === 'sticky' ? 'sticky-classic' : 'card-panel';
    const topZ = cur.placements.reduce((m, p) => Math.max(m, p.zIndex), 0);
    const placement = createNativePlacement({ shell, x: world.x, y: world.y, zIndex: topZ + 1 });
    commit(upsertPlacement(cur, placement));
    setSelectedUuid(placement.placementUuid);
    setSelectedEdgeUuid(null);
    setTool('select');
  };

  /** Delete / Backspace：先删选中边，再删选中卡（删卡级联删边在模型层） */
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (selectedEdgeUuid !== null) {
      e.preventDefault();
      commit(removeEdge(docRef.current, selectedEdgeUuid));
      setSelectedEdgeUuid(null);
      return;
    }
    if (selectedUuid === null) return;
    e.preventDefault();
    commit(removePlacement(docRef.current, selectedUuid));
    setSelectedUuid(null);
    setEditing(null);
  };

  const onSelectEdge = useCallback((edgeUuid: string) => {
    setSelectedEdgeUuid(edgeUuid);
    setSelectedUuid(null);
  }, []);

  // 卡片菜单项（右键）：随目标卡 back 状态分流
  const menuItems = useMemo<ContextMenuItem[] | null>(() => {
    if (cardMenu === null) return null;
    const p = doc.placements.find((x) => x.placementUuid === cardMenu.uuid);
    if (p === undefined) return null;
    const items: ContextMenuItem[] = [];
    if (nativeBackEnabled(p.back)) {
      items.push({ label: '翻面', onSelect: () => actions.toggleFace(p.placementUuid) });
      items.push({
        label: '编辑当前面',
        onSelect: () => actions.requestEdit(p.placementUuid, p.face),
      });
    } else {
      items.push({ label: '添加背面', onSelect: () => actions.addBack(p.placementUuid) });
      items.push({
        label: '编辑正面',
        onSelect: () => actions.requestEdit(p.placementUuid, 'front'),
      });
    }
    items.push({ label: '删除卡片', danger: true, onSelect: () => actions.remove(p.placementUuid) });
    return items;
  }, [cardMenu, doc.placements, actions]);

  const vp = doc.viewport;

  return (
    <div
      ref={hostRef}
      data-fc-host
      tabIndex={0}
      className={className}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onKeyDown={onKeyDown}
      style={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        height: '100%',
        background: CHROME.bg,
        color: CHROME.text,
        fontFamily: CHROME.fontFamily,
        touchAction: 'none',
        outline: 'none',
        cursor: tool === 'select' ? 'default' : 'copy',
        ...style,
      }}
    >
      <div
        data-fc-world
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: viewportCssTransform(vp),
        }}
      >
        <EdgeLayer
          placements={doc.placements}
          edges={doc.edges}
          selectedEdgeUuid={selectedEdgeUuid}
          onSelectEdge={onSelectEdge}
          draft={connectDraft}
        />
        {doc.placements.map((p) => (
          <NativeCard
            key={p.placementUuid}
            placement={p}
            scale={vp.scale}
            selected={p.placementUuid === selectedUuid}
            editingFace={editing !== null && editing.uuid === p.placementUuid ? editing.face : null}
            tool={tool}
            actions={actions}
          />
        ))}
      </div>
      <Toolbar tool={tool} onTool={setTool} />
      {cardMenu !== null && menuItems !== null && (
        <ContextMenu
          x={cardMenu.x}
          y={cardMenu.y}
          items={menuItems}
          onClose={() => setCardMenu(null)}
        />
      )}
    </div>
  );
}
