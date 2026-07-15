"use client";

import { assertBoundedWorkerMessage } from "@intentform/graph-runtime";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { verifyGraph, type VerificationResult, type VerificationScenario } from "@intentform/verifier";
import { useEffect, useRef, useState } from "react";

interface WorkerResponse {
  id: number;
  status: "ready" | "failed";
  result?: VerificationResult;
}

export function useBackgroundVerification(
  graph: SemanticInterfaceGraph,
  scenario: VerificationScenario,
): VerificationResult {
  const [result, setResult] = useState(() => verifyGraph(graph, scenario));
  const workerRef = useRef<Worker | null>(null);
  const sequence = useRef(0);

  useEffect(() => {
    try {
      workerRef.current = new Worker(new URL("../workers/graph-analysis-worker.ts", import.meta.url), { type: "module" });
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const worker = workerRef.current;
    const id = ++sequence.current;
    const request = { id, kind: "verify" as const, graph, scenario };
    if (!worker) {
      setResult(verifyGraph(graph, scenario));
      return;
    }
    try {
      assertBoundedWorkerMessage(request);
    } catch {
      setResult(verifyGraph(graph, scenario));
      return;
    }
    const receive = (event: MessageEvent<WorkerResponse>) => {
      if (event.data.id !== id || id !== sequence.current) return;
      if (event.data.status === "ready" && event.data.result) setResult(event.data.result);
      else setResult(verifyGraph(graph, scenario));
    };
    const failed = () => {
      if (id === sequence.current) setResult(verifyGraph(graph, scenario));
    };
    worker.addEventListener("message", receive);
    worker.addEventListener("error", failed, { once: true });
    worker.postMessage(request);
    return () => {
      worker.removeEventListener("message", receive);
      worker.removeEventListener("error", failed);
    };
  }, [graph, scenario]);

  return result;
}
