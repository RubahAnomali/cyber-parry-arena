import { ARENA, ENEMY_DEFS, SPAWN_DELAY, Tuning } from './config';
import type { EnemyKind } from './types';
import type { World } from './World';

type Phase = 'intermission' | 'active';

/** Budget-based wave director: spends a point budget on enemy archetypes and staggers spawns. */
export class WaveDirector {
  wave = 0;
  phase: Phase = 'intermission';
  timer = 1.2;
  queue: EnemyKind[] = [];
  private spawnTimer = 0;

  reset(): void {
    this.wave = 0;
    this.phase = 'intermission';
    this.timer = 1.2;
    this.queue.length = 0;
    this.spawnTimer = 0;
  }

  get remaining(): number {
    return this.queue.length;
  }

  update(dt: number, w: World): void {
    if (this.phase === 'intermission') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave(w);
      return;
    }

    this.spawnTimer -= dt;
    const cap = 6 + Math.floor(this.wave / 2);
    if (this.queue.length > 0 && this.spawnTimer <= 0 && w.enemies.length + w.spawns.length < cap) {
      const kind = this.queue.shift() as EnemyKind;
      const pos = this.pickSpawn(w);
      w.spawns.push({ x: pos.x, y: pos.y, t: 0, kind });
      this.spawnTimer = 0.8 / Tuning.spawnRate;
    }

    for (let i = w.spawns.length - 1; i >= 0; i--) {
      const m = w.spawns[i];
      m.t += dt;
      if (m.t >= SPAWN_DELAY) {
        w.spawnEnemy(m.kind, m.x, m.y);
        w.spawns.splice(i, 1);
      }
    }

    if (this.queue.length === 0 && w.spawns.length === 0 && w.enemies.length === 0) this.clearWave(w);
  }

  private startWave(w: World): void {
    this.wave++;
    this.phase = 'active';
    this.spawnTimer = 0.4;
    this.queue = this.compose(this.wave, w);
    w.bus.emit('WAVE_STARTED', { wave: this.wave });
  }

  private clearWave(w: World): void {
    const bonus = 100 * this.wave;
    w.score += bonus;
    const p = w.player;
    if (!p.dead && p.hp < p.maxHp) p.hp++;
    this.phase = 'intermission';
    this.timer = 3;
    w.bus.emit('WAVE_CLEARED', { wave: this.wave, bonus });
  }

  private compose(n: number, w: World): EnemyKind[] {
    let budget = Math.floor(2 + n * 1.4);
    const out: EnemyKind[] = [];
    // Introduce each new archetype the first wave it becomes available.
    const intro: EnemyKind | null = n === 2 ? 'sniper' : n === 4 ? 'aegis' : null;
    if (intro) {
      out.push(intro);
      budget -= ENEMY_DEFS[intro].cost;
    }
    while (budget > 0) {
      const pool: [EnemyKind, number][] = [['rusher', 3]];
      if (n >= 2 && budget >= ENEMY_DEFS.sniper.cost) pool.push(['sniper', 2]);
      if (n >= 4 && budget >= ENEMY_DEFS.aegis.cost) pool.push(['aegis', 1.5]);
      const total = pool.reduce((s, [, wt]) => s + wt, 0);
      let r = w.rng.next() * total;
      let pick: EnemyKind = 'rusher';
      for (const [k, wt] of pool) {
        r -= wt;
        if (r <= 0) {
          pick = k;
          break;
        }
      }
      out.push(pick);
      budget -= ENEMY_DEFS[pick].cost;
    }
    return out;
  }

  private pickSpawn(w: World): { x: number; y: number } {
    const m = 70;
    let x = m;
    let y = m;
    for (let i = 0; i < 30; i++) {
      x = w.rng.range(m, ARENA.w - m);
      y = w.rng.range(m, ARENA.h - m);
      if (Math.hypot(x - w.player.x, y - w.player.y) < 300) continue;
      if (w.pillars.some((p) => Math.hypot(x - p.x, y - p.y) < p.r + 40)) continue;
      break;
    }
    return { x, y };
  }
}
