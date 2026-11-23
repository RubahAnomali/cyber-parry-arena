export interface State<C, Id extends string> {
  enter?(ctx: C, from: Id | null): void;
  update?(ctx: C, dt: number): void;
  exit?(ctx: C, to: Id): void;
}

/**
 * Explicit finite state machine: every transition is validated against an adjacency
 * table (plus an optional guard) and runs exit -> enter lifecycle hooks.
 */
export class StateMachine<C, Id extends string> {
  current: Id;
  /** Seconds spent in the current state. */
  time = 0;
  /** Number of rejected transition requests (debug telemetry). */
  rejected = 0;
  readonly history: Id[] = [];

  constructor(
    private readonly ctx: C,
    private readonly states: Record<Id, State<C, Id>>,
    private readonly allowed: Record<Id, readonly Id[]>,
    private readonly initial: Id,
    private readonly guard?: (from: Id, to: Id) => boolean,
  ) {
    this.current = initial;
  }

  reset(): void {
    this.current = this.initial;
    this.time = 0;
    this.rejected = 0;
    this.history.length = 0;
    this.states[this.current].enter?.(this.ctx, null);
  }

  canTransition(to: Id): boolean {
    return to !== this.current && this.allowed[this.current].includes(to) && (this.guard?.(this.current, to) ?? true);
  }

  transition(to: Id): boolean {
    if (to === this.current) return false;
    if (!this.canTransition(to)) {
      this.rejected++;
      return false;
    }
    const from = this.current;
    this.states[from].exit?.(this.ctx, to);
    this.current = to;
    this.time = 0;
    this.history.push(to);
    if (this.history.length > 8) this.history.shift();
    this.states[to].enter?.(this.ctx, from);
    return true;
  }

  update(dt: number): void {
    this.time += dt;
    this.states[this.current].update?.(this.ctx, dt);
  }
}
