import { cache } from "react";
import {
  type ArticleMeta,
  type Category,
  getArticle,
  getArticles,
  getCategories,
} from "@/lib/content";
import type { GraphCluster, GraphData, GraphNode } from "@/lib/graph-types";
import { ROOT_ID } from "@/lib/graph-types";

export * from "@/lib/graph-types";

/**
 * Build-time layout for the map of the library.
 *
 * Everything lives in one continuous world space. The core sits at the origin,
 * the categories ring it, and each category's articles are scattered through
 * a lobe to either side of it. Nothing is wired together here — on the map,
 * links form between whichever neurons happen to sit close to each other — so
 * a branch reads as a region of the network rather than a drawn tree.
 *
 * Positions are computed here rather than simulated in the browser so the map
 * is identical on every load, and so a deep link can frame its node before
 * the first frame is painted. Randomness is seeded from each node's id.
 */

/** Distance from the core to each category. */
const RING = 1000;
/** Nominal radius of a branch; grows gently with its article count. */
const CLUSTER_BASE = 300;
/** Articles keep at least this far from one another… */
const MIN_ARTICLE_GAP = 215;
/** …and at least this far from their branch's name. */
const MIN_BRANCH_GAP = 275;
/** No article strays further than this multiple of the cluster radius. */
const MAX_REACH = 1.5;
const RELAX_PASSES = 140;
const SNIPPET_LENGTH = 130;

/** FNV-1a string hash → 32-bit seed. */
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG, so layout never depends on load order. */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Plain text of a markdown body, for when an article has no description. */
function plainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s.*$/gm, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/[*_`>#|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function snippetOf(meta: ArticleMeta): string {
  const source =
    meta.description ||
    plainText(getArticle(meta.category, meta.slug)?.content ?? "");
  if (source.length <= SNIPPET_LENGTH) return source;
  const cut = source.slice(0, SNIPPET_LENGTH);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : SNIPPET_LENGTH).trimEnd()}…`;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Scatters a branch's articles through two lobes, one either side of the
 * branch name, then relaxes them until they keep their distance from each
 * other and from the name without drifting out of the branch.
 */
function placeArticles(
  branch: GraphNode,
  articles: ArticleMeta[],
  radius: number,
): GraphNode[] {
  const rand = prng(hash(branch.id));
  const lobeOffset = radius * 0.95;
  const lobeSpread = radius * 0.55;

  const nodes = articles.map((meta, i): GraphNode => {
    const side = i % 2 === 0 ? -1 : 1;
    const angle = rand() * Math.PI * 2;
    const dist = Math.sqrt(rand()) * lobeSpread;
    return {
      id: `article:${meta.category}/${meta.slug}`,
      kind: "article",
      label: meta.title,
      sublabel: "article",
      description: meta.description || undefined,
      snippet: snippetOf(meta) || undefined,
      image: meta.thumbnail,
      href: `/learn/${meta.category}/${meta.slug}`,
      branch: branch.id,
      x: branch.x + side * lobeOffset + Math.cos(angle) * dist,
      y: branch.y + Math.sin(angle) * dist * 0.8,
      hue: branch.hue,
    };
  });

  const reach = radius * MAX_REACH;
  for (let pass = 0; pass < RELAX_PASSES; pass++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        if (d >= MIN_ARTICLE_GAP) continue;
        if (d < 1e-3) {
          // Coincident points: split them along a seeded direction.
          const t = rand() * Math.PI * 2;
          dx = Math.cos(t);
          dy = Math.sin(t);
          d = 1;
        }
        const push = (MIN_ARTICLE_GAP - d) / 2;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
    for (const n of nodes) {
      const dx = n.x - branch.x;
      const dy = n.y - branch.y;
      const d = Math.hypot(dx, dy) || 1;
      const clamped = Math.min(Math.max(d, MIN_BRANCH_GAP), reach);
      n.x = branch.x + (dx / d) * clamped;
      n.y = branch.y + (dy / d) * clamped;
    }
  }
  return nodes;
}

function clusterOf(branch: GraphNode, articles: GraphNode[]): GraphCluster {
  let radius = MIN_BRANCH_GAP;
  let minX = branch.x;
  let minY = branch.y;
  let maxX = branch.x;
  let maxY = branch.y;
  for (const a of articles) {
    radius = Math.max(radius, Math.hypot(a.x - branch.x, a.y - branch.y));
    minX = Math.min(minX, a.x);
    minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x);
    maxY = Math.max(maxY, a.y);
  }
  return {
    id: branch.id,
    x: branch.x,
    y: branch.y,
    radius,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function placeCategory(
  category: Category,
  index: number,
  siblings: number,
): { branch: GraphNode; articles: GraphNode[]; cluster: GraphCluster } {
  const id = `category:${category.slug}`;
  // Categories ring the core evenly, starting at the top.
  const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(siblings, 1);
  const metas = getArticles(category.slug);
  const branch: GraphNode = {
    id,
    kind: "category",
    label: category.title,
    sublabel: plural(metas.length, "topic", "topics"),
    description: category.description || undefined,
    href: `/learn/${category.slug}`,
    branch: id,
    x: Math.cos(angle) * RING,
    y: Math.sin(angle) * RING,
    hue: index,
  };
  const radius = CLUSTER_BASE + 26 * Math.sqrt(metas.length);
  const articles = placeArticles(branch, metas, radius);
  return { branch, articles, cluster: clusterOf(branch, articles) };
}

export const getGraph = cache((): GraphData => {
  const categories = getCategories();
  const root: GraphNode = {
    id: ROOT_ID,
    kind: "root",
    label: "AI Pedia",
    sublabel: `${plural(categories.length, "branch", "branches")} · click to fly in`,
    x: 0,
    y: 0,
    hue: 0,
  };

  const nodes: GraphNode[] = [root];
  const clusters: GraphCluster[] = [];
  categories.forEach((category, i) => {
    const placed = placeCategory(category, i, categories.length);
    nodes.push(placed.branch, ...placed.articles);
    clusters.push(placed.cluster);
  });

  return { nodes, clusters, ring: RING };
});
