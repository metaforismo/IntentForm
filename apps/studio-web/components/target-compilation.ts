import { compileExpo } from "@intentform/compiler-expo";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { compileWeb } from "@intentform/compiler-web";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";

export type StudioOutputTarget = "react" | "swiftui" | "expo" | "web";
export type StudioGeneratedFileSet = ReturnType<typeof compileReact>;

export interface StudioTargetCompilation {
  target: StudioOutputTarget;
  status: "generated" | "disabled" | "failed";
  output: StudioGeneratedFileSet | null;
  message: string | null;
}

function compileStudioTargetUncached(
  graph: SemanticInterfaceGraph,
  target: StudioOutputTarget,
): StudioTargetCompilation {
  const platform = graph.platforms.find((candidate) => candidate.target === target);
  if (!platform?.enabled) {
    return {
      target,
      status: "disabled",
      output: null,
      message: `The ${target} target is not enabled by this graph. Enable it in project platforms before generating source.`,
    };
  }

  try {
    return {
      target,
      status: "generated",
      output: target === "react"
        ? compileReact(graph)
        : target === "swiftui"
          ? compileSwiftUI(graph)
          : target === "expo"
            ? compileExpo(graph)
            : compileWeb(graph),
      message: null,
    };
  } catch (error) {
    return {
      target,
      status: "failed",
      output: null,
      message: error instanceof Error
        ? error.message.slice(0, 500)
        : `The ${target} compiler failed without a diagnostic.`,
    };
  }
}

export interface StudioCompilationCache {
  compile(graph: SemanticInterfaceGraph, target: StudioOutputTarget): StudioTargetCompilation;
}

export function createStudioCompilationCache(): StudioCompilationCache {
  const graphs = new WeakMap<SemanticInterfaceGraph, Map<StudioOutputTarget, StudioTargetCompilation>>();
  return {
    compile(graph, target) {
      let targets = graphs.get(graph);
      if (!targets) {
        targets = new Map();
        graphs.set(graph, targets);
      }
      const cached = targets.get(target);
      if (cached) return cached;
      const result = compileStudioTargetUncached(graph, target);
      targets.set(target, result);
      return result;
    },
  };
}

const sharedCompilationCache = createStudioCompilationCache();

export function compileStudioTarget(
  graph: SemanticInterfaceGraph,
  target: StudioOutputTarget,
): StudioTargetCompilation {
  return sharedCompilationCache.compile(graph, target);
}
