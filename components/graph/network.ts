import type { GraphCluster, GraphNode } from "@/lib/graph-types";
import type { Camera } from "./camera";

/**
 * The neural network the map is drawn as.
 *
 * Every point on the map is a neuron: the named ones (the core, the branches
 * and their articles) and a few hundred unnamed ones that fill the world
 * around them. Nothing is wired explicitly. Each frame, any two neurons close
 * enough to each other are linked, so connections form and dissolve as the
 * neurons drift, and a branch reads as a bright region of the network rather
 * than a drawn tree.
 *
 * Signals hop neuron to neuron along those same links, never doubling back.
 * Each branch sits in a breathing pool of its own light.
 */

export const PALETTE = [
  "#6fd6ff",
  "#4d8dff",
  "#7ae7d3",
  "#a8ccff",
  "#3f5fe0",
  "#8fe3ff",
] as const;
const WARM = "#ff7a54";
const LINK_BLUE = "#4d8dff";
const LINK_NAMED = "#8fd8ff";
const SIGNAL = "#8fe3ff";

/** Unnamed neurons at density 1. */
const BACKGROUND_COUNT = 300;
/** World distance within which two neurons are linked… */
const LINK_REACH = 250;
/** …and how much farther a link touching a named neuron reaches. */
const NAMED_REACH = 1.5;
const AMBIENT_SIGNALS = 34;
const BURST_SIGNALS = 10;
/** How often the adjacency signals travel along is recomputed, in ms. */
const ADJACENCY_MS = 700;
const ALPHA_LEVELS = 14;

export interface Tweaks {
  /** Multiplier on the number of unnamed neurons. */
  density: number;
  /** Multiplier on link and glow brightness. */
  glow: number;
  /** Multiplier on how far neurons wander. */
  drift: number;
}

export const DEFAULT_TWEAKS: Tweaks = { density: 1, glow: 1, drift: 1 };

type RGB = readonly [number, number, number];

interface Neuron {
  hx: number;
  hy: number;
  x: number;
  y: number;
  /** On-screen radius at the overview zoom, in px. */
  r: number;
  rgb: RGB;
  /** Background neurons that glow; named ones always do. */
  big: boolean;
  named: GraphNode | null;
  /** How far, in world units, the neuron wanders from home. */
  wander: number;
  speed: number;
  phase: number;
  /** Phase the links touching this neuron shimmer on. */
  linkPhase: number;
  twinkle: number;
}

interface Signal {
  from: number;
  to: number;
  p: number;
  speed: number;
  /** Hops left before it fades out; ambient signals travel forever. */
  hops: number;
}

/** What the network needs to know about the view to draw a frame. */
export interface View {
  w: number;
  h: number;
  cam: Camera;
  /** Screen y of the view centre. */
  oy: number;
  /** Zoom relative to the overview; sizes grow sublinearly with it. */
  zoom: number;
  t: number;
  tweaks: Tweaks;
  /** Per-cluster brightness boost, 0–1, in `clusters` order. */
  boost: number[];
  hovered: number;
}

function rgbOf(hex: string): RGB {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
}

