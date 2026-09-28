"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  MAP_LOCATE_EVENT,
  type MapLocateDetail,
  OPEN_SEARCH_EVENT,
} from "@/lib/constants";
import type { GraphData, GraphEdge, GraphNode } from "@/lib/graph-types";
import { ROOT_ID } from "@/lib/graph-types";
import { drawField, type FieldStyle } from "./ambient-field";
import {
  type Camera,
  clamp,
  clampCamera,
  damp,
  type Flight,
  flightPath,
  focusScaleFor,
  lerp,
  levelFor,
  MAX_K,
  MIN_K,
  openingCamera,
  toWorld,
  transformFor,
} from "./camera";
import { MapHero, type MapStats } from "./map-hero";

/**
 * The panel drags in the whole markdown stack — react-markdown, KaTeX, the
 * syntax highlighter — which has no business loading before someone opens a
 * node. It arrives with the first click instead.
 */
const ArticlePanel = dynamic(
  () => import("./article-panel").then((m) => m.ArticlePanel),
  { ssr: false },
);

/** Label size in world units, by tree depth. */
const LABEL_SIZE = [46, 27, 15, 8.5, 6] as const;

/** Below this viewport width the panel covers the canvas instead of splitting it. */
const NARROW = 900;

interface Size {
  w: number;
  h: number;
}

interface OpenArticle {
  href: string;
  anchor?: string;
}

/** A wheel zoom in progress: glide towards `k`, holding a world point under the cursor. */
interface ZoomGlide {
  k: number;
  px: number;
  py: number;
  wx: number;
  wy: number;
}

/** Response time of the wheel glide, in ms. Lower is snappier. */
const ZOOM_TAU = 105;
/** How quickly a flung pan loses speed, in ms. */
const FLING_TAU = 300;
/** A single wheel notch never zooms by more than this factor. */
const WHEEL_STEP_MAX = 1.35;

/**
 * Wheel deltas come in pixels, lines or pages depending on the browser and the
 * device. Normalized to pixels, so a mouse notch and a trackpad swipe land on
 * the same scale before they are turned into zoom.
 */
