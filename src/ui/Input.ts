import type { InputState } from '../sim/types';

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const BLOCKED_DEFAULTS = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1', 'Tab']);

/** DOM input layer. Produces plain `InputState` snapshots; edge presses latch until consumed. */
export class Input {
  /** Fired once per physical key press (no auto-repeat). */
  onKey: ((code: string) => void) | null = null;
  /** Fired on the first pointer/key gesture (audio unlock etc.). */
  onGesture: (() => void) | null = null;

  private readonly keys = new Set<string>();
  private mx = 0;
  private my = 0;
  private dash = false;
  private parry = false;
  private attack = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    private readonly toWorld: (cx: number, cy: number) => { x: number; y: number },
  ) {
    this.listen(window, 'keydown', (e) => {
      if (BLOCKED_DEFAULTS.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.dash = true;
      if (e.code === 'KeyE') this.parry = true;
      this.onGesture?.();
      this.onKey?.(e.code);
    });
    this.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this.listen(window, 'blur', () => this.keys.clear());
    this.listen(window, 'mousemove', (e) => {
      this.mx = e.clientX;
      this.my = e.clientY;
    });
    this.listen(canvas, 'mousedown', (e) => {
      this.mx = e.clientX;
      this.my = e.clientY;
      if (e.button === 0) this.attack = true;
      if (e.button === 2) this.parry = true;
      this.onGesture?.();
      this.onKey?.(e.button === 0 ? 'MouseLeft' : 'MouseRight');
    });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
  }

  snapshot(): InputState {
    let mx = 0;
    let my = 0;
    for (const k of this.keys) {
      const v = MOVE_KEYS[k];
      if (v) {
        mx += v[0];
        my += v[1];
      }
    }
    const l = Math.hypot(mx, my);
    if (l > 0) {
      mx /= l;
      my /= l;
    }
    const aim = this.toWorld(this.mx, this.my);
    const s: InputState = {
      moveX: mx,
      moveY: my,
      aimX: aim.x,
      aimY: aim.y,
      dashPressed: this.dash,
      parryPressed: this.parry,
      attackPressed: this.attack,
    };
    this.clearEdges();
    return s;
  }

  clearEdges(): void {
    this.dash = this.parry = this.attack = false;
  }

  dispose(): void {
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
  }

  private listen<K extends keyof WindowEventMap>(t: Window, type: K, fn: (e: WindowEventMap[K]) => void): void;
  private listen<K extends keyof HTMLElementEventMap>(t: HTMLElement, type: K, fn: (e: HTMLElementEventMap[K]) => void): void;
  private listen(t: EventTarget, type: string, fn: (e: never) => void): void {
    const handler = fn as EventListener;
    t.addEventListener(type, handler);
    this.cleanups.push(() => t.removeEventListener(type, handler));
  }
}
