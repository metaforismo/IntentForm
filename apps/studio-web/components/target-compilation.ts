import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { compileWeb } from "@intentform/compiler-web";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";

export type StudioOutputTarget = "react" | "swiftui" | "web";
export type StudioGeneratedFileSet = ReturnType<typeof compileReact>;

export interface StudioTargetCompilation {
  target: StudioOutputTarget;
  status: "generated" | "disabled" | "failed";
  output: StudioGeneratedFileSet | null;
  message: string | null;
}

export function compileStudioTarget(
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
      output: target === "react" ? compileReact(graph) : target === "swiftui" ? compileSwiftUI(graph) : compileWeb(graph),
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
