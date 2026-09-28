import type { GraphBounds, GraphNode } from "@/lib/graph-types";

/**
 * The camera looks at a world point (`cx`, `cy`) at magnification `k`, and
 * `ox` nudges the whole view sideways in screen pixels so a focused node can
 * sit in the space left over beside the open reading panel.
 */
export interface Camera {
  cx: number;
  cy: number;
  k: number;
  ox: number;
}

export const MIN_K = 0.12;
export const MAX_K = 9;

/**
 * Zoom thresholds, as multiples of the opening framing. Measuring against that
 * rather than an absolute scale keeps the reveals landing at the same point in
 * the gesture on a phone and on a wide monitor.
 */
const LEVEL_BREAKS = [1.45, 2.9] as const;

/** 0 = categories only, 1 = articles, 2 = headings. */
export function levelFor(k: number, baseK: number): number {
  const ratio = k / Math.max(baseK, 1e-6);
  if (ratio < LEVEL_BREAKS[0]) return 0;
  if (ratio < LEVEL_BREAKS[1]) return 1;
  return 2;
}

/** Magnification used when a node of each kind is brought into focus. */
export function focusScaleFor(node: GraphNode, baseK: number): number {
  switch (node.kind) {
    case "root":
      return baseK;
    case "category":
      return baseK * 1.9;
    case "article":
      return baseK * 3.6;
    default:
      return baseK * 5.4;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function transformFor(cam: Camera, w: number, h: number): string {
  const tx = w / 2 + cam.ox;
  const ty = h / 2;
  return `translate(${tx} ${ty}) scale(${cam.k}) translate(${-cam.cx} ${-cam.cy})`;
}

/** Screen pixel → world coordinate under the current camera. */
export function toWorld(
  cam: Camera,
  w: number,
  h: number,
  px: number,
  py: number,
): { x: number; y: number } {
  return {
    x: (px - w / 2 - cam.ox) / cam.k + cam.cx,
    y: (py - h / 2) / cam.k + cam.cy,
  };
}

/**
 * The opening shot: close in on the root, with the ring of categories pulled
 * out towards the edges of the screen around the title card. On a narrow
 * screen the ring is allowed to spill past the sides rather than crowd the
 * title — the categories above and below stay in view.
 */
export function openingCamera(
  categories: { x: number; y: number }[],
  w: number,
  h: number,
): Camera {
  let reachX = 1;
  let reachY = 1;
  for (const c of categories) {
    reachX = Math.max(reachX, Math.abs(c.x));
    reachY = Math.max(reachY, Math.abs(c.y));
  }
  const k = clamp(
    Math.min(((h / 2) * 0.72) / reachY, ((w / 2) * 1.2) / reachX),
    MIN_K,
    2.2,
  );
  return { cx: 0, cy: 0, k, ox: 0 };
}

/**
 * Keeps the camera tethered to the map: the scale stays within reach of the
 * opening framing, and the centre may drift only part of a screen beyond the
 * outermost node. Without this the mesh is endless in every direction and it is
 * entirely possible to zoom into blank paper and lose the site.
 */
export function clampCamera(
  cam: Camera,
  bounds: GraphBounds,
  baseK: number,
  w: number,
  h: number,
): Camera {
  const k = clamp(clamp(cam.k, baseK * 0.4, baseK * 12), MIN_K, MAX_K);
  if (!w || !h) return { ...cam, k };
  const slackX = (w / (2 * k)) * 0.7;
  const slackY = (h / (2 * k)) * 0.7;
  return {
    ...cam,
    k,
    cx: clamp(cam.cx, bounds.minX - slackX, bounds.maxX + slackX),
    cy: clamp(cam.cy, bounds.minY - slackY, bounds.maxY + slackY),
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Ease-in-out cubic, for flights that should neither lurch off nor stop dead. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Fraction of the remaining distance a damped value should close in a frame of
 * `dt` ms, for a response time of `tau` ms. Frame-rate independent, so the
 * glide feels the same on a 60 Hz laptop and a 144 Hz monitor.
 */
export function damp(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

export interface Flight {
  at: (t: number) => Camera;
  /** Suggested duration in ms, longer for journeys that cover more ground. */
  duration: number;
}

/**
 * A camera flight along the "optimal" zoom-and-pan path of van Wijk and Nuij
 * (2003): for a long hop the camera pulls out, travels, and settles back in,
 * so the viewer keeps their bearings instead of watching the map smear past.
 * A short hop degrades to a near-straight glide. `viewW` is the screen width
 * the view spans, which is what the path's zoom is measured in.
 */
export function flightPath(from: Camera, to: Camera, viewW: number): Flight {
  const rho = 1.35;
  const rho2 = rho * rho;
  const rho4 = rho2 * rho2;
  const w0 = viewW / from.k;
  const w1 = viewW / to.k;
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const d2 = dx * dx + dy * dy;

  let S: number;
  let path: (s: number) => { u: number; w: number };
  if (d2 < 1e-9) {
    S = Math.abs(Math.log(w1 / w0)) / rho;
    const dir = Math.sign(Math.log(w1 / w0)) || 0;
    path = (s) => ({ u: 0, w: w0 * Math.exp(dir * rho * s) });
  } else {
    const d1 = Math.sqrt(d2);
    const b0 = (w1 * w1 - w0 * w0 + rho4 * d2) / (2 * w0 * rho2 * d1);
    const b1 = (w1 * w1 - w0 * w0 - rho4 * d2) / (2 * w1 * rho2 * d1);
    const r0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0);
    const r1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
    S = (r1 - r0) / rho;
    const coshR0 = Math.cosh(r0);
    const sinhR0 = Math.sinh(r0);
    path = (s) => ({
      u: (w0 / (rho2 * d1)) * (coshR0 * Math.tanh(rho * s + r0) - sinhR0),
      w: (w0 * coshR0) / Math.cosh(rho * s + r0),
    });
  }

  return {
    duration: clamp(S * 520, 420, 2000),
    at: (t) => {
      if (t >= 1) return { ...to };
      const s = easeInOut(t);
      const p = path(s * S);
      return {
        cx: from.cx + p.u * dx,
        cy: from.cy + p.u * dy,
        k: viewW / p.w,
        ox: lerp(from.ox, to.ox, s),
      };
    },
  };
}
