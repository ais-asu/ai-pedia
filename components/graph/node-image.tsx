import type { GraphNode } from "@/lib/graph-types";
import { cn } from "@/lib/utils";
import { PALETTE } from "./network";

/**
 * An article's header image, or — when it has none — a placeholder drawn in
 * its branch's colour, so the preview card and panel keep their shape.
 */
export function NodeImage({
  node,
  className,
}: {
  node: GraphNode;
  className?: string;
}) {
  const hue = PALETTE[node.hue % PALETTE.length];
  if (node.image) {
    return (
      // biome-ignore lint/performance/noImgElement: small static thumbnails from public/, shown at one size
      <img
        src={node.image}
        alt=""
        className={cn("w-full object-cover", className)}
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className={cn("nmap-placeholder w-full", className)}
      style={{ "--hue": hue } as React.CSSProperties}
    />
  );
}
