import { demoGraph } from "@intentform/proof-report/demo";
import { defaultDeviceConfiguration } from "@intentform/device-registry";
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
  targets: Array<Extract<PlatformTarget, "react" | "swiftui" | "expo" | "web">>;
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
  "responsive-web": {
    title: "Home",
    nodeLabel: "Shape the first responsive section",
    principle: "Let intrinsic content and declared breakpoints drive the layout",
  },
};

export function createStarterGraph(input: StarterProjectInput): SemanticInterfaceGraph {
  if (input.targets.length === 0) throw new Error("Select at least one target compiler.");
  const name = input.name.trim();
  const audience = input.audience.trim();
  const purpose = input.purpose.trim();
  const copy = starterCopy[input.projectType];
  const expoSlug = name.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "intentform-project";

  return parseGraph({
    schemaVersion: "0.8.0",
    dependencies: [],
    product: {
      name,
      audience: [audience],
      principles: [copy.principle, `The first interface should ${purpose.toLowerCase()}`],
    },
    tokens: {
      defaultMode: "default",
      activeMode: "default",
      modes: {
        default: {
          name: "Default",
          values: {
            colors: {
              "color.accent": "#397461",
              "color.ink": "#181c1a",
              "color.canvas": "#f3f5f1",
              "color.surface": "#fbfcf9",
            },
            spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20, "space.24": 24 },
            radii: { "radius.control": 18, "radius.surface": 28 },
          },
        },
      },
      aliases: {},
      deprecated: {},
      extensions: {},
    },
    assets: [],
    devices: defaultDeviceConfiguration(),
    ...(input.targets.includes("expo") ? {
      expo: {
        strategy: "expo-router",
        sdkVersion: "57.0.0",
        slug: expoSlug,
        scheme: expoSlug,
        defaultRenderStrategy: "universal-react-native",
        developmentBuild: false,
      },
    } : {}),
    ...(input.projectType === "responsive-web" ? {
      web: {
        strategy: "responsive-web",
        defaultFrame: "desktop-browser",
        frames: [
          { id: "mobile-browser", label: "Mobile browser", mode: "browser", width: 390, height: 844 },
          { id: "tablet-browser", label: "Tablet browser", mode: "browser", width: 768, height: 1024 },
          { id: "desktop-browser", label: "Desktop browser", mode: "browser", width: 1440, height: 1000 },
          { id: "fluid-content", label: "Fluid content", mode: "fluid", minWidth: 320, maxWidth: 1600, height: 1000 },
        ],
        breakpoints: [
          { id: "small", label: "Small", minWidth: 0, maxWidth: 767 },
          { id: "medium", label: "Medium", minWidth: 768, maxWidth: 1199 },
          { id: "large", label: "Large", minWidth: 1200 },
        ],
        contentMaxWidth: 1200,
        inlinePaddingToken: "space.20",
      },
    } : {}),
    platforms: [
      { target: "react", enabled: input.targets.includes("react"), capabilities: ["responsive-layout", "aria", "sticky-actions"] },
      { target: "swiftui", enabled: input.targets.includes("swiftui"), capabilities: ["safe-area", "dynamic-type", "native-controls"] },
      ...(input.targets.includes("expo") ? [{ target: "expo" as const, enabled: true, capabilities: ["expo-router", "safe-area", "adaptive-layout", "platform-files"] }] : []),
      ...(input.projectType === "responsive-web" ? [{ target: "web" as const, enabled: input.targets.includes("web"), capabilities: ["semantic-html", "responsive-layout", "intrinsic-grid", "container-queries"] }] : []),
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
        ...(input.projectType === "responsive-web" ? {
          web: {
            display: "grid",
            direction: "column",
            wrap: "wrap",
            position: "static",
            overflowX: "visible",
            overflowY: "visible",
            containerType: "inline-size",
            gridMinColumnWidth: 260,
            gridMaxColumns: 3,
            breakpointOverrides: { large: { gridMinColumnWidth: 320, gridMaxColumns: 4 } },
          },
        } : {}),
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
      targets: ["react", "swiftui", "expo"],
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
      targets: ["react", "swiftui", "expo"],
    }),
  },
];
