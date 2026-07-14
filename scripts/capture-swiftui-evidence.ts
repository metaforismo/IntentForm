import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
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
const artifactRoot = join(process.cwd(), "artifacts/swiftui");
const screenshotPath = "artifacts/swiftui/payment-request-compact.png";
const screenshotAbsolutePath = join(process.cwd(), screenshotPath);
await mkdir(artifactRoot, { recursive: true });

const response = await fetch(axEndpoint, { signal: AbortSignal.timeout(10_000) });
if (!response.ok) throw new Error(`Accessibility endpoint returned HTTP ${response.status}`);
const roots = await response.json() as AccessibilityNode[];

function findNode(nodes: AccessibilityNode[], predicate: (node: AccessibilityNode) => boolean): AccessibilityNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) return node;
    const child = findNode(node.children ?? [], predicate);
    if (child) return child;
  }
}

const app = findNode(roots, (node) => node.type === "Application");
const action = findNode(roots, (node) => node.AXUniqueId === "intentform.payment-request.confirm");
if (!app?.frame) throw new Error("Simulator accessibility tree did not expose the application viewport.");
if (!action?.frame) throw new Error("Simulator accessibility tree did not expose the semantic primary action.");
if (action.type !== "Button" || action.enabled !== true) {
  throw new Error("The semantic primary action is not an enabled native Button.");
}

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

const observation = {
  target: "swiftui" as const,
  screenId: "payment-request",
  viewport: { width: app.frame.width, height: app.frame.height },
  primaryAction: action.frame,
  position: "safe-area-inset",
  screenshotPath,
  graphExpectsPersistent: true,
};
const findings = verifyRenderedPrimaryAction(observation);
if (findings.length > 0) {
  throw new Error(`Native render produced ${findings.length} blocking finding(s).`);
}

const report = {
  generatedAt: new Date().toISOString(),
  simulator,
  accessibilityEndpoint: axEndpoint,
  observation,
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
  verdict: "verified",
};

await writeFile(join(artifactRoot, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({
  viewport: observation.viewport,
  primaryAction: observation.primaryAction,
  accessibilityIdentifier: action.AXUniqueId,
  screenshotSha256: report.screenshot.sha256,
  verdict: report.verdict,
}, null, 2));
