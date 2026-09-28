"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAP_LOCATE_EVENT, type MapLocateDetail } from "@/lib/constants";
import type { GraphCluster, GraphData, GraphNode } from "@/lib/graph-types";
import { ROOT_ID } from "@/lib/graph-types";
import {
  type Box,
  type Camera,
  clamp,
  easeCamera,
  fitScale,
  lerp,
  smoothstep,
} from "./camera";
import { MapTweaks } from "./map-tweaks";
import { DEFAULT_TWEAKS, Network, type Tweaks } from "./network";
import { NodeImage } from "./node-image";

/**
 * The panel drags in the whole markdown stack — react-markdown, KaTeX, the
 * syntax highlighter — which has no business loading before someone opens an
 * article. It arrives with the first click instead.
 */
const MapPanel = dynamic(() => import("./map-panel").then((m) => m.MapPanel), {
  ssr: false,
});

const PANEL_SUMMARY = 392;
const PANEL_FULL = 660;
/** Below this width the panel covers the map instead of sitting beside it. */
const NARROW = 720;
/** The header floats over the top of the map; framing keeps clear of it. */
const HEADER = 48;
/** Width of the padded hit block around each labelled neuron. */
const HIT_W = 178;
const PREVIEW_W = 290;
const TWEAKS_KEY = "ai-pedia:map-tweaks";

interface Size {
  w: number;
  h: number;
}

/** Normalizes wheel deltas (pixels, lines or pages) to pixels. */
function wheelPixels(event: WheelEvent, pageH: number) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pageH : 1;
  return { x: event.deltaX * unit, y: event.deltaY * unit };
}

function readTweaks(): Tweaks {
  try {
    const raw = window.localStorage.getItem(TWEAKS_KEY);
    if (raw) return { ...DEFAULT_TWEAKS, ...JSON.parse(raw) };
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
  }
  return DEFAULT_TWEAKS;
}

function writeTweaks(tweaks: Tweaks): void {
  try {
    window.localStorage.setItem(TWEAKS_KEY, JSON.stringify(tweaks));
  } catch {
    // Not worth surfacing: the tweaks just won't persist.
  }
}

/** Smallest area a branch is framed in, so a sparse one keeps some context. */
const MIN_FRAME_W = 980;
const MIN_FRAME_H = 640;

/** The world box a branch is framed by: its articles, with room to breathe. */
function clusterBox(c: GraphCluster): Box {
  const cx = (c.minX + c.maxX) / 2;
  const cy = (c.minY + c.maxY) / 2;
  const hw = Math.max((c.maxX - c.minX) / 2, MIN_FRAME_W / 2);
  const hh = Math.max((c.maxY - c.minY) / 2, MIN_FRAME_H / 2);
  return { minX: cx - hw, minY: cy - hh, maxX: cx + hw, maxY: cy + hh };
}

