import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { demoGraph } from "../packages/proof-report/src/demo.ts";
import { buildProofReport } from "../packages/proof-report/src/index.ts";
import {
  classifyDevice,
  type DeviceClass,
} from "../packages/semantic-schema/src/index.ts";
import { verifyRenderedPrimaryAction } from "../packages/verifier/src/index.ts";

interface AccessibilityNode {
  AXLabel?: string | null;
  AXUniqueId?: string | null;
  AXValue?: string | null;
  children?: AccessibilityNode[];
  enabled?: boolean;
  frame?: { x: number; y: number; width: number; height: number };
  type?: string;
}

const simulator = process.env.INTENTFORM_SIMULATOR_UDID;
if (!simulator) {
  throw new Error("Set INTENTFORM_SIMULATOR_UDID to the booted simulator used by the SwiftUI preview host.");
}

const axEndpoint = process.env.INTENTFORM_SIMULATOR_AX_URL ?? "http://localhost:3100/ax";
const root = process.cwd();
const artifactRoot = join(root, "artifacts/swiftui");
const serveSim = join(root, "node_modules/.bin/serve-sim");
const bottomBandPoints = 64;
const contentSize = process.env.INTENTFORM_NATIVE_CONTENT_SIZE ?? "medium";
const repairedGraph = buildProofReport(demoGraph, { before: "not-run", after: "not-run" }).after.graph;
const primaryPlacement = repairedGraph.screens
  .find((screen) => screen.id === "payment-request")
  ?.nodes.find((node) => node.kind === "primary-action")
  ?.layout.placement;
if (!primaryPlacement) throw new Error("The repaired graph has no payment-request primary placement to verify.");
await mkdir(artifactRoot, { recursive: true });

function findNode(nodes: AccessibilityNode[], predicate: (node: AccessibilityNode) => boolean): AccessibilityNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const child = findNode(node.children ?? [], predicate);
    if (child) return child;
  }
}

async function accessibilityTree(): Promise<AccessibilityNode[]> {
  const endpoint = new URL(axEndpoint);
  endpoint.searchParams.set("observation", Date.now().toString());
  const response = await fetch(endpoint, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Accessibility endpoint returned HTTP ${response.status}`);
  return response.json() as Promise<AccessibilityNode[]>;
}

function rotate(orientation: "portrait" | "landscape_left") {
  const result = spawnSync(serveSim, ["rotate", orientation, "-d", simulator], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `Could not rotate Simulator to ${orientation}.`);
}

async function waitForDeviceClass(expected: DeviceClass): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const roots = await accessibilityTree();
    const app = findNode(roots, (node) => node.type === "Application");
    if (app?.frame && classifyDevice(app.frame) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Simulator did not expose a ${expected} application viewport after rotation.`);
}

async function capture(
  label: "regular" | "compact",
  graphPlacement: "inline" | "persistent-bottom",
) {
  const roots = await accessibilityTree();
  const app = findNode(roots, (node) => node.type === "Application");
  const action = findNode(roots, (node) => node.AXUniqueId === "intentform.payment-request.confirm");
  if (!app?.frame) throw new Error("Simulator accessibility tree did not expose the application viewport.");
  if (!action?.frame) throw new Error("Simulator accessibility tree did not expose the semantic primary action.");
  if (action.type !== "Button" || action.enabled !== true) {
    throw new Error("The semantic primary action is not an enabled native Button.");
  }

  const screenshotPath = `artifacts/swiftui/payment-request-${label}.png`;
  const screenshotAbsolutePath = join(root, screenshotPath);
  await rm(screenshotAbsolutePath, { force: true });
  const screenshot = spawnSync(
    "xcrun",
    ["simctl", "io", simulator, "screenshot", "--mask=black", screenshotAbsolutePath],
    { encoding: "utf8" },
  );
  if (screenshot.error) throw screenshot.error;
  if (screenshot.status !== 0) throw new Error(screenshot.stderr || "simctl screenshot failed");

  const screenshotBytes = await readFile(screenshotAbsolutePath);
  if (screenshotBytes.length < 24 || screenshotBytes.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("Simulator screenshot is not a valid PNG.");
  }

  const viewportBottom = app.frame.y + app.frame.height;
  const actionBottom = action.frame.y + action.frame.height;
  const bottomGap = viewportBottom - actionBottom;
  const position = bottomGap >= 0 && bottomGap <= bottomBandPoints
    ? "viewport-bottom" as const
    : "inline" as const;
  const observation = {
    target: "swiftui" as const,
    screenId: "payment-request",
    viewport: { width: app.frame.width, height: app.frame.height },
    primaryAction: action.frame,
    position,
    screenshotPath,
    graphPlacement,
  };
  const findings = verifyRenderedPrimaryAction(observation);

  return {
    observation,
    deviceClass: classifyDevice(observation.viewport),
    placementDerivation: {
      bottomGap,
      bottomBandPoints,
      rule: "viewport-bottom only when the measured action bottom is inside the viewport's bottom band",
    },
    accessibility: {
      identifier: action.AXUniqueId,
      label: action.AXLabel,
      type: action.type,
      enabled: action.enabled,
    },
    screenshot: {
      path: screenshotPath,
      sha256: createHash("sha256").update(screenshotBytes).digest("hex"),
      pixels: {
        width: screenshotBytes.readUInt32BE(16),
        height: screenshotBytes.readUInt32BE(20),
      },
    },
    findings,
  };
}

let regular: Awaited<ReturnType<typeof capture>> | undefined;
let compact: Awaited<ReturnType<typeof capture>> | undefined;
try {
  rotate("portrait");
  await waitForDeviceClass("regular");
  regular = await capture("regular", primaryPlacement.regular);

  rotate("landscape_left");
  await waitForDeviceClass("compact");
  compact = await capture("compact", primaryPlacement.compact);
} finally {
  rotate("portrait");
}

if (!regular || !compact) throw new Error("Native evidence did not capture both device classes.");
if (regular.deviceClass !== "regular" || regular.observation.position !== "inline") {
  throw new Error("Native regular evidence did not observe the graph's inline placement.");
}
if (compact.deviceClass !== "compact" || compact.observation.position !== "viewport-bottom") {
  throw new Error("Native compact evidence did not independently observe viewport-bottom placement.");
}
if (regular.findings.length > 0 || compact.findings.length > 0) {
  throw new Error(`Native render produced ${regular.findings.length + compact.findings.length} blocking finding(s).`);
}

const report = {
  generatedAt: new Date().toISOString(),
  simulator,
  contentSize,
  accessibilityEndpoint: axEndpoint,
  regular,
  compact,
  verdict: "verified",
};

await writeFile(join(artifactRoot, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  regularViewport: regular.observation.viewport,
  regularPosition: regular.observation.position,
  compactViewport: compact.observation.viewport,
  compactPosition: compact.observation.position,
  compactBottomGap: compact.placementDerivation.bottomGap,
  accessibilityIdentifier: compact.accessibility.identifier,
  screenshotSha256: compact.screenshot.sha256,
  verdict: report.verdict,
}, null, 2));
