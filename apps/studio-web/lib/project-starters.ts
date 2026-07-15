import { demoGraph } from "@intentform/proof-report/demo";
import { defaultDeviceConfiguration } from "@intentform/device-registry";
import {
  parseGraph,
  type PlatformTarget,
  type SemanticInterfaceGraph,
  type SemanticNode,
} from "@intentform/semantic-schema";
import type { ProjectType } from "./browser-projects";

export type { ProjectType } from "./browser-projects";

export interface StarterProjectInput {
  name: string;
  audience: string;
  purpose: string;
  projectType: ProjectType;
  targets: Array<Extract<PlatformTarget, "react" | "swiftui" | "expo" | "web">>;
  startFrom?: StarterContent;
  theme?: StarterTheme;
}

export type StarterContent = "empty" | "patterns" | "example";
export type StarterTheme = "light" | "dark" | "both";

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

const lightTokens = {
  colors: {
    "color.accent": "#397461",
    "color.ink": "#181c1a",
    "color.canvas": "#f3f5f1",
    "color.surface": "#fbfcf9",
  },
  spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20, "space.24": 24 },
  radii: { "radius.control": 18, "radius.surface": 28 },
};

const darkTokens = {
  colors: {
    "color.accent": "#72b89f",
    "color.ink": "#f1f6f3",
    "color.canvas": "#111713",
    "color.surface": "#1a231e",
  },
  spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20, "space.24": 24 },
  radii: { "radius.control": 18, "radius.surface": 28 },
};

function starterNode(
  id: string,
  kind: SemanticNode["kind"],
  label: string,
  purpose: string,
  children: SemanticNode[] = [],
): SemanticNode {
  return {
    id,
    kind,
    intent: { purpose, label, importance: kind === "action" ? "primary" : "supporting" },
    layout: {
      ...structuredClone(demoGraph.screens[0]!.nodes[0]!.layout),
      axis: "vertical",
      width: "fill",
      gapToken: "space.16",
      paddingToken: "space.20",
    },
    style: { role: kind === "frame" ? "starter-section" : kind, emphasis: kind === "action" ? "strong" : "quiet" },
    accessibility: { label, live: kind === "status-message" ? "polite" : "off" },
    states: [],
    interactions: [],
    provenance: { author: "system", revision: 0 },
    children,
  };
}

function starterNodes(content: StarterContent, copy: (typeof starterCopy)[ProjectType]): SemanticNode[] {
  const startingPoint = starterNode("home.start", "status-message", copy.nodeLabel, "Mark the canvas starting point");
  if (content === "empty") return [startingPoint];
  const primaryInput = starterNode("home.primary-input", "input", "Primary input", "Capture the first piece of user intent");
  const primaryAction = starterNode("home.primary-action", "action", "Continue", "Advance the primary product workflow");
  if (content === "patterns") return [startingPoint, primaryInput, primaryAction];
  return [starterNode(
    "home.example",
    "frame",
    "First workflow",
    "Provide a complete editable example section",
    [
      starterNode("home.example.title", "text", copy.title, "Explain the first user outcome"),
      primaryInput,
      primaryAction,
      starterNode("home.example.status", "status-message", "Ready for review", "Confirm the example workflow state"),
    ],
  )];
}

export function createStarterGraph(input: StarterProjectInput): SemanticInterfaceGraph {
  if (input.targets.length === 0) throw new Error("Select at least one target compiler.");
  const name = input.name.trim();
  const audience = input.audience.trim();
  const purpose = input.purpose.trim();
  const copy = starterCopy[input.projectType];
  const startFrom = input.startFrom ?? "empty";
  const theme = input.theme ?? "both";
  const expoSlug = name.normalize("NFKD").toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "intentform-project";

  return parseGraph({
    schemaVersion: "0.9.0",
    dependencies: [],
    product: {
      name,
      audience: [audience],
      principles: [copy.principle, `The first interface should ${purpose.toLowerCase()}`],
    },
    tokens: {
      defaultMode: "default",
      activeMode: theme === "dark" ? "dark" : "default",
      modes: {
        default: {
          name: "Light",
          values: lightTokens,
        },
        ...(theme !== "light" ? { dark: { name: "Dark", values: darkTokens } } : {}),
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
      nodes: starterNodes(startFrom, copy).map((node) => input.projectType === "responsive-web" && node.id === "home.start" ? {
        ...node,
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
      } : node),
    }],
    flows: [],
    contracts: [],
    fixtures: [],
  });
}

