"use client";

import type React from "react";
// Import all visualization components from organized categories
import {
  AssumptionPlotsVisualization,
  InteractiveDemoVisualization,
  LinearEquationVisualization,
  ModelEvaluationVisualization,
  RegressionComparisonVisualization,
} from "./categories";
import { VisualizationError, type VisualizationProps } from "./shared";

/**
 * Registry of the React visualizations that articles can embed.
 *
 * An article embeds one with a placeholder on its own line:
 *   <div id="VZ-linear-equation" data-placeholder="Interactive Linear Equation"></div>
 * The id must start with "VZ-" and match a key below; MarkdownRenderer only
 * swaps in divs whose id starts with "VZ-".
 *
 * To add a visualization:
 * 1. Create the component in a folder under ./categories/
 * 2. Export it from that folder's index.ts
 * 3. Import it above and add it below under a new "VZ-..." key
 */
export const VISUALIZATION_COMPONENTS: Record<string, React.ComponentType> = {
  // Linear regression
  "VZ-linear-equation": LinearEquationVisualization,
  "VZ-assumptions-plots": AssumptionPlotsVisualization,
  "VZ-regression-comparison": RegressionComparisonVisualization,
  "VZ-model-evaluation": ModelEvaluationVisualization,
  "VZ-interactive-demo": InteractiveDemoVisualization,
};

/**
 * Component to render a visualization by ID
 */
export const Visualization: React.FC<VisualizationProps> = ({
  componentId,
}) => {
  // Safety check for component ID
  if (!componentId || typeof componentId !== "string") {
    return <VisualizationError componentId={componentId} type="invalid-id" />;
  }

  const Component = VISUALIZATION_COMPONENTS[componentId];

  if (!Component) {
    return <VisualizationError componentId={componentId} type="not-found" />;
  }

  try {
    return <Component />;
  } catch (error) {
    console.error(
      `Error rendering visualization component ${componentId}:`,
      error,
    );
    return <VisualizationError componentId={componentId} type="error" />;
  }
};

export default Visualization;
