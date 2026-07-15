import { demoGraph } from "@intentform/proof-report/demo";
import {
  parseGraph,
  type PlatformTarget,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import type { ProjectType } from "./browser-projects";

export type { ProjectType } from "./browser-projects";

export interface StarterProjectInput {
  name: string;
  audience: string;
  purpose: string;
  projectType: ProjectType;
  targets: Array<Extract<PlatformTarget, "react" | "swiftui">>;
}

const starterCopy: Record<ProjectType, { title: string; nodeLabel: string; principle: string }> = {
  application: {
    title: "Home",
    nodeLabel: "Add the first product state",
    principle: "Keep the primary workflow understandable without implementation language",
  },
  prototype: {
    title: "Concept",
    nodeLabel: "Shape the first testable interaction",
    principle: "Make assumptions explicit and easy to revise",
  },
  "component-library": {
    title: "Component catalog",
    nodeLabel: "Add the first reusable semantic component",
    principle: "Prefer stable semantic roles over page-specific styling",
  },
};

export function createStarterGraph(input: StarterProjectInput): SemanticInterfaceGraph {
  if (input.targets.length === 0) throw new Error("Select at least one target compiler.");
  const name = input.name.trim();
  const audience = input.audience.trim();
  const purpose = input.purpose.trim();
  const copy = starterCopy[input.projectType];

  return parseGraph({
    schemaVersion: "0.1.0",
    product: {
      name,
      audience: [audience],
      principles: [copy.principle, `The first interface should ${purpose.toLowerCase()}`],
    },
    tokens: {
      colors: {
        "color.accent": "#397461",
        "color.ink": "#181c1a",
        "color.canvas": "#f3f5f1",
        "color.surface": "#fbfcf9",
      },
      spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20, "space.24": 24 },
      radii: { "radius.control": 18, "radius.surface": 28 },
    },
    platforms: [
      { target: "react", enabled: input.targets.includes("react"), capabilities: ["responsive-layout", "aria", "sticky-actions"] },
      { target: "swiftui", enabled: input.targets.includes("swiftui"), capabilities: ["safe-area", "dynamic-type", "native-controls"] },
    ],
    components: [],
    screens: [{
      id: "home",
      title: copy.title,
      purpose,
      route: "/",
      nodes: [{
        id: "home.start",
        kind: "status-message",
        intent: {
          purpose: "Mark the blank canvas starting point",
          label: copy.nodeLabel,
          importance: "supporting",
        },
        layout: { axis: "vertical", width: "fill", gapToken: "space.16", paddingToken: "space.20" },
        style: { role: "empty-state", emphasis: "quiet" },
        accessibility: { label: copy.nodeLabel, live: "off" },
        states: [],
        interactions: [],
        provenance: { author: "system", revision: 0 },
      }],
    }],
    flows: [],
    contracts: [],
    fixtures: [],
  });
}

export interface ProjectExample {
  id: string;
  label: string;
  summary: string;
  projectType: ProjectType;
  graph: SemanticInterfaceGraph;
}

export const projectExamples: ProjectExample[] = [
  {
    id: "verdant-pay",
    label: "Adaptive payment flow",
    summary: "Three screens, typed fixtures, responsive action placement, failure recovery, and two generated targets.",
    projectType: "application",
    graph: demoGraph,
  },
  {
    id: "sable-inventory",
    label: "Inventory workspace",
    summary: "A restrained application starter for independent shop operators tracking stock changes.",
    projectType: "application",
    graph: createStarterGraph({
      name: "Sable Inventory",
      audience: "Independent shop operators",
      purpose: "Review stock changes and flag items that need attention",
      projectType: "application",
      targets: ["react", "swiftui"],
    }),
  },
  {
    id: "foundry-mobile-kit",
    label: "Semantic component kit",
    summary: "A portable catalog starting point for shared roles, variants, tokens, and native output.",
    projectType: "component-library",
    graph: createStarterGraph({
      name: "Foundry Mobile Kit",
      audience: "Product designers and mobile engineers",
      purpose: "Document reusable interface intent across web and native products",
      projectType: "component-library",
      targets: ["react", "swiftui"],
    }),
  },
];
