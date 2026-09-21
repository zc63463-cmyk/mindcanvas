/** 快照式 undo/redo（不可变树操作使旧快照天然安全） */

export class History<T> {
  private past: T[] = [];
  private present: T;
  private future: T[] = [];

  constructor(
    initial: T,
    private readonly limit = 100,
  ) {
    this.present = initial;
  }

  get current(): T {
    return this.present;
  }

  /** 提交新状态（截断 redo 分支） */
  push(next: T): void {
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  undo(): T | null {
    if (this.past.length === 0) return null;
    this.future.push(this.present);
    this.present = this.past.pop() as T;
    return this.present;
  }

  redo(): T | null {
    if (this.future.length === 0) return null;
    this.past.push(this.present);
    this.present = this.future.pop() as T;
    return this.present;
  }

  /** 打开新文件时重置 */
  reset(initial: T): void {
    this.past = [];
    this.present = initial;
    this.future = [];
  }
}
