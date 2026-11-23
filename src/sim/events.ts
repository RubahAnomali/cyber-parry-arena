import type { EnemyKind } from './types';

export type GameEvents = {
  ENTITY_PARRIED: { x: number; y: number; kind: 'projectile' | 'melee'; score: number };
  ENTITY_DAMAGED: {
    x: number;
    y: number;
    amount: number;
    target: 'player' | 'enemy';
    heavy: boolean;
    dx: number;
    dy: number;
  };
  ENEMY_KILLED: { x: number; y: number; kind: EnemyKind; score: number; dx: number; dy: number };
  PLAYER_DIED: { x: number; y: number };
  WAVE_STARTED: { wave: number };
  WAVE_CLEARED: { wave: number; bonus: number };
  PLAYER_DASHED: { x: number; y: number; dx: number; dy: number };
  PLAYER_SLASH: { x: number; y: number; angle: number; overcharged: boolean };
  PARRY_STARTED: { x: number; y: number };
  SNIPER_CHARGE: { x: number; y: number; duration: number };
  SNIPER_FIRED: { x: number; y: number; angle: number };
  MELEE_TELEGRAPH: { x: number; y: number; kind: EnemyKind };
  SHIELD_BLOCK: { x: number; y: number };
  PROJECTILE_IMPACT: { x: number; y: number };
};
