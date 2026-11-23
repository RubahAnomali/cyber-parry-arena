import { angleDiff, clamp, clamp01, rotateToward } from '../../core/math';
import type { Action } from './UtilityBrain';

const LUNGE_MIN = 60;
const LUNGE_MAX = 250;
const WINDUP = 0.5;
const LUNGE_T = 0.24;
const RECOVER = 0.5;
const LUNGE_SPEED = 780;

const Approach: Action = {
  id: 'Approach',
  interruptible: true,
  score: (c) => 0.3 + 0.4 * clamp01((c.dist - 180) / 420),
  enter() {},
  update(c, dt) {
    c.e.moveToward(c.p.x, c.p.y, 1, dt);
    c.e.angle = c.angToPlayer;
    return false;
  },
};

/** Circle around the player toward the blind spot behind their aim direction. */
const Flank: Action = {
  id: 'Flank',
  interruptible: true,
  score: (c) => (c.dist > 600 ? 0 : 0.35 + 0.45 * (1 - c.behind) * (c.dist < 500 ? 1 : 0.6)),
  enter() {},
  update(c, dt) {
    const { e, p } = c;
    const te = Math.atan2(e.y - p.y, e.x - p.x);
    const side = Math.sign(angleDiff(te, p.aim + Math.PI)) || 1;
    const a = te + side * 0.6;
    const R = clamp(c.dist, 150, 230);
    e.moveToward(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R, 1.15, dt);
    e.angle = c.angToPlayer;
    return false;
  },
};

/** While the lunge is on cooldown, orbit at mid range waiting for an opening. */
const Strafe: Action = {
  id: 'Strafe',
  interruptible: true,
  score: (c) => (c.e.cd > 0 && c.dist < 280 ? 0.9 : 0),
  enter() {},
  update(c, dt) {
    const { e, p } = c;
    const a = Math.atan2(e.y - p.y, e.x - p.x) + e.sign * 0.5;
    e.moveToward(p.x + Math.cos(a) * 210, p.y + Math.sin(a) * 210, 0.9, dt);
    e.angle = c.angToPlayer;
    return false;
  },
};

/** Telegraphed dash-slash: windup (aim tracks, then locks) -> dash -> recovery. */
const Lunge: Action = {
  id: 'Lunge',
  interruptible: false,
  score(c) {
    const e = c.e;
    if (e.cd > 0 || c.dist > LUNGE_MAX || c.dist < LUNGE_MIN) return 0;
    const patience = Math.min(0.3, e.idle * 0.06);
    return 0.25 + 0.6 * c.behind + 0.25 * (1 - (c.dist - LUNGE_MIN) / (LUNGE_MAX - LUNGE_MIN)) + patience;
  },
  enter(c) {
    const e = c.e;
    e.lockAngle = c.angToPlayer;
    e.telegraphKind = 'lunge';
    e.telegraph = 0;
    e.idle = 0;
    c.w.bus.emit('MELEE_TELEGRAPH', { x: e.x, y: e.y, kind: 'rusher' });
  },
  update(c, dt) {
    const e = c.e;
    e.angle = e.lockAngle;
    if (e.phase === 0) {
      e.stop(dt);
      if (e.actionT < WINDUP * 0.68) e.lockAngle = rotateToward(e.lockAngle, c.angToPlayer, 5 * dt);
      e.telegraph = e.actionT / WINDUP;
      if (e.actionT >= WINDUP) {
        e.phase = 1;
        e.actionT = 0;
        e.telegraph = 0;
        e.telegraphKind = 'none';
        e.attackActive = true;
        e.attackHit = false;
      }
    } else if (e.phase === 1) {
      e.vx = Math.cos(e.lockAngle) * LUNGE_SPEED;
      e.vy = Math.sin(e.lockAngle) * LUNGE_SPEED;
      if (e.actionT >= LUNGE_T) {
        e.phase = 2;
        e.actionT = 0;
        e.attackActive = false;
      }
    } else {
      e.stop(dt, 3000);
      if (e.actionT >= RECOVER) return true;
    }
    return false;
  },
  exit(c) {
    const e = c.e;
    e.attackActive = false;
    e.telegraph = 0;
    e.telegraphKind = 'none';
    e.cd = c.w.rng.range(2.0, 3.0);
  },
};

export const RUSHER_ACTIONS: readonly Action[] = [Approach, Flank, Strafe, Lunge];
