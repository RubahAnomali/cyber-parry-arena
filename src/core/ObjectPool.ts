/**
 * Generic object pool. Items are created lazily (or pre-warmed), recycled via `release`,
 * and re-initialised by `reset` on every `acquire` so no state leaks between uses.
 */
export class ObjectPool<T> {
  readonly active: T[] = [];
  private readonly free: T[] = [];
  private created = 0;

  constructor(
    readonly name: string,
    private readonly factory: () => T,
    private readonly reset: (item: T) => void,
    prewarm = 0,
  ) {
    for (let i = 0; i < prewarm; i++) {
      this.free.push(factory());
      this.created++;
    }
  }

  acquire(): T {
    let item = this.free.pop();
    if (item === undefined) {
      item = this.factory();
      this.created++;
    }
    this.reset(item);
    this.active.push(item);
    return item;
  }

  release(item: T): boolean {
    const i = this.active.indexOf(item);
    if (i < 0) return false;
    this.removeAt(i);
    return true;
  }

  /** Iterate backwards; items for which `keep` returns false are released (swap-remove). */
  sweep(keep: (item: T) => boolean): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (!keep(this.active[i])) this.removeAt(i);
    }
  }

  releaseAll(): void {
    while (this.active.length > 0) this.free.push(this.active.pop() as T);
  }

  get activeCount(): number {
    return this.active.length;
  }

  get freeCount(): number {
    return this.free.length;
  }

  get totalCreated(): number {
    return this.created;
  }

  private removeAt(i: number): void {
    const item = this.active[i];
    const last = this.active.length - 1;
    this.active[i] = this.active[last];
    this.active.pop();
    this.free.push(item);
  }
}
