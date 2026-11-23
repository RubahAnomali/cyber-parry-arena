import type { EnemyKind, Pillar } from './types';

export const FIXED_DT = 1 / 60;
export const MAX_FRAME_DT = 0.05;

export const ARENA = { w: 1280, h: 720 } as const;

export const PILLARS: readonly Pillar[] = [
  { x: 340, y: 230, r: 44 },
  { x: 940, y: 230, r: 44 },
  { x: 340, y: 490, r: 44 },
  { x: 940, y: 490, r: 44 },
];

/** Live-tunable values, exposed through the F1 debug panel sliders. */
export const Tuning = {
  playerSpeed: 340,
  dashCooldown: 0.65,
  spawnRate: 1,
  enemySpeed: 1,
  hitStopScale: 1,
  shakeScale: 1,
  timeScale: 1,
};

export const TuningRanges: Record<keyof typeof Tuning, [min: number, max: number, step: number]> = {
  playerSpeed: [200, 560, 5],
  dashCooldown: [0.1, 1.5, 0.05],
  spawnRate: [0.25, 3, 0.05],
  enemySpeed: [0.4, 2, 0.05],
  hitStopScale: [0, 2, 0.1],
  shakeScale: [0, 2, 0.1],
  timeScale: [0.1, 1.5, 0.05],
};

export const P = {
  radius: 14,
  maxHp: 5,
  accel: 3400,
  friction: 2800,
  dashSpeed: 980,
  dashTime: 0.15,
  dashIframes: 0.22,
  parryActive: 0.18,
  parryMissRecovery: 0.34,
  parryHitRecovery: 0.05,
  parryRadius: 84,
  parryHalfArc: Math.PI / 2,
  attackCooldown: 0.26,
  inputBuffer: 0.1,
  slashRange: 100,
  slashHalfArc: 1.15,
  hitstun: 0.26,
  invuln: 1.1,
  meterPerParry: 34,
  reflectMult: 2,
  reflectMinSpeed: 1200,
} as const;

export interface EnemyDef {
  hp: number;
  r: number;
  speed: number;
  accel: number;
  score: number;
  cost: number;
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  rusher: { hp: 2, r: 13, speed: 235, accel: 1500, score: 100, cost: 1 },
  sniper: { hp: 2, r: 12, speed: 175, accel: 1100, score: 200, cost: 2 },
  aegis: { hp: 4, r: 19, speed: 125, accel: 900, score: 300, cost: 3 },
};

export const SHIELD_HALF_ARC = 1.1;
export const SPAWN_DELAY = 0.9;

/** Seconds of simulation freeze per event. */
export const HITSTOP = { parry: 0.07, kill: 0.055, playerHit: 0.075, heavy: 0.045 } as const;
