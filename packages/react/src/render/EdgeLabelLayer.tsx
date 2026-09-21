/**
 * R5-2：自由边标签宿主层 —— FreeEdgeLayer 收集标签描述符，本层在**节点层之上**渲染。
 *
 * 为什么（层序契约，另见 MapView 渲染块开头）：标签是信息层——被节点盖住即失效；
 * 命中区是交互层——必须留在节点之下防抢点击（不得随标签上提）。
 *
 * 为什么用 useSyncExternalStore 而非 setState：标签锚点随路由每帧变化（动画期），
 * 若经宿主 setState 会把整棵 MapView（2000+ 行、全量节点列表）按帧重渲；
 * 外部存储把订阅面收敛到本层（只有几条 EdgeLabel 重渲）。
 * 引用相等短路（set 同引用不通知）— 与 viewport / controller 的 store 同款纪律。
 */
import { useSyncExternalStore } from 'react';
import type { TokenSet } from '../theme/types.js';
import { EdgeLabel } from './EdgeLabel.js';

/** 一条自由边的标签渲染描述符（由 FreeEdgeLayer 计算，宿主层消费） */
export interface FreeEdgeLabelSpec {
  /** 边 key（React key；同时是稳定身份） */
  key: string;
  /** 线中锚点（世界坐标） */
  ax: number;
  ay: number;
  /** 单位法向（茎的生长方向；由路由结果提供） */
  nx: number;
  ny: number;
  text: string;
  stroke: string;
  /** 弱化（失效边）→ 半透明 */
  muted: boolean;
}

const EMPTY: readonly FreeEdgeLabelSpec[] = [];

/** 极简外部存储：FreeEdgeLayer（layout effect 上报）→ 标签层（订阅重渲） */
export class FreeEdgeLabelStore {
  private listeners = new Set<() => void>();
  private snapshot: readonly FreeEdgeLabelSpec[] = EMPTY;

  getSnapshot = (): readonly FreeEdgeLabelSpec[] => this.snapshot;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  set(next: readonly FreeEdgeLabelSpec[]): void {
    if (this.snapshot === next) return; // 引用相等短路：不通知 → 不重渲
    this.snapshot = next;
    for (const cb of this.listeners) cb();
  }
}

/** 自由边标签层：订阅 store 渲染 EdgeLabel（空文本仍由 EdgeLabel 内部守卫兜底——双保险） */
export function FreeEdgeLabelLayer({
  store,
  token,
}: {
  store: FreeEdgeLabelStore;
  token: TokenSet;
}) {
  const labels = useSyncExternalStore(store.subscribe, store.getSnapshot);
  if (labels.length === 0) return null;
  return (
    <>
      {labels.map((l) => (
        <EdgeLabel
          key={l.key}
          ax={l.ax}
          ay={l.ay}
          nx={l.nx}
          ny={l.ny}
          text={l.text}
          stroke={l.stroke}
          token={token}
          muted={l.muted}
        />
      ))}
    </>
  );
}
