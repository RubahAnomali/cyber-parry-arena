import { P, SHIELD_HALF_ARC, Tuning, TuningRanges } from '../sim/config';
import type { World } from '../sim/World';
import type { Fx } from '../render/Fx';
import type { GameState } from './Hud';

export interface DebugFrameInfo {
  fps: number;
  frameMs: number;
  hitStop: number;
  state: GameState;
}

/** F1 overlay: DOM stats panel with live-tuning sliders + world-space AI / hitbox wireframes. */
export class DebugOverlay {
  visible = false;
  showHitboxes = true;
  showAI = true;
  private readonly root: HTMLDivElement;
  private readonly stats: HTMLPreElement;
  private lastUpdate = 0;

  constructor(
    private readonly world: World,
    private readonly fx: Fx,
  ) {
    this.root = document.createElement('div');
    Object.assign(this.root.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      width: '330px',
      maxHeight: 'calc(100vh - 16px)',
      overflowY: 'auto',
      padding: '10px 12px',
      background: 'rgba(4,8,18,0.86)',
      border: '1px solid #2a7f88',
      borderRadius: '6px',
      color: '#bfe9ff',
      font: '11px/1.45 ui-monospace, Consolas, monospace',
      zIndex: '10',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    for (const ev of ['mousedown', 'mouseup', 'click', 'contextmenu', 'keydown']) {
      this.root.addEventListener(ev, (e) => e.stopPropagation());
    }
    this.stats = document.createElement('pre');
    this.stats.style.margin = '0 0 8px';
    this.stats.style.whiteSpace = 'pre-wrap';
    this.root.appendChild(this.stats);

    this.root.appendChild(this.checkbox('Hitboxes / parry & shield arcs', this.showHitboxes, (v) => (this.showHitboxes = v)));
    this.root.appendChild(this.checkbox('AI scores above enemies', this.showAI, (v) => (this.showAI = v)));
    for (const key of Object.keys(Tuning) as (keyof typeof Tuning)[]) this.root.appendChild(this.slider(key));
    document.body.appendChild(this.root);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? 'block' : 'none';
  }

  dispose(): void {
    this.root.remove();
  }

  updateStats(info: DebugFrameInfo, now: number): void {
    if (!this.visible || now - this.lastUpdate < 100) return;
    this.lastUpdate = now;
    const w = this.world;
    const p = w.player;
    const pools = [w.projectiles, this.fx.particles, this.fx.rings, this.fx.texts, this.fx.ghosts];
    const lines = [
      `FPS ${info.fps.toFixed(0)}  (${info.frameMs.toFixed(1)} ms)   state: ${info.state}`,
      `sim tick ${w.tick}  t=${w.time.toFixed(1)}s  seed ${w.seed}`,
      `hit-stop ${(info.hitStop * 1000).toFixed(0)} ms`,
      '',
      'POOLS  active / free / created',
      ...pools.map((q) => `  ${q.name.padEnd(12)} ${String(q.activeCount).padStart(4)} / ${String(q.freeCount).padStart(4)} / ${String(q.totalCreated).padStart(4)}`),
      '',
      `PLAYER FSM: ${p.fsm.current}  (${p.fsm.time.toFixed(2)}s)`,
      `  history: ${p.fsm.history.join(' > ') || '-'}`,
      `  rejected transitions: ${p.fsm.rejected}`,
      `  hp ${p.hp}/${p.maxHp}  iframes ${p.iframes.toFixed(2)}  meter ${p.meter.toFixed(0)}`,
      `  dashCd ${p.dashCd.toFixed(2)}  atkCd ${p.attackCd.toFixed(2)}  atkBuf ${p.attackBuffer.toFixed(2)}`,
      `  parryT ${p.parryT.toFixed(2)} (${p.parryActive ? 'ACTIVE' : 'off'}) ok=${p.parrySucceeded}`,
      `  vel ${Math.hypot(p.vx, p.vy).toFixed(0)} px/s`,
      '',
      `ENEMIES ${w.enemies.length}  queued ${w.waves.remaining}  spawning ${w.spawns.length}`,
      ...w.enemies.slice(0, 8).map((e) => `  #${e.id} ${e.kind.padEnd(6)} hp ${e.hp}  ${e.action?.id ?? '-'}${e.stun > 0 ? ' STUN' : ''}`),
    ];
    this.stats.textContent = lines.join('\n');
  }

  /** World-space layer: hitbox wireframes, parry/shield arcs, Utility-AI score readouts. */
  drawWorld(ctx: CanvasRenderingContext2D): void {
    if (!this.visible) return;
    const w = this.world;
    const p = w.player;
    ctx.save();
    ctx.lineWidth = 1.5;
    if (this.showHitboxes) {
      ctx.strokeStyle = '#0a8f5a';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = p.parryActive ? '#ffffff' : 'rgba(43,79,216,0.6)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, P.parryRadius, p.aim - P.parryHalfArc, p.aim + P.parryHalfArc);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(22,19,15,0.4)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, P.slashRange, p.aim - P.slashHalfArc, p.aim + P.slashHalfArc);
      ctx.stroke();
      ctx.strokeStyle = '#ffa040';
      for (const pl of w.pillars) {
        ctx.beginPath();
        ctx.arc(pl.x, pl.y, pl.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const pr of w.projectiles.active) {
        ctx.strokeStyle = pr.owner === 'player' ? '#2b4fd8' : '#e2452b';
        ctx.beginPath();
        ctx.arc(pr.x, pr.y, pr.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.textAlign = 'center';
    for (const e of w.enemies) {
      if (this.showHitboxes) {
        ctx.strokeStyle = e.attackActive ? '#ff2a4a' : '#0a8f5a';
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.stroke();
        if (e.attackActive) {
          ctx.beginPath();
          ctx.arc(e.x + Math.cos(e.angle) * e.r * 0.8, e.y + Math.sin(e.angle) * e.r * 0.8, e.r + 8, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (e.kind === 'aegis') {
          ctx.strokeStyle = e.stun > 0 ? '#555' : '#1f8a86';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.r + 11, e.shieldAngle - SHIELD_HALF_ARC, e.shieldAngle + SHIELD_HALF_ARC);
          ctx.stroke();
        }
      }
      if (this.showAI) {
        ctx.font = '700 11px ui-monospace, Consolas, monospace';
        ctx.fillStyle = '#16130f';
        const top = e.scores[0];
        ctx.fillText(`${e.action?.id ?? 'idle'}${top ? ' ' + top.score.toFixed(2) : ''}`, e.x, e.y - e.r - 22);
        ctx.font = '10px ui-monospace, Consolas, monospace';
        ctx.fillStyle = 'rgba(22,19,15,0.75)';
        e.scores.slice(0, 4).forEach((s, i) => ctx.fillText(`${s.id} ${s.score.toFixed(2)}`, e.x, e.y + e.r + 14 + i * 11));
      }
    }
    ctx.restore();
  }

  private checkbox(label: string, initial: boolean, set: (v: boolean) => void): HTMLLabelElement {
    const l = document.createElement('label');
    l.style.display = 'block';
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = initial;
    c.addEventListener('change', () => set(c.checked));
    l.append(c, ` ${label}`);
    return l;
  }

  private slider(key: keyof typeof Tuning): HTMLLabelElement {
    const [min, max, step] = TuningRanges[key];
    const l = document.createElement('label');
    l.style.display = 'block';
    l.style.marginTop = '4px';
    const name = document.createElement('span');
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(Tuning[key]);
    input.style.width = '100%';
    const sync = (): void => {
      name.textContent = `${key}: ${Tuning[key]}`;
    };
    input.addEventListener('input', () => {
      Tuning[key] = Number(input.value);
      sync();
    });
    sync();
    l.append(name, input);
    return l;
  }
}
