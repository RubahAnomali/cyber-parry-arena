import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../sim/events';

type Wave = OscillatorType;

/**
 * Fully procedural audio: oscillators, filtered noise buffers, envelopes and biquad filters.
 * No asset files. The AudioContext is created lazily on the first user gesture.
 */
export class SoundEngine {
  muted = false;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;

  /** Call from a user gesture (key / pointer). Safe to call repeatedly. */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.45;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.5;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.45;
    return this.muted;
  }

  bind(bus: EventBus<GameEvents>): void {
    bus.on('PLAYER_DASHED', () => this.dash());
    bus.on('PLAYER_SLASH', (e) => this.slash(e.overcharged));
    bus.on('PARRY_STARTED', () => this.tone(900, 640, 0.07, 'triangle', 0.08));
    bus.on('ENTITY_PARRIED', () => this.parry());
    bus.on('SNIPER_CHARGE', (e) => this.sniperCharge(e.duration));
    bus.on('SNIPER_FIRED', () => this.sniperShot());
    bus.on('MELEE_TELEGRAPH', () => this.tone(110, 190, 0.28, 'sawtooth', 0.07, 0, 600));
    bus.on('ENTITY_DAMAGED', (e) => (e.target === 'player' ? this.playerHurt() : this.hit(e.heavy)));
    bus.on('ENEMY_KILLED', () => this.kill());
    bus.on('SHIELD_BLOCK', () => this.shieldBlock());
    bus.on('PROJECTILE_IMPACT', () => this.burstNoise(0.08, 0.1, 'bandpass', 1800, 600, 2));
    bus.on('WAVE_STARTED', () => this.tone(220, 330, 0.18, 'square', 0.07, 0, 1200));
    bus.on('WAVE_CLEARED', () => this.waveClear());
    bus.on('PLAYER_DIED', () => this.death());
  }

  uiClick(): void {
    this.tone(660, 880, 0.06, 'square', 0.06, 0, 2400);
  }

  // ---- voices -----------------------------------------------------------------------------

  private dash(): void {
    this.burstNoise(0.2, 0.22, 'bandpass', 400, 2600, 1.4);
    this.tone(220, 70, 0.18, 'sine', 0.18);
  }

  private slash(over: boolean): void {
    this.burstNoise(over ? 0.28 : 0.13, over ? 0.3 : 0.2, 'bandpass', over ? 900 : 1700, 500, 1.2);
    if (over) this.tone(140, 50, 0.3, 'sawtooth', 0.14, 0, 700);
  }

  private parry(): void {
    // metallic clang: inharmonic partials with fast decay + a bright noise tick
    const partials = [1180, 1760, 2890, 4210];
    partials.forEach((f, i) => this.tone(f, f * 0.985, 0.42 - i * 0.05, i % 2 ? 'sine' : 'square', 0.1 / (1 + i * 0.6)));
    this.burstNoise(0.06, 0.25, 'highpass', 3500, 3500, 0.7);
    this.tone(90, 45, 0.18, 'sine', 0.25);
  }

  private sniperCharge(dur: number): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime;
    const o = c.createOscillator();
    const f = c.createBiquadFilter();
    const g = c.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(1500, t + dur);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(5000, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + dur * 0.9);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.02);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private sniperShot(): void {
    this.burstNoise(0.18, 0.5, 'lowpass', 6000, 300, 0.8);
    this.tone(1100, 55, 0.28, 'sawtooth', 0.18, 0, 4000);
  }

  private hit(heavy: boolean): void {
    this.tone(heavy ? 200 : 260, 60, heavy ? 0.16 : 0.1, 'square', 0.12, 0, 1500);
    this.burstNoise(0.08, heavy ? 0.3 : 0.2, 'bandpass', 1200, 400, 1);
  }

  private playerHurt(): void {
    this.burstNoise(0.3, 0.45, 'lowpass', 2500, 200, 0.8);
    this.tone(120, 38, 0.4, 'sine', 0.35);
    this.tone(300, 120, 0.25, 'sawtooth', 0.1, 0, 800);
  }

  private kill(): void {
    this.burstNoise(0.22, 0.4, 'lowpass', 4000, 250, 0.8);
    this.tone(520, 130, 0.22, 'square', 0.1, 0, 2000);
    this.tone(780, 260, 0.16, 'triangle', 0.1, 0.02);
  }

  private shieldBlock(): void {
    this.tone(720, 700, 0.14, 'triangle', 0.14);
    this.tone(1440, 1400, 0.1, 'sine', 0.08);
    this.burstNoise(0.05, 0.15, 'highpass', 4000, 4000, 0.7);
  }

  private waveClear(): void {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, f, 0.34, 'triangle', 0.12, i * 0.09));
  }

  private death(): void {
    this.tone(420, 36, 1.1, 'sawtooth', 0.2, 0, 900);
    this.burstNoise(0.9, 0.5, 'lowpass', 3000, 100, 0.8);
  }

  // ---- primitives -------------------------------------------------------------------------

  private tone(f0: number, f1: number, dur: number, type: Wave, vol: number, delay = 0, lowpass = 0): void {
    const c = this.ctx;
    if (!c || !this.master) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (lowpass > 0) {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lowpass;
      node = o.connect(f);
    }
    node.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burstNoise(dur: number, vol: number, type: BiquadFilterType, f0: number, f1: number, q: number): void {
    const c = this.ctx;
    if (!c || !this.master || !this.noise) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(Math.max(40, f0), t);
    f.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }
}
