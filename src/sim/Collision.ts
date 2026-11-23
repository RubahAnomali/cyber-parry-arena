import { angleDiff } from '../core/math';
import { ARENA } from './config';
import type { Body, Pillar } from './types';

export function distToSegmentSq(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((cx - ax) * abx + (cy - ay) * aby) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - cx;
  const dy = ay + aby * t - cy;
  return dx * dx + dy * dy;
}

/** Swept test: does segment a->b touch the circle (c, r)? */
export function segHitsCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  return distToSegmentSq(ax, ay, bx, by, cx, cy) <= r * r;
}

export function inArc(ox: number, oy: number, facing: number, halfArc: number, tx: number, ty: number): boolean {
  return Math.abs(angleDiff(facing, Math.atan2(ty - oy, tx - ox))) <= halfArc;
}

export function hasLOS(ax: number, ay: number, bx: number, by: number, pillars: readonly Pillar[]): boolean {
  for (const p of pillars) if (segHitsCircle(ax, ay, bx, by, p.x, p.y, p.r)) return false;
  return true;
}

/** Clamp to arena bounds; velocity into the wall is removed so bodies slide along it. */
export function collideArena(b: Body): void {
  if (b.x < b.r) {
    b.x = b.r;
    if (b.vx < 0) b.vx = 0;
  } else if (b.x > ARENA.w - b.r) {
    b.x = ARENA.w - b.r;
    if (b.vx > 0) b.vx = 0;
  }
  if (b.y < b.r) {
    b.y = b.r;
    if (b.vy < 0) b.vy = 0;
  } else if (b.y > ARENA.h - b.r) {
    b.y = ARENA.h - b.r;
    if (b.vy > 0) b.vy = 0;
  }
}

export function collidePillars(b: Body, pillars: readonly Pillar[]): void {
  for (const p of pillars) {
    const dx = b.x - p.x;
    const dy = b.y - p.y;
    const min = p.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) continue;
    const d = Math.sqrt(d2) || 0.0001;
    const nx = dx / d;
    const ny = dy / d;
    b.x = p.x + nx * min;
    b.y = p.y + ny * min;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= vn * nx;
      b.vy -= vn * ny;
    }
  }
}

/** Distance from (x,y) along `angle` to the first pillar or arena wall (capped at `max`). */
export function rayDistance(x: number, y: number, angle: number, max: number, pillars: readonly Pillar[]): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t = max;
  if (dx > 1e-6) t = Math.min(t, (ARENA.w - x) / dx);
  else if (dx < -1e-6) t = Math.min(t, -x / dx);
  if (dy > 1e-6) t = Math.min(t, (ARENA.h - y) / dy);
  else if (dy < -1e-6) t = Math.min(t, -y / dy);
  for (const p of pillars) {
    const fx = x - p.x;
    const fy = y - p.y;
    const b = fx * dx + fy * dy;
    const c = fx * fx + fy * fy - p.r * p.r;
    const disc = b * b - c;
    if (disc < 0) continue;
    const s = -b - Math.sqrt(disc);
    if (s > 0 && s < t) t = s;
  }
  return Math.max(0, t);
}
