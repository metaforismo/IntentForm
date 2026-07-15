import { demoGraph } from "../packages/proof-report/src/demo.ts";
import type { SemanticInterfaceGraph, SemanticNode } from "../packages/semantic-schema/src/index.ts";

export const LARGE_DOCUMENT_NODE_COUNT = 10_000;
export const LARGE_DOCUMENT_SCREEN_COUNT = 100;

export function createLargeDocumentGraph(
  nodeCount = LARGE_DOCUMENT_NODE_COUNT,
  screenCount = LARGE_DOCUMENT_SCREEN_COUNT,
): SemanticInterfaceGraph {
  if (!Number.isSafeInteger(nodeCount) || nodeCount < 1 || !Number.isSafeInteger(screenCount) || screenCount < 1) {
    throw new Error("Large-document fixture sizes must be positive integers.");
  }
  if (nodeCount % screenCount !== 0) throw new Error("Large-document nodes must divide evenly across screens.");
  const nodesPerScreen = nodeCount / screenCount;
  const graph = structuredClone(demoGraph);
  const template = structuredClone(graph.screens[0]!.nodes[0]!) as SemanticNode;
  graph.components = [];
  graph.assets = [];
  graph.flows = [];
  graph.contracts = [];
  graph.fixtures = [];
  graph.screens = Array.from({ length: screenCount }, (_, screenIndex) => {
    const screenId = `scale-${String(screenIndex).padStart(3, "0")}`;
    return {
      id: screenId,
      title: `Scale profile ${screenIndex + 1}`,
      purpose: "Exercise deterministic large-document architecture",
      route: `/scale-${String(screenIndex).padStart(3, "0")}`,
      nodes: Array.from({ length: nodesPerScreen }, (_, nodeIndex) => {
        const id = `${screenId}.node-${String(nodeIndex).padStart(3, "0")}`;
        return {
          ...structuredClone(template),
          id,
          intent: { ...template.intent, label: `Indexed item ${nodeIndex + 1}` },
          accessibility: { ...template.accessibility, label: `Indexed item ${nodeIndex + 1}` },
        };
      }),
    };
  });
  return graph;
}
