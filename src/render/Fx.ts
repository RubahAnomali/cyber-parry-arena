import { EventBus } from '../core/EventBus';
import { ObjectPool } from '../core/ObjectPool';
import { ARENA, P } from '../sim/config';
import type { GameEvents } from '../sim/events';
import type { World } from '../sim/World';
import { Camera } from './Camera';

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
}

export interface Ring {
  x: number;
  y: number;
  r0: number;
  r1: number;
  life: number;
  max: number;
  color: string;
  width: number;
  /** 0 = expanding ring, 1 = slash arc */
  kind: 0 | 1;
  angle: number;
  arc: number;
}

export interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  max: number;
  text: string;
  color: string;
  size: number;
}

export interface Ghost {
  x: number;
  y: number;
  angle: number;
  stretch: number;
  life: number;
  max: number;
}

const MAX_PARTICLES = 800;
// Spot colours from the print palette (names kept so call sites read the same).
const COLORS = {
  cyan: '#2b4fd8',
  white: '#16130f',
  red: '#e2452b',
  violet: '#6a2c70',
  amber: '#e0a526',
  shield: '#1f8a86',
};

/** Presentation-only effects. Subscribes to simulation events; every effect is pooled. */
export class Fx {
  readonly particles = new ObjectPool<Particle>(
    'particles',
    () => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, color: '#fff', drag: 3 }),
    () => {},
    256,
  );
  readonly rings = new ObjectPool<Ring>(
    'rings',
    () => ({ x: 0, y: 0, r0: 0, r1: 0, life: 0, max: 1, color: '#fff', width: 3, kind: 0, angle: 0, arc: 0 }),
    () => {},
    32,
  );
  readonly texts = new ObjectPool<FloatText>(
    'texts',
    () => ({ x: 0, y: 0, vy: 0, life: 0, max: 1, text: '', color: '#fff', size: 18 }),
    () => {},
    24,
  );
  readonly ghosts = new ObjectPool<Ghost>(
    'ghosts',
    () => ({ x: 0, y: 0, angle: 0, stretch: 1, life: 0, max: 1 }),
    () => {},
    24,
  );
  private ghostTimer = 0;

  constructor(
    bus: EventBus<GameEvents>,
    private readonly cam: Camera,
  ) {
    bus.on('PLAYER_DASHED', (e) => {
      this.burst(e.x, e.y, 14, 260, COLORS.cyan, 0.35, 3, Math.atan2(e.dy, e.dx) + Math.PI, 0.7);
      this.cam.impulse(e.dx, e.dy, 4);
    });
    bus.on('PLAYER_SLASH', (e) => {
      const r = this.rings.acquire();
      Object.assign(r, {
        x: e.x,
        y: e.y,
        r0: P.slashRange * (e.overcharged ? 0.9 : 0.55),
        r1: P.slashRange * (e.overcharged ? 1.9 : 1.1),
        life: 0.16,
        max: 0.16,
        color: e.overcharged ? COLORS.amber : COLORS.white,
        width: e.overcharged ? 16 : 9,
        kind: 1,
        angle: e.angle,
        arc: e.overcharged ? 2.6 : P.slashHalfArc,
      });
      this.cam.impulse(Math.cos(e.angle), Math.sin(e.angle), e.overcharged ? 9 : 3);
      if (e.overcharged) this.cam.addTrauma(0.35);
    });
    bus.on('ENTITY_PARRIED', (e) => {
      this.ring(e.x, e.y, 10, 120, COLORS.cyan, 0.3, 6);
      this.ring(e.x, e.y, 4, 70, COLORS.white, 0.2, 3);
      this.burst(e.x, e.y, 28, 520, COLORS.cyan, 0.5, 3);
      this.burst(e.x, e.y, 12, 380, COLORS.white, 0.35, 2);
      this.text(e.x, e.y - 24, `PARRY +${e.score}`, COLORS.cyan, 20);
      this.cam.addTrauma(0.55);
    });
    bus.on('ENTITY_DAMAGED', (e) => {
      if (e.target === 'player') {
        this.burst(e.x, e.y, 26, 460, COLORS.red, 0.6, 3);
        this.ring(e.x, e.y, 10, 90, COLORS.red, 0.3, 5);
        this.cam.addTrauma(0.6);
        this.cam.impulse(e.dx, e.dy, 10);
      } else {
        this.burst(e.x, e.y, e.heavy ? 18 : 10, e.heavy ? 420 : 300, COLORS.amber, 0.4, 2.5, Math.atan2(e.dy, e.dx), 1);
        this.cam.addTrauma(e.heavy ? 0.3 : 0.12);
      }
    });
    bus.on('ENEMY_KILLED', (e) => {
      const c = e.kind === 'rusher' ? COLORS.red : e.kind === 'sniper' ? COLORS.violet : COLORS.amber;
      this.burst(e.x, e.y, 40, 560, c, 0.75, 3.5);
      this.burst(e.x, e.y, 14, 300, COLORS.white, 0.45, 2.5);
      this.ring(e.x, e.y, 8, 100, c, 0.35, 6);
      this.text(e.x, e.y - 20, `+${e.score}`, COLORS.white, 17);
      this.cam.addTrauma(0.35);
    });
    bus.on('SHIELD_BLOCK', (e) => {
      this.burst(e.x, e.y, 14, 360, COLORS.shield, 0.35, 2.5);
      this.ring(e.x, e.y, 4, 38, COLORS.shield, 0.18, 3);
      this.cam.addTrauma(0.15);
    });
    bus.on('PROJECTILE_IMPACT', (e) => this.burst(e.x, e.y, 8, 260, COLORS.red, 0.3, 2));
    bus.on('SNIPER_FIRED', (e) => {
      this.ring(e.x, e.y, 4, 46, COLORS.violet, 0.2, 4);
      this.burst(e.x, e.y, 10, 380, COLORS.violet, 0.3, 2.5, e.angle, 0.4);
    });
    bus.on('PLAYER_DIED', (e) => {
      this.burst(e.x, e.y, 90, 700, COLORS.cyan, 1.1, 4);
      this.ring(e.x, e.y, 10, 260, COLORS.cyan, 0.7, 8);
      this.cam.addTrauma(1);
    });
    bus.on('WAVE_STARTED', (e) => this.text(ARENA.w / 2, ARENA.h / 2 - 90, `WAVE ${e.wave}`, COLORS.white, 54, 1.6));
    bus.on('WAVE_CLEARED', (e) => {
      this.text(ARENA.w / 2, ARENA.h / 2 - 90, 'WAVE CLEARED', COLORS.cyan, 44, 1.8);
      this.text(ARENA.w / 2, ARENA.h / 2 - 50, `+${e.bonus}  ·  +1 HP`, COLORS.white, 20, 1.8);
      this.ring(ARENA.w / 2, ARENA.h / 2, 20, 700, COLORS.cyan, 0.8, 4);
    });
  }

  burst(x: number, y: number, count: number, speed: number, color: string, life: number, size: number, dir = 0, spread = Math.PI): void {
    for (let i = 0; i < count; i++) {
      if (this.particles.activeCount >= MAX_PARTICLES) return;
      const p = this.particles.acquire();
      const a = dir + (Math.random() * 2 - 1) * spread;
      const s = speed * (0.25 + Math.random() * 0.75);
      p.x = x;
      p.y = y;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.life = p.max = life * (0.5 + Math.random() * 0.5);
      p.size = size * (0.5 + Math.random() * 0.8);
      p.color = color;
      p.drag = 3 + Math.random() * 2;
    }
  }

  ring(x: number, y: number, r0: number, r1: number, color: string, life: number, width: number): void {
    const r = this.rings.acquire();
    Object.assign(r, { x, y, r0, r1, life, max: life, color, width, kind: 0, angle: 0, arc: 0 });
  }

  text(x: number, y: number, text: string, color: string, size: number, life = 0.9): void {
    const t = this.texts.acquire();
    Object.assign(t, { x, y, vy: -46, life, max: life, text, color, size });
  }

  update(dt: number, world: World): void {
    const p = world.player;
    if (p.fsm.current === 'Dash') {
      this.ghostTimer -= dt;
      if (this.ghostTimer <= 0) {
        this.ghostTimer = 0.022;
        const g = this.ghosts.acquire();
        g.x = p.x;
        g.y = p.y;
        g.angle = Math.atan2(p.vy, p.vx);
        g.stretch = 1.5;
        g.life = g.max = 0.22;
      }
    }
    this.particles.sweep((q) => {
      q.life -= dt;
      const d = Math.exp(-q.drag * dt);
      q.vx *= d;
      q.vy *= d;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      return q.life > 0;
    });
    this.rings.sweep((r) => (r.life -= dt) > 0);
    this.ghosts.sweep((g) => (g.life -= dt) > 0);
    this.texts.sweep((t) => {
      t.life -= dt;
      t.y += t.vy * dt;
      return t.life > 0;
    });
  }

  clear(): void {
    this.particles.releaseAll();
    this.rings.releaseAll();
    this.texts.releaseAll();
    this.ghosts.releaseAll();
    this.ghostTimer = 0;
  }
}
