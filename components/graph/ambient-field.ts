import type { Camera } from "./camera";

/**
 * The ambient mesh behind the map — a slow-drifting constellation of neurons
 * and links that keeps the canvas from ever reading as empty space.
 *
 * It is procedural and unbounded rather than a fixed set of points. World space
 * is cut into cells, each cell's points are derived from a hash of its
 * coordinates, and only the cells currently on screen are drawn. Pan as far as
 * you like and there is always more of it, with no data to store.
 *
 * Density is held constant in *screen* space: the cell size is a power of two
 * near `CELL_PX / scale`, so zooming in subdivides the field instead of
 * thinning it out. Between two octaves both meshes are drawn, cross-faded by
 * how far the zoom has travelled from one to the next, so detail resolves
 * gradually rather than swapping in a single frame.
 *
 * Every point wanders around its home on its own slow orbit, and links are
 * faded by length, so connections form and dissolve as the points drift
 * instead of blinking in and out. A few links carry a travelling signal.
 */

/** Target on-screen size of one cell, in CSS pixels. */
const CELL_PX = 190;
const POINTS_PER_CELL = 3;
/**
 * Points closer than this fraction of a cell get linked. With the drift on top
 * it stays below one cell, because the neighbour search only looks one cell
 * out — a longer reach would drop the links it cannot see and keep the long
 * ones it can, webbing the screen with stray diagonals.
 */
const LINK_CELLS = 0.6;
/** How far, in screen pixels, a point strays from its home. */
const DRIFT_PX = 14;

/** The field slides slightly slower than the graph, which reads as depth. */
const PARALLAX = 0.88;

/** Cell budget, so a pathological camera can never lock up the frame. */
const MAX_CELLS = 3000;

export interface FieldStyle {
  /** Colour of the dots — the site's ink. */
  ink: string;
  /** Colour of the links. */
  line: string;
  /** Colour of the signals travelling along a few links. */
  accent: string;
}

interface FieldPoint {
  x: number;
  y: number;
  /** Stable 0–1 roll deciding size and brightness. */
  s: number;
  /** Stable 0–1 roll used to pick which links carry a signal. */
  id: number;
}

/**
 * Integer hash → 0–1. Deterministic across machines and reloads.
 *
 * Every input, the salt included, is folded in before the final avalanche. Mix
 * the salt in at the end instead and the x and y draws for a point stay
 * correlated, which lays the whole field out along one diagonal.
 */
