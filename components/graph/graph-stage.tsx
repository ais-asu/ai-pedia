import { NeuralMap } from "@/components/graph/neural-map";
import type { GraphData } from "@/lib/graph-types";

/** Full-bleed home for the map, on its deep-space backdrop. */
export function GraphStage({ graph }: { graph: GraphData }) {
  return (
    <div className="nmap-backdrop relative h-full w-full">
      <NeuralMap graph={graph} />
    </div>
  );
}
