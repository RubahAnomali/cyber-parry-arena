import { lerp } from '../core/math';
import { ARENA, P, SHIELD_HALF_ARC } from '../sim/config';
import type { Enemy } from '../sim/Enemy';
import type { World } from '../sim/World';
import type { Camera } from './Camera';
import type { Fx } from './Fx';

/** Flat "screen-print" palette: paper, ink and four spot colours. No glow, no gradients. */
export const PAL = {
  paper: '#e8e0cc',
  paperDark: '#d6cdb3',
  ink: '#16130f',
  cobalt: '#2b4fd8',
  vermilion: '#e2452b',
  plum: '#6a2c70',
  mustard: '#e0a526',
  teal: '#1f8a86',
  shadow: 'rgba(22,19,15,0.2)',
};

const ENEMY_COL = { rusher: PAL.vermilion, sniper: PAL.plum, aegis: PAL.mustard } as const;
const OUTLINE = 3;

export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  private readonly bg: HTMLCanvasElement;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private dpr = 1;
  private readonly onResize = (): void => this.resize();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly world: World,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not supported in this browser');
    this.ctx = ctx;
    this.bg = this.buildBackground();
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  dispose(): void {
    window.removeEventListener('resize', this.onResize);
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.scale = Math.min(w / ARENA.w, h / ARENA.h);
    this.ox = (w - ARENA.w * this.scale) / 2;
    this.oy = (h - ARENA.h * this.scale) / 2;
  }

  screenToWorld(cx: number, cy: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (cx - r.left - this.ox) / this.scale, y: (cy - r.top - this.oy) / this.scale };
  }

  /**
   * @param debugWorld drawn in world space (inside camera shake)
   * @param hud drawn in screen-stable logical space (no shake)
   */
  render(alpha: number, fx: Fx, cam: Camera, debugWorld: (ctx: CanvasRenderingContext2D) => void, hud: (ctx: CanvasRenderingContext2D) => void): void {
    const ctx = this.ctx;
    const w = this.world;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const k = this.scale * this.dpr;
    ctx.setTransform(k, 0, 0, k, this.ox * this.dpr, this.oy * this.dpr);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, ARENA.w, ARENA.h);
    ctx.clip();
    ctx.fillStyle = PAL.paper;
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
    ctx.translate(ARENA.w / 2 + cam.offX, ARENA.h / 2 + cam.offY);
    ctx.rotate(cam.rot);
    ctx.translate(-ARENA.w / 2, -ARENA.h / 2);

    ctx.drawImage(this.bg, 0, 0, ARENA.w, ARENA.h);
    this.drawSpawns(ctx);
    this.drawGhosts(ctx, fx);
    this.drawRings(ctx, fx);
    for (const e of w.enemies) this.drawEnemy(ctx, e, alpha);
    this.drawProjectiles(ctx, alpha);
    this.drawPlayer(ctx, alpha);
    this.drawParticles(ctx, fx);
    this.drawTexts(ctx, fx);
    debugWorld(ctx);
    ctx.restore();

    hud(ctx);
  }

  // ---- static background ------------------------------------------------------------------

  private buildBackground(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    const s = 2;
    c.width = ARENA.w * s;
    c.height = ARENA.h * s;
    const g = c.getContext('2d');
    if (!g) throw new Error('2D canvas is not supported in this browser');
    g.scale(s, s);
    g.fillStyle = PAL.paper;
    g.fillRect(0, 0, ARENA.w, ARENA.h);

    // paper grain (deterministic so the floor never shimmers between reloads)
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(22,19,15,0.05)' : 'rgba(255,250,235,0.35)';
      g.fillRect(rnd() * ARENA.w, rnd() * ARENA.h, 1 + rnd() * 2, 1 + rnd() * 2);
    }

    // registration-mark dot grid
    g.fillStyle = 'rgba(22,19,15,0.28)';
    for (let x = 40; x < ARENA.w; x += 40) {
      for (let y = 40; y < ARENA.h; y += 40) g.fillRect(x - 1, y - 1, 2, 2);
    }

    // floor ring, like a painted arena marking
    g.strokeStyle = 'rgba(22,19,15,0.18)';
    g.lineWidth = 3;
    g.setLineDash([14, 10]);
    g.beginPath();
    g.arc(ARENA.w / 2, ARENA.h / 2, 150, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);

    for (const p of this.world.pillars) {
      g.fillStyle = PAL.shadow;
      g.beginPath();
      g.arc(p.x + 7, p.y + 9, p.r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = PAL.ink;
      g.beginPath();
      g.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = PAL.paper;
      g.lineWidth = 3;
      g.setLineDash([5, 7]);
      g.beginPath();
      g.arc(p.x, p.y, p.r * 0.62, 0, Math.PI * 2);
      g.stroke();
      g.setLineDash([]);
    }

    // arena frame: heavy ink border with corner ticks
    g.strokeStyle = PAL.ink;
    g.lineWidth = 10;
    g.strokeRect(0, 0, ARENA.w, ARENA.h);
    g.strokeStyle = PAL.vermilion;
    g.lineWidth = 4;
    const L = 40;
    for (const [cx, cy, sx, sy] of [
      [14, 14, 1, 1],
      [ARENA.w - 14, 14, -1, 1],
      [14, ARENA.h - 14, 1, -1],
      [ARENA.w - 14, ARENA.h - 14, -1, -1],
    ] as const) {
      g.beginPath();
      g.moveTo(cx + sx * L, cy);
      g.lineTo(cx, cy);
      g.lineTo(cx, cy + sy * L);
      g.stroke();
    }
    return c;
  }

  // ---- shape helpers ----------------------------------------------------------------------

  /** Hard offset shadow, then fill + ink outline. `path` builds the shape at the origin. */
  private solid(ctx: CanvasRenderingContext2D, path: () => void, fill: string, shadow = 4): void {
    if (shadow > 0) {
      ctx.save();
      ctx.translate(shadow, shadow * 1.25);
      ctx.fillStyle = PAL.shadow;
      ctx.beginPath();
      path();
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = fill;
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = OUTLINE;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path();
    ctx.fill();
    ctx.stroke();
  }

  // ---- entities ---------------------------------------------------------------------------

  private drawSpawns(ctx: CanvasRenderingContext2D): void {
    for (const m of this.world.spawns) {
      const t = m.t / 0.9;
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.rotate(t * 2.5);
      ctx.beginPath();
      ctx.arc(0, 0, 34 * (1 - t) + 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = ENEMY_COL[m.kind];
      ctx.globalAlpha = 0.4 + 0.6 * t;
      ctx.beginPath();
      ctx.arc(0, 0, 5 + 8 * t, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, alpha: number): void {
    const x = lerp(e.px, e.x, alpha);
    const y = lerp(e.py, e.y, alpha);
    const col = ENEMY_COL[e.kind];

    // telegraphs (drawn under the body)
    if (e.telegraphKind === 'lunge' || e.telegraphKind === 'bash') {
      const len = e.telegraphKind === 'lunge' ? 270 : 110;
      const wdt = e.kind === 'aegis' ? e.r * 2 : 22;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(e.lockAngle);
      ctx.fillStyle = PAL.vermilion;
      ctx.globalAlpha = 0.18 + 0.5 * e.telegraph;
      ctx.fillRect(0, -wdt / 2, len * (0.3 + 0.7 * e.telegraph), wdt);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([10, 7]);
      ctx.strokeRect(0, -wdt / 2, len, wdt);
      ctx.restore();
    } else if (e.telegraphKind === 'laser') {
      const len = this.world.raycast(x, y, e.lockAngle, 1600);
      const locked = e.actionT >= 0.65;
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 2 + 5 * e.telegraph + (locked ? 3 : 0);
      if (!locked) ctx.setLineDash([16, 10]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(e.lockAngle) * len, y + Math.sin(e.lockAngle) * len);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = locked ? PAL.vermilion : PAL.plum;
      ctx.lineWidth = (2 + 5 * e.telegraph + (locked ? 3 : 0)) * 0.45;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(e.lockAngle) * len, y + Math.sin(e.lockAngle) * len);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(e.angle);
    const r = e.r;
    const path = (): void => {
      if (e.kind === 'rusher') {
        ctx.moveTo(r * 1.4, 0);
        ctx.lineTo(-r, r * 0.95);
        ctx.lineTo(-r * 0.45, 0);
        ctx.lineTo(-r, -r * 0.95);
        ctx.closePath();
      } else if (e.kind === 'sniper') {
        ctx.moveTo(r * 1.3, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 1.1, 0);
        ctx.lineTo(0, -r);
        ctx.closePath();
      } else {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
      }
    };
    this.solid(ctx, path, e.flash > 0 ? PAL.paper : col, e.attackActive ? 7 : 4);
    if (e.kind === 'sniper') {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(r * 0.1, -2.5, r * 1.3, 5);
    } else if (e.kind === 'aegis') {
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.fillStyle = PAL.ink;
      ctx.beginPath();
      ctx.arc(r * 0.15, 0, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (e.kind === 'aegis') {
      ctx.save();
      ctx.translate(x, y);
      ctx.lineCap = 'butt';
      const a0 = e.shieldAngle - SHIELD_HALF_ARC;
      const a1 = e.shieldAngle + SHIELD_HALF_ARC;
      if (e.stun <= 0) {
        ctx.strokeStyle = PAL.ink;
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 11, a0, a1);
        ctx.stroke();
        ctx.strokeStyle = PAL.teal;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 11, a0, a1);
        ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(22,19,15,0.3)';
        ctx.setLineDash([4, 8]);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, e.r + 11, a0, a1);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (e.stun > 0) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(e.age * 5);
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 3.5;
      ctx.setLineDash([7, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, e.r + 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (e.hp < e.maxHp) {
      for (let i = 0; i < e.maxHp; i++) {
        const px = x - e.maxHp * 4.5 + i * 9;
        ctx.fillStyle = i < e.hp ? PAL.ink : PAL.paperDark;
        ctx.fillRect(px, y - e.r - 16, 7, 5);
        ctx.strokeStyle = PAL.ink;
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, y - e.r - 15.5, 6, 4);
      }
    }
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, alpha: number): void {
    ctx.save();
    ctx.lineCap = 'round';
    for (const p of this.world.projectiles.active) {
      const x = lerp(p.px, p.x, alpha);
      const y = lerp(p.py, p.y, alpha);
      const sp = Math.hypot(p.vx, p.vy) || 1;
      const tail = p.owner === 'player' ? 54 : 38;
      const tx = x - (p.vx / sp) * tail;
      const ty = y - (p.vy / sp) * tail;
      const col = p.owner === 'player' ? PAL.cobalt : PAL.vermilion;
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = p.r * 2.6;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = p.r * 1.4;
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = PAL.paper;
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(x, y, p.r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, alpha: number): void {
    const p = this.world.player;
    const x = lerp(p.px, p.x, alpha);
    const y = lerp(p.py, p.y, alpha);
    const state = p.fsm.current;
    if (state === 'Dead') return;

    // parry zone
    if (state === 'Parry') {
      const active = p.parryActive;
      ctx.save();
      ctx.translate(x, y);
      if (active) {
        ctx.fillStyle = PAL.cobalt;
        ctx.globalAlpha = 0.22;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, P.parryRadius, p.aim - P.parryHalfArc, p.aim + P.parryHalfArc);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.lineCap = 'butt';
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = active ? 11 : 4;
      ctx.beginPath();
      ctx.arc(0, 0, P.parryRadius, p.aim - P.parryHalfArc, p.aim + P.parryHalfArc);
      ctx.stroke();
      if (active) {
        ctx.strokeStyle = PAL.cobalt;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(0, 0, P.parryRadius, p.aim - P.parryHalfArc, p.aim + P.parryHalfArc);
        ctx.stroke();
      }
      ctx.restore();
    }

    // velocity-based squash & stretch
    const speed = Math.hypot(p.vx, p.vy);
    const stretch = 1 + Math.min(speed / 1000, 0.55);
    const squash = 1 / Math.sqrt(stretch);
    const blink = p.iframes > 0 && state !== 'Dash' && Math.floor(p.iframes * 18) % 2 === 0;

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = blink ? 0.4 : 1;
    ctx.save();
    ctx.rotate(speed > 20 ? Math.atan2(p.vy, p.vx) : p.aim);
    ctx.scale(stretch, squash);
    const fill = state === 'Hitstun' ? PAL.vermilion : state === 'Dash' ? PAL.paper : PAL.cobalt;
    this.solid(ctx, () => ctx.arc(0, 0, p.r, 0, Math.PI * 2), fill, 4);
    ctx.restore();
    // aim pointer
    ctx.rotate(p.aim);
    ctx.fillStyle = PAL.ink;
    ctx.beginPath();
    ctx.moveTo(p.r + 13, 0);
    ctx.lineTo(p.r + 3, -5);
    ctx.lineTo(p.r + 3, 5);
    ctx.closePath();
    ctx.fill();
    if (p.meter >= 100) {
      ctx.strokeStyle = PAL.mustard;
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.arc(0, 0, p.r + 8 + Math.sin(this.world.time * 12) * 1.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- fx ---------------------------------------------------------------------------------

  private drawGhosts(ctx: CanvasRenderingContext2D, fx: Fx): void {
    ctx.save();
    ctx.fillStyle = PAL.cobalt;
    for (const g of fx.ghosts.active) {
      ctx.globalAlpha = (g.life / g.max) * 0.4;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.rotate(g.angle);
      ctx.scale(g.stretch, 1 / Math.sqrt(g.stretch));
      ctx.beginPath();
      ctx.arc(0, 0, P.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawRings(ctx: CanvasRenderingContext2D, fx: Fx): void {
    ctx.save();
    ctx.lineCap = 'butt';
    for (const r of fx.rings.active) {
      const t = 1 - r.life / r.max;
      const rad = lerp(r.r0, r.r1, 1 - (1 - t) * (1 - t));
      ctx.globalAlpha = 1 - t * t;
      ctx.lineWidth = r.width * (1 - t * 0.6);
      ctx.strokeStyle = r.color;
      ctx.beginPath();
      if (r.kind === 0) ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      else ctx.arc(r.x, r.y, rad, r.angle - r.arc, r.angle + r.arc);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, fx: Fx): void {
    ctx.save();
    for (const p of fx.particles.active) {
      const t = p.life / p.max;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.fillStyle = p.color;
      const s = p.size * (0.5 + 0.7 * t) * 1.5;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.vy, p.vx));
      ctx.fillRect(-s, -s / 2.4, s * 2, s / 1.2); // streak aligned to travel direction
      ctx.restore();
    }
    ctx.restore();
  }

  private drawTexts(ctx: CanvasRenderingContext2D, fx: Fx): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const t of fx.texts.active) {
      ctx.globalAlpha = Math.min(1, (t.life / t.max) * 2.2);
      ctx.font = `900 ${t.size}px "Arial Black", Impact, sans-serif`;
      ctx.lineWidth = Math.max(4, t.size * 0.22);
      ctx.strokeStyle = PAL.paper;
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.restore();
  }
}
