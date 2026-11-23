export type EnemyKind = 'rusher' | 'sniper' | 'aegis';

/** Plain-data input snapshot. The simulation never touches the DOM. */
export interface InputState {
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
  dashPressed: boolean;
  parryPressed: boolean;
  attackPressed: boolean;
}

export const emptyInput = (): InputState => ({
  moveX: 0,
  moveY: 0,
  aimX: 0,
  aimY: 0,
  dashPressed: false,
  parryPressed: false,
  attackPressed: false,
});

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface Projectile {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  damage: number;
  owner: 'enemy' | 'player';
  reflected: boolean;
  homing: boolean;
}

export interface Pillar {
  x: number;
  y: number;
  r: number;
}

export interface SpawnMarker {
  x: number;
  y: number;
  t: number;
  kind: EnemyKind;
}
