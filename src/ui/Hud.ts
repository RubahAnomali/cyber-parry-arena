import { ARENA, P, Tuning } from '../sim/config';
import { PAL } from '../render/Renderer';
import type { World } from '../sim/World';

export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

const HEAD = '"Arial Black", Impact, "Helvetica Neue", sans-serif';
const BODY = '"Trebuchet MS", "Segoe UI", Verdana, sans-serif';

function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string = PAL.ink, align: CanvasTextAlign = 'left', head = false): void {
  ctx.font = head ? `900 ${size}px ${HEAD}` : `700 ${size}px ${BODY}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
}

/** Headline with a hard offset "misregistered print" shadow. */
function headline(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, shadow: string): void {
  text(ctx, s, x + size * 0.06, y + size * 0.07, size, shadow, 'center', true);
  text(ctx, s, x, y, size, color, 'center', true);
}

function bar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: number, color: string): void {
  ctx.fillStyle = PAL.paperDark;
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w * Math.max(0, Math.min(1, t)), h);
  ctx.strokeStyle = PAL.ink;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(x, y, w, h);
}

/** Canvas-drawn HUD and menu screens (screen-stable: not affected by camera shake). */
export class Hud {
  draw(ctx: CanvasRenderingContext2D, world: World, state: GameState, muted: boolean, gameOverFade: number): void {
    ctx.save();
    ctx.globalAlpha = 1;
    if (state !== 'title') this.drawHud(ctx, world, muted);
    if (state === 'title') this.drawTitle(ctx);
    else if (state === 'paused') this.drawPause(ctx);
    else if (state === 'gameover') this.drawGameOver(ctx, world, gameOverFade);
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D, w: World, muted: boolean): void {
    const p = w.player;
    for (let i = 0; i < p.maxHp; i++) {
      ctx.fillStyle = i < p.hp ? PAL.vermilion : PAL.paperDark;
      ctx.fillRect(30 + i * 28, 30, 22, 16);
      ctx.strokeStyle = PAL.ink;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(30 + i * 28, 30, 22, 16);
    }
    text(ctx, 'DASH', 30, 64, 11, PAL.ink, 'left', true);
    const cdFrac = 1 - Math.min(1, p.dashCd / Math.max(0.01, Tuning.dashCooldown));
    bar(ctx, 80, 58, 110, 12, cdFrac, p.dashCd > 0 ? PAL.paperDark : PAL.cobalt);
    text(ctx, 'PARRY', 30, 84, 11, PAL.ink, 'left', true);
    bar(ctx, 80, 78, 110, 12, p.meter / 100, PAL.mustard);
    if (p.meter >= 100) text(ctx, 'OVERCHARGE', 200, 84, 11, PAL.ink, 'left', true);

    text(ctx, `WAVE ${Math.max(1, w.waves.wave)}`, ARENA.w / 2, 36, 24, PAL.ink, 'center', true);
    const left = w.enemiesRemaining;
    text(ctx, w.waves.phase === 'intermission' && w.waves.wave > 0 ? 'NEXT WAVE INCOMING' : `${left} HOSTILE${left === 1 ? '' : 'S'}`, ARENA.w / 2, 60, 12, PAL.ink, 'center');

    text(ctx, String(Math.round(w.score)).padStart(7, '0'), ARENA.w - 30, 36, 26, PAL.ink, 'right', true);
    if (w.combo > 1) text(ctx, `COMBO x${(1 + Math.min(w.combo, 20) * 0.1).toFixed(1)}`, ARENA.w - 30, 62, 14, PAL.vermilion, 'right', true);

    text(ctx, `M sound ${muted ? 'off' : 'on'}  ·  F1 debug  ·  P pause  ·  R restart`, ARENA.w / 2, ARENA.h - 26, 11, 'rgba(22,19,15,0.6)', 'center');
  }

  private dim(ctx: CanvasRenderingContext2D, a: number): void {
    ctx.fillStyle = `rgba(232,224,204,${a})`;
    ctx.fillRect(0, 0, ARENA.w, ARENA.h);
  }

  private drawTitle(ctx: CanvasRenderingContext2D): void {
    this.dim(ctx, 0.94);
    headline(ctx, 'CYBER-PARRY', ARENA.w / 2, 140, 84, PAL.ink, PAL.vermilion);
    headline(ctx, 'ARENA', ARENA.w / 2, 216, 84, PAL.ink, PAL.cobalt);
    text(ctx, 'Hit the shot back. Break the shield. Stay alive.', ARENA.w / 2, 278, 17, PAL.ink, 'center');
    const rows: [string, string][] = [
      ['WASD / ARROWS', 'Move'],
      ['SPACE / SHIFT', 'Dash: i-frames, hurts what you pass through'],
      ['RIGHT-CLICK / E', `Parry: ${Math.round(P.parryActive * 1000)} ms window. Reflects shots, stuns melee`],
      ['LEFT-CLICK', 'Slash toward the cursor'],
      ['P / ESC  ·  R  ·  F1  ·  M', 'Pause · restart · debug · mute'],
    ];
    rows.forEach(([k, v], i) => {
      text(ctx, k, ARENA.w / 2 - 16, 340 + i * 32, 14, PAL.ink, 'right', true);
      text(ctx, v, ARENA.w / 2 + 6, 340 + i * 32, 15, PAL.ink, 'left');
    });
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(ARENA.w / 2 - 330, 520, 660, 2);
    text(ctx, 'Rushers lunge.   Snipers charge a laser.   Aegis shields block the front: get behind them.', ARENA.w / 2, 548, 14, PAL.ink, 'center');
    const pulse = Math.sin(performance.now() / 260) > -0.3;
    if (pulse) {
      ctx.fillStyle = PAL.ink;
      ctx.fillRect(ARENA.w / 2 - 190, 590, 380, 48);
      text(ctx, 'CLICK  OR  PRESS ENTER', ARENA.w / 2, 615, 20, PAL.paper, 'center', true);
    }
  }

  private drawPause(ctx: CanvasRenderingContext2D): void {
    this.dim(ctx, 0.8);
    headline(ctx, 'PAUSED', ARENA.w / 2, ARENA.h / 2 - 20, 70, PAL.ink, PAL.mustard);
    text(ctx, 'P / ESC resume    ·    R restart', ARENA.w / 2, ARENA.h / 2 + 46, 16, PAL.ink, 'center');
  }

  private drawGameOver(ctx: CanvasRenderingContext2D, w: World, fade: number): void {
    this.dim(ctx, 0.9 * fade);
    ctx.globalAlpha = fade;
    headline(ctx, 'OVERRUN', ARENA.w / 2, 170, 80, PAL.ink, PAL.vermilion);
    const rows: [string, string][] = [
      ['Wave reached', String(Math.max(1, w.waves.wave))],
      ['Parries landed', String(w.stats.parries)],
      ['Enemies defeated', String(w.stats.kills)],
      ['Score', String(Math.round(w.score))],
      ['Time', `${Math.floor(w.time / 60)}:${String(Math.floor(w.time % 60)).padStart(2, '0')}`],
    ];
    rows.forEach(([k, v], i) => {
      text(ctx, k, ARENA.w / 2 - 20, 270 + i * 42, 19, PAL.ink, 'right');
      text(ctx, v, ARENA.w / 2 + 20, 270 + i * 42, 24, PAL.ink, 'left', true);
    });
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(ARENA.w / 2 - 210, 505, 420, 48);
    text(ctx, 'R  OR  CLICK  TO  RETRY', ARENA.w / 2, 530, 20, PAL.paper, 'center', true);
    ctx.globalAlpha = 1;
  }
}
