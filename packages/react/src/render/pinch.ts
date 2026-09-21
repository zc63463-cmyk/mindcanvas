/**
 * PinchTracker（R2：移动端双指缩放手势逻辑）。
 * 纯逻辑类：登记指头 / 计算指间距离比与中点——与视口解耦（MapView 把 zoom 事件接到
 * ViewportController.zoomAt(中点, 距离比)，中点位移自然转化为平移）。
 * 可注入测试：与 ViewportController 组合即可在 node 环境驱动动画帧。
 */
export interface PinchPoint {
  x: number;
  y: number;
}

export type PinchEvent =
  /** 第二指落下 → 进入 pinch（调用方取消单指 pan / 节点拖拽） */
  | { type: 'start' }
  /** 双指移动 → 缩放（factor = 距离比，mid 为屏幕坐标锚点） */
  | { type: 'zoom'; midX: number; midY: number; factor: number }
  | null;

export class PinchTracker {
  private pointers = new Map<number, PinchPoint>();
  private prevDist = 0;

  down(id: number, x: number, y: number): PinchEvent {
    this.pointers.set(id, { x, y });
    if (this.pointers.size === 2) {
      this.prevDist = this.#dist();
      return { type: 'start' };
    }
    return null;
  }

  move(id: number, x: number, y: number): PinchEvent {
    if (!this.pointers.has(id) || this.pointers.size < 2) return null;
    this.pointers.set(id, { x, y });
    const dist = this.#dist();
    let ev: PinchEvent = null;
    if (this.prevDist > 0 && dist > 0) {
      const mid = this.#mid();
      ev = { type: 'zoom', midX: mid.x, midY: mid.y, factor: dist / this.prevDist };
    }
    this.prevDist = dist;
    return ev;
  }

  up(id: number): void {
    this.pointers.delete(id);
    this.prevDist = 0;
  }

  get active(): boolean {
    return this.pointers.size >= 2;
  }

  #dist(): number {
    const [p1, p2] = [...this.pointers.values()];
    if (!p1 || !p2) return 0;
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  #mid(): PinchPoint {
    const [p1, p2] = [...this.pointers.values()];
    if (!p1 || !p2) return { x: 0, y: 0 };
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  }
}
