import { clamp, rotateToward } from '../../core/math';
import { ARENA } from '../config';
import type { Enemy } from '../Enemy';
import type { Action } from './UtilityBrain';

const CHARGE = 0.9;
const LOCK_AT = 0.65; // aim stops tracking this far into the charge, leaving a parry/dodge window
const RECOVER = 0.45;
const SHOT_SPEED = 950;
const WALL_MARGIN = 110;

/** Repulsion from arena walls, components in -1..1. */
function wallPush(e: Enemy): { x: number; y: number } {
  const x = clamp((WALL_MARGIN - e.x) / WALL_MARGIN, 0, 1) - clamp((WALL_MARGIN - (ARENA.w - e.x)) / WALL_MARGIN, 0, 1);
  const y = clamp((WALL_MARGIN - e.y) / WALL_MARGIN, 0, 1) - clamp((WALL_MARGIN - (ARENA.h - e.y)) / WALL_MARGIN, 0, 1);
  return { x, y };
}

/** Keep distance: flee when too close (sliding sideways along walls), close in when too far. */
const Reposition: Action = {
  id: 'Reposition',
  interruptible: true,
  score(c) {
    const w = wallPush(c.e);
    const cornered = Math.hypot(w.x, w.y) > 0.9;
    if (c.dist < 330) return cornered ? 0.45 : 0.92;
    if (c.dist > 640) return 0.6;
    return 0.1;
  },
  enter() {},
  update(c, dt) {
    const { e, p } = c;
    const ax = (e.x - p.x) / (c.dist || 1);
    const ay = (e.y - p.y) / (c.dist || 1);
    const s = c.dist < 330 ? 1 : -1;
    const w = wallPush(e);
    let dx = ax * s - ay * e.sign * 0.6 + w.x * 1.6;
    let dy = ay * s + ax * e.sign * 0.6 + w.y * 1.6;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    e.moveToward(e.x + dx * 200, e.y + dy * 200, 1, dt);
    e.angle = c.angToPlayer;
    return false;
  },
};

/** Lost the sightline (pillar in the way): circle the player until it is regained. */
const SeekLOS: Action = {
  id: 'SeekLOS',
  interruptible: true,
  score: (c) => (c.los ? 0 : 0.9),
  enter() {},
  update(c, dt) {
    const { e, p } = c;
    const a = Math.atan2(e.y - p.y, e.x - p.x) + e.sign * 0.35;
    const R = clamp(c.dist, 380, 520);
    e.moveToward(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R, 1.1, dt);
    e.angle = c.angToPlayer;
    return false;
  },
};

/** Cooldown filler: drift around the player at the current range. */
const Strafe: Action = {
  id: 'Strafe',
  interruptible: true,
  score: () => 0.3,
  enter() {},
  update(c, dt) {
    const { e, p } = c;
    const a = Math.atan2(e.y - p.y, e.x - p.x) + e.sign * 0.3;
    const R = clamp(c.dist, 380, 560);
    e.moveToward(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R, 0.7, dt);
    e.angle = c.angToPlayer;
    return false;
  },
};

/** Laser sightline telegraph (0.9s) -> high-velocity rail shot -> recovery. */
const Snipe: Action = {
  id: 'Snipe',
  interruptible: false,
  score(c) {
    const e = c.e;
    if (!c.los || e.cd > 0 || c.dist < 220 || c.dist > 900) return 0;
    return 0.75 + (c.dist >= 380 && c.dist <= 620 ? 0.2 : 0);
  },
  enter(c) {
    const e = c.e;
    e.lockAngle = c.angToPlayer;
    e.telegraph = 0;
    e.telegraphKind = 'laser';
    c.w.bus.emit('SNIPER_CHARGE', { x: e.x, y: e.y, duration: CHARGE });
  },
  update(c, dt) {
    const e = c.e;
    e.angle = e.lockAngle;
    e.stop(dt, 2500);
    if (e.phase === 0) {
      if (e.actionT < LOCK_AT) e.lockAngle = rotateToward(e.lockAngle, c.angToPlayer, 3.2 * dt);
      e.telegraph = e.actionT / CHARGE;
      if (e.actionT >= CHARGE) {
        c.w.fireProjectile(e.x, e.y, e.lockAngle, SHOT_SPEED, 'enemy', 1);
        c.w.bus.emit('SNIPER_FIRED', { x: e.x, y: e.y, angle: e.lockAngle });
        e.vx -= Math.cos(e.lockAngle) * 140;
        e.vy -= Math.sin(e.lockAngle) * 140;
        e.phase = 1;
        e.actionT = 0;
        e.telegraph = 0;
        e.telegraphKind = 'none';
      }
    } else if (e.actionT >= RECOVER) {
      return true;
    }
    return false;
  },
  exit(c) {
    const e = c.e;
    e.telegraph = 0;
    e.telegraphKind = 'none';
    e.cd = c.w.rng.range(2.2, 3.2);
  },
};

export const SNIPER_ACTIONS: readonly Action[] = [Reposition, SeekLOS, Strafe, Snipe];
