/**
 * The map's camera: it looks at world point (`x`, `y`) at magnification `k`,
 * and `ox` is the screen x the view is centred on — the middle of whatever
 * width the reading panel leaves free.
 *
 * The camera never jumps. Input and navigation move a *target* camera, and
 * every frame the real one eases toward it at a frame-rate-independent rate,
 * with zoom eased in log space so that zooming from far out to close in reads
 * as a constant rate rather than a lurch.
 */
export interface Camera {
  x: number;
  y: number;
  k: number;
  ox: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Response time of the camera, in ms. Lower is snappier. */
const TAU = 170;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Hermite smoothstep of `x` between `a` and `b`. */
export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Moves `cam` toward `target` for a frame of `dt` ms, in place. */
export function easeCamera(cam: Camera, target: Camera, dt: number): void {
  const a = 1 - Math.exp(-dt / TAU);
  cam.x = lerp(cam.x, target.x, a);
  cam.y = lerp(cam.y, target.y, a);
  cam.k = Math.exp(lerp(Math.log(cam.k), Math.log(target.k), a));
  cam.ox = lerp(cam.ox, target.ox, a);
}

/** Whether `cam` has come to rest on `target`. */
export function settled(cam: Camera, target: Camera): boolean {
  return (
    Math.abs(cam.x - target.x) * cam.k < 0.05 &&
    Math.abs(cam.y - target.y) * cam.k < 0.05 &&
    Math.abs(Math.log(cam.k / target.k)) < 1e-4 &&
    Math.abs(cam.ox - target.ox) < 0.05
  );
}

/** Scale that fits `box` into a `w` × `h` area with `pad` px around it. */
export function fitScale(box: Box, w: number, h: number, pad: number): number {
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  return Math.min(
    Math.max(40, w - pad * 2) / bw,
    Math.max(40, h - pad * 2) / bh,
  );
}
