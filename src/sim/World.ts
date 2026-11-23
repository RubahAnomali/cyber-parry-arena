import { angleDiff } from '../core/math';
import type { EventBus } from '../core/EventBus';
import { ObjectPool } from '../core/ObjectPool';
import { Rng } from '../core/Rng';
import { BRAINS } from './ai/brains';
import { collideArena, collidePillars, inArc, rayDistance, segHitsCircle } from './Collision';
import { ARENA, ENEMY_DEFS, P, PILLARS, SHIELD_HALF_ARC } from './config';
import { Enemy } from './Enemy';
import type { GameEvents } from './events';
import { Player } from './Player';
import type { EnemyKind, InputState, Pillar, Projectile, SpawnMarker } from './types';
import { WaveDirector } from './Waves';

function makeProjectile(): Projectile {
  return { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: 5, life: 0, damage: 1, owner: 'enemy', reflected: false, homing: false };
}

function resetProjectile(p: Projectile): void {
  p.x = p.y = p.px = p.py = p.vx = p.vy = 0;
  p.r = 5;
  p.life = 4;
  p.damage = 1;
  p.owner = 'enemy';
  p.reflected = false;
  p.homing = false;
}

/**
 * Authoritative game state. Pure simulation: no DOM, Canvas or WebAudio access.
 * Presentation layers observe it through the EventBus and by reading its fields.
 */
export class World {
  readonly pillars: readonly Pillar[] = PILLARS;
  readonly rng = new Rng(1);
  readonly projectiles = new ObjectPool<Projectile>('projectiles', makeProjectile, resetProjectile, 32);
  readonly player: Player;
  readonly waves = new WaveDirector();
  enemies: Enemy[] = [];
  spawns: SpawnMarker[] = [];
  time = 0;
  tick = 0;
  seed = 1;
  score = 0;
  combo = 0;
  comboTimer = 0;
  stats = { parries: 0, kills: 0 };
  private nextId = 1;

  constructor(readonly bus: EventBus<GameEvents>) {
    this.player = new Player(this);
    this.reset();
  }

  /** Full deterministic reset: same seed + same inputs => same run. Listeners are untouched. */
  reset(seed: number = (Math.random() * 4294967296) >>> 0): void {
    this.seed = seed;
    this.rng.seed(seed);
    this.enemies = [];
    this.spawns = [];
    this.projectiles.releaseAll();
    this.time = 0;
    this.tick = 0;
    this.score = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.stats.parries = 0;
    this.stats.kills = 0;
    this.nextId = 1;
    this.waves.reset();
    this.player.reset();
  }

  get enemiesRemaining(): number {
    return this.enemies.length + this.spawns.length + this.waves.remaining;
  }