export function NeuralMap({ graph }: { graph: GraphData }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coreRef = useRef<HTMLButtonElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef(new Map<string, HTMLElement>());

  const sizeRef = useRef<Size>({ w: 0, h: 0 });
  const camRef = useRef<Camera>({ x: 0, y: 0, k: 0.3, ox: 0 });
  const targetRef = useRef<Camera>({ x: 0, y: 0, k: 0.3, ox: 0 });
  const overviewKRef = useRef(0.3);
  const maxKRef = useRef(2);
  const panelWRef = useRef(0);
  /** The branch the camera was sent to, so a resize can reframe it. */
  const focusRef = useRef<string | null>(null);
  const hoverIdxRef = useRef(-1);
  const reducedRef = useRef(false);

  const networkRef = useRef<Network | null>(null);
  const tweaksRef = useRef<Tweaks>(DEFAULT_TWEAKS);

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{
    x: number;
    y: number;
    moved: boolean;
    vx: number;
    vy: number;
    t: number;
  } | null>(null);
  const pinchRef = useRef<number | null>(null);
  const capturedRef = useRef(new Set<number>());

  const [ready, setReady] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(DEFAULT_TWEAKS);
  const [openId, setOpenId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const byId = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph.nodes],
  );
  const indexById = useMemo(
    () => new Map(graph.nodes.map((n, i) => [n.id, i])),
    [graph.nodes],
  );
  const clusterById = useMemo(
    () => new Map(graph.clusters.map((c) => [c.id, c])),
    [graph.clusters],
  );
  const labelled = useMemo(
    () => graph.nodes.filter((n) => n.kind !== "root"),
    [graph.nodes],
  );
  const root = byId.get(ROOT_ID);

  const openNode = openId ? byId.get(openId) : undefined;
  const hoverNode = hoverId ? byId.get(hoverId) : undefined;
  /** The open article, for the animation loop, which outlives any render. */
  const openNodeRef = useRef<GraphNode | undefined>(undefined);
  openNodeRef.current = openNode;

  // ---------------------------------------------------------------- framing

  /** Width of the map left beside the panel. */
  const freeWidth = useCallback((panelW: number) => {
    const { w } = sizeRef.current;
    return w < NARROW ? w : w - panelW;
  }, []);

  const overview = useCallback((): Camera => {
    const { w, h } = sizeRef.current;
    // Framed symmetrically about the core, so the title sits dead centre
    // however lopsided the branches' article lobes are.
    let rx = 1;
    let ry = 1;
    for (const c of graph.clusters) {
      rx = Math.max(rx, -c.minX, c.maxX);
      ry = Math.max(ry, -c.minY, c.maxY);
    }
    const box: Box = { minX: -rx, minY: -ry, maxX: rx, maxY: ry };
    return {
      x: 0,
      y: 0,
      // A phone is too narrow for the whole ring, so there the ring is framed
      // by height and the branches at the sides run off the edges.
      k: fitScale(box, w < NARROW ? w * 1.9 : w, h - HEADER, 64),
      ox: w / 2,
    };
  }, [graph.clusters]);

  /** Frames a whole branch inside whatever width the panel leaves free. */
  const clusterCamera = useCallback(
    (id: string, panelW: number): Camera | null => {
      const cluster = clusterById.get(id);
      if (!cluster) return null;
      const { h } = sizeRef.current;
      const free = freeWidth(panelW);
      const box = clusterBox(cluster);
      return {
        x: (box.minX + box.maxX) / 2,
        y: (box.minY + box.maxY) / 2,
        k: Math.min(fitScale(box, free, h - HEADER, 96), maxKRef.current),
        ox: free / 2,
      };
    },
    [clusterById, freeWidth],
  );

  /** Keeps a target inside the world, and its zoom inside the allowed range. */
  const tether = useCallback(
    (cam: Camera): Camera => {
      const k = clamp(cam.k, overviewKRef.current * 0.75, maxKRef.current);
      const limit = graph.ring + 700;
      const d = Math.hypot(cam.x, cam.y);
      const s = d > limit ? limit / d : 1;
      return { ...cam, k, x: cam.x * s, y: cam.y * s };
    },
    [graph.ring],
  );

  const flyTo = useCallback(
    (next: Camera) => {
      targetRef.current = tether(next);
    },
    [tether],
  );

  // ------------------------------------------------------------ navigation

  const goOverview = useCallback(() => {
    focusRef.current = null;
    setOpenId(null);
    setExpanded(false);
    panelWRef.current = 0;
    flyTo(overview());
  }, [flyTo, overview]);

  const focusBranch = useCallback(
    (id: string) => {
      focusRef.current = id;
      const cam = clusterCamera(id, panelWRef.current);
      if (cam) flyTo(cam);
    },
    [clusterCamera, flyTo],
  );

  const openArticle = useCallback((node: GraphNode) => {
    focusRef.current = node.branch ?? null;
    setOpenId(node.id);
    setExpanded(false);
  }, []);

  const closePanel = useCallback(() => {
    setOpenId(null);
    setExpanded(false);
  }, []);

  const select = useCallback(
    (node: GraphNode) => {
      if (node.kind === "root") goOverview();
      else if (node.kind === "category") focusBranch(node.id);
      else openArticle(node);
    },
    [focusBranch, goOverview, openArticle],
  );

  // The panel's width decides the free width, so every change to it reframes
  // the focused branch and shifts the view centre.
  useEffect(() => {
    const panelW = openId ? (expanded ? PANEL_FULL : PANEL_SUMMARY) : 0;
    panelWRef.current = panelW;
    if (!sizeRef.current.w) return;
    const focus = focusRef.current;
    const cam = focus ? clusterCamera(focus, panelW) : null;
    if (cam) flyTo(cam);
    else
      targetRef.current = { ...targetRef.current, ox: freeWidth(panelW) / 2 };
  }, [openId, expanded, clusterCamera, flyTo, freeWidth]);

  // Search picks land here: the map flies to them instead of navigating away.
  const locateRef = useRef<(path: string) => boolean>(() => false);
  locateRef.current = (path: string) => {
    if (path === "/" || path === "/learn") {
      goOverview();
      return true;
    }
    const node = graph.nodes.find((n) => n.href === path && n.kind !== "root");
    if (!node) return false;
    select(node);
    return true;
  };

  useEffect(() => {
    const onLocate = (event: Event) => {
      const { path } = (event as CustomEvent<MapLocateDetail>).detail;
      if (locateRef.current(path)) event.preventDefault();
    };
    window.addEventListener(MAP_LOCATE_EVENT, onLocate);
    return () => window.removeEventListener(MAP_LOCATE_EVENT, onLocate);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (openId) closePanel();
      else goOverview();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, closePanel, goOverview]);

  // ---------------------------------------------------------------- tweaks

  useEffect(() => {
    const saved = readTweaks();
    tweaksRef.current = saved;
    setTweaks(saved);
  }, []);

  const changeTweaks = useCallback((next: Tweaks) => {
    const densityChanged = next.density !== tweaksRef.current.density;
    tweaksRef.current = next;
    setTweaks(next);
    writeTweaks(next);
    if (densityChanged) networkRef.current?.populate(next.density);
  }, []);

  // --------------------------------------------------------------- sizing

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    networkRef.current ??= new Network(
      graph.nodes,
      graph.clusters,
      graph.ring,
      tweaksRef.current.density,
    );

    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0) return;
      const first = sizeRef.current.w === 0;
      sizeRef.current = { w: rect.width, h: rect.height };
      const home = overview();
      overviewKRef.current = home.k;
      // Wheel zoom stops just past the point where a branch fills the screen:
      // you can never zoom in past a subgroup.
      let tightest = home.k;
      for (const c of graph.clusters) {
        tightest = Math.max(
          tightest,
          fitScale(clusterBox(c), rect.width, rect.height - HEADER, 96),
        );
      }
      maxKRef.current = tightest * 1.2;

      if (first) {
        camRef.current = { ...home };
        targetRef.current = { ...home };
        setReady(true);
        return;
      }
      const focus = focusRef.current;
      const cam = focus ? clusterCamera(focus, panelWRef.current) : null;
      if (cam) flyTo(cam);
      else if (!focus && !panelWRef.current) flyTo(home);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [graph, overview, clusterCamera, flyTo]);

  // ----------------------------------------------------------- the loop

  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    reducedRef.current = media?.matches ?? false;
    const onMotionPref = () => {
      reducedRef.current = media?.matches ?? false;
    };
    media?.addEventListener("change", onMotionPref);

    let raf = 0;
    let last = performance.now();
    let clock = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const network = networkRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!network || !canvas || !ctx) return;

      const dt = Math.min(50, now - last);
      last = now;
      const reduced = reducedRef.current;
      if (!reduced) clock += dt / 1000;

      const cam = camRef.current;
      const target = targetRef.current;
      if (reduced) Object.assign(cam, target);
      else easeCamera(cam, target, dt);

      const { w, h } = sizeRef.current;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pw = Math.round(w * dpr);
      const ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const oy = (h + HEADER) / 2;
      const zoom = cam.k / overviewKRef.current;
      const free = freeWidth(panelWRef.current);
      const tw = tweaksRef.current;
      network.update(clock, reduced ? 0 : dt, tw, !reduced);

      // The branch nearest the middle of the free area is the active one; an
      // open article pins its own branch instead.
      const minSide = Math.min(free, h - HEADER);
      const openBranch = openNodeRef.current?.branch ?? null;
      const hoverNodeNow =
        hoverIdxRef.current >= 0 ? graph.nodes[hoverIdxRef.current] : null;
      let active = openBranch;
      let nearest = Infinity;
      const boost = graph.clusters.map((c) => {
        const x = cam.ox + ((c.minX + c.maxX) / 2 - cam.x) * cam.k;
        const y = oy + ((c.minY + c.maxY) / 2 - cam.y) * cam.k;
        const d = Math.hypot(x - cam.ox, y - oy);
        if (!openBranch && d < minSide * 0.34 && d < nearest) {
          nearest = d;
          active = c.id;
        }
        return 1 - smoothstep(0.1, 0.6, d / minSide);
      });
      graph.clusters.forEach((c, i) => {
        if (c.id === active || c.id === hoverNodeNow?.branch) boost[i] = 1;
      });

      network.draw(ctx, {
        w,
        h,
        cam,
        oy,
        zoom,
        t: clock,
        tweaks: tw,
        boost,
        hovered: hoverIdxRef.current,
      });

      // --- labels ---------------------------------------------------------
      const reach = 0.5 * Math.max(free, h - HEADER);
      const labelScale = clamp(zoom, 0.7, 8) ** 0.26;
      for (const node of labelled) {
        const el = labelRefs.current.get(node.id);
        const i = indexById.get(node.id);
        if (!el || i === undefined) continue;
        const x = network.sx[i];
        const y = network.sy[i];
        const dN = Math.hypot(x - cam.ox, y - oy) / reach;
        let alpha: number;
        if (node.kind === "category") {
          alpha =
            node.id === active
              ? 1
              : Math.max(0.4, 1 - smoothstep(0.75, 1.3, dN));
        } else {
          alpha = smoothstep(1.7, 2.9, zoom) * (1 - smoothstep(0.35, 0.95, dN));
          if (node.branch === active) {
            alpha = Math.max(alpha, smoothstep(1.4, 2.5, zoom));
          }
          if (node.id === openNodeRef.current?.id) alpha = 1;
        }
        el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${labelScale.toFixed(3)})`;
        el.style.opacity = alpha.toFixed(3);
        el.style.visibility = alpha < 0.02 ? "hidden" : "visible";
        el.style.pointerEvents = alpha > 0.35 ? "auto" : "none";
        const isActive = node.id === active || node.branch === active;
        if ((el.dataset.active === "true") !== isActive) {
          el.dataset.active = isActive ? "true" : "false";
        }
      }

      const core = coreRef.current;
      if (core) {
        const coreScale = clamp(zoom, 0.6, 4) ** 0.45;
        const alpha = 1 - smoothstep(2.4, 3.6, zoom);
        core.style.transform = `translate(${network.sx[0].toFixed(1)}px, ${network.sy[0].toFixed(1)}px) scale(${coreScale.toFixed(3)})`;
        core.style.opacity = alpha.toFixed(3);
        core.style.visibility = alpha < 0.02 ? "hidden" : "visible";
      }

      // --- hover preview --------------------------------------------------
      const preview = previewRef.current;
      const hi = hoverIdxRef.current;
      if (preview && hi >= 0) {
        const x = network.sx[hi];
        const y = network.sy[hi];
        const gap = (HIT_W / 2) * labelScale + 8;
        const right = x + gap + PREVIEW_W < free - 12;
        const left = right ? x + gap : x - gap - PREVIEW_W;
        const top = clamp(y - 70, HEADER + 8, h - preview.offsetHeight - 12);
        preview.style.transform = `translate(${Math.max(8, left).toFixed(1)}px, ${top.toFixed(1)}px)`;
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      media?.removeEventListener("change", onMotionPref);
    };
  }, [ready, graph, labelled, indexById, freeWidth]);

  // ------------------------------------------------------------- wheel zoom

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = stage.getBoundingClientRect();
      const delta = wheelPixels(event, rect.height);
      const target = targetRef.current;

      // A sideways swipe on a trackpad pans; everything else zooms.
      if (!event.ctrlKey && Math.abs(delta.x) > Math.abs(delta.y)) {
        flyTo({ ...target, x: target.x + delta.x / target.k });
        return;
      }

      // Pinch arrives as ctrl-modified wheel events with small deltas, a mouse
      // notch as one big one; both are capped so no single event can jump.
      const exponent = event.ctrlKey ? -delta.y * 0.011 : -delta.y * 0.0022;
      const k = clamp(
        target.k * Math.exp(clamp(exponent, -0.3, 0.3)),
        overviewKRef.current * 0.75,
        maxKRef.current,
      );
      // Zoom about the cursor: the world point under it stays under it.
      const px = event.clientX - rect.left;
      const py = event.clientY - rect.top;
      const oy = (sizeRef.current.h + HEADER) / 2;
      const wx = target.x + (px - target.ox) / target.k;
      const wy = target.y + (py - oy) / target.k;
      flyTo({
        ...target,
        k,
        x: wx - (px - target.ox) / k,
        y: wy - (py - oy) / k,
      });
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, [flyTo]);

  // ------------------------------------------------------- pan and pinch

  /**
   * Pointer capture is taken only once a drag is really under way. Capturing on
   * pointerdown would retarget the click that follows to the stage itself, and
   * the label under the cursor would never hear about it.
   */
  const capture = useCallback((pointerId: number) => {
    const stage = stageRef.current;
    if (!stage || capturedRef.current.has(pointerId)) return;
    stage.setPointerCapture(pointerId);
    capturedRef.current.add(pointerId);
  }, []);

  /** Moves the camera and its target together, so a drag has no lag. */
  const shift = useCallback((dx: number, dy: number) => {
    const cam = camRef.current;
    const target = targetRef.current;
    cam.x -= dx / cam.k;
    cam.y -= dy / cam.k;
    target.x -= dx / cam.k;
    target.y -= dy / cam.k;
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      pointersRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });
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
        const stage = stageRef.current;
        if (!previous || distance <= 0 || !stage) return;
        const rect = stage.getBoundingClientRect();
        const px = (a.x + b.x) / 2 - rect.left;
        const py = (a.y + b.y) / 2 - rect.top;
        const oy = (sizeRef.current.h + HEADER) / 2;
        const cam = camRef.current;
        const k = clamp(
          cam.k * (distance / previous),
          overviewKRef.current * 0.75,
          maxKRef.current,
        );
        const wx = cam.x + (px - cam.ox) / cam.k;
        const wy = cam.y + (py - oy) / cam.k;
        const next = {
          ...cam,
          k,
          x: wx - (px - cam.ox) / k,
          y: wy - (py - oy) / k,
        };
        camRef.current = next;
        targetRef.current = { ...next };
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
      shift(dx, dy);
    },
    [capture, shift],
  );

  const endPointer = useCallback(
    (event: React.PointerEvent) => {
      const stage = stageRef.current;
      if (stage && capturedRef.current.delete(event.pointerId)) {
        stage.releasePointerCapture?.(event.pointerId);
      }
      pointersRef.current.delete(event.pointerId);
      if (pointersRef.current.size < 2) pinchRef.current = null;
      if (pointersRef.current.size > 0) return;

      const drag = dragRef.current;
      // A drag let go while still moving coasts on: the target is thrown
      // ahead and the camera's easing brings it gently to rest there.
      if (drag?.moved && performance.now() - drag.t < 70) {
        const target = targetRef.current;
        flyTo({
          ...target,
          x: target.x - (drag.vx * 240) / target.k,
          y: target.y - (drag.vy * 240) / target.k,
        });
      } else {
        targetRef.current = tether(targetRef.current);
      }
      // Cleared on the next frame so the click that follows can read it.
      requestAnimationFrame(() => {
        if (dragRef.current === drag) dragRef.current = null;
      });
    },
    [flyTo, tether],
  );

  const wasDragged = () => dragRef.current?.moved === true;

  // ---------------------------------------------------------------- hover

  const enter = useCallback(
    (node: GraphNode) => {
      const i = indexById.get(node.id) ?? -1;
      hoverIdxRef.current = i;
      setHoverId(node.id);
      if (i >= 0 && !reducedRef.current) networkRef.current?.burst(i);
    },
    [indexById],
  );

  const leave = useCallback((node: GraphNode) => {
    setHoverId((id) => {
      if (id !== node.id) return id;
      hoverIdxRef.current = -1;
      return null;
    });
  }, []);

  // ---------------------------------------------------------------- render

  const related = openNode
    ? graph.nodes.filter(
        (n) =>
          n.kind === "article" &&
          n.branch === openNode.branch &&
          n.id !== openNode.id,
      )
    : [];
  const panelWidth = openId ? (expanded ? PANEL_FULL : PANEL_SUMMARY) : 0;
  const showPreview = hoverNode?.kind === "article" && hoverNode.id !== openId;

  return (
    <div
      ref={rootRef}
      className="nmap relative h-full w-full overflow-hidden"
      style={{ opacity: ready ? 1 : 0 }}
    >
      <div
        ref={stageRef}
        className="absolute inset-0 touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
      >
        <canvas
          ref={canvasRef}
          className="pointer-events-none absolute inset-0 h-full w-full"
        />

        <div aria-hidden="true" className="absolute inset-0">
          <button
            ref={coreRef}
            type="button"
            tabIndex={-1}
            className="nmap-core"
            onClick={() => {
              if (!wasDragged()) goOverview();
            }}
          >
            <span className="nmap-core-title">{root?.label ?? "AI Pedia"}</span>
            {root?.sublabel && (
              <span className="nmap-core-meta">{root.sublabel}</span>
            )}
          </button>

          {labelled.map((node) => (
            <button
              key={node.id}
              ref={(el) => {
                if (el) labelRefs.current.set(node.id, el);
                else labelRefs.current.delete(node.id);
              }}
              type="button"
              tabIndex={-1}
              className="nmap-label"
              data-kind={node.kind}
              data-open={node.id === openId ? "true" : undefined}
              style={{ width: HIT_W }}
              onPointerEnter={() => enter(node)}
              onPointerLeave={() => leave(node)}
              onClick={() => {
                if (!wasDragged()) select(node);
              }}
            >
              <span className="nmap-label-inner">
                <span className="nmap-label-name">{node.label}</span>
                {node.sublabel && (
                  <span className="nmap-label-meta">{node.sublabel}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      <h1 className="sr-only">AI Pedia</h1>

      <div
        ref={previewRef}
        className="nmap-preview"
        style={{ width: PREVIEW_W, opacity: showPreview ? 1 : 0 }}
        aria-hidden="true"
      >
        {showPreview && hoverNode && (
          <>
            <NodeImage node={hoverNode} className="h-28" />
            <div className="p-4">
              <p className="nmap-meta">
                {byId.get(hoverNode.branch ?? "")?.label}
              </p>
              <p className="mt-1.5 text-base leading-snug font-semibold text-foreground">
                {hoverNode.label}
              </p>
              {hoverNode.snippet && (
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {hoverNode.snippet}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {openNode && (
        <MapPanel
          node={openNode}
          branch={byId.get(openNode.branch ?? "")}
          related={related}
          expanded={expanded}
          width={sizeRef.current.w < NARROW ? sizeRef.current.w : panelWidth}
          onExpand={() => setExpanded(true)}
          onCollapse={() => setExpanded(false)}
          onClose={closePanel}
          onSelect={openArticle}
        />
      )}

      <MapTweaks tweaks={tweaks} onChange={changeTweaks} />

      {/* Real links for keyboard users, screen readers and crawlers — the map
          above is decorative as far as assistive tech is concerned. */}
      <nav className="sr-only" aria-label="All topics">
        <h2>Topics</h2>
        <ul>
          {labelled.map((n) => (
            <li key={n.id}>
              <Link href={n.href ?? "/"}>{n.label}</Link>
              {n.description ? ` — ${n.description}` : null}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
