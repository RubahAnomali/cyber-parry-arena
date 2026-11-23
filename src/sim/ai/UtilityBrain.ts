import { angleDiff } from '../../core/math';
import { hasLOS } from '../Collision';
import type { Enemy } from '../Enemy';
import type { Player } from '../Player';
import type { World } from '../World';

/** Read-only world snapshot the considerations score against (reused to avoid allocation). */
export interface AIContext {
  e: Enemy;
  w: World;
  p: Player;
  dist: number;
  angToPlayer: number;
  los: boolean;
  /** 0 = enemy is in front of the player's aim, 1 = directly behind (in the blind spot). */
  behind: number;
  sniper: Enemy | null;
}

export interface Action {
  readonly id: string;
  /** Committed actions (telegraphed attacks) cannot be pre-empted by re-scoring. */
  readonly interruptible: boolean;
  /** Utility in roughly 0..1.2; <= 0 means the action is unavailable. */
  score(c: AIContext): number;
  enter(c: AIContext): void;
  /** Returns true when the action has finished. */
  update(c: AIContext, dt: number): boolean;
  exit?(c: AIContext): void;
}

export interface ScoredAction {
  id: string;
  score: number;
}

const ctx = {} as AIContext;

export function fillContext(e: Enemy, w: World): AIContext {
  const p = w.player;
  const dx = p.x - e.x;
  const dy = p.y - e.y;
  ctx.e = e;
  ctx.w = w;
  ctx.p = p;
  ctx.dist = Math.hypot(dx, dy);
  ctx.angToPlayer = Math.atan2(dy, dx);
  ctx.los = hasLOS(e.x, e.y, p.x, p.y, w.pillars);
  ctx.behind = Math.abs(angleDiff(p.aim, Math.atan2(-dy, -dx))) / Math.PI;
  let best: Enemy | null = null;
  let bestD = Infinity;
  for (const o of w.enemies) {
    if (o === e || o.dead || o.kind !== 'sniper') continue;
    const d = Math.hypot(o.x - e.x, o.y - e.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  ctx.sniper = best;
  return ctx;
}

const HYSTERESIS = 0.12;

/**
 * Utility AI: every think interval each action scores itself from the context, the best
 * one wins (with a small bonus for the current action to prevent flip-flopping).
 */
export class UtilityBrain {
  constructor(private readonly actions: readonly Action[]) {}

  think(e: Enemy, w: World, dt: number): void {
    const c = fillContext(e, w);
    e.thinkTimer -= dt;
    if (!e.action || (e.action.interruptible && e.thinkTimer <= 0)) this.choose(c);
    const a = e.action;
    if (a) {
      e.actionT += dt;
      if (a.update(c, dt)) this.finish(c);
    } else {
      e.stop(dt);
    }
  }

  abort(e: Enemy, w: World): void {
    if (!e.action) return;
    const c = fillContext(e, w);
    e.action.exit?.(c);
    e.action = null;
  }

  private choose(c: AIContext): void {
    const e = c.e;
    e.scores.length = 0;
    let best: Action | null = null;
    let bestScore = 0;
    for (const a of this.actions) {
      let s = a.score(c);
      if (s <= 0) continue;
      if (a === e.action) s += HYSTERESIS;
      e.scores.push({ id: a.id, score: s });
      if (s > bestScore) {
        bestScore = s;
        best = a;
      }
    }
    e.scores.sort((a, b) => b.score - a.score);
    e.thinkTimer = c.w.rng.range(0.18, 0.34);
    if (best && best !== e.action) {
      e.action?.exit?.(c);
      e.action = best;
      e.actionT = 0;
      e.phase = 0;
      best.enter(c);
    }
  }

  private finish(c: AIContext): void {
    const e = c.e;
    e.action?.exit?.(c);
    e.action = null;
    e.thinkTimer = 0;
  }
}
