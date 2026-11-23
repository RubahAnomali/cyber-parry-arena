import { approach } from '../core/math';
import { StateMachine, type State } from '../core/StateMachine';
import { collideArena, collidePillars } from './Collision';
import { ARENA, P, Tuning } from './config';
import type { Enemy } from './Enemy';
import { emptyInput, type InputState } from './types';
import type { World } from './World';

export type PlayerStateId = 'Idle' | 'Move' | 'Dash' | 'Parry' | 'Hitstun' | 'Dead';

/** Adjacency table: the only legal transitions. Anything else is rejected and counted. */
const ALLOWED: Record<PlayerStateId, readonly PlayerStateId[]> = {
  Idle: ['Move', 'Dash', 'Parry', 'Hitstun', 'Dead'],
  Move: ['Idle', 'Dash', 'Parry', 'Hitstun', 'Dead'],
  Dash: ['Idle', 'Move', 'Dead'],
  Parry: ['Idle', 'Move', 'Dash', 'Hitstun', 'Dead'],
  Hitstun: ['Idle', 'Move', 'Dead'],
  Dead: [],
};

function steer(p: Player, tx: number, ty: number, rate: number, dt: number): void {
  p.vx = approach(p.vx, tx, rate * dt);
  p.vy = approach(p.vy, ty, rate * dt);
}

function hasMoveInput(p: Player): boolean {
  return p.input.moveX !== 0 || p.input.moveY !== 0;
}

function settle(p: Player): void {
  p.fsm.transition(hasMoveInput(p) ? 'Move' : 'Idle');
}

const STATES: Record<PlayerStateId, State<Player, PlayerStateId>> = {
  Idle: {
    update(p, dt) {
      steer(p, 0, 0, P.friction, dt);
      if (hasMoveInput(p)) p.fsm.transition('Move');
    },
  },
  Move: {
    update(p, dt) {
      steer(p, p.input.moveX * Tuning.playerSpeed, p.input.moveY * Tuning.playerSpeed, P.accel, dt);
      if (!hasMoveInput(p)) p.fsm.transition('Idle');
    },
  },
  Dash: {
    enter(p) {
      const inX = p.input.moveX;
      const inY = p.input.moveY;
      const l = Math.hypot(inX, inY);
      p.dashDirX = l > 0.1 ? inX / l : Math.cos(p.aim);
      p.dashDirY = l > 0.1 ? inY / l : Math.sin(p.aim);
      p.vx = p.dashDirX * P.dashSpeed;
      p.vy = p.dashDirY * P.dashSpeed;
      p.dashT = 0;
      p.dashHit.clear();
      p.dashCd = Tuning.dashCooldown;
      p.iframes = Math.max(p.iframes, P.dashIframes);
      p.world.bus.emit('PLAYER_DASHED', { x: p.x, y: p.y, dx: p.dashDirX, dy: p.dashDirY });
    },
    update(p, dt) {
      p.dashT += dt;
      const speed = P.dashSpeed * (1 - 0.25 * (p.dashT / P.dashTime));
      p.vx = p.dashDirX * speed;
      p.vy = p.dashDirY * speed;
      if (!p.world.dashContacts(p)) return; // blocked by a shield -> already left the state
      if (p.dashT >= P.dashTime) settle(p);
    },
    exit(p) {
      p.vx *= 0.4;
      p.vy *= 0.4;
    },
  },
  Parry: {
    enter(p) {
      p.parryT = 0;
      p.parrySucceeded = false;
      p.vx *= 0.5;
      p.vy *= 0.5;
      p.world.bus.emit('PARRY_STARTED', { x: p.x, y: p.y });
    },
    update(p, dt) {
      p.parryT += dt;
      steer(p, p.input.moveX * Tuning.playerSpeed * 0.35, p.input.moveY * Tuning.playerSpeed * 0.35, P.accel * 0.6, dt);
      const recovery = p.parrySucceeded ? P.parryHitRecovery : P.parryMissRecovery;
      if (p.parryT >= P.parryActive + recovery) settle(p);
    },
  },
  Hitstun: {
    update(p, dt) {
      steer(p, 0, 0, P.friction * 0.5, dt);
      if (p.fsm.time >= P.hitstun) settle(p);
    },
  },
  Dead: {
    enter(p) {
      p.vx = 0;
      p.vy = 0;
      p.world.bus.emit('PLAYER_DIED', { x: p.x, y: p.y });
    },
  },
};

