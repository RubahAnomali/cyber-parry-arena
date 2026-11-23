import { clamp01, rotateToward } from '../../core/math';
import type { Action } from './UtilityBrain';

const BASH_RANGE = 135;
const WINDUP = 0.55;
const BASH_T = 0.2;
const RECOVER = 0.6;
const BASH_SPEED = 430;
const TURN = 2.4;

/** Interpose between the player and the nearest Sniper, shield turned toward the player. */
const Guard: Action = {
  id: 'Guard',
  interruptible: true,
  score: (c) => (c.sniper ? 0.8 : 0),
  enter() {},
  update(c, dt) {
    const { e, p } = c;
    const s = c.sniper;
    if (s) {
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const l = Math.hypot(dx, dy) || 1;
      e.moveToward(s.x + (dx / l) * 105, s.y + (dy / l) * 105, 1, dt);
    }
    e.shieldAngle = rotateToward(e.shieldAngle, c.angToPlayer, TURN * dt);
    e.angle = e.shieldAngle;
    return false;
  },
};

/** No Sniper to protect: march on the player, shield first. */
const Advance: Action = {
  id: 'Advance',
  interruptible: true,
  score: (c) => (c.sniper ? 0.2 : 0.4 + 0.3 * clamp01((c.dist - 150) / 300)),
  enter() {},
  update(c, dt) {
    const e = c.e;
    if (c.dist > 140) e.moveToward(c.p.x, c.p.y, 1, dt);
    else e.stop(dt);
    e.shieldAngle = rotateToward(e.shieldAngle, c.angToPlayer, TURN * dt);
    e.angle = e.shieldAngle;
    return false;
  },
};

const Hold: Action = {
  id: 'Hold',
  interruptible: true,
  score: () => 0.15,
  enter() {},
  update(c, dt) {
    const e = c.e;
    e.stop(dt);
    e.shieldAngle = rotateToward(e.shieldAngle, c.angToPlayer, TURN * dt);
    e.angle = e.shieldAngle;
    return false;
  },
};

/** Shield bash: slow windup (shield still tracking), short forward charge, long recovery. */
const Bash: Action = {
  id: 'Bash',
  interruptible: false,
  score: (c) => (c.e.cd <= 0 && c.dist < BASH_RANGE ? 1 : 0),
  enter(c) {
    const e = c.e;
    e.lockAngle = c.angToPlayer;
    e.telegraphKind = 'bash';
    e.telegraph = 0;
    c.w.bus.emit('MELEE_TELEGRAPH', { x: e.x, y: e.y, kind: 'aegis' });
  },
  update(c, dt) {
    const e = c.e;
    if (e.phase === 0) {
      e.stop(dt);
      if (e.actionT < WINDUP * 0.7) e.lockAngle = rotateToward(e.lockAngle, c.angToPlayer, 1.6 * dt);
      e.shieldAngle = e.lockAngle;
      e.angle = e.lockAngle;
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
      e.vx = Math.cos(e.lockAngle) * BASH_SPEED;
      e.vy = Math.sin(e.lockAngle) * BASH_SPEED;
      if (e.actionT >= BASH_T) {
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
    e.cd = c.w.rng.range(2.2, 3.0);
  },
};

export const AEGIS_ACTIONS: readonly Action[] = [Guard, Advance, Hold, Bash];
