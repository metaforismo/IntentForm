import { assertBoundedWorkerMessage } from "@intentform/graph-runtime";
import { computeNeutralLayout } from "@intentform/layout-engine";
import { parseGraph } from "@intentform/semantic-schema";
import { verifyGraph, type VerificationScenario } from "@intentform/verifier";

type WorkerRequest =
  | { id: number; kind: "verify"; graph: unknown; scenario: VerificationScenario }
  | { id: number; kind: "layout"; graph: unknown; screenId: string; viewport: { width: number; height: number } };

type WorkerResponse =
  | { id: number; status: "ready"; result: unknown }
  | { id: number; status: "failed"; message: string };

const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: WorkerResponse): void;
};

scope.onmessage = (event) => {
  const input = event.data;
  const id = input && typeof input === "object" && Number.isSafeInteger((input as { id?: unknown }).id)
    ? (input as { id: number }).id
    : 0;
  try {
    assertBoundedWorkerMessage(input);
    if (!input || typeof input !== "object" || !("kind" in input) || !("graph" in input)) {
      throw new Error("Graph worker request is malformed.");
    }
    const request = input as WorkerRequest;
    const graph = parseGraph(request.graph);
    if (request.kind === "verify") {
      scope.postMessage({ id, status: "ready", result: verifyGraph(graph, request.scenario) });
      return;
    }
    if (request.kind === "layout") {
      const screen = graph.screens.find((candidate) => candidate.id === request.screenId);
      if (!screen) throw new Error(`Unknown layout screen: ${request.screenId}`);
      const layout = computeNeutralLayout(screen, graph, request.viewport);
      scope.postMessage({
        id,
        status: "ready",
        result: { viewport: layout.viewport, contentHeight: layout.contentHeight, roots: layout.roots },
      });
      return;
    }
    throw new Error("Graph worker request kind is unsupported.");
  } catch (error) {
    scope.postMessage({
      id,
      status: "failed",
      message: error instanceof Error ? error.message.slice(0, 500) : "Graph worker failed.",
    });
  }
};