export class Player implements Body2D {
  x = ARENA.w / 2;
  y = ARENA.h / 2;
  px = this.x;
  py = this.y;
  vx = 0;
  vy = 0;
  readonly r = P.radius;
  hp: number = P.maxHp;
  readonly maxHp = P.maxHp;
  aim = 0;
  input: InputState = emptyInput();

  // timers
  dashCd = 0;
  attackCd = 0;
  attackBuffer = 0;
  dashBuffer = 0;
  parryBuffer = 0;
  iframes = 0;
  parryT = 0;
  dashT = 0;
  slashFlash = 0;
  dashDirX = 1;
  dashDirY = 0;
  parrySucceeded = false;
  meter = 0;
  readonly dashHit = new Set<Enemy>();

  readonly fsm: StateMachine<Player, PlayerStateId>;

  constructor(readonly world: World) {
    this.fsm = new StateMachine<Player, PlayerStateId>(this, STATES, ALLOWED, 'Idle', (from, to) => {
      // Dash-cancel is only legal out of a *successful* parry.
      if (from === 'Parry' && to === 'Dash') return this.parrySucceeded;
      return true;
    });
  }

  reset(): void {
    this.x = this.px = ARENA.w / 2;
    this.y = this.py = ARENA.h / 2;
    this.vx = this.vy = 0;
    this.hp = P.maxHp;
    this.aim = 0;
    this.input = emptyInput();
    this.dashCd = this.attackCd = this.attackBuffer = this.dashBuffer = this.parryBuffer = 0;
    this.iframes = this.parryT = this.dashT = this.slashFlash = 0;
    this.parrySucceeded = false;
    this.meter = 0;
    this.dashHit.clear();
    this.fsm.reset();
  }

  get dead(): boolean {
    return this.fsm.current === 'Dead';
  }

  get parryActive(): boolean {
    return this.fsm.current === 'Parry' && this.parryT < P.parryActive;
  }

  update(dt: number, input: InputState): void {
    this.input = input;
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.attackBuffer = Math.max(0, this.attackBuffer - dt);
    this.dashBuffer = Math.max(0, this.dashBuffer - dt);
    this.parryBuffer = Math.max(0, this.parryBuffer - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.slashFlash = Math.max(0, this.slashFlash - dt);
    if (this.dead) return;

    this.aim = Math.atan2(input.aimY - this.y, input.aimX - this.x);
    if (input.attackPressed) this.attackBuffer = P.inputBuffer;
    if (input.dashPressed) this.dashBuffer = P.inputBuffer;
    if (input.parryPressed) this.parryBuffer = P.inputBuffer;

    const cur = this.fsm.current;
    if (this.parryBuffer > 0 && (cur === 'Idle' || cur === 'Move') && this.fsm.transition('Parry')) this.parryBuffer = 0;

    this.fsm.update(dt);

    if (this.dashBuffer > 0 && this.dashCd <= 0 && this.fsm.transition('Dash')) this.dashBuffer = 0;

    const s = this.fsm.current;
    if (this.attackBuffer > 0 && this.attackCd <= 0 && (s === 'Idle' || s === 'Move')) this.slash();

    this.x += this.vx * dt;
    this.y += this.vy * dt;
    collideArena(this);
    collidePillars(this, this.world.pillars);
  }

  private slash(): void {
    const overcharged = this.meter >= 100;
    if (overcharged) this.meter = 0;
    this.attackCd = P.attackCooldown;
    this.attackBuffer = 0;
    this.slashFlash = 0.12;
    this.vx += Math.cos(this.aim) * 160;
    this.vy += Math.sin(this.aim) * 160;
    this.world.bus.emit('PLAYER_SLASH', { x: this.x, y: this.y, angle: this.aim, overcharged });
    this.world.playerSlash(this.aim, overcharged);
  }
}

interface Body2D {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}