function wheelPixels(
  event: WheelEvent,
  pageH: number,
): { x: number; y: number } {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageH : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

function labelSize(depth: number): number {
  return LABEL_SIZE[Math.min(depth, LABEL_SIZE.length - 1)];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * A gently bowed link between two nodes. The bow direction is derived from the
 * edge's own ids so the network keeps the same hand-drawn shape on every load.
 */
function edgePath(a: GraphNode, b: GraphNode, bow: number): string {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return `M${a.x.toFixed(2)} ${a.y.toFixed(2)} Q${(mx - dy * bow).toFixed(2)} ${(
    my + dx * bow
  ).toFixed(2)} ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;
}

function bowFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * 0.22;
}

export function NeuralGraph({ graph }: { graph: GraphData }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fieldStyleRef = useRef<FieldStyle>({
    ink: "#191918",
    line: "#6f6d66",
    accent: "#8f84d6",
  });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const worldRef = useRef<SVGGElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef<Size>({ w: 0, h: 0 });

  const camRef = useRef<Camera>({ cx: 0, cy: 0, k: 0.5, ox: 0 });
  /** The opening shot. Every zoom threshold is relative to its scale. */
  const homeRef = useRef<Camera>({ cx: 0, cy: 0, k: 0.5, ox: 0 });
  const baseKRef = useRef(0.5);

  // Camera motion. At most one of these drives the camera on a given frame,
  // in this order of precedence; any direct input cancels the others.
  const flightRef = useRef<{
    flight: Flight;
    start: number;
    done?: () => void;
  } | null>(null);
  const glideRef = useRef<ZoomGlide | null>(null);
  const flingRef = useRef<{ vx: number; vy: number } | null>(null);
  /** Set whenever the camera moved, so the loop knows to repaint the field. */
  const dirtyRef = useRef(true);
  const reducedRef = useRef(false);

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{
    x: number;
    y: number;
    moved: boolean;
    /** Smoothed pointer velocity in px/ms, for flinging on release. */
    vx: number;
    vy: number;
    t: number;
  } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const capturedRef = useRef(new Set<number>());

  const [ready, setReady] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenArticle | null>(null);

  const byId = useMemo(() => {
    const map = new Map<string, GraphNode>();
    for (const n of graph.nodes) map.set(n.id, n);
    return map;
  }, [graph.nodes]);

  const edges = useMemo(
    () =>
      graph.edges
        .map((e: GraphEdge) => {
          const from = byId.get(e.from);
          const to = byId.get(e.to);
          if (!from || !to) return null;
          const id = `${e.from}->${e.to}`;
          return {
            id,
            kind: e.kind,
            from,
            to,
            depth: e.kind === "ring" ? 1 : to.depth,
            d: edgePath(from, to, e.kind === "ring" ? 0.16 : bowFor(id)),
          };
        })
        .filter((e): e is NonNullable<typeof e> => e !== null),
    [graph.edges, byId],
  );

  /** Every node from `id` up to the root, for highlighting a lineage. */
  const lineageOf = useCallback(
    (id: string | null): Set<string> => {
      const chain = new Set<string>();
      let cursor = id;
      while (cursor) {
        chain.add(cursor);
        cursor = byId.get(cursor)?.parent ?? null;
      }
      return chain;
    },
    [byId],
  );

  const highlight = useMemo(
    () => lineageOf(hoverId ?? activeId),
    [hoverId, activeId, lineageOf],
  );

  const stats = useMemo<MapStats>(() => {
    const count = (kind: GraphNode["kind"]) =>
      graph.nodes.filter((n) => n.kind === kind).length;
    return {
      categories: count("category"),
      articles: count("article"),
      sections: count("heading"),
    };
  }, [graph.nodes]);

  const categoryNodes = useMemo(
    () => graph.nodes.filter((n) => n.kind === "category"),
    [graph.nodes],
  );

  // ---------------------------------------------------------------- camera

  /** Repaints the procedural mesh for the current camera at time `t` (s). */
  const paintField = useCallback((t: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = sizeRef.current;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelW = Math.round(w * dpr);
    const pixelH = Math.round(h * dpr);
    if (canvas.width !== pixelW || canvas.height !== pixelH) {
      canvas.width = pixelW;
      canvas.height = pixelH;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawField(ctx, w, h, camRef.current, fieldStyleRef.current, t);
  }, []);

  /**
   * Pins the title card to the root. It grows and shrinks with the zoom, but
   * less than the map does, and fades out once you are well past it.
   */
  const placeHero = useCallback(() => {
    const hero = heroRef.current;
    if (!hero) return;
    const { w, h } = sizeRef.current;
    const cam = camRef.current;
    const x = w / 2 + cam.ox - cam.cx * cam.k;
    const y = h / 2 - cam.cy * cam.k;
    const ratio = cam.k / Math.max(baseKRef.current, 1e-6);
    const scale = clamp(ratio, 0.45, 2.4) ** 0.6;
    const opacity = clamp((1.75 - ratio) / 0.55, 0, 1);
    hero.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(
      1,
    )}px) translate(-50%, -50%) scale(${scale.toFixed(4)})`;
    hero.style.opacity = opacity.toFixed(3);
    hero.style.visibility = opacity < 0.02 ? "hidden" : "visible";
  }, []);

  const applyCamera = useCallback(() => {
    const world = worldRef.current;
    const svg = svgRef.current;
    if (!world || !svg) return;
    const { w, h } = sizeRef.current;
    world.setAttribute("transform", transformFor(camRef.current, w, h));
    const level = String(levelFor(camRef.current.k, baseKRef.current));
    if (svg.dataset.zoom !== level) svg.dataset.zoom = level;
    placeHero();
    dirtyRef.current = true;
  }, [placeHero]);

  const tether = useCallback(
    (cam: Camera): Camera => {
      const { w, h } = sizeRef.current;
      return clampCamera(cam, graph.bounds, baseKRef.current, w, h);
    },
    [graph.bounds],
  );

  /** Stops every glide, fling and flight in progress. */
  const halt = useCallback(() => {
    flightRef.current = null;
    glideRef.current = null;
    flingRef.current = null;
  }, []);

  /** Flies the camera to `to`, then calls `done` once it has arrived. */
  const animateTo = useCallback(
    (to: Partial<Camera>, done?: () => void) => {
      const from = { ...camRef.current };
      const next = tether({ ...from, ...to });
      halt();
      if (reducedRef.current) {
        camRef.current = next;
        applyCamera();
        done?.();
        return;
      }
      flightRef.current = {
        flight: flightPath(from, next, sizeRef.current.w || 1000),
        start: performance.now(),
        done,
      };
    },
    [applyCamera, halt, tether],
  );

  /** Stops any running motion and moves the camera immediately. */
  const setCamera = useCallback(
    (next: Camera) => {
      halt();
      camRef.current = tether(next);
      applyCamera();
    },
    [applyCamera, halt, tether],
  );

  /**
   * Starts (or extends) a smooth zoom towards `k`, keeping the world point
   * under screen position (`px`, `py`) fixed. Successive wheel events keep
   * pushing the same target, so a burst of notches reads as one gesture.
   */
  const glideZoom = useCallback(
    (factor: number, px: number, py: number) => {
      const { w, h } = sizeRef.current;
      const cam = camRef.current;
      flightRef.current = null;
      flingRef.current = null;
      const from = glideRef.current?.k ?? cam.k;
      const base = baseKRef.current;
      const k = clamp(
        clamp(from * factor, base * 0.4, base * 12),
        MIN_K,
        MAX_K,
      );
      const world = toWorld(cam, w, h, px, py);
      if (reducedRef.current) {
        setCamera({
          ...cam,
          k,
          cx: world.x - (px - w / 2 - cam.ox) / k,
          cy: world.y - (py - h / 2) / k,
        });
        return;
      }
      glideRef.current = { k, px, py, wx: world.x, wy: world.y };
    },
    [setCamera],
  );

  /** Screen-space sideways shift that keeps a focused node clear of the panel. */
  const panelOffset = useCallback((panelOpen: boolean) => {
    const { w } = sizeRef.current;
    if (!panelOpen || w < NARROW) return 0;
    return -Math.min(760, w * 0.52) / 2;
  }, []);

  const resetView = useCallback(() => {
    if (!sizeRef.current.w) return;
    animateTo(homeRef.current);
  }, [animateTo]);

  // ------------------------------------------------------------- selection

  const closePanel = useCallback(() => {
    setOpen(null);
    animateTo({ ox: 0 });
  }, [animateTo]);

  const selectNode = useCallback(
    (node: GraphNode, { openOnArrival = false } = {}) => {
      setActiveId(node.id);

      if (node.id === ROOT_ID) {
        setOpen(null);
        resetView();
        return;
      }

      // Categories are waypoints: flying to one reveals its articles without
      // opening anything to read.
      if (node.kind === "category") {
        setOpen(null);
        animateTo({
          cx: node.x,
          cy: node.y,
          k: focusScaleFor(node, baseKRef.current),
          ox: 0,
        });
        return;
      }

      if (!node.href) return;
      const next: OpenArticle = { href: node.href, anchor: node.anchor };
      // From search the journey can cross the whole map, so the panel waits
      // for the camera to land rather than covering half the flight.
      if (!openOnArrival) setOpen(next);
      animateTo(
        {
          cx: node.x,
          cy: node.y,
          k: focusScaleFor(node, baseKRef.current),
          ox: panelOffset(true),
        },
        openOnArrival ? () => setOpen(next) : undefined,
      );
    },
    [animateTo, panelOffset, resetView],
  );

  /** Flies to whatever the search palette picked, if it is on the map. */
  const locate = useCallback(
    (path: string): boolean => {
      if (path === "/" || path === "/learn") {
        setActiveId(null);
        setOpen(null);
        resetView();
        return true;
      }
      const node = graph.nodes.find(
        (n) =>
          n.href === path && (n.kind === "category" || n.kind === "article"),
      );
      if (!node) return false;
      selectNode(node, { openOnArrival: true });
      return true;
    },
    [graph.nodes, resetView, selectNode],
  );

  const locateRef = useRef(locate);
  locateRef.current = locate;

  useEffect(() => {
    const onLocate = (event: Event) => {
      const { path } = (event as CustomEvent<MapLocateDetail>).detail;
      if (locateRef.current(path)) event.preventDefault();
    };
    window.addEventListener(MAP_LOCATE_EVENT, onLocate);
    return () => window.removeEventListener(MAP_LOCATE_EVENT, onLocate);
  }, []);

  const explore = useCallback(() => {
    const first =
      categoryNodes.find((c) => graph.nodes.some((n) => n.parent === c.id)) ??
      categoryNodes[0];
    if (first) selectNode(first);
  }, [categoryNodes, graph.nodes, selectNode]);

  // --------------------------------------------------------------- sizing

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const styles = getComputedStyle(svg);
    fieldStyleRef.current = {
      ink: styles.getPropertyValue("--foreground").trim() || "#191918",
      line: styles.getPropertyValue("--muted").trim() || "#6f6d66",
      accent: styles.getPropertyValue("--purple").trim() || "#8f84d6",
    };

    const measure = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0) return;
      const first = sizeRef.current.w === 0;
      sizeRef.current = { w: rect.width, h: rect.height };
      const home = openingCamera(categoryNodes, rect.width, rect.height);
      homeRef.current = home;
      baseKRef.current = home.k;
      if (first) {
        setCamera(home);
        setReady(true);
      } else {
        applyCamera();
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [applyCamera, setCamera, categoryNodes]);

  // --------------------------------------------------------- motion loop

  /**
   * One loop drives everything that moves: flights, wheel glides, flings and
   * the drifting field. The field keeps animating while the camera is still,
   * unless the visitor has asked for reduced motion, in which case the loop
   * only repaints when the camera actually moves.
   */
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    reducedRef.current = media?.matches ?? false;
    const onMotionPref = () => {
      reducedRef.current = media?.matches ?? false;
      dirtyRef.current = true;
    };
    media?.addEventListener("change", onMotionPref);

    let last = performance.now();
    let raf = 0;

    const step = (now: number, dt: number) => {
      const flight = flightRef.current;
      if (flight) {
        const t = Math.min(1, (now - flight.start) / flight.flight.duration);
        camRef.current = flight.flight.at(t);
        applyCamera();
        if (t >= 1) {
          flightRef.current = null;
          flight.done?.();
        }
        return;
      }

      const glide = glideRef.current;
      if (glide) {
        const { w, h } = sizeRef.current;
        const cam = camRef.current;
        const a = damp(dt, ZOOM_TAU);
        const logK = lerp(Math.log(cam.k), Math.log(glide.k), a);
        const settled = Math.abs(logK - Math.log(glide.k)) < 0.0015;
        const k = settled ? glide.k : Math.exp(logK);
        camRef.current = tether({
          k,
          ox: cam.ox,
          cx: glide.wx - (glide.px - w / 2 - cam.ox) / k,
          cy: glide.wy - (glide.py - h / 2) / k,
        });
        applyCamera();
        if (settled) glideRef.current = null;
        return;
      }

      const fling = flingRef.current;
      if (fling) {
        const cam = camRef.current;
        camRef.current = tether({
          ...cam,
          cx: cam.cx - (fling.vx * dt) / cam.k,
          cy: cam.cy - (fling.vy * dt) / cam.k,
        });
        applyCamera();
        const decay = Math.exp(-dt / FLING_TAU);
        fling.vx *= decay;
        fling.vy *= decay;
        if (Math.hypot(fling.vx, fling.vy) < 0.015) flingRef.current = null;
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      step(now, dt);
      const animated = !reducedRef.current;
      if (animated || dirtyRef.current) {
        dirtyRef.current = false;
        paintField(animated ? now / 1000 : 0);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      media?.removeEventListener("change", onMotionPref);
    };
  }, [applyCamera, paintField, tether]);

  // ----------------------------------------------------------- wheel zoom

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = svg.getBoundingClientRect();
      const delta = wheelPixels(event, rect.height);

      // A sideways swipe on a trackpad pans; everything else zooms.
      if (!event.ctrlKey && Math.abs(delta.x) > Math.abs(delta.y)) {
        const cam = camRef.current;
        setCamera({ ...cam, cx: cam.cx + delta.x / cam.k });
        return;
      }

      // Pinch arrives as a ctrl-modified wheel with small, frequent deltas; a
      // mouse notch as one large one. Both are capped so no single event can
      // jump, and the glide in the loop smooths out whatever arrives.
      const exponent = event.ctrlKey ? -delta.y * 0.011 : -delta.y * 0.0026;
      const cap = Math.log(WHEEL_STEP_MAX);
      glideZoom(
        Math.exp(clamp(exponent, -cap, cap)),
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
    };

    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [glideZoom, setCamera]);

  // ------------------------------------------------------- pan and pinch

  /**
   * Pointer capture is taken only once a drag is really under way. Capturing on
   * pointerdown would retarget the click that follows to the <svg> itself, and
   * the node under the cursor would never hear about it.
   */
  const capture = useCallback((pointerId: number) => {
    const svg = svgRef.current;
    if (!svg || capturedRef.current.has(pointerId)) return;
    svg.setPointerCapture(pointerId);
    capturedRef.current.add(pointerId);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
      // Catching the map mid-fling or mid-glide stops it, like a hand on a page.
      glideRef.current = null;
      flingRef.current = null;
      if (pointersRef.current.size === 1) {
        dragRef.current = {
          x: event.clientX,
          y: event.clientY,
          moved: false,
          vx: 0,
          vy: 0,
          t: performance.now(),
        };
      } else {
        dragRef.current = null;
        pinchRef.current = null;
        // A second finger is unambiguously a gesture, never a tap.
        for (const id of pointersRef.current.keys()) capture(id);
      }
    },
    [capture],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      const pointers = pointersRef.current;
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const previous = pinchRef.current;
        pinchRef.current = distance;
        if (previous && distance > 0) {
          const svg = svgRef.current;
          if (!svg) return;
          const rect = svg.getBoundingClientRect();
          const px = (a.x + b.x) / 2 - rect.left;
          const py = (a.y + b.y) / 2 - rect.top;
          const { w, h } = sizeRef.current;
          const cam = camRef.current;
          const k = clamp(cam.k * (distance / previous), MIN_K, MAX_K);
          const world = toWorld(cam, w, h, px, py);
          setCamera({
            k,
            ox: cam.ox,
            cx: world.x - (px - w / 2 - cam.ox) / k,
            cy: world.y - (py - h / 2) / k,
          });
        }
        return;
      }

      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      capture(event.pointerId);
      const now = performance.now();
      const elapsed = Math.max(1, now - drag.t);
      drag.vx = lerp(drag.vx, dx / elapsed, 0.6);
      drag.vy = lerp(drag.vy, dy / elapsed, 0.6);
      drag.t = now;
      drag.x = event.clientX;
      drag.y = event.clientY;
      const cam = camRef.current;
      setCamera({
        ...cam,
        cx: cam.cx - dx / cam.k,
        cy: cam.cy - dy / cam.k,
      });
    },
    [capture, setCamera],
  );

  const endPointer = useCallback((event: React.PointerEvent) => {
    const svg = svgRef.current;
    if (svg && capturedRef.current.delete(event.pointerId)) {
      svg.releasePointerCapture?.(event.pointerId);
    }
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      const drag = dragRef.current;
      // A drag released while still moving carries on and coasts to a stop.
      if (
        drag?.moved &&
        !reducedRef.current &&
        performance.now() - drag.t < 70 &&
        Math.hypot(drag.vx, drag.vy) > 0.08
      ) {
        flingRef.current = { vx: drag.vx, vy: drag.vy };
      }
      // Cleared on the next frame so the click that follows can read it.
      requestAnimationFrame(() => {
        if (dragRef.current === drag) dragRef.current = null;
      });
    }
  }, []);

  const wasDragged = () => dragRef.current?.moved === true;

  // ------------------------------------------------------------- keyboard

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (open) {
        closePanel();
        return;
      }
      if (activeId) {
        setActiveId(null);
        resetView();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, activeId, closePanel, resetView]);

  // ---------------------------------------------------------------- render

  const dimmed = highlight.size > 1;

  return (
    <div className="relative h-full w-full overflow-hidden bg-background">
      {/* The unbounded ambient mesh. Canvas, not SVG: it is repainted on every
          frame of a pan or a flight, and there is no reason for any of it to
          exist in the DOM. */}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <div className="ngraph-edge-vignette" aria-hidden="true" />
      <svg
        ref={svgRef}
        className="ngraph relative h-full w-full touch-none select-none"
        data-zoom="0"
        data-dimmed={dimmed ? "true" : "false"}
        style={{ opacity: ready ? 1 : 0 }}
        role="presentation"
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onDoubleClick={() => {
          setActiveId(null);
          setOpen(null);
          resetView();
        }}
      >
        <title>Map of AI Pedia</title>
        <defs>
          {/* Clears a little paper around each real node so it is never read as
              part of the ambient mesh behind it. */}
          <radialGradient id="ngraph-halo">
            <stop className="ngraph-halo-in" offset="22%" />
            <stop className="ngraph-halo-out" offset="100%" />
          </radialGradient>
        </defs>
        <g ref={worldRef}>
          <g className="ngraph-edges">
            {edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.d}
                data-depth={edge.depth}
                data-kind={edge.kind}
                data-lit={
                  highlight.has(edge.from.id) && highlight.has(edge.to.id)
                    ? "true"
                    : undefined
                }
              />
            ))}
          </g>

          <g className="ngraph-nodes">
            {graph.nodes.map((node) => {
              const lit = highlight.has(node.id);
              const size = labelSize(node.depth);
              return (
                <g
                  key={node.id}
                  data-depth={node.depth}
                  data-kind={node.kind}
                  data-lit={lit ? "true" : undefined}
                  data-active={activeId === node.id ? "true" : undefined}
                  transform={`translate(${node.x} ${node.y})`}
                >
                  <circle
                    className="ngraph-halo"
                    r={Math.max(node.r * 3.2, 15)}
                    fill="url(#ngraph-halo)"
                  />
                  {/* Generous invisible target — the drawn dots are small. */}
                  {/* biome-ignore lint/a11y/noStaticElementInteractions: the canvas is aria-hidden decoration; the equivalent links live in the sr-only nav below */}
                  <circle
                    className="ngraph-hit"
                    r={Math.max(node.r * 2.4, 16)}
                    onPointerEnter={() => setHoverId(node.id)}
                    onPointerLeave={() =>
                      setHoverId((id) => (id === node.id ? null : id))
                    }
                    onClick={() => {
                      if (wasDragged()) return;
                      selectNode(node);
                    }}
                  />
                  <circle className="ngraph-dot" r={node.r} />
                  <text
                    className="ngraph-label"
                    y={node.r + size * 1.15}
                    fontSize={size}
                  >
                    {truncate(node.label, node.depth >= 3 ? 30 : 42)}
                  </text>
                  {node.sublabel && (
                    <text
                      className="ngraph-sublabel"
                      y={node.r + size * 2.05}
                      fontSize={size * 0.38}
                      letterSpacing={size * 0.07}
                    >
                      {node.sublabel.toUpperCase()}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      <div
        className="pointer-events-none absolute inset-0 z-10 overflow-hidden transition-opacity duration-500"
        style={{ opacity: ready && !open ? 1 : 0 }}
      >
        <MapHero
          ref={heroRef}
          stats={stats}
          onExplore={explore}
          onSearch={() => window.dispatchEvent(new Event(OPEN_SEARCH_EVENT))}
        />
      </div>

      {/* Real links for keyboard users, screen readers and crawlers — the
          canvas above is decorative as far as assistive tech is concerned. */}
      <nav className="sr-only" aria-label="All topics">
        <h2>Topics</h2>
        <ul>
          {graph.nodes
            .filter((n) => n.kind === "category" || n.kind === "article")
            .map((n) => (
              <li key={n.id}>
                <Link href={n.href ?? "/"}>{n.label}</Link>
                {n.description ? ` — ${n.description}` : null}
              </li>
            ))}
        </ul>
      </nav>

      <GraphControls
        onReset={() => {
          setActiveId(null);
          setOpen(null);
          resetView();
        }}
        onZoom={(factor) => {
          const { w, h } = sizeRef.current;
          glideZoom(factor, w / 2 + camRef.current.ox, h / 2);
        }}
      />

      {open && (
        <ArticlePanel
          href={open.href}
          anchor={open.anchor}
          onClose={closePanel}
        />
      )}
    </div>
  );
}

function GraphControls({
  onReset,
  onZoom,
}: {
  onReset: () => void;
  onZoom: (factor: number) => void;
}) {
  return (
    <div className="pointer-events-none absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-background/85 px-1.5 py-1 backdrop-blur">
      <button
        type="button"
        onClick={() => onZoom(1 / 1.45)}
        className="pointer-events-auto h-8 w-8 rounded-full text-lg leading-none text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        type="button"
        onClick={onReset}
        className="pointer-events-auto rounded-full px-3 py-1 text-xs tracking-[0.14em] text-muted uppercase transition-colors hover:bg-surface-2 hover:text-foreground"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={() => onZoom(1.45)}
        className="pointer-events-auto h-8 w-8 rounded-full text-lg leading-none text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
        aria-label="Zoom in"
      >
        +
      </button>
    </div>
  );
}
