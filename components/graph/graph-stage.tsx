import { NeuralGraph } from "@/components/graph/neural-graph";
import type { GraphData } from "@/lib/graph-types";

/** Full-bleed home for the map. */
export function GraphStage({ graph }: { graph: GraphData }) {
  return (
    <div className="relative h-full w-full">
      <NeuralGraph graph={graph} />
    </div>
  );
}