function rand(cx: number, cy: number, i: number, salt: number): number {
  let h = Math.imul(cx ^ 0x9e3779b9, 374761393);
  h = Math.imul(h ^ Math.imul(cy, 668265263), 2246822519);
  h = Math.imul(h ^ Math.imul(i + 1, 3266489917), 668265263);
  h = Math.imul(h ^ Math.imul(salt + 1, 374761393), 2246822519);
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * A cell's points at time `t` (seconds). Each point circles its home on a
 * lissajous path whose speed and phase come from the same hash as its
 * position, so the motion is as stable across reloads as the layout.
 */
function pointsInCell(
  cx: number,
  cy: number,
  cell: number,
  drift: number,
  t: number,
): FieldPoint[] {
  const points: FieldPoint[] = [];
  for (let i = 0; i < POINTS_PER_CELL; i++) {
    const phase = rand(cx, cy, i, 4) * Math.PI * 2;
    const speed = 0.12 + rand(cx, cy, i, 5) * 0.22;
    points.push({
      x:
        (cx + 0.1 + rand(cx, cy, i, 1) * 0.8) * cell +
        Math.cos(t * speed + phase) * drift,
      y:
        (cy + 0.1 + rand(cx, cy, i, 2) * 0.8) * cell +
        Math.sin(t * speed * 1.3 + phase * 1.7) * drift,
      s: rand(cx, cy, i, 3),
      id: rand(cx, cy, i, 6),
    });
  }
  return points;
}

/** Hermite smoothstep, for easing the cross-fade between octaves. */
function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Redraws the whole field for the current camera at time `t` (seconds).
 * Cheap enough to run on every animation frame: at most two octaves of a few
 * hundred dots and links, no allocation of note beyond the visible cells.
 */
export function drawField(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cam: Camera,
  style: FieldStyle,
  t: number,
): void {
  ctx.clearRect(0, 0, width, height);
  if (width <= 0 || height <= 0) return;

  // Where the zoom sits between two octaves: 0 at the coarser one's home, 1 at
  // the finer one's. Each is drawn with the weight of how close it is.
  const level = Math.log2(Math.max(CELL_PX / cam.k, 1e-6));
  const coarse = Math.ceil(level);
  const mix = smooth((coarse - level - 0.25) / 0.5);
  if (mix < 0.999)
    drawOctave(ctx, width, height, cam, style, t, coarse, 1 - mix);
  if (mix > 0.001)
    drawOctave(ctx, width, height, cam, style, t, coarse - 1, mix);
  ctx.globalAlpha = 1;
}

function drawOctave(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cam: Camera,
  style: FieldStyle,
  t: number,
  octave: number,
  weight: number,
): void {
  const k = cam.k;
  const cell = 2 ** octave;
  const drift = DRIFT_PX / k;

  // The field's own centre, lagged behind the camera's.
  const fx = cam.cx * PARALLAX;
  const fy = cam.cy * PARALLAX;
  const originX = width / 2 + cam.ox;
  const originY = height / 2;

  const linkWorld = cell * LINK_CELLS;
  const marginWorld = linkWorld + drift;
  const minX = fx - originX / k - marginWorld;
  const maxX = fx + (width - originX) / k + marginWorld;
  const minY = fy - originY / k - marginWorld;
  const maxY = fy + (height - originY) / k + marginWorld;

  const c0 = Math.floor(minX / cell);
  const c1 = Math.floor(maxX / cell);
  const r0 = Math.floor(minY / cell);
  const r1 = Math.floor(maxY / cell);
  const cols = c1 - c0 + 1;
  const rows = r1 - r0 + 1;
  if (cols * rows > MAX_CELLS) return;

  const grid: FieldPoint[][] = new Array(cols * rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      grid[c * rows + r] = pointsInCell(c0 + c, r0 + r, cell, drift, t);
    }
  }
  const at = (c: number, r: number) =>
    c < 0 || r < 0 || c >= cols || r >= rows ? undefined : grid[c * rows + r];

  const toScreenX = (x: number) => (x - fx) * k + originX;
  const toScreenY = (y: number) => (y - fy) * k + originY;

  // --- links -------------------------------------------------------------
  // Each cell only looks forward, so no pair is considered twice. Links are
  // bucketed by opacity so the whole mesh still strokes in a handful of calls.
  const forward = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const;
  const linkWorldSq = linkWorld * linkWorld;
  const BUCKETS = 4;
  const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
  const signals: number[] = [];

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const here = grid[c * rows + r];
      for (const [dc, dr] of forward) {
        const there = at(c + dc, r + dr);
        if (!there) continue;
        for (let i = 0; i < here.length; i++) {
          // Within a cell, only later points, so a point never links to itself.
          const start = dc === 0 && dr === 0 ? i + 1 : 0;
          for (let j = start; j < there.length; j++) {
            const a = here[i];
            const b = there[j];
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > linkWorldSq) continue;
            const closeness = 1 - Math.sqrt(d2) / linkWorld;
            const bucket = Math.min(
              BUCKETS - 1,
              Math.floor(closeness * BUCKETS),
            );
            const ax = toScreenX(a.x);
            const ay = toScreenY(a.y);
            const bx = toScreenX(b.x);
            const by = toScreenY(b.y);
            buckets[bucket].push(ax, ay, bx, by);
            // One link in a dozen carries a pulse, on its own period.
            const roll = (a.id * 7.31 + b.id * 3.17) % 1;
            if (roll < 0.085 && closeness > 0.2) {
              const period = 2.6 + roll * 30;
              const p = ((t + roll * 97) % period) / period;
              if (p < 0.55) {
                const q = p / 0.55;
                signals.push(ax + (bx - ax) * q, ay + (by - ay) * q, closeness);
              }
            }
          }
        }
      }
    }
  }

  ctx.strokeStyle = style.line;
  ctx.lineWidth = 1;
  for (let b = 0; b < BUCKETS; b++) {
    const segs = buckets[b];
    if (segs.length === 0) continue;
    ctx.globalAlpha = weight * (0.12 + ((b + 0.5) / BUCKETS) * 0.38);
    ctx.beginPath();
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(segs[i], segs[i + 1]);
      ctx.lineTo(segs[i + 2], segs[i + 3]);
    }
    ctx.stroke();
  }

  // --- dots --------------------------------------------------------------
  ctx.fillStyle = style.ink;
  for (const points of grid) {
    for (const p of points) {
      const sx = toScreenX(p.x);
      const sy = toScreenY(p.y);
      if (sx < -10 || sy < -10 || sx > width + 10 || sy > height + 10) continue;
      // A handful of points per screen are hubs — bigger and darker — which
      // gives the mesh some structure instead of an even grey wash.
      const hub = p.s > 0.9;
      ctx.globalAlpha = weight * (hub ? 0.5 : 0.2 + p.s * 0.22);
      ctx.beginPath();
      ctx.arc(sx, sy, hub ? 4 : 1.6 + p.s * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- signals -----------------------------------------------------------
  ctx.fillStyle = style.accent;
  for (let i = 0; i < signals.length; i += 3) {
    ctx.globalAlpha = weight * (0.35 + signals[i + 2] * 0.5);
    ctx.beginPath();
    ctx.arc(signals[i], signals[i + 1], 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