export function createLumenShowcaseGraph(): SemanticInterfaceGraph {
  const graph = structuredClone(createStarterGraph({
    name: "Aster Sound",
    audience: "Independent artists and curious listeners",
    purpose: "Discover original releases, organize collections, and keep playback within reach",
    projectType: "responsive-web",
    targets: ["react", "swiftui", "expo", "web"],
  }));
  graph.product.principles = [
    "Keep discovery editorial without hiding playback controls",
    "Share one semantic page across desktop, tablet, and phone projections",
    "Use original abstract surfaces instead of licensed music artwork",
  ];
  graph.tokens.modes.evening = {
    name: "Dark",
    values: {
      colors: { "color.accent": "#7c82ff", "color.ink": "#f4f1ff", "color.canvas": "#111117", "color.surface": "#1d1d26" },
      spacing: { "space.8": 8, "space.12": 12, "space.16": 16, "space.20": 20, "space.24": 24 },
      radii: { "radius.control": 16, "radius.surface": 24 },
    },
  };
  graph.tokens.modes.compact = {
    name: "Compact",
    values: {
      colors: { "color.accent": "#5b63e8", "color.ink": "#1c1c27", "color.canvas": "#f2f1f7", "color.surface": "#ffffff" },
      spacing: { "space.8": 6, "space.12": 8, "space.16": 12, "space.20": 16, "space.24": 20 },
      radii: { "radius.control": 12, "radius.surface": 18 },
    },
  };
  graph.components = structuredClone(demoGraph.components.slice(0, 2));
  const seed = graph.screens[0]!.nodes[0]!;
  const node = (
    id: string,
    kind: SemanticNode["kind"],
    label: string,
    children: SemanticNode[] = [],
    layout: Partial<SemanticNode["layout"]> = {},
    states: SemanticNode["states"] = [],
  ): SemanticNode => ({
    ...structuredClone(seed),
    id,
    kind,
    intent: { purpose: `Present ${label.toLowerCase()} in the Aster Sound experience`, label, importance: kind === "action" ? "primary" : "supporting" },
    layout: { ...structuredClone(seed.layout), ...layout },
    style: { role: kind === "shape" ? "abstract-artwork" : kind, emphasis: kind === "action" ? "strong" : "normal" },
    accessibility: { label, live: kind === "status-message" ? "polite" : "off" },
    states,
    interactions: [],
    provenance: { author: "system", revision: 0 },
    children,
  });
  const cover = (id: string, title: string) => node(id, "frame", title, [
    node(`${id}.art`, "shape", `${title} original abstract cover`, [], { height: "fixed", fixedHeight: 180 }),
    node(`${id}.title`, "text", title),
    node(`${id}.artist`, "text", "Aster Editions"),
    node(`${id}.play`, "action", `Play ${title}`),
  ], { width: "fill", height: "hug", paddingTokens: { top: "space.16", right: "space.16", bottom: "space.16", left: "space.16" } });
  graph.screens = [{
    id: "library", title: "Library", purpose: "Browse original releases and playlists", route: "/", nodes: [
      node("library.shell", "frame", "Aster Sound library", [
        node("library.header", "stack", "Responsive library header", [node("library.brand", "text", "ASTER / SOUND"), node("library.search", "input", "Search artists, releases, and playlists")], { axis: "horizontal" }),
        node("library.featured", "grid", "Featured original releases", [cover("library.tidal", "Tidal Memory"), cover("library.glass", "Glass Hours"), cover("library.orbit", "Soft Orbit")], { columns: 3, gridTracks: [1, 1, 1], gap: 20 }),
        node("library.playlists", "list", "Playlist table", [node("library.track.1", "text", "01 · Between Signals · 4:12"), node("library.track.2", "text", "02 · Violet Static · 3:48"), node("library.track.3", "text", "03 · Night Geometry · 5:06")]),
        node("library.player", "frame", "Persistent player · Tidal Memory", [node("library.now", "text", "Now playing · Between Signals"), node("library.pause", "action", "Pause")], { axis: "horizontal", placement: { compact: "persistent-bottom", regular: "persistent-bottom" } }),
      ]),
    ],
  }, {
    id: "collection", title: "Collection", purpose: "Review a saved collection on tablet", route: "/collection", nodes: [
      node("collection.shell", "frame", "Saved collection", [
        node("collection.title", "text", "Collected for late hours"),
        node("collection.grid", "grid", "Saved releases", [cover("collection.one", "Quiet Current"), cover("collection.two", "Mirror Weather")], { gridTracks: [1, 1], columns: 2 }),
        node("collection.empty", "status-message", "No downloaded releases yet. Save one for offline listening.", [], {}, [{ name: "empty" }]),
        node("collection.loading", "status-message", "Refreshing your collection…", [], {}, [{ name: "loading" }]),
      ]),
    ],
  }, {
    id: "player", title: "Discovery player", purpose: "Discover and play an original release on phone", route: "/player", nodes: [
      node("player.safe", "safe-area", "Phone discovery flow", [
        node("player.cover", "shape", "Tidal Memory original generative cover", [], { height: "fixed", fixedHeight: 320 }),
        node("player.title", "text", "Between Signals"),
        node("player.artist", "text", "Aster Editions · Tidal Memory"),
        node("player.controls", "stack", "Playback controls", [node("player.previous", "action", "Previous"), node("player.play", "action", "Play"), node("player.next", "action", "Next")], { axis: "horizontal" }),
        node("player.error", "status-message", "Playback paused. The local file can be retried safely.", [], {}, [{ name: "failed" }]),
        node("player.success", "status-message", "Added to Late Hours.", [], {}, [{ name: "completed" }]),
      ]),
    ],
  }];
  graph.flows = [];
  graph.contracts = [{
    screenId: "collection",
    data: [{ name: "status", type: "status", required: true }],
    events: [],
    visualStates: ["idle", "loading", "empty"],
    fixtures: ["collection.idle", "collection.loading", "collection.empty"],
  }, {
    screenId: "player",
    data: [{ name: "status", type: "status", required: true }],
    events: [],
    visualStates: ["idle", "failed", "completed"],
    fixtures: ["player.idle", "player.failed", "player.completed"],
  }];
  graph.fixtures = [
    { id: "collection.idle", screenId: "collection", state: "idle", data: { status: "idle" } },
    { id: "collection.loading", screenId: "collection", state: "loading", data: { status: "loading" } },
    { id: "collection.empty", screenId: "collection", state: "empty", data: { status: "empty" } },
    { id: "player.idle", screenId: "player", state: "idle", data: { status: "idle" } },
    { id: "player.failed", screenId: "player", state: "failed", data: { status: "failed" } },
    { id: "player.completed", screenId: "player", state: "completed", data: { status: "completed" } },
  ];
  return parseGraph(graph);
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
    id: "aster-sound",
    label: "Aster Sound creator platform",
    summary: "Original music discovery across desktop, iPad, and iPhone with responsive grids, persistent playback, token modes, and verified web/native outputs.",
    projectType: "responsive-web",
    graph: createLumenShowcaseGraph(),
  },
  {
    id: "verdant-pay",
    label: "Adaptive payment flow",
    summary: "Verified sample · three screens, typed fixtures, responsive action placement, failure recovery, and two generated targets.",
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
