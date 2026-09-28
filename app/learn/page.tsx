import { GraphStage } from "@/components/graph/graph-stage";
import { getGraph } from "@/lib/graph";

export default function LearnPage() {
  return (
    <main data-theme="space" className="h-svh overflow-hidden">
      <GraphStage graph={getGraph()} />
    </main>
  );
}
