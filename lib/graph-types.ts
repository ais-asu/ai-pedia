/**
 * The shape of the map, shared by the build-time layout in `lib/graph.ts` and
 * the browser-side canvas that draws it.
 *
 * This module is deliberately free of Node imports: the graph builder reads the
 * content directory with `node:fs`, and the client must be able to take these
 * types and constants without dragging that into the bundle.
 */

export type GraphNodeKind = "root" | "category" | "article";

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  /** Small mono caption under the label: "3 topics", "article". */
  sublabel?: string;
  description?: string;
  /** ~130 characters of the article, for the hover preview. */
  snippet?: string;
  /** Header image for the preview card and panel, when the article has one. */
  image?: string;
  /** Article or category route. */
  href?: string;
  /** Id of the category node an article belongs to (a category's own id). */
  branch?: string;
  x: number;
  y: number;
  /** Index into the map palette; a branch and its articles share one. */
  hue: number;
}

/** A branch and the region its articles occupy. */
export interface GraphCluster {
  /** The category node's id. */
  id: string;
  x: number;
  y: number;
  /** Distance from the category node to its farthest article. */
  radius: number;
  /** Bounding box of the category and its articles, for framing. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface GraphData {
  nodes: GraphNode[];
  clusters: GraphCluster[];
  /** Radius of the ring the categories sit on. */
  ring: number;
}

export const ROOT_ID = "root";