  step(dt: number, input: InputState): void {
    this.tick++;
    this.time += dt;
    this.snapshotPrev();
    this.waves.update(dt, this);
    this.player.update(dt, input);
    for (const e of this.enemies) if (!e.dead) e.update(dt, this);
    this.separateBodies();
    this.updateProjectiles(dt);
    this.resolveParry();
    this.resolveContacts();
    this.enemies = this.enemies.filter((e) => !e.dead);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }
  }

  // ---- spawning ---------------------------------------------------------------------------

  spawnEnemy(kind: EnemyKind, x: number, y: number): Enemy {
    const e = new Enemy(kind, this.nextId++, x, y);
    e.sign = this.rng.sign();
    e.cd = this.rng.range(0.6, 1.6);
    e.thinkTimer = 0;
    e.angle = e.shieldAngle = Math.atan2(this.player.y - y, this.player.x - x);
    this.enemies.push(e);
    return e;
  }

  fireProjectile(x: number, y: number, angle: number, speed: number, owner: 'enemy' | 'player', damage: number): Projectile {
    const p = this.projectiles.acquire();
    p.x = p.px = x + Math.cos(angle) * 14;
    p.y = p.py = y + Math.sin(angle) * 14;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    p.owner = owner;
    p.damage = damage;
    return p;
  }

  raycast(x: number, y: number, angle: number, max: number): number {
    return rayDistance(x, y, angle, max, this.pillars);
  }

  // ---- combat helpers ---------------------------------------------------------------------

  /** Does the Aegis shield stop an attack coming from (fromX, fromY)? */
  shieldBlocks(e: Enemy, fromX: number, fromY: number): boolean {
    if (e.kind !== 'aegis' || e.stun > 0 || e.dead) return false;
    return Math.abs(angleDiff(e.shieldAngle, Math.atan2(fromY - e.y, fromX - e.x))) <= SHIELD_HALF_ARC;
  }

  stunEnemy(e: Enemy, duration: number): void {
    BRAINS[e.kind].abort(e, this);
    e.stun = Math.max(e.stun, duration);
    e.attackActive = false;
    e.telegraph = 0;
    e.telegraphKind = 'none';
  }

  damageEnemy(e: Enemy, amount: number, dx: number, dy: number, heavy: boolean): void {
    if (e.dead) return;
    e.hp -= amount;
    e.flash = 0.12;
    e.kx += dx * (heavy ? 520 : 340);
    e.ky += dy * (heavy ? 520 : 340);
    this.bus.emit('ENTITY_DAMAGED', { x: e.x, y: e.y, amount, target: 'enemy', heavy, dx, dy });
    if (e.hp > 0) return;
    e.dead = true;
    BRAINS[e.kind].abort(e, this);
    this.stats.kills++;
    this.bumpCombo();
    const score = Math.round(ENEMY_DEFS[e.kind].score * (1 + Math.min(this.combo, 20) * 0.1));
    this.score += score;
    this.bus.emit('ENEMY_KILLED', { x: e.x, y: e.y, kind: e.kind, score, dx, dy });
  }

  damagePlayer(amount: number, dx: number, dy: number): boolean {
    const p = this.player;
    if (p.dead || p.iframes > 0) return false;
    p.hp = Math.max(0, p.hp - amount);
    p.iframes = P.invuln;
    this.combo = 0;
    this.comboTimer = 0;
    p.vx = dx * 420;
    p.vy = dy * 420;
    this.bus.emit('ENTITY_DAMAGED', { x: p.x, y: p.y, amount, target: 'player', heavy: true, dx, dy });
    p.fsm.transition(p.hp <= 0 ? 'Dead' : 'Hitstun');
    return true;
  }

  /** Instant arc attack from the player. Overcharged slashes are wider, stronger and pierce shields. */
  playerSlash(angle: number, overcharged: boolean): void {
    const pl = this.player;
    const range = overcharged ? P.slashRange * 1.7 : P.slashRange;
    const half = overcharged ? Math.PI * 0.85 : P.slashHalfArc;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - pl.x;
      const dy = e.y - pl.y;
      const d = Math.hypot(dx, dy);
      if (d > range + e.r) continue;
      if (d > e.r + 6 && !inArc(pl.x, pl.y, angle, half, e.x, e.y)) continue;
      const nx = dx / (d || 1);
      const ny = dy / (d || 1);
      if (!overcharged && this.shieldBlocks(e, pl.x, pl.y)) {
        this.bus.emit('SHIELD_BLOCK', { x: e.x - nx * e.r, y: e.y - ny * e.r });
        pl.vx -= nx * 220;
        pl.vy -= ny * 220;
        e.kx += nx * 120;
        e.ky += ny * 120;
        continue;
      }
      if (overcharged && e.kind === 'aegis') this.stunEnemy(e, 1.2);
      this.damageEnemy(e, overcharged ? 2 : 1, nx, ny, overcharged);
    }
  }

  /**
   * Called every Dash tick. Dashing through an enemy damages it unless a shield stops the
   * dash. Returns false when the dash was blocked (the player is bounced out of the state).
   */
  dashContacts(p: Player): boolean {
    for (const e of this.enemies) {
      if (e.dead || p.dashHit.has(e)) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      if (Math.hypot(dx, dy) > e.r + p.r) continue;
      p.dashHit.add(e);
      if (this.shieldBlocks(e, p.x, p.y)) {
        this.bus.emit('SHIELD_BLOCK', { x: p.x, y: p.y });
        p.vx = -p.dashDirX * 260;
        p.vy = -p.dashDirY * 260;
        p.fsm.transition('Idle');
        return false;
      }
      this.damageEnemy(e, 1, p.dashDirX, p.dashDirY, false);
    }
    return true;
  }

  private bumpCombo(): void {
    this.combo++;
    this.comboTimer = 5;
  }

  // ---- per-tick passes --------------------------------------------------------------------

  private snapshotPrev(): void {
    const p = this.player;
    p.px = p.x;
    p.py = p.y;
    for (const e of this.enemies) {
      e.px = e.x;
      e.py = e.y;
    }
  }

  private separateBodies(): void {
    const es = this.enemies;
    for (let i = 0; i < es.length; i++) {
      const a = es[i];
      if (a.dead) continue;
      for (let j = i + 1; j < es.length; j++) {
        const b = es[j];
        if (b.dead) continue;
        this.pushApart(a, b, 0.5, 0.5);
      }
    }
    const p = this.player;
    if (!p.dead && p.fsm.current !== 'Dash') {
      for (const e of es) if (!e.dead) this.pushApart(p, e, 0.35, 0.65);
      collideArena(p);
      collidePillars(p, this.pillars);
    }
    for (const e of es) {
      collideArena(e);
      collidePillars(e, this.pillars);
    }
  }

  private pushApart(a: { x: number; y: number; r: number }, b: { x: number; y: number; r: number }, wa: number, wb: number): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const min = a.r + b.r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= min * min) return;
    const d = Math.sqrt(d2) || 0.0001;
    const push = min - d;
    const nx = dx / d;
    const ny = dy / d;
    a.x -= nx * push * wa;
    a.y -= ny * push * wa;
    b.x += nx * push * wb;
    b.y += ny * push * wb;
  }

  private updateProjectiles(dt: number): void {
    this.projectiles.sweep((p) => {
      p.px = p.x;
      p.py = p.y;
      if (p.homing) this.steerHoming(p, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0 || p.x < -60 || p.y < -60 || p.x > ARENA.w + 60 || p.y > ARENA.h + 60) return false;
      for (const pl of this.pillars) {
        if (Math.hypot(p.x - pl.x, p.y - pl.y) <= pl.r + p.r) {
          this.bus.emit('PROJECTILE_IMPACT', { x: p.x, y: p.y });
          return false;
        }
      }
      return true;
    });
  }

  /** Reflected shots bend gently toward the enemy closest to their heading (within a cone). */
  private steerHoming(p: Projectile, dt: number): void {
    const speed = Math.hypot(p.vx, p.vy);
    const heading = Math.atan2(p.vy, p.vx);
    let best: Enemy | null = null;
    let bestDiff = 1.05;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d > 520) continue;
      const diff = Math.abs(angleDiff(heading, Math.atan2(e.y - p.y, e.x - p.x)));
      if (diff < bestDiff) {
        bestDiff = diff;
        best = e;
      }
    }
    if (!best) return;
    const want = Math.atan2(best.y - p.y, best.x - p.x);
    const diff = angleDiff(heading, want);
    const step = Math.min(Math.abs(diff), 3.2 * dt) * Math.sign(diff);
    p.vx = Math.cos(heading + step) * speed;
    p.vy = Math.sin(heading + step) * speed;
  }

  private resolveParry(): void {
    const pl = this.player;
    if (!pl.parryActive) return;
    const reach = P.parryRadius;
    for (const p of this.projectiles.active) {
      if (p.owner !== 'enemy') continue;
      if (Math.hypot(p.x - pl.x, p.y - pl.y) > reach + p.r) continue;
      if (!inArc(pl.x, pl.y, pl.aim, P.parryHalfArc, p.x, p.y)) continue;
      const speed = Math.max(Math.hypot(p.vx, p.vy) * P.reflectMult, P.reflectMinSpeed);
      p.owner = 'player';
      p.reflected = true;
      p.homing = true;
      p.damage = 2;
      p.life = 3;
      p.vx = Math.cos(pl.aim) * speed;
      p.vy = Math.sin(pl.aim) * speed;
      p.x = p.px = pl.x + Math.cos(pl.aim) * (pl.r + 10);
      p.y = p.py = pl.y + Math.sin(pl.aim) * (pl.r + 10);
      this.registerParry(p.x, p.y, 'projectile', 150);
    }
    for (const e of this.enemies) {
      if (e.dead || !e.attackActive || e.attackHit) continue;
      if (Math.hypot(e.x - pl.x, e.y - pl.y) > reach + e.r) continue;
      if (!inArc(pl.x, pl.y, pl.aim, P.parryHalfArc, e.x, e.y)) continue;
      e.attackHit = true;
      this.stunEnemy(e, 1.5);
      const d = Math.hypot(e.x - pl.x, e.y - pl.y) || 1;
      e.kx += ((e.x - pl.x) / d) * 460;
      e.ky += ((e.y - pl.y) / d) * 460;
      this.registerParry(e.x, e.y, 'melee', 100);
    }
  }

  private registerParry(x: number, y: number, kind: 'projectile' | 'melee', base: number): void {
    const pl = this.player;
    pl.parrySucceeded = true;
    pl.meter = Math.min(100, pl.meter + P.meterPerParry);
    pl.iframes = Math.max(pl.iframes, 0.15);
    this.stats.parries++;
    this.bumpCombo();
    const score = Math.round(base * (1 + Math.min(this.combo, 20) * 0.1));
    this.score += score;
    this.bus.emit('ENTITY_PARRIED', { x, y, kind, score });
  }

  private resolveContacts(): void {
    const pl = this.player;
    const proj = this.projectiles.active;
    for (let i = proj.length - 1; i >= 0; i--) {
      const p = proj[i];
      if (p.owner === 'enemy') {
        if (pl.dead || !segHitsCircle(p.px, p.py, p.x, p.y, pl.x, pl.y, pl.r + p.r)) continue;
        if (pl.iframes > 0) continue; // dodged: shot passes through
        const l = Math.hypot(p.vx, p.vy) || 1;
        this.damagePlayer(p.damage, p.vx / l, p.vy / l);
        this.projectiles.release(p);
      } else {
        for (const e of this.enemies) {
          if (e.dead || !segHitsCircle(p.px, p.py, p.x, p.y, e.x, e.y, e.r + p.r)) continue;
          if (this.shieldBlocks(e, p.px, p.py)) {
            this.bus.emit('SHIELD_BLOCK', { x: p.x, y: p.y });
          } else {
            const l = Math.hypot(p.vx, p.vy) || 1;
            this.damageEnemy(e, p.damage, p.vx / l, p.vy / l, true);
          }
          this.projectiles.release(p);
          break;
        }
      }
    }

    for (const e of this.enemies) {
      if (e.dead || !e.attackActive || e.attackHit || pl.dead) continue;
      const hx = e.x + Math.cos(e.angle) * e.r * 0.8;
      const hy = e.y + Math.sin(e.angle) * e.r * 0.8;
      if (Math.hypot(hx - pl.x, hy - pl.y) > e.r + 8 + pl.r) continue;
      e.attackHit = true;
      if (pl.iframes > 0) continue;
      this.damagePlayer(1, Math.cos(e.angle), Math.sin(e.angle));
    }
  }
}
