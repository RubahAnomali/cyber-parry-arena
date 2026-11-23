import { EventBus } from './core/EventBus';
import { SoundEngine } from './audio/SoundEngine';
import { Camera } from './render/Camera';
import { Fx } from './render/Fx';
import { Renderer } from './render/Renderer';
import { FIXED_DT, HITSTOP, MAX_FRAME_DT, Tuning } from './sim/config';
import type { GameEvents } from './sim/events';
import { World } from './sim/World';
import { DebugOverlay } from './ui/DebugOverlay';
import { Hud, type GameState } from './ui/Hud';
import { Input } from './ui/Input';

/**
 * Composition root: owns the fixed-timestep loop and wires simulation events to the
 * presentation layers (camera shake, hit-stop, particles, audio). Listeners are registered
 * exactly once in the constructor, so restarts never duplicate subscriptions.
 */
export class Game {
  readonly bus = new EventBus<GameEvents>();
  readonly world = new World(this.bus);
  readonly camera = new Camera();
  readonly fx = new Fx(this.bus, this.camera);
  readonly sound = new SoundEngine();
  readonly renderer: Renderer;
  readonly input: Input;
  readonly hud = new Hud();
  readonly debug: DebugOverlay;

  state: GameState = 'title';
  private acc = 0;
  private hitStop = 0;
  private last = 0;
  private raf = 0;
  private fps = 60;
  private gameOverTimer = -1;
  private gameOverFade = 0;
  private running = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas, this.world);
    this.input = new Input(canvas, (x, y) => this.renderer.screenToWorld(x, y));
    this.debug = new DebugOverlay(this.world, this.fx);
    this.sound.bind(this.bus);

    this.input.onGesture = () => this.sound.unlock();
    this.input.onKey = (code) => this.onKey(code);
    window.addEventListener('blur', this.onBlur);

    this.bus.on('ENTITY_PARRIED', () => this.freeze(HITSTOP.parry));
    this.bus.on('ENEMY_KILLED', () => this.freeze(HITSTOP.kill));
    this.bus.on('ENTITY_DAMAGED', (e) => {
      if (e.target === 'player') this.freeze(HITSTOP.playerHit);
      else if (e.heavy) this.freeze(HITSTOP.heavy);
    });
    this.bus.on('PLAYER_DIED', () => {
      this.gameOverTimer = 1.3;
    });
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('blur', this.onBlur);
    this.input.dispose();
    this.renderer.dispose();
    this.debug.dispose();
    this.bus.clear();
  }

  /** Full, clean restart: sim state, pools, fx, camera, timers and latched input. */
  restart(): void {
    this.world.reset();
    this.fx.clear();
    this.camera.reset();
    this.input.clearEdges();
    this.acc = 0;
    this.hitStop = 0;
    this.gameOverTimer = -1;
    this.gameOverFade = 0;
    this.state = 'playing';
  }

  private readonly onBlur = (): void => {
    if (this.state === 'playing') this.state = 'paused';
  };

  private freeze(seconds: number): void {
    this.hitStop = Math.max(this.hitStop, seconds * Tuning.hitStopScale);
  }

  private onKey(code: string): void {
    if (code === 'F1') {
      this.debug.toggle();
      return;
    }
    if (code === 'KeyM') {
      this.sound.toggleMute();
      return;
    }
    if (code === 'KeyR') {
      this.sound.uiClick();
      this.restart();
      return;
    }
    switch (this.state) {
      case 'title':
        if (code === 'Enter' || code === 'MouseLeft' || code === 'Space') {
          this.sound.uiClick();
          this.restart();
        }
        break;
      case 'playing':
        if (code === 'KeyP' || code === 'Escape') this.state = 'paused';
        break;
      case 'paused':
        if (code === 'KeyP' || code === 'Escape') {
          this.state = 'playing';
          this.input.clearEdges();
        }
        break;
      case 'gameover':
        if (code === 'MouseLeft' || code === 'Enter') this.restart();
        break;
    }
  }

  private frame(now: number): void {
    if (!this.running) return;
    const raw = (now - this.last) / 1000;
    this.last = now;
    const dt = Math.min(Math.max(raw, 0), MAX_FRAME_DT);
    if (raw > 0) this.fps += (1 / raw - this.fps) * 0.1;

    if (this.state === 'playing') this.advance(dt);
    else if (this.state === 'title') this.camera.update(dt, 0);

    if (this.gameOverTimer > 0) {
      this.gameOverTimer -= dt;
      if (this.gameOverTimer <= 0) this.state = 'gameover';
    }
    if (this.state === 'gameover') this.gameOverFade = Math.min(1, this.gameOverFade + dt * 2);

    const alpha = this.hitStop > 0 || this.state !== 'playing' ? 1 : this.acc / FIXED_DT;
    this.renderer.render(
      alpha,
      this.fx,
      this.camera,
      (ctx) => this.debug.drawWorld(ctx),
      (ctx) => this.hud.draw(ctx, this.world, this.state, this.sound.muted, this.gameOverFade),
    );
    this.debug.updateStats({ fps: this.fps, frameMs: raw * 1000, hitStop: this.hitStop, state: this.state }, now);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Fixed-timestep accumulator. Hit-stop freezes simulation ticks but not rendering / camera. */
  private advance(dt: number): void {
    this.acc += dt * Tuning.timeScale;
    while (this.acc >= FIXED_DT) {
      this.acc -= FIXED_DT;
      if (this.hitStop > 0) {
        this.hitStop -= FIXED_DT;
        continue;
      }
      this.world.step(FIXED_DT, this.input.snapshot());
    }
    const frozen = this.hitStop > 0;
    if (frozen) this.camera.floor(0.12);
    this.camera.update(dt, Tuning.shakeScale);
    this.fx.update(frozen ? dt * 0.15 : dt, this.world);
  }
}