/** mulberry32 — seeded so the background is the same on every load. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Network {
  neurons: Neuron[] = [];
  /** Screen positions from the last frame, indexed like `neurons`. */
  sx = new Float32Array(0);
  sy = new Float32Array(0);
  /** Number of named neurons; they come first, in graph order. */
  readonly namedCount: number;

  private adjacency: number[][] = [];
  private adjacencyAt = -Infinity;
  private signals: Signal[] = [];
  private rand = prng(7);
  private rgbPalette = PALETTE.map(rgbOf);

  constructor(
    private readonly nodes: GraphNode[],
    private readonly clusters: GraphCluster[],
    private readonly ring: number,
    density: number,
  ) {
    this.namedCount = nodes.length;
    this.populate(density);
  }

  /** (Re)builds the neurons for a given density. Named ones never change. */
  populate(density: number): void {
    const rand = prng(1337);
    const named: Neuron[] = this.nodes.map((node) => ({
      hx: node.x,
      hy: node.y,
      x: node.x,
      y: node.y,
      // The core draws no dot of its own: the title and its pool of light
      // stand in for it, and its links converge underneath them.
      r: node.kind === "root" ? 0 : node.kind === "category" ? 4.8 : 3.6,
      rgb:
        node.kind === "root"
          ? rgbOf("#bff0ff")
          : this.rgbPalette[node.hue % PALETTE.length],
      big: true,
      named: node,
      wander: node.kind === "root" ? 6 : 16 + rand() * 10,
      speed: 0.18 + rand() * 0.16,
      phase: rand() * Math.PI * 2,
      linkPhase: rand() * Math.PI * 2,
      twinkle: 0.5 + rand() * 0.5,
    }));

    const extent = this.ring + 720;
    const count = Math.round(BACKGROUND_COUNT * density);
    const background: Neuron[] = [];
    for (let i = 0; i < count; i++) {
      let x: number;
      let y: number;
      // Most fill the world evenly; some gather around the branches, so each
      // region is a little denser than the space between them.
      if (rand() < 0.3 && this.clusters.length > 0) {
        const c = this.clusters[Math.floor(rand() * this.clusters.length)];
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * c.radius * 1.3;
        x = c.x + Math.cos(a) * d;
        y = c.y + Math.sin(a) * d;
      } else {
        const a = rand() * Math.PI * 2;
        const d = Math.sqrt(rand()) * extent;
        x = Math.cos(a) * d;
        y = Math.sin(a) * d;
      }
      const big = rand() < 0.1;
      const warm = rand() < 0.03;
      background.push({
        hx: x,
        hy: y,
        x,
        y,
        r: big ? 2.4 + rand() * 1.2 : 0.9 + rand() * 1,
        rgb: warm
          ? rgbOf(WARM)
          : this.rgbPalette[Math.floor(rand() * PALETTE.length)],
        big,
        named: null,
        wander: 10 + rand() * 18,
        speed: 0.05 + rand() * 0.12,
        phase: rand() * Math.PI * 2,
        linkPhase: rand() * Math.PI * 2,
        twinkle: 0.4 + rand() * 1.1,
      });
    }

    this.neurons = [...named, ...background];
    this.sx = new Float32Array(this.neurons.length);
    this.sy = new Float32Array(this.neurons.length);
    this.adjacencyAt = -Infinity;
    this.signals = [];
  }

  /** Moves every neuron along its slow orbit and advances the signals. */
  update(t: number, dt: number, tweaks: Tweaks, animate: boolean): void {
    for (const n of this.neurons) {
      const a = n.wander * tweaks.drift;
      n.x = n.hx + Math.cos(t * n.speed + n.phase) * a;
      n.y = n.hy + Math.sin(t * n.speed * 1.27 + n.phase * 1.9) * a;
    }

    if (t * 1000 - this.adjacencyAt > ADJACENCY_MS) {
      this.rebuildAdjacency();
      this.adjacencyAt = t * 1000;
    }
    if (!animate) {
      this.signals = [];
      return;
    }

    const ambient = this.signals.filter((s) => s.hops === Infinity).length;
    for (let i = ambient; i < AMBIENT_SIGNALS; i++) {
      const s = this.spawn(
        Math.floor(this.rand() * this.neurons.length),
        Infinity,
      );
      if (s) this.signals.push(s);
    }

    const survivors: Signal[] = [];
    for (const s of this.signals) {
      const a = this.neurons[s.from];
      const b = this.neurons[s.to];
      const len = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      s.p += (s.speed * dt) / 1000 / len;
      if (s.p < 1) {
        survivors.push(s);
        continue;
      }
      if (s.hops <= 1) continue;
      const next = this.pick(s.to, s.from);
      if (next === null) continue;
      survivors.push({
        from: s.to,
        to: next,
        p: s.p - 1,
        speed: s.speed,
        hops: s.hops - 1,
      });
    }
    this.signals = survivors;
  }

  /** Sends a burst of signals out from neuron `index` along its links. */
  burst(index: number): void {
    const out = this.adjacency[index];
    if (!out || out.length === 0) return;
    for (let i = 0; i < BURST_SIGNALS; i++) {
      this.signals.push({
        from: index,
        to: out[i % out.length],
        p: -i * 0.12,
        speed: 300 + this.rand() * 160,
        hops: 2 + Math.floor(this.rand() * 2),
      });
    }
  }

  private spawn(from: number, hops: number): Signal | null {
    const to = this.pick(from, -1);
    if (to === null) return null;
    return {
      from,
      to,
      p: this.rand(),
      speed: 220 + this.rand() * 180,
      hops,
    };
  }

  /** A random neighbour of `at`, avoiding `not` (no backtracking) when it can. */
  private pick(at: number, not: number): number | null {
    const out = this.adjacency[at];
    if (!out || out.length === 0) return null;
    const options = out.length > 1 ? out.filter((i) => i !== not) : out;
    return options[Math.floor(this.rand() * options.length)];
  }

  private reach(i: number, j: number): number {
    return this.neurons[i].named || this.neurons[j].named
      ? LINK_REACH * NAMED_REACH
      : LINK_REACH;
  }

  private rebuildAdjacency(): void {
    const n = this.neurons;
    const adj: number[][] = n.map(() => []);
    const far = LINK_REACH * NAMED_REACH;
    for (let i = 0; i < n.length; i++) {
      for (let j = i + 1; j < n.length; j++) {
        const dx = n[j].x - n[i].x;
        if (dx > far || dx < -far) continue;
        const dy = n[j].y - n[i].y;
        const reach = this.reach(i, j);
        if (dx * dx + dy * dy > reach * reach) continue;
        adj[i].push(j);
        adj[j].push(i);
      }
    }
    this.adjacency = adj;
  }

  /** Draws the frame. Also records each neuron's screen position. */
  draw(ctx: CanvasRenderingContext2D, view: View): void {
    const { w, h, cam, oy, t, tweaks } = view;
    const k = cam.k;
    const size = Math.sqrt(Math.min(Math.max(view.zoom, 0.6), 9));
    const n = this.neurons;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";

    // --- screen positions --------------------------------------------------
    const margin = LINK_REACH * NAMED_REACH * k + 40;
    const visible = new Uint8Array(n.length);
    for (let i = 0; i < n.length; i++) {
      const x = cam.ox + (n[i].x - cam.x) * k;
      const y = oy + (n[i].y - cam.y) * k;
      this.sx[i] = x;
      this.sy[i] = y;
      visible[i] =
        x > -margin && x < w + margin && y > -margin && y < h + margin ? 1 : 0;
    }

    // --- pools of light ----------------------------------------------------
    const glow = Math.sqrt(tweaks.glow);
    const core = n[0];
    this.pool(
      ctx,
      this.sx[0],
      this.sy[0],
      Math.max(180, 440 * k),
      rgbOf("#6fd6ff"),
      (0.13 + 0.03 * Math.sin(t * 0.5)) * glow,
    );
    this.clusters.forEach((c, i) => {
      const node = n.find((m) => m.named?.id === c.id) ?? core;
      const cx = cam.ox + ((c.minX + c.maxX) / 2 - cam.x) * k;
      const cy = oy + ((c.minY + c.maxY) / 2 - cam.y) * k;
      const breathe = 0.085 + 0.03 * Math.sin(t * 0.55 + i * 1.7);
      this.pool(
        ctx,
        cx,
        cy,
        Math.max(120, c.radius * 1.55 * k),
        node.rgb,
        breathe * (1 + 1.6 * (view.boost[i] ?? 0)) * glow,
      );
    });

    // --- links -------------------------------------------------------------
    // Bucketed by opacity, so hundreds of links stroke in a few dozen calls.
    const plain: number[][] = Array.from({ length: ALPHA_LEVELS }, () => []);
    const bright: number[][] = Array.from({ length: ALPHA_LEVELS }, () => []);
    const far = LINK_REACH * NAMED_REACH;
    for (let i = 0; i < n.length; i++) {
      for (let j = i + 1; j < n.length; j++) {
        if (!visible[i] && !visible[j]) continue;
        const dx = n[j].x - n[i].x;
        if (dx > far || dx < -far) continue;
        const dy = n[j].y - n[i].y;
        const named = n[i].named !== null || n[j].named !== null;
        const reach = named ? far : LINK_REACH;
        const d2 = dx * dx + dy * dy;
        if (d2 > reach * reach) continue;
        const falloff = (1 - Math.sqrt(d2) / reach) ** 1.5;
        const shimmer =
          0.55 + 0.45 * Math.sin(t * 0.9 + n[i].linkPhase + n[j].linkPhase);
        const a = falloff * shimmer * (named ? 0.75 : 0.42) * tweaks.glow;
        const level = Math.min(ALPHA_LEVELS - 1, Math.floor(a * ALPHA_LEVELS));
        if (level <= 0) continue;
        (named ? bright : plain)[level].push(
          this.sx[i],
          this.sy[i],
          this.sx[j],
          this.sy[j],
        );
      }
    }
    ctx.lineWidth = Math.min(1.6, 0.7 * size);
    const blue = rgbOf(LINK_BLUE);
    const cyan = rgbOf(LINK_NAMED);
    for (const [buckets, colour] of [
      [plain, blue],
      [bright, cyan],
    ] as const) {
      for (let level = 1; level < ALPHA_LEVELS; level++) {
        const segs = buckets[level];
        if (segs.length === 0) continue;
        ctx.strokeStyle = rgba(colour, (level + 0.5) / ALPHA_LEVELS);
        ctx.beginPath();
        for (let s = 0; s < segs.length; s += 4) {
          ctx.moveTo(segs[s], segs[s + 1]);
          ctx.lineTo(segs[s + 2], segs[s + 3]);
        }
        ctx.stroke();
      }
    }

    // --- signals -----------------------------------------------------------
    const signal = rgbOf(SIGNAL);
    const tail = Math.max(14, 70 * k);
    for (const s of this.signals) {
      if (s.p < 0) continue;
      if (!visible[s.from] && !visible[s.to]) continue;
      const ax = this.sx[s.from];
      const ay = this.sy[s.from];
      const bx = this.sx[s.to];
      const by = this.sy[s.to];
      const hx = ax + (bx - ax) * s.p;
      const hy = ay + (by - ay) * s.p;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const back = Math.min(tail, len * s.p);
      const tx = hx - ((bx - ax) / len) * back;
      const ty = hy - ((by - ay) / len) * back;
      const gradient = ctx.createLinearGradient(hx, hy, tx, ty);
      gradient.addColorStop(0, rgba(signal, 0.9));
      gradient.addColorStop(1, rgba(signal, 0));
      ctx.strokeStyle = gradient;
      ctx.lineWidth = Math.min(2.4, 1.3 * size);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.fillStyle = rgba(signal, 0.95);
      ctx.beginPath();
      ctx.arc(hx, hy, Math.min(2.6, 1.4 * size), 0, Math.PI * 2);
      ctx.fill();
    }

    // --- neurons -----------------------------------------------------------
    for (let i = n.length - 1; i >= 0; i--) {
      const m = n[i];
      if (m.r <= 0) continue;
      const x = this.sx[i];
      const y = this.sy[i];
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) continue;
      const pulse = 0.6 + 0.4 * Math.sin(t * m.twinkle + m.phase);
      const r = m.r * size * (i === view.hovered ? 1.35 : 1);
      if (m.big) {
        // The halo is a pre-rendered sprite rather than shadowBlur: the same
        // soft falloff, at the cost of one bitmap copy instead of a blur pass
        // per neuron per frame.
        const halo =
          r * (m.named ? 7 : 5) * (i === view.hovered ? 1.5 : 1) * glow;
        ctx.globalAlpha = m.named ? 0.55 + 0.35 * pulse : 0.35 + 0.4 * pulse;
        ctx.drawImage(
          this.sprite(m.rgb),
          x - halo,
          y - halo,
          halo * 2,
          halo * 2,
        );
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = rgba(
        m.rgb,
        m.named ? 0.7 + 0.3 * pulse : 0.3 + 0.55 * pulse,
      );
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (m.named) {
        // A hot white core makes named neurons read as light, not paint.
        ctx.fillStyle = rgba([230, 244, 255], 0.55 + 0.4 * pulse);
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.globalCompositeOperation = "source-over";
  }

  private sprites = new Map<string, HTMLCanvasElement>();

  /** A soft radial glow in one colour, rendered once and reused. */
  private sprite(rgb: RGB): HTMLCanvasElement {
    const key = rgb.join(",");
    let sprite = this.sprites.get(key);
    if (sprite) return sprite;
    sprite = document.createElement("canvas");
    sprite.width = 64;
    sprite.height = 64;
    const ctx = sprite.getContext("2d");
    if (ctx) {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, rgba(rgb, 0.9));
      g.addColorStop(0.18, rgba(rgb, 0.45));
      g.addColorStop(0.5, rgba(rgb, 0.12));
      g.addColorStop(1, rgba(rgb, 0));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 64, 64);
    }
    this.sprites.set(key, sprite);
    return sprite;
  }

  private pool(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    rgb: RGB,
    alpha: number,
  ): void {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, rgba(rgb, Math.min(1, alpha)));
    gradient.addColorStop(0.45, rgba(rgb, Math.min(1, alpha * 0.4)));
    gradient.addColorStop(1, rgba(rgb, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}
