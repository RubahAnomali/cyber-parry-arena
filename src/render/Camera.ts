const MAX_OFFSET = 20;
const MAX_ROLL = 0.025;

/** Trauma-based screen shake: displacement scales with trauma squared and decays over time. */
export class Camera {
  trauma = 0;
  offX = 0;
  offY = 0;
  rot = 0;
  private impX = 0;
  private impY = 0;
  private t = 0;

  addTrauma(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Keep a faint residual shake alive (used during hit-stop). */
  floor(amount: number): void {
    this.trauma = Math.max(this.trauma, amount);
  }

  impulse(dx: number, dy: number, magnitude: number): void {
    this.impX += dx * magnitude;
    this.impY += dy * magnitude;
  }

  update(dt: number, scale: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.7);
    const shake = this.trauma * this.trauma * scale;
    const nx = Math.sin(this.t * 53.3) + Math.sin(this.t * 97.1 + 2);
    const ny = Math.sin(this.t * 61.7 + 1) + Math.sin(this.t * 83.9 + 4);
    const nr = Math.sin(this.t * 71.3 + 3);
    this.offX = nx * 0.5 * MAX_OFFSET * shake + this.impX;
    this.offY = ny * 0.5 * MAX_OFFSET * shake + this.impY;
    this.rot = nr * MAX_ROLL * shake;
    const decay = Math.exp(-dt * 12);
    this.impX *= decay;
    this.impY *= decay;
  }

  reset(): void {
    this.trauma = 0;
    this.offX = this.offY = this.rot = this.impX = this.impY = 0;
  }
}
