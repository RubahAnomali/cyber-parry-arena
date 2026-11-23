import { approach } from '../core/math';
import { BRAINS } from './ai/brains';
import type { Action, ScoredAction } from './ai/UtilityBrain';
import { collideArena, collidePillars } from './Collision';
import { ENEMY_DEFS, Tuning, type EnemyDef } from './config';
import type { EnemyKind } from './types';
import type { World } from './World';

export type TelegraphKind = 'none' | 'lunge' | 'laser' | 'bash';

export class Enemy {
  readonly def: EnemyDef;
  x: number;
  y: number;
  px: number;
  py: number;
  vx = 0;
  vy = 0;
  /** Decaying knockback velocity, added on top of steering velocity. */
  kx = 0;
  ky = 0;
  r: number;
  hp: number;
  maxHp: number;
  dead = false;
  /** Facing angle (radians). */
  angle = 0;
  shieldAngle = 0;
  stun = 0;
  flash = 0;
  /** Primary attack cooldown. */
  cd = 0;
  /** Seconds since the last attack; feeds "patience" considerations. */
  idle = 0;
  age = 0;
  sign: 1 | -1 = 1;

  // Utility-AI state
  action: Action | null = null;
  actionT = 0;
  phase = 0;
  thinkTimer = 0;
  lockAngle = 0;
  scores: ScoredAction[] = [];

  // Attack presentation / hitbox state
  attackActive = false;
  attackHit = false;
  telegraph = 0;
  telegraphKind: TelegraphKind = 'none';

  constructor(
    readonly kind: EnemyKind,
    readonly id: number,
    x: number,
    y: number,
  ) {
    this.def = ENEMY_DEFS[kind];
    this.x = this.px = x;
    this.y = this.py = y;
    this.r = this.def.r;
    this.hp = this.maxHp = this.def.hp;
  }

  moveToward(tx: number, ty: number, speedMul: number, dt: number): void {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    const k = d > 6 ? (this.def.speed * Tuning.enemySpeed * speedMul) / d : 0;
    this.vx = approach(this.vx, dx * k, this.def.accel * dt);
    this.vy = approach(this.vy, dy * k, this.def.accel * dt);
  }

  stop(dt: number, rate = this.def.accel * 1.5): void {
    this.vx = approach(this.vx, 0, rate * dt);
    this.vy = approach(this.vy, 0, rate * dt);
  }

  update(dt: number, w: World): void {
    this.cd = Math.max(0, this.cd - dt);
    this.flash = Math.max(0, this.flash - dt);
    this.idle += dt;
    this.age += dt;
    if (this.stun > 0) {
      this.stun -= dt;
      this.stop(dt, 1200);
    } else {
      BRAINS[this.kind].think(this, w, dt);
    }
    this.x += (this.vx + this.kx) * dt;
    this.y += (this.vy + this.ky) * dt;
    const decay = Math.exp(-7 * dt);
    this.kx *= decay;
    this.ky *= decay;
    collideArena(this);
    collidePillars(this, w.pillars);
  }
}
