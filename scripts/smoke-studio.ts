import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import AxeBuilder from "@axe-core/playwright";
import { demoGraph } from "../packages/proof-report/src/demo.ts";
import { recordAgentActivity } from "../packages/mcp-server/src/activity.ts";
import { applyHistoryBranchPatch, createHistoryBranch, graphFingerprint } from "../packages/mcp-server/src/history.ts";
import { assertSecurityHeaders, gotoStudio as navigateToStudio, runSmokeScenario } from "./smoke-studio-support.ts";
import { createLargeDocumentGraph } from "./large-document-fixture.ts";

const root = process.cwd();
const studioRoot = join(root, "apps/studio-web");
const remoteOrigin = process.env.STUDIO_ORIGIN?.replace(/\/$/, "");
const origin = remoteOrigin || "http://127.0.0.1:4319";
const demoGraphJson = JSON.stringify(demoGraph);

async function gotoStudio(page: Page, targetOrigin: string, path = "/studio") {
  if (path === "/studio") {
    await page.addInitScript((graphJson: string) => {
      try {
        if (localStorage.getItem("intentform-browser-project-v2-manifest") || localStorage.getItem("intentform-browser-project-v1")) return;
        localStorage.setItem("intentform-browser-project-v1", JSON.stringify({
          version: 1,
          graph: JSON.parse(graphJson),
          savedAt: "2026-07-15T00:00:00.000Z",
          projectType: "application",
          source: "example",
        }));
      } catch {
        // Sandboxed preview frames intentionally have no same-origin storage.
      }
    }, demoGraphJson);
  }
  return navigateToStudio(page, targetOrigin, path);
}
const localTestProjectDir = remoteOrigin ? undefined : mkdtempSync(join(tmpdir(), "intentform-bezel-smoke-"));
let localBezelOption = "";
if (localTestProjectDir) {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X3Y5WQAAAABJRU5ErkJggg==", "base64");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const packId = "fixture.browser";
  const packRoot = join(localTestProjectDir, "bezel-packs", packId);
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(join(localTestProjectDir, "graph.json"), JSON.stringify(demoGraph));
  const localProjectFingerprint = graphFingerprint(demoGraph);
  createHistoryBranch(localTestProjectDir, "agent-copy", demoGraph, localProjectFingerprint, "agent");
  applyHistoryBranchPatch(localTestProjectDir, "agent-copy", {
    id: "smoke-agent-label",
    rationale: "Review an isolated agent label",
    operations: [{ op: "set-label", target: "payment-request.confirm", label: "Confirm securely" }],
  }, localProjectFingerprint, "agent");
  createHistoryBranch(localTestProjectDir, "conflict-copy", demoGraph, localProjectFingerprint, "agent");
  applyHistoryBranchPatch(localTestProjectDir, "conflict-copy", {
    id: "smoke-conflicting-label",
    rationale: "Exercise path-level conflict review",
    operations: [{ op: "set-label", target: "payment-request.confirm", label: "Approve with conflict" }],
  }, localProjectFingerprint, "agent");
  recordAgentActivity(localTestProjectDir, {
    transport: "stdio",
    tool: "intentform_get_graph",
    access: "read",
    outcome: "succeeded",
    durationMs: 4,
  });
  writeFileSync(join(packRoot, "frame.png"), bytes);
  writeFileSync(join(packRoot, "manifest.json"), JSON.stringify({
    format: "intentform-device-bezel-pack",
    version: "1.0.0",
    packId,
    name: "Browser fixture frame",
    publisher: "IntentForm tests",
    revoked: false,
    license: {
      name: "Fixture-only terms",
      sourceUrl: "https://example.test/browser-fixture",
      termsAcknowledgement: "I confirm this inert fixture is used for local browser tests only.",
      redistribution: "local-reference-only",
    },
    profiles: [{
      deviceProfileId: "neutral.phone.compact",
      asset: { fileName: "frame.png", digest, mediaType: "image/png", byteLength: bytes.byteLength, width: 395, height: 707 },
      viewport: { x: 10, y: 20, width: 375, height: 667 },
    }],
  }));
  localBezelOption = `${packId}:${digest}`;
}
const server = remoteOrigin ? undefined : spawn(process.execPath, [join(studioRoot, "node_modules/next/dist/bin/next"), "start"], {
  cwd: studioRoot,
  env: {
    ...process.env,
    OPENAI_API_KEY: "",
    HOSTNAME: "127.0.0.1",
    PORT: "4319",
    INTENTFORM_ENABLE_LOCAL_PROJECT_API: "1",
    INTENTFORM_ENABLE_LOCAL_BEZELS: "1",
    ...(localTestProjectDir ? { INTENTFORM_PROJECT_DIR: localTestProjectDir } : {}),
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server?.stdout?.on("data", (chunk) => { serverOutput += chunk.toString(); });
server?.stderr?.on("data", (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Studio exited before startup:\n${serverOutput}`);
    }
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Studio did not become ready:\n${serverOutput}`);
}

async function launchBrowser(): Promise<Browser> {
  if (!process.env.CI) {
    try {
      return await chromium.launch({ headless: true, channel: "chrome" });
    } catch {
      // Fall through to Playwright's managed Chromium.
    }
  }
  return chromium.launch({ headless: true });
}

async function stopServer(process: ChildProcess) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => process.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (process.exitCode === null) process.kill("SIGKILL");
}

let browser: Browser | undefined;
try {
  await waitForServer();
  browser = await launchBrowser();
  await runSmokeScenario(browser, {
    name: "project launcher onboarding and recovery",
    allowConsoleError: (message) => message.text().includes("status of 409 (Conflict)"),
    run: async (page) => {
      await page.route("**/api/project**", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (request.method() === "GET" && url.searchParams.get("capability") === "1") {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: true }) });
          return;
        }
        if (request.method() === "GET") {
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({
              error: "Project schema 0.0.1 must be migrated to 0.9.0 before it can be opened.",
              migration: {
                status: "migration-required",
                sourceFingerprint: "a".repeat(64),
                fromVersion: "0.0.1",
                toVersion: "0.9.0",
                diagnostics: [{
                  severity: "info",
                  code: "schema.migrated.0.0.1.to.0.1.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.0.1 to 0.1.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.1.0.to.0.2.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.1.0 to 0.2.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.2.0.to.0.3.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.2.0 to 0.3.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.3.0.to.0.4.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.3.0 to 0.4.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.4.0.to.0.5.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.4.0 to 0.5.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.5.0.to.0.6.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.5.0 to 0.6.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.6.0.to.0.7.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.6.0 to 0.7.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.7.0.to.0.8.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.7.0 to 0.8.0.",
                }, {
                  severity: "info",
                  code: "schema.migrated.0.8.0.to.0.9.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.8.0 to 0.9.0.",
                }],
              },
            }),
          });
          return;
        }
        await route.continue();
      });
      const rootResponse = await gotoStudio(page, origin, "/");
      assertSecurityHeaders(rootResponse, "Project launcher");
      await page.getByRole("heading", { name: "Recents", level: 1 }).waitFor();
      await page.getByText("No recent projects", { exact: true }).waitFor();
      await page.keyboard.press("Control+k");
      const projectSearch = page.getByLabel("Search projects");
      await projectSearch.fill("aster original");
      await page.getByRole("button", { name: /Aster Sound/ }).waitFor();
      await page.getByRole("button", { name: /Verdant Pay/ }).waitFor({ state: "detached" });
      await page.getByText(/No recent project matches/).waitFor();
      await page.getByRole("button", { name: "Recents", exact: true }).click();
      await page.getByText("Working examples", { exact: true }).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Examples", exact: true }).click();
      await page.getByText("Projects on this device", { exact: true }).waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Projects", exact: true }).click();
      await projectSearch.fill("");
      await page.getByRole("button", { name: /Verdant Pay/ }).waitFor();
      await page.locator("header").getByRole("button", { name: "Open project" }).click();
      await page.getByText(/Schema 0\.0\.1 needs an atomic update/).waitFor();
      await page.getByRole("button", { name: "Checkpoint and update" }).waitFor();
      await mkdir(join(root, "output/playwright"), { recursive: true });
      await page.screenshot({ path: join(root, "output/playwright/schema-migration-preview.png"), fullPage: true });
      await page.getByRole("button", { name: "Not now" }).click();
      await page.getByText(/Schema 0\.0\.1 needs an atomic update/).waitFor({ state: "detached" });
      await page.screenshot({ path: join(root, "output/playwright/project-launcher-wide.png"), fullPage: true });
      await page.evaluate(() => localStorage.setItem("intentform-theme", "dark"));
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Recents", level: 1 }).waitFor();
      await page.screenshot({ path: join(root, "output/playwright/project-launcher-dark.png"), fullPage: true });
      await page.evaluate(() => localStorage.setItem("intentform-theme", "light"));
      await page.reload({ waitUntil: "networkidle" });

      await page.evaluate(() => localStorage.setItem("intentform-browser-project-v1", "{broken"));
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Recovery needs attention", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await page.getByText("No recent projects", { exact: true }).waitFor();

      const importInput = page.getByLabel("Import IntentForm project");
      await importInput.setInputFiles({
        name: "invalid.intentform.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ schemaVersion: "0.2.0" })),
      });
      await page.getByRole("alert").getByText(/Import failed:/).waitFor();
      await page.getByRole("button", { name: "Dismiss launcher error" }).click();

      const legacyImport = structuredClone(demoGraph) as unknown as Record<string, unknown> & {
        tokens: unknown;
        assets?: unknown;
      };
      legacyImport.schemaVersion = "0.0.1";
      legacyImport.tokens = structuredClone(demoGraph.tokens.modes[demoGraph.tokens.defaultMode]!.values);
      delete legacyImport.assets;
      await importInput.setInputFiles({
        name: "legacy.intentform.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(legacyImport)),
      });
      await page.waitForURL(`${origin}/studio`);
      await page.getByText("Verdant Pay", { exact: true }).first().waitFor();
      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menuitem", { name: "Back to project launcher" }).click();
      await page.waitForURL(`${origin}/`);
      await page.getByRole("button", { name: /Verdant Pay/ }).waitFor();

      await page.getByRole("button", { name: "New file" }).click();
      await page.getByRole("heading", { name: "New project" }).waitFor();
      await page.getByLabel("Project name").fill("Northline Field Notes");
      await page.getByLabel("Primary audience").fill("Distributed research teams");
      await page.getByLabel("First outcome").fill("Review and organize field observations");
      await page.getByLabel("SwiftUI").uncheck();
      await page.getByLabel("Starter").selectOption("example");
      await page.getByLabel("Theme").selectOption("dark");
      await page.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(`${origin}/studio`);
      await page.getByText("Northline Field Notes", { exact: true }).first().waitFor();
      await page.getByTestId("canvas-node-home.example").waitFor();
      const createdTheme = await page.evaluate(() => {
        const manifest = JSON.parse(localStorage.getItem("intentform-browser-project-v2-manifest") ?? "null") as { generation?: string; chunkCount?: number } | null;
        if (!manifest?.generation || !manifest.chunkCount) return null;
        const source = Array.from({ length: manifest.chunkCount }, (_, index) => localStorage.getItem(`intentform-browser-project-v2-chunk:${manifest.generation}:${String(index).padStart(3, "0")}`) ?? "").join("");
        const project = JSON.parse(source) as { graph?: { tokens?: { activeMode?: string; modes?: Record<string, unknown> } } };
        return { activeMode: project.graph?.tokens?.activeMode, modes: Object.keys(project.graph?.tokens?.modes ?? {}) };
      });
      if (createdTheme?.activeMode !== "dark" || !createdTheme.modes.includes("dark")) throw new Error("Dark starter theme was not persisted");

      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menuitem", { name: "Back to project launcher" }).click();
      await page.waitForURL(`${origin}/`);
      await page.getByText("Northline Field Notes", { exact: true }).waitFor();
      await page.getByRole("button", { name: /Northline Field Notes/ }).waitFor();

      await page.setViewportSize({ width: 375, height: 667 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`Compact project launcher has ${overflow}px horizontal overflow`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(root, "output/playwright/project-launcher-compact.png"), fullPage: true });
      await page.getByRole("button", { name: "Examples", exact: true }).click();
      await page.getByRole("button", { name: /Verdant Pay/ }).click();
      await page.waitForURL(`${origin}/studio`);
      await page.getByTestId("canvas-node-home.balance").waitFor();
      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menu").getByText("Verdant Pay", { exact: true }).waitFor();
    },
  });

  if (!remoteOrigin) await runSmokeScenario(browser, {
    name: "local bezel pack acknowledgement and neutral fallback",
    run: async (page) => {
      await gotoStudio(page, origin, "/");
      const openLocal = page.locator("header").getByRole("button", { name: "Open project" });
      await openLocal.waitFor();
      await openLocal.click();
      await page.waitForURL(`${origin}/studio`);
      const bezelSelect = page.getByLabel("Device bezel");
      await bezelSelect.waitFor();
      // The canvas camera settles after opening a local project. Measure both
      // states outside that transition so this remains a geometry assertion,
      // not an animation-timing assertion.
      await page.waitForTimeout(450);
      const contentBefore = await page.getByTestId("device-content").boundingBox();
      await bezelSelect.selectOption(localBezelOption);
      if (await bezelSelect.inputValue() !== localBezelOption) throw new Error("Pending local bezel terms were not retained for review");
      if (await page.getByTestId("local-device-bezel").count() !== 0) throw new Error("Unacknowledged local bezel selection was rendered");
      const termsLink = page.getByRole("link", { name: "Review terms" });
      if (await termsLink.getAttribute("href") !== "https://example.test/browser-fixture") throw new Error("Selected bezel terms were not linked to their manifest source");
      await page.getByLabel("Acknowledge local bezel license").check();
      const overlay = page.getByTestId("local-device-bezel");
      await overlay.waitFor();
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-testid="local-device-bezel"]');
        return image?.complete === true && (image.naturalWidth ?? 0) > 0;
      });
      await page.waitForTimeout(450);
      const contentWithBezel = await page.getByTestId("device-content").boundingBox();
      if (!contentBefore || !contentWithBezel
        || Math.abs(contentBefore.x - contentWithBezel.x) > 0.1
        || Math.abs(contentBefore.y - contentWithBezel.y) > 0.1
        || Math.abs(contentBefore.width - contentWithBezel.width) > 0.1
        || Math.abs(contentBefore.height - contentWithBezel.height) > 0.1) {
        throw new Error(`Local bezel presentation changed semantic content geometry: before=${JSON.stringify(contentBefore)} after=${JSON.stringify(contentWithBezel)}`);
      }
      await bezelSelect.selectOption("");
      await overlay.waitFor({ state: "detached" });
      await mkdir(join(root, "output/playwright"), { recursive: true });
      await page.screenshot({ path: join(root, "output/playwright/local-bezel-neutral-fallback.png"), fullPage: true });

      await page.getByRole("button", { name: "Native outputs" }).click();
      const evidencePanel = page.getByRole("region", { name: "Continuous local evidence" });
      await evidencePanel.getByText("saved graph", { exact: true }).waitFor();
      const agentPanel = page.getByRole("region", { name: "Agent access" });
      await agentPanel.getByText("least authority", { exact: true }).waitFor();
      await agentPanel.getByText("No shell · no network", { exact: true }).waitFor();
      await agentPanel.getByText("get graph", { exact: true }).waitFor();
      await agentPanel.getByText("succeeded", { exact: true }).waitFor();
      const historyPanel = page.getByRole("region", { name: "History & branches" });
      await historyPanel.getByText("history valid", { exact: true }).waitFor();
      await historyPanel.getByTestId("history-branch-agent-copy").waitFor();
      await historyPanel.getByTestId("history-branch-agent-copy").getByRole("button", { name: "Preview", exact: true }).click();
      await historyPanel.getByRole("button", { name: "Merge 1 changes" }).waitFor();
      await historyPanel.getByRole("button", { name: "Merge 1 changes" }).click();
      await historyPanel.getByText("merge branch agent-copy", { exact: true }).waitFor();
      await historyPanel.getByTestId("history-branch-conflict-copy").getByRole("button", { name: "Preview", exact: true }).click();
      await historyPanel.getByTestId("history-merge-conflicts").getByText(/both-modified.*intent\.label/).waitFor();
      const browserPreview = evidencePanel.locator('[data-preview-target="browser"]');
      await browserPreview.getByRole("button", { name: "Start" }).click();
      await browserPreview.getByText("fresh · ready", { exact: true }).waitFor({ timeout: 30_000 });
      await page.screenshot({ path: join(root, "output/playwright/continuous-preview-evidence.png"), fullPage: true });
      await page.getByRole("button", { name: "Verification" }).click();
      await page.getByText("Passed", { exact: true }).first().waitFor();
    },
  });

  if (!remoteOrigin) await runSmokeScenario(browser, {
    name: "truthful local save state and save-race protection",
    run: async (page) => {
      await gotoStudio(page, origin, "/");
      await page.locator("header").getByRole("button", { name: "Open project" }).click();
      await page.waitForURL(`${origin}/studio`);
      await page.getByTestId("layer-payment-request.confirm").click();
      const label = page.getByTestId("semantic-inspector").getByLabel("Label", { exact: true });
      const unsaved = page.locator('[aria-label="Unsaved local changes"]');
      if (await unsaved.count() !== 0) throw new Error("A freshly opened local graph was marked unsaved");

      await label.fill("Save state smoke");
      await label.press("Enter");
      await unsaved.waitFor();
      const dirtyUnloadWasCancelled = await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        return !window.dispatchEvent(event);
      });
      if (!dirtyUnloadWasCancelled) throw new Error("Unsaved local changes did not install unload protection");

      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menuitem", { name: "Save to local project" }).click();
      await unsaved.waitFor({ state: "detached" });

      await label.fill("Captured save");
      await label.press("Enter");
      await page.route("**/api/project", async (route) => {
        if (route.request().method() !== "PUT") { await route.continue(); return; }
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.continue();
      });
      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menuitem", { name: "Save to local project" }).click();
      await label.fill("Newer unsaved edit");
      await label.press("Enter");
      await page.getByRole("button", { name: "Show workspace status" }).click();
      await page.getByRole("status").getByText(/Saved the captured graph revision atomically; newer Studio edits remain unsaved/).waitFor();
      await unsaved.waitFor();
      await page.unroute("**/api/project");

      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menuitem", { name: "Save to local project" }).click();
      await unsaved.waitFor({ state: "detached" });
      const cleanUnloadWasCancelled = await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        return !window.dispatchEvent(event);
      });
      if (cleanUnloadWasCancelled) throw new Error("Unload protection remained after the local graph was saved");
    },
  });

  await runSmokeScenario(browser, {
    name: "Expo Adaptive project compiler",
    run: async (page) => {
      await gotoStudio(page, origin, "/");
      await page.getByRole("button", { name: "New file" }).click();
      await page.getByLabel("Project name").fill("Trail Ledger");
      await page.getByLabel("Primary audience").fill("Field operations teams");
      await page.getByLabel("First outcome").fill("Record a verified field observation");
      const expoTarget = page.getByRole("checkbox", { name: "Expo Adaptive" });
      if (!await expoTarget.isChecked()) throw new Error("Expo Adaptive was not enabled for a new native project");
      await page.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(`${origin}/studio`);
      await page.getByTestId("canvas-node-home.start").waitFor();
      const renderStrategy = page.getByLabel("Render strategy");
      if (await renderStrategy.inputValue() !== "universal-react-native") {
        throw new Error("New Expo nodes did not inherit the universal React Native strategy");
      }
      await renderStrategy.selectOption("platform-native");
      const adapterId = page.getByLabel("Adapter ID");
      await adapterId.waitFor();
      if (await adapterId.inputValue() !== "intent.status-message") {
        throw new Error("Platform-native strategy did not create a deterministic adapter ID");
      }

      await page.getByRole("button", { name: "Native outputs" }).click();
      const outputTargets = page.getByRole("group", { name: "Output target" });
      await outputTargets.getByRole("button", { name: "expo" }).click();
      await page.getByText("Expo Adaptive semantic preview", { exact: true }).waitFor();
      await page.getByRole("button", { name: "intentform.expo.json" }).click();
      const manifest = await page.locator("code").textContent();
      if (!manifest?.includes('"sdkVersion": "57.0.0"')
        || !manifest.includes('"strategy": "platform-native"')
        || !manifest.includes('"intent.status-message"')) {
        throw new Error("Expo manifest omitted SDK, node strategy, or adapter ownership");
      }
      await page.getByRole("button", { name: "intent-dot-status-dash-message.ios.tsx" }).click();
      const adapter = await page.locator("code").textContent();
      if (!adapter?.includes("borderRadius: 16") || !adapter.includes("return fallback")) {
        throw new Error("Generated iOS adapter omitted its platform specialization or universal fallback");
      }
      await page.getByRole("button", { name: "index.tsx" }).click();
      const route = await page.locator("code").textContent();
      if (!route?.includes('<Stack.Screen options={{ title: "Home" }} />')) {
        throw new Error("Expo Router output did not use the semantic screen title");
      }
      await mkdir(join(root, "output/playwright"), { recursive: true });
      await page.screenshot({ path: join(root, "output/playwright/expo-adaptive-output.png"), fullPage: true });
    },
  });

  await runSmokeScenario(browser, {
    name: "responsive web project compiler",
    run: async (page) => {
      await gotoStudio(page, origin, "/");
      await page.getByRole("button", { name: "New file" }).click();
      const responsiveWebType = page.getByRole("radio", { name: /Responsive web/ });
      await page.getByText("Responsive web", { exact: true }).first().click();
      if (!await responsiveWebType.isChecked()) throw new Error("Responsive-web project type could not be selected");
      await page.getByLabel("Project name").fill("Northline Journal");
      await page.getByLabel("Primary audience").fill("Field researchers");
      await page.getByLabel("First outcome").fill("Publish observations across browser widths");
      await page.getByLabel("React").uncheck();
      await page.getByLabel("SwiftUI").uncheck();
      if (!await page.getByRole("checkbox", { name: "Responsive web" }).isChecked()) {
        throw new Error("Responsive-web compiler target was not enabled by default");
      }
      await page.getByRole("button", { name: "Create project" }).click();
      await page.waitForURL(`${origin}/studio`);
      await page.getByText("Northline Journal", { exact: true }).first().waitFor();
      await page.getByLabel("Preview device").selectOption("web:desktop-browser");
      const frame = page.getByTestId("device-frame");
      if (await frame.getAttribute("data-breakpoint") !== "regular") throw new Error("Desktop web frame did not resolve to the regular layout class");
      await page.getByRole("heading", { name: "Responsive web" }).waitFor();
      await page.getByRole("group", { name: "Display" }).waitFor();
      if (await page.getByTestId("web-breakpoint-overrides").locator("select").count() !== 3) {
        throw new Error("Responsive-web breakpoint controls did not reflect the project profile");
      }
      await page.getByRole("button", { name: "Native outputs" }).click();
      const outputTargets = page.getByRole("group", { name: "Output target" });
      if (await outputTargets.getByRole("button", { name: "web" }).getAttribute("aria-pressed") !== "true") {
        throw new Error("Responsive-web projects did not open their dedicated output target");
      }
      await page.getByTestId("responsive-web-preview").waitFor();
      await page.getByRole("button", { name: "styles.css" }).click();
      const css = await page.locator("code").textContent();
      if (!css?.includes("grid-template-columns: repeat(auto-fit, minmax(") || !css.includes("@media (min-width: 1200px)")) {
        throw new Error("Responsive-web output omitted intrinsic grid or declared breakpoint CSS");
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`Responsive-web Studio has ${overflow}px horizontal overflow`);
      await mkdir(join(root, "output/playwright"), { recursive: true });
      await page.screenshot({ path: join(root, "output/playwright/responsive-web-output.png"), fullPage: true });
      await page.getByRole("button", { name: "Toggle color theme" }).click();
      if (await page.locator("html[data-theme='dark']").count() !== 1) throw new Error("Responsive-web workspace did not enter dark mode");
      await page.screenshot({ path: join(root, "output/playwright/responsive-web-output-dark.png"), fullPage: true });
    },
  });

  await runSmokeScenario(browser, {
    name: "desktop editor and active runtime",
    run: async (page) => {
      await gotoStudio(page, origin);

      const workspaceStatus = page.getByRole("button", { name: "Show workspace status" });
      await workspaceStatus.click();
      await page.getByRole("status").waitFor();

      const ecosystemTrigger = page.getByRole("button", { name: "Open ecosystem status" });
      await ecosystemTrigger.click();
      const ecosystemDialog = page.getByRole("dialog", { name: "Packages and collaboration" });
      await ecosystemDialog.getByText("Sync disabled", { exact: true }).waitFor();
      await ecosystemDialog.getByText("0 locked packages", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await ecosystemDialog.waitFor({ state: "detached" });
      const ecosystemReturnFocus = await page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
      if (ecosystemReturnFocus !== "Open ecosystem status" && ecosystemReturnFocus !== "Show workspace status") {
        throw new Error(`Ecosystem dialog returned focus to an unexpected control (${ecosystemReturnFocus ?? "none"})`);
      }
      await workspaceStatus.click();

      await page.keyboard.press("Control+k");
      await page.getByRole("dialog", { name: "Command menu" }).waitFor();
      await page.getByLabel("Search commands").fill("preview");
      await page.getByRole("button", { name: "Enter preview mode" }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Command menu" }).waitFor({ state: "detached" });

      const previewMode = page.getByRole("button", { name: "Toggle preview mode" });
      await previewMode.click();
      if (await page.locator("[data-preview-mode='true']").count() !== 1 || await previewMode.getAttribute("aria-pressed") !== "true") {
        throw new Error("Preview mode did not hide editor selection behavior");
      }
      await previewMode.click();

      await page.keyboard.press("Alt+l");
      const desktopLayersTrigger = page.getByRole("button", { name: "Open pages and layers" });
      await desktopLayersTrigger.waitFor();
      await desktopLayersTrigger.click();
      await page.getByTestId("layer-payment-request.amount").waitFor();
      const layerSearch = page.getByLabel("Search layers");
      await layerSearch.fill("Recipient");
      await page.getByTestId("layer-payment-request.recipient").waitFor();
      if (await page.getByTestId("layer-payment-request.amount").count() !== 0) {
        throw new Error("Layer search did not filter non-matching semantic nodes");
      }
      await page.getByRole("button", { name: "Clear layer search" }).click();
      await page.getByRole("button", { name: "Layout lab 20", exact: true }).click();
      const adaptiveLayer = page.getByTestId("layer-layout-lab.adaptive");
      const nestedGridLayer = page.getByTestId("layer-layout-lab.grid");
      const nestedLeafLayer = page.getByTestId("layer-layout-lab.grid-a");
      await nestedLeafLayer.waitFor();
      const indentation = await Promise.all([adaptiveLayer, nestedGridLayer, nestedLeafLayer].map((locator) =>
        locator.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingLeft)),
      ));
      if (!(indentation[0]! < indentation[1]! && indentation[1]! < indentation[2]!)) {
        throw new Error(`Recursive layer indentation is not increasing (${indentation.join(", ")})`);
      }
      await nestedLeafLayer.click();
      await page.getByTestId("semantic-inspector").getByText("layout-lab.grid-a", { exact: true }).waitFor();
      if (await page.getByTestId("canvas-node-layout-lab.grid-a").getAttribute("data-node-selected") !== "true") {
        throw new Error("Selecting a nested layer did not surface its canvas selection");
      }
      const selectionOverlay = page.getByTestId("selection-overlay");
      await selectionOverlay.waitFor();
      if (await selectionOverlay.getAttribute("data-selection-count") !== "1"
        || await selectionOverlay.getAttribute("data-selection-ids") !== "layout-lab.grid-a") {
        throw new Error("Nested selection did not create a single deterministic selection overlay");
      }
      const layoutInspector = page.getByTestId("semantic-inspector");
      await layoutInspector.getByTestId("padding-side-controls").waitFor();
      await layoutInspector.getByTestId("grid-placement-controls").waitFor();
      const growField = layoutInspector.getByLabel("Grow");
      await growField.fill("2");
      await growField.press("Enter");
      await page.waitForFunction(() => getComputedStyle(document.querySelector<HTMLElement>('[data-testid="canvas-node-layout-lab.grid-a"]')!).flexGrow === "2");
      await page.getByRole("button", { name: "Undo" }).click();
      const gridRowField = layoutInspector.getByLabel("Grid row");
      await gridRowField.fill("2");
      await gridRowField.press("Enter");
      await page.waitForFunction(() => getComputedStyle(document.querySelector<HTMLElement>('[data-testid="canvas-node-layout-lab.grid-a"]')!).gridRowStart === "2");
      await page.getByRole("button", { name: "Undo" }).click();
      const resizeHandles = selectionOverlay.locator('button[aria-label^="Resize selected layer "]');
      const resizeHandleCount = await resizeHandles.count();
      if (resizeHandleCount !== 8) {
        throw new Error(`Single selection exposed ${resizeHandleCount} resize handles instead of eight`);
      }
      if (await selectionOverlay.getByTestId("selection-dimension-hud").getAttribute("hidden") === null) {
        throw new Error("Selection dimension HUD is not idle-hidden");
      }
      const additiveSelectionModifier = process.platform === "darwin" ? "Meta" : "Control";
      await page.getByTestId("layer-layout-lab.grid-b").click({ modifiers: [additiveSelectionModifier] });
      await page.waitForFunction(() => document.querySelector('[data-testid="selection-overlay"]')?.getAttribute("data-selection-count") === "2");
      await page.getByTestId("multi-selection-inspector").getByText("2 layers selected", { exact: true }).waitFor();
      if (await selectionOverlay.locator('button[aria-label^="Resize selected layer "]').count() !== 0
        || await selectionOverlay.getByRole("button", { name: /Group|Duplicate|Delete/ }).count() !== 0) {
        throw new Error("Multi-selection retained per-node resize handles or the deprecated action capsule");
      }
      await page.getByRole("button", { name: "Group selected layers", exact: true }).click();
      await page.getByTestId("layer-layout-lab.group-1").waitFor();
      if (await page.getByTestId("canvas-node-layout-lab.group-1").getAttribute("data-node-selected") !== "true") {
        throw new Error("Grouping did not select the committed semantic container");
      }
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("layer-layout-lab.group-1").waitFor({ state: "detached" });
      await nestedLeafLayer.click();
      await page.waitForFunction(() => document.querySelector('[data-testid="selection-overlay"]')?.getAttribute("data-selection-ids") === "layout-lab.grid-a");

      const gridLayer = page.getByTestId("layer-layout-lab.grid");
      await gridLayer.getByRole("button", { name: /^Collapse / }).click();
      await nestedLeafLayer.waitFor({ state: "detached" });
      await gridLayer.getByRole("button", { name: /^Expand / }).click();
      await nestedLeafLayer.waitFor();
      const lockLeaf = nestedLeafLayer.getByRole("button", { name: /^Lock / });
      await lockLeaf.click();
      if (await nestedLeafLayer.getAttribute("draggable") !== "false") {
        throw new Error("Locked nested layer remained draggable");
      }
      await nestedLeafLayer.getByRole("button", { name: /^Unlock / }).click();
      const hideLeaf = nestedLeafLayer.getByRole("button", { name: /^Hide / });
      await hideLeaf.click();
      await page.getByTestId("canvas-node-layout-lab.grid-a").waitFor({ state: "detached" });
      await nestedLeafLayer.getByRole("button", { name: /^Show / }).click();
      await page.getByTestId("canvas-node-layout-lab.grid-a").waitFor();

      await nestedLeafLayer.dragTo(page.getByTestId("layer-layout-lab.overlay"), {
        targetPosition: { x: 90, y: 14 },
      });
      await page.waitForFunction(() => document.querySelector('[data-container-id="layout-lab.overlay"]')
        ?.querySelector('[data-testid="canvas-node-layout-lab.grid-a"]'));
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForFunction(() => document.querySelector('[data-container-id="layout-lab.grid"]')
        ?.querySelector('[data-testid="canvas-node-layout-lab.grid-a"]'));
      await nestedLeafLayer.click();

      const moveHandle = page.getByRole("button", { name: "Move selected layer", exact: true });
      const moveBox = await moveHandle.boundingBox();
      const gridBBox = await page.getByTestId("canvas-node-layout-lab.grid-b").boundingBox();
      if (!moveBox || !gridBBox) throw new Error("Direct reorder handles have no browser geometry");
      await page.mouse.move(moveBox.x + moveBox.width / 2, moveBox.y + moveBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(gridBBox.x + gridBBox.width / 2, gridBBox.y + gridBBox.height + 8, { steps: 5 });
      await page.mouse.up();
      await page.waitForFunction(() => {
        const container = document.querySelector('[data-container-id="layout-lab.grid"]');
        return [...(container?.children ?? [])].map((child) => child.getAttribute("data-testid"))
          .slice(0, 2).join("|") === "canvas-node-layout-lab.grid-b|canvas-node-layout-lab.grid-a";
      });
      await page.getByRole("button", { name: "Undo" }).click();
      await page.waitForFunction(() => {
        const container = document.querySelector('[data-container-id="layout-lab.grid"]');
        return [...(container?.children ?? [])].map((child) => child.getAttribute("data-testid"))
          .slice(0, 2).join("|") === "canvas-node-layout-lab.grid-a|canvas-node-layout-lab.grid-b";
      });

      const resizeHandle = page.getByRole("button", { name: "Resize selected layer southeast", exact: true });
      const resizeBox = await resizeHandle.boundingBox();
      if (!resizeBox) throw new Error("Resize handle has no browser geometry");
      await page.mouse.move(resizeBox.x + resizeBox.width / 2, resizeBox.y + resizeBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(resizeBox.x + resizeBox.width / 2 + 36, resizeBox.y + resizeBox.height / 2 + 24, { steps: 5 });
      await page.mouse.up();
      await page.getByLabel("Fixed width").waitFor();
      const committedWidth = Number(await page.getByLabel("Fixed width").inputValue());
      const committedHeight = Number(await page.getByLabel("Fixed height").inputValue());
      if (!Number.isFinite(committedWidth) || !Number.isFinite(committedHeight)
        || committedWidth % 8 !== 0 || committedHeight % 8 !== 0) {
        throw new Error(`Resize did not commit snapped semantic dimensions (${committedWidth} × ${committedHeight})`);
      }
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByLabel("Fixed width").waitFor({ state: "detached" });

      await page.keyboard.press("Escape");
      await page.getByTestId("canvas-node-layout-lab.grid-a").dblclick();
      const textEditor = page.getByLabel("Edit layer text");
      await textEditor.waitFor();
      await textEditor.dispatchEvent("compositionstart", { data: "مرحبا" });
      await textEditor.fill("مرحبا 👩🏽‍💻\ncafé");
      await textEditor.dispatchEvent("compositionend", { data: "مرحبا" });
      await page.keyboard.press("Control+Enter");
      await page.getByTestId("canvas-node-layout-lab.grid-a").getByText(/مرحبا 👩🏽‍💻/).waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("canvas-node-layout-lab.grid-a").getByText("Grid A", { exact: true }).waitFor();
      await nestedLeafLayer.click();
      await page.getByRole("button", { name: "Move selected layer", exact: true }).focus();
      await page.keyboard.press("Enter");
      await textEditor.fill("This edit must be cancelled");
      await page.keyboard.press("Escape");
      await textEditor.waitFor({ state: "detached" });
      await page.getByTestId("canvas-node-layout-lab.grid-a").getByText("Grid A", { exact: true }).waitFor();

      await page.keyboard.press("Control+k");
      await page.getByLabel("Search commands").fill("Copy selected layer");
      await page.getByRole("button", { name: "Copy selected layer", exact: true }).click();
      await page.getByTestId("layer-layout-lab.overlay").click();
      await page.keyboard.press("Control+k");
      await page.getByLabel("Search commands").fill("Paste");
      await page.getByRole("button", { name: "Paste", exact: true }).click();
      await page.getByTestId("layer-layout-lab.grid-a-copy").waitFor();
      await page.waitForFunction(() => document.querySelector('[data-container-id="layout-lab.overlay"]')
        ?.querySelector('[data-testid="canvas-node-layout-lab.grid-a-copy"]'));
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("layer-layout-lab.grid-a-copy").waitFor({ state: "detached" });

      await page.getByTestId("layer-layout-lab.grid-b").click();
      await page.keyboard.press("Shift+Control+r");
      await page.getByTestId("layer-layout-lab.grid-b").waitFor({ state: "detached" });
      await page.getByTestId("layer-layout-lab.grid-a-copy").waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("layer-layout-lab.grid-b").waitFor();

      await nestedLeafLayer.click();
      await page.getByTestId("semantic-inspector").getByRole("button", { name: "Strong", exact: true }).click();
      await page.keyboard.press("Control+k");
      await page.getByLabel("Search commands").fill("Copy styles");
      await page.getByRole("button", { name: "Copy styles", exact: true }).click();
      await page.getByTestId("layer-layout-lab.grid-b").click();
      await page.keyboard.press("Control+k");
      await page.getByLabel("Search commands").fill("Paste styles");
      await page.getByRole("button", { name: "Paste styles", exact: true }).click();
      if (await page.getByTestId("semantic-inspector").getByRole("button", { name: "Strong", exact: true }).getAttribute("aria-pressed") !== "true") {
        throw new Error("Style clipboard did not apply the copied semantic emphasis");
      }
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByRole("button", { name: "Undo" }).click();

      await page.getByTestId("layer-layout-lab.overlay").click();
      await page.evaluate(() => {
        const data = new DataTransfer();
        data.setData("text/html", '<style>p{color:red}</style><p dir="rtl">نص <strong>آمن</strong> 🌍</p><script>alert(1)</script>');
        window.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
      });
      await page.getByTestId("layer-layout-lab.pasted-text").waitFor();
      await page.getByRole("status").getByText(/Pasted HTML as safe text; unsupported markup and styles were ignored/i).waitFor();
      await page.getByTestId("canvas-node-layout-lab.pasted-text").getByText("نص آمن 🌍", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("layer-layout-lab.pasted-text").waitFor({ state: "detached" });

      const adaptivePreview = page.getByTestId("canvas-node-layout-lab.adaptive").locator('[data-container-id="layout-lab.adaptive"]');
      if (await adaptivePreview.getAttribute("data-layout-mode") !== "stack") {
        throw new Error("Compact canvas did not resolve the shared adaptive mode to stack");
      }
      await page.getByLabel("Preview device").selectOption("device:neutral.phone.regular");
      if (await adaptivePreview.getAttribute("data-layout-mode") !== "grid") {
        throw new Error("Regular canvas did not resolve the shared adaptive mode to grid");
      }
      await page.getByLabel("Preview device").selectOption("device:neutral.phone.compact");
      await nestedGridLayer.click();
      await page.getByRole("button", { name: "Duplicate layer" }).click();
      await page.getByTestId("layer-layout-lab.grid-copy").waitFor();
      await page.getByTestId("layer-layout-lab.grid-a-copy").waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("layer-layout-lab.grid-copy").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Request payment 4", exact: true }).click();
      await page.getByTestId("layer-payment-request.amount").click();
      await page.getByRole("button", { name: "Duplicate layer" }).click();
      await page.getByTestId("layer-payment-request.amount-copy").waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("layer-payment-request.amount-copy").waitFor({ state: "detached" });
      await page.getByRole("button", { name: "Close design inspector" }).click();
      const desktopInspectorTrigger = page.getByRole("button", { name: "Open design inspector" });
      await desktopInspectorTrigger.waitFor();
      await desktopInspectorTrigger.click();
      await page.getByTestId("semantic-inspector").waitFor();
      const railSeparator = page.getByRole("separator", { name: "Resize pages and layers panel" });
      const railWidth = Number(await railSeparator.getAttribute("aria-valuenow"));
      await railSeparator.focus();
      await page.keyboard.press("ArrowRight");
      if (Number(await railSeparator.getAttribute("aria-valuenow")) !== railWidth + 12) {
        throw new Error("Keyboard panel resize did not update the pages and layers width");
      }
      await page.keyboard.press("ArrowLeft");

      const moveRequestScreen = page.getByRole("button", { name: "Move screen Request payment up" });
      await moveRequestScreen.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("button", { name: "Undo" }).click();

      if (await page.getByTestId("canvas-node-payment-request.failure").count() !== 0) {
        throw new Error("Idle canvas rendered a node bound only to the failed visual state");
      }
      if (await page.getByTestId("layer-payment-request.failure").getAttribute("data-state-visible") !== "false") {
        throw new Error("Layers panel did not expose state-bound visibility");
      }
      await page.getByLabel("Visual state").selectOption("failed");
      await page.getByTestId("canvas-node-payment-request.failure").waitFor();
      await page.getByTestId("fixture-editor").waitFor();
      const recipientFixture = page.getByLabel("Fixture recipientName");
      await recipientFixture.fill("Elena Serra");
      await recipientFixture.press("Enter");
      await page.getByTestId("canvas-node-payment-request.recipient").getByText("Elena Serra", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("canvas-node-payment-request.recipient").getByText("Mara Rinaldi", { exact: true }).waitFor();
      await page.getByLabel("Visual state").selectOption("idle");
      await page.getByTestId("canvas-node-payment-request.failure").waitFor({ state: "detached" });

      await page.getByLabel("Preview device").selectOption("device:neutral.phone.regular");
      if (await page.getByTestId("device-frame").getAttribute("data-breakpoint") !== "regular") {
        throw new Error("Device profile did not switch the semantic preview breakpoint");
      }
      if (await page.getByTestId("device-frame").getAttribute("data-safe-area") !== "59,0,34,0") {
        throw new Error("Device frame did not expose registry-owned safe-area geometry");
      }
      await page.getByTestId("device-cutout-sensor-island").waitFor();
      // Device changes animate frame size and camera fit; compare chrome states
      // only after that presentation transition reaches its settled geometry.
      await page.waitForTimeout(450);
      const contentWithChrome = await page.getByTestId("device-content").boundingBox();
      await page.getByRole("button", { name: "Toggle device chrome" }).click();
      await page.getByTestId("device-cutout-sensor-island").waitFor({ state: "detached" });
      const contentWithoutChrome = await page.getByTestId("device-content").boundingBox();
      if (!contentWithChrome || !contentWithoutChrome
        || Math.abs(contentWithChrome.x - contentWithoutChrome.x) > 0.1
        || Math.abs(contentWithChrome.y - contentWithoutChrome.y) > 0.1
        || Math.abs(contentWithChrome.width - contentWithoutChrome.width) > 0.1
        || Math.abs(contentWithChrome.height - contentWithoutChrome.height) > 0.1) {
        throw new Error(`Presentation chrome changed logical device content geometry (${JSON.stringify(contentWithChrome)} vs ${JSON.stringify(contentWithoutChrome)})`);
      }
      await page.getByRole("button", { name: "Toggle device chrome" }).click();
      await page.getByRole("button", { name: "Verification" }).click();
      const regularScenario = page.getByRole("button", { name: "Neutral regular phone", exact: true });
      if (await regularScenario.getAttribute("aria-pressed") !== "true") {
        throw new Error("Verification did not inherit the active canvas device");
      }
      await page.getByText("402 × 874", { exact: true }).waitFor();
      await page.getByText("Build evidence pending", { exact: true }).waitFor();
      await page.getByText("Not run for this graph", { exact: true }).waitFor();
      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menuitem", { name: "Proof report" }).click();
      await page.getByRole("heading", { name: "Source generated. Build evidence is still pending." }).waitFor();
      await page.getByRole("button", { name: "Design canvas" }).click();
      if (await page.getByLabel("Preview device").inputValue() !== "device:neutral.phone.regular") {
        throw new Error("Canvas device changed after visiting verification");
      }
      await page.keyboard.press("h");
      if (await page.getByRole("button", { name: "Pan", exact: true }).getAttribute("aria-pressed") !== "true") {
        throw new Error("Hand-tool keyboard shortcut did not update the active tool");
      }
      await page.keyboard.press("v");
      await page.keyboard.type("?");
      await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor();
      await page.keyboard.press("Escape");
      await page.getByRole("dialog", { name: "Keyboard shortcuts" }).waitFor({ state: "detached" });
      await page.getByLabel("Preview device").selectOption("device:neutral.phone.compact");

      await mkdir(join(root, "output/playwright"), { recursive: true });
      await page.screenshot({ path: join(root, "output/playwright/studio-redesign-wide.png"), fullPage: true });

      await page.getByTestId("layer-payment-request.confirm").click();
      const compactPlacement = page.getByRole("group", { name: "Compact placement" });
      const inlinePlacement = compactPlacement.getByRole("button", { name: "Inline", exact: true });
      const bottomPlacement = compactPlacement.getByRole("button", { name: "Bottom safe area", exact: true });
      await inlinePlacement.click();
      await page.waitForFunction(() => document.querySelector('[role="group"][aria-label="Compact placement"] button[aria-pressed="true"]')?.textContent?.trim() === "Inline");
      await page.waitForFunction(() => document.querySelector('[data-testid="selection-overlay"]')?.getAttribute("data-selection-ids") === "payment-request.confirm");
      const action = page.getByTestId("canvas-node-payment-request.confirm");
      const bounds = await action.boundingBox();
      if (!bounds) throw new Error("Primary action is not visible on the semantic canvas");
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (const delta of [8, 18, 30, 44, 60, 76]) await page.mouse.move(x, y + delta);
      await page.getByText("Bottom safe area · compact", { exact: true }).waitFor();
      await page.mouse.up();
      if (await bottomPlacement.getAttribute("aria-pressed") !== "true") {
        throw new Error("The placement preview did not commit the exact bottom-safe-area relation");
      }

      const label = page.getByLabel("Label", { exact: true });
      await label.fill("Send verified request");
      await page.getByRole("button", { name: "Select", exact: true }).click();
      await page.getByRole("button", { name: "Native outputs" }).click();
      const generatedCode = await page.locator("code").textContent();
      if (!generatedCode?.includes("Send verified request") || !generatedCode.includes("placement-compact-persistent")) {
        throw new Error("Manual semantic edits did not reach generated React code");
      }
      await page.getByText("Active compiled preview", { exact: true }).waitFor();
      const previewFrame = page.locator('iframe[title^="Generated React preview"]');
      if (await previewFrame.getAttribute("sandbox") !== "allow-scripts") {
        throw new Error("Active preview iframe must not receive same-origin access");
      }
      const previewStatus = page.locator('[aria-live="polite"]').filter({ hasText: /^Current · [0-9a-f]{8}$/ });
      await previewStatus.waitFor();
      const statusText = (await previewStatus.textContent())?.trim() ?? "";
      const activeFingerprint = statusText.split(" · ")[1];
      const preview = page.frameLocator('iframe[title^="Generated React preview"]');
      await preview.getByRole("heading", { name: "Request payment" }).waitFor();
      const renderedFingerprint = await preview.locator("main[data-compiler-fingerprint]").getAttribute("data-compiler-fingerprint");
      if (!activeFingerprint || renderedFingerprint !== activeFingerprint) {
        throw new Error(`Active preview fingerprint drifted from generated output (${renderedFingerprint} vs ${activeFingerprint})`);
      }
      await preview.getByRole("button").filter({ hasText: "Send verified request" }).click();
      await preview.getByRole("heading", { name: "Request sent" }).waitFor();
      await page.screenshot({ path: join(root, "output/playwright/studio-active-preview.png"), fullPage: true });
      await page.getByRole("button", { name: "Design canvas" }).click();
      await page.getByTestId("canvas-viewport").waitFor();
      if (await page.getByTestId("canvas-node-home.balance").count() !== 1
        || await page.getByTestId("canvas-node-receipt.summary").count() !== 1) {
        throw new Error("The board did not render every semantic screen as a frame");
      }

      await page.getByTestId("canvas-node-payment-request.recipient").click();
      const keyboardContextNode = page.getByTestId("canvas-node-payment-request.recipient");
      await keyboardContextNode.focus();
      await page.keyboard.press("Shift+F10");
      const layerActions = page.getByRole("menu", { name: "Layer actions" });
      await layerActions.waitFor();
      const firstLayerAction = layerActions.getByRole("menuitem").first();
      await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "menuitem");
      if (await firstLayerAction.evaluate((element) => document.activeElement === element) !== true) {
        throw new Error("Keyboard context menu did not focus its first action");
      }
      await page.keyboard.press("End");
      const lastLayerAction = layerActions.getByRole("menuitem").last();
      if (await lastLayerAction.evaluate((element) => document.activeElement === element) !== true) {
        throw new Error("Keyboard context menu did not support End navigation");
      }
      await page.keyboard.press("Escape");
      await layerActions.waitFor({ state: "detached" });
      if (await keyboardContextNode.evaluate((element) => document.activeElement === element) !== true) {
        throw new Error("Closing the keyboard context menu did not return focus to its layer");
      }
      await keyboardContextNode.click({ button: "right" });
      await layerActions.waitFor();
      await page.getByRole("menuitem", { name: "Duplicate" }).click();
      await page.getByTestId("layer-payment-request.recipient-copy").waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.getByTestId("layer-payment-request.recipient-copy").waitFor({ state: "detached" });

      await page.getByRole("tab", { name: "Tokens" }).click();
      const accentHex = page.getByLabel("Hex for color.accent");
      await accentHex.fill("#7a4b9e");
      await accentHex.press("Enter");
      await page.getByRole("tab", { name: "Layers" }).click();
      const paintedAccent = await page.getByTestId("canvas-node-payment-request.confirm")
        .locator("> div").first()
        .evaluate((element) => getComputedStyle(element).backgroundColor);
      if (paintedAccent !== "rgb(122, 75, 158)") {
        throw new Error(`Design-token edit did not repaint the board (got ${paintedAccent})`);
      }
      await page.getByRole("button", { name: "Undo" }).click();

      await page.getByLabel("Visual state").selectOption("loading");
      await page.locator("[data-loading-skeleton]").first().waitFor();
      await page.getByLabel("Visual state").selectOption("idle");
      await page.locator("[data-loading-skeleton]").waitFor({ state: "detached" });

      await page.getByRole("button", { name: "Toggle color theme" }).click();
      if (await page.locator("html[data-theme='dark']").count() !== 1) {
        throw new Error("The theme toggle did not switch the workspace to dark mode");
      }
      await page.screenshot({ path: join(root, "output/playwright/studio-redesign-dark.png"), fullPage: true });
      await page.getByRole("button", { name: "Toggle color theme" }).click();
      if (await page.locator("html[data-theme='light']").count() !== 1) {
        throw new Error("The theme toggle did not restore light mode");
      }

      await page.getByRole("button", { name: "Toggle preview mode" }).click();
      await page.getByTestId("canvas-node-payment-request.confirm").click();
      await page.locator('[data-testid="device-frame"][data-screen-id="receipt"]').waitFor();
      await page.getByRole("button", { name: "Toggle preview mode" }).click();

      await page.getByTestId("layer-receipt.confirm").click();
      await page.getByLabel("Navigates to").selectOption("home");
      await page.locator(".editor-world svg text", { hasText: "onDone" }).waitFor();
      await page.getByRole("button", { name: "Undo" }).click();
      await page.locator(".editor-world svg text", { hasText: "onDone" }).waitFor({ state: "detached" });
    },
  });

  await runSmokeScenario(browser, {
    name: "Studio WCAG, keyboard, RTL and text-scale matrix",
    context: { viewport: { width: 1280, height: 900 } },
    run: async (accessibilityPage) => {
      await gotoStudio(accessibilityPage, origin);
      const axe = await new AxeBuilder({ page: accessibilityPage })
        .withTags(["wcag2a", "wcag2aa", "wcag22aa"])
        .analyze();
      if (axe.violations.length > 0) {
        throw new Error(`Studio failed axe: ${axe.violations.map((item) => `${item.id} (${item.nodes.length}) ${item.nodes.map((node) => node.target.join(" ")).join(" | ")}`).join("; ")}`);
      }

      await accessibilityPage.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      });
      await accessibilityPage.keyboard.press("Tab");
      if (await accessibilityPage.evaluate(() => document.activeElement?.textContent?.trim()) !== "Skip to workspace") {
        throw new Error("Studio skip navigation was not the first keyboard focus target");
      }
      await accessibilityPage.keyboard.press("Enter");
      if (await accessibilityPage.locator("#studio-workspace").evaluate((element) => document.activeElement === element) !== true) {
        throw new Error("Studio skip navigation did not move focus to the workspace");
      }

      await accessibilityPage.getByRole("button", { name: "Verification" }).click();
      await accessibilityPage.getByRole("heading", { name: /WCAG 2.2 AA/ }).waitFor();
      const rtlProfile = accessibilityPage.getByRole("button", { name: /rtl/i }).filter({ hasText: "RTL" });
      await rtlProfile.click();
      const activeInspection = accessibilityPage.getByText(/Active inspection:/);
      if (await activeInspection.getAttribute("dir") !== "rtl" || await activeInspection.getAttribute("lang") !== "ar") {
        throw new Error("RTL audit profile did not expose language and reading direction semantics");
      }

      const undersized = await accessibilityPage.locator("button:visible").evaluateAll((elements) => elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: element.getAttribute("aria-label") ?? element.textContent?.trim() ?? "button", width: rect.width, height: rect.height };
        })
        .filter((item) => item.width > 0 && item.height > 0 && (item.width < 24 || item.height < 24)));
      if (undersized.length > 0) throw new Error(`Studio has undersized interactive targets: ${JSON.stringify(undersized.slice(0, 5))}`);

      await accessibilityPage.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
      const scaledOverflow = await accessibilityPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (scaledOverflow > 1) throw new Error(`Studio has ${scaledOverflow}px horizontal overflow at 200% text scale`);
      const clipped = await accessibilityPage.locator("body *:visible").evaluateAll((elements) => elements
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { label: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 40) ?? element.tagName, left: rect.left, right: rect.right };
        })
        .filter((item) => item.right > window.innerWidth + 1 || item.left < -1));
      if (clipped.length > 0) throw new Error(`Studio clips visible content at 200% text scale: ${JSON.stringify(clipped.slice(0, 5))}`);
      await mkdir(join(root, "output/playwright"), { recursive: true });
      await accessibilityPage.screenshot({ path: join(root, "output/playwright/studio-accessibility-text-scale-rtl.png"), fullPage: true });
      await accessibilityPage.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
      const reducedMotion = await accessibilityPage.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior);
      if (reducedMotion !== "auto") throw new Error("Studio reduced-motion mode retained smooth scrolling");
      await accessibilityPage.screenshot({ path: join(root, "output/playwright/studio-accessibility-forced-colors.png"), fullPage: true });
    },
  });

  await runSmokeScenario(browser, {
    name: "adaptive drawers",
    context: { viewport: { width: 1100, height: 900 } },
    run: async (adaptivePage) => {
      await gotoStudio(adaptivePage, origin);
      const layersTrigger = adaptivePage.getByRole("button", { name: "Open pages and layers" });
      const inspectorTrigger = adaptivePage.getByRole("button", { name: "Open design inspector" });
      await layersTrigger.waitFor();
      await inspectorTrigger.waitFor();
      const contextBar = await adaptivePage.getByLabel("Preview device").boundingBox();
      if (!contextBar || contextBar.y + contextBar.height > 900) {
        throw new Error("Adaptive device and state controls are outside the visible workspace");
      }
      await layersTrigger.click();
      await adaptivePage.locator("#editor-structure-panel").waitFor();
      await adaptivePage.getByTestId("layer-payment-request.confirm").click();
      if (await layersTrigger.getAttribute("aria-expanded") !== "false") {
        throw new Error("Adaptive layer drawer did not close after selecting a semantic node");
      }
      await inspectorTrigger.click();
      await adaptivePage.getByTestId("semantic-inspector").waitFor();
      await adaptivePage.getByText("Bottom safe area", { exact: true }).waitFor();
      await adaptivePage.screenshot({ path: join(root, "output/playwright/studio-redesign-1100.png"), fullPage: true });
    },
  });

  await runSmokeScenario(browser, {
    name: "compact keyboard flow",
    context: { viewport: { width: 375, height: 667 } },
    run: async (compactPage) => {
      await gotoStudio(compactPage, origin);
      const compactOverflow = await compactPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (compactOverflow > 1) throw new Error(`Compact Studio has ${compactOverflow}px horizontal overflow`);
      await compactPage.getByText("Replay", { exact: true }).waitFor();
      const compactLayers = compactPage.getByRole("button", { name: "Open pages and layers" });
      await compactLayers.click();
      await compactPage.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Close pages and layers");
      await compactPage.keyboard.press("Escape");
      if (await compactLayers.evaluate((element) => document.activeElement === element) !== true) {
        throw new Error("Closing the compact layers drawer did not return focus to its trigger");
      }
      await compactPage.keyboard.press("Control+k");
      const commandDialog = compactPage.getByRole("dialog", { name: "Command menu" });
      await commandDialog.waitFor();
      const commandSearch = compactPage.getByLabel("Search commands");
      await commandSearch.waitFor();
      await compactPage.keyboard.press("Shift+Tab");
      const lastCommand = commandDialog.getByRole("button").last();
      if (await lastCommand.evaluate((element) => document.activeElement === element) !== true) {
        throw new Error("Command dialog did not wrap focus backward from its first control");
      }
      await compactPage.keyboard.press("Tab");
      if (await commandSearch.evaluate((element) => document.activeElement === element) !== true) {
        throw new Error("Command dialog did not wrap focus forward from its last control");
      }
      await compactPage.keyboard.press("Escape");
      await commandDialog.waitFor({ state: "detached" });

      await compactPage.getByRole("button", { name: "Toggle preview mode" }).click();
      const keyboardFlow = compactPage.getByRole("button", { name: /Follow Confirm request to Request sent/ });
      await keyboardFlow.focus();
      await compactPage.keyboard.press("Enter");
      await compactPage.locator('[data-testid="device-frame"][data-screen-id="receipt"]').waitFor();
      await compactPage.waitForTimeout(400);
      await compactPage.screenshot({ path: join(root, "output/playwright/studio-compact-375.png"), fullPage: true });
    },
  });

  await runSmokeScenario(browser, {
    name: "tablet and short landscape",
    context: { viewport: { width: 768, height: 1024 } },
    run: async (matrixPage) => {
      for (const viewport of [{ width: 768, height: 1024 }, { width: 667, height: 375 }]) {
        await matrixPage.setViewportSize(viewport);
        await gotoStudio(matrixPage, origin);
        const metrics = await matrixPage.evaluate(() => ({
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          editorBottom: document.querySelector<HTMLElement>(".editor-shell")?.getBoundingClientRect().bottom ?? 0,
          viewportHeight: window.innerHeight,
        }));
        if (metrics.overflow > 1) throw new Error(`${viewport.width}x${viewport.height} Studio has ${metrics.overflow}px horizontal overflow`);
        if (metrics.editorBottom > metrics.viewportHeight + 1) throw new Error(`${viewport.width}x${viewport.height} editor is clipped below the viewport`);
        await matrixPage.screenshot({ path: join(root, `output/playwright/studio-${viewport.width}x${viewport.height}.png`), fullPage: true });
      }
    },
  });

  await runSmokeScenario(browser, {
    name: "reduced motion",
    context: { viewport: { width: 768, height: 1024 }, reducedMotion: "reduce" },
    run: async (reducedPage) => {
      await gotoStudio(reducedPage, origin);
      if (await reducedPage.locator(".status-breathe").count() !== 0) throw new Error("Studio restored a prohibited breathing status animation");
      await reducedPage.keyboard.press("Control+k");
      const animationSeconds = await reducedPage.locator(".command-menu").evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration));
      if (animationSeconds > 0.01) throw new Error(`Reduced motion left a ${animationSeconds}s status animation active`);
    },
  });

  await runSmokeScenario(browser, {
    name: "editor transactions and repair history",
    run: async (transactionPage) => {
      await gotoStudio(transactionPage, origin);

      await transactionPage.keyboard.press("Control+k");
      await transactionPage.getByLabel("Search commands").fill("Duplicate current screen");
      await transactionPage.getByRole("button", { name: "Duplicate current screen", exact: true }).click();
      const copiedScreen = transactionPage.getByRole("button", { name: "Duplicate screen Request payment copy" });
      await copiedScreen.waitFor();
      await transactionPage.getByRole("button", { name: "Undo" }).click();
      await copiedScreen.waitFor({ state: "detached" });

      await transactionPage.getByRole("button", { name: "Request payment 4", exact: true }).click();
      await transactionPage.getByTestId("layer-payment-request.confirm").click();
      await transactionPage.getByRole("button", { name: "Duplicate layer" }).click();
      await transactionPage.getByRole("status").getByText(/more than one primary action.*No changes were saved/i).waitFor();
      if (await transactionPage.getByTestId("layer-payment-request.confirm-copy").count() !== 0) {
        throw new Error("A rejected primary-action duplicate leaked into the canonical graph");
      }
      await transactionPage.getByTestId("semantic-inspector").getByText("payment-request.confirm", { exact: true }).waitFor();
      await transactionPage.getByRole("button", { name: "Show workspace status" }).click();

      await transactionPage.getByLabel("Visual state").selectOption("failed");
      await transactionPage.getByRole("button", { name: "Insert component" }).click();
      await transactionPage.getByRole("menu", { name: "Insert semantic component" })
        .getByRole("menuitem").filter({ hasText: "Status message" }).click();
      const insertedId = "payment-request.custom-status-message-2";
      await transactionPage.getByTestId(`canvas-node-${insertedId}`).waitFor({ state: "attached" });
      await transactionPage.getByLabel("Visual state").selectOption("idle");
      await transactionPage.getByTestId(`canvas-node-${insertedId}`).waitFor({ state: "detached" });
      if (await transactionPage.getByTestId(`layer-${insertedId}`).getAttribute("data-state-visible") !== "false") {
        throw new Error("A layer inserted in the failed state leaked into the idle state");
      }
      await transactionPage.getByRole("button", { name: "Undo" }).click();
      await transactionPage.getByTestId(`layer-${insertedId}`).waitFor({ state: "detached" });

      await transactionPage.keyboard.press("Control+k");
      await transactionPage.getByLabel("Search commands").fill("Reset to verified sample");
      await transactionPage.getByRole("button", { name: "Reset to verified sample" }).click();
      const resetDialog = transactionPage.getByRole("alertdialog", { name: "Reset this workspace?" });
      await resetDialog.waitFor();
      await transactionPage.waitForTimeout(200);
      await transactionPage.screenshot({ path: join(root, "output/playwright/reset-project-confirmation.png"), fullPage: true });
      const cancelReset = resetDialog.getByRole("button", { name: "Cancel" });
      const confirmReset = resetDialog.getByRole("button", { name: "Reset workspace" });
      if (!await cancelReset.evaluate((element) => element === document.activeElement)) throw new Error("Reset dialog did not focus its safe action");
      await transactionPage.keyboard.press("Shift+Tab");
      if (!await confirmReset.evaluate((element) => element === document.activeElement)) throw new Error("Reset dialog did not wrap backward focus");
      await transactionPage.keyboard.press("Tab");
      if (!await cancelReset.evaluate((element) => element === document.activeElement)) throw new Error("Reset dialog did not wrap forward focus");
      await cancelReset.click();
      await resetDialog.waitFor({ state: "detached" });
      if (!await transactionPage.getByRole("button", { name: "IntentForm project menu" }).evaluate((element) => element === document.activeElement)) throw new Error("Reset cancellation did not restore focus to the project menu");
      await transactionPage.getByRole("button", { name: "Request payment 4", exact: true }).waitFor();
      await transactionPage.keyboard.press("Control+k");
      await transactionPage.getByLabel("Search commands").fill("Reset to verified sample");
      await transactionPage.getByRole("button", { name: "Reset to verified sample" }).click();
      await transactionPage.getByRole("alertdialog", { name: "Reset this workspace?" }).getByRole("button", { name: "Reset workspace" }).click();
      await transactionPage.getByRole("button", { name: "Request payment 4", exact: true }).waitFor();
      await transactionPage.getByRole("button", { name: "Verification" }).click();
      await transactionPage.getByRole("button", { name: "Plan repair" }).click();
      await transactionPage.getByRole("heading", { name: "The repair changed the graph. Available output was regenerated; verification is still pending." }).waitFor();
      await transactionPage.getByRole("button", { name: "Design canvas" }).click();
      await transactionPage.getByTestId("layer-payment-request.confirm").click();
      const repairedPlacement = transactionPage.getByRole("group", { name: "Compact placement" });
      const inlinePlacement = repairedPlacement.getByRole("button", { name: "Inline", exact: true });
      const bottomPlacement = repairedPlacement.getByRole("button", { name: "Bottom safe area", exact: true });
      await repairedPlacement.waitFor();
      if (await bottomPlacement.getAttribute("aria-pressed") !== "true") {
        throw new Error("The accepted repair did not reach the compact placement control");
      }
      const undo = transactionPage.getByRole("button", { name: "Undo" });
      if (await undo.isDisabled()) throw new Error("The accepted repair bypassed semantic undo history");
      await undo.click();
      await transactionPage.waitForFunction(() => document.querySelector('[role="group"][aria-label="Compact placement"] button[aria-pressed="true"]')?.textContent?.trim() === "Inline");
      await transactionPage.getByRole("button", { name: "Redo" }).click();
      await transactionPage.waitForFunction(() => document.querySelector('[role="group"][aria-label="Compact placement"] button[aria-pressed="true"]')?.textContent?.trim() === "Bottom safe area");
      if (await inlinePlacement.getAttribute("aria-pressed") !== "false") {
        throw new Error("Redo left both compact placement options active");
      }
    },
  });

  await runSmokeScenario(browser, {
    name: "component library instances",
    run: async (componentPage) => {
      await gotoStudio(componentPage, origin);
      await componentPage.getByRole("button", { name: "Layout lab 20", exact: true }).click();
      await componentPage.getByRole("tab", { name: "Library", exact: true }).click();
      const library = componentPage.getByTestId("component-library-panel");
      await library.getByText("Local components", { exact: true }).waitFor();
      await library.getByRole("button", { name: "Insert Primary action" }).click();

      const instanceId = "layout-lab.instance-primary-action-1";
      const instance = componentPage.getByTestId(`canvas-node-${instanceId}`);
      await instance.waitFor();
      const inspector = componentPage.getByTestId("semantic-inspector");
      await inspector.getByText("Component instance", { exact: true }).waitFor();
      await inspector.getByText("intent.primary-action · v1.1.0", { exact: true }).waitFor();

      const gapPicker = inspector.getByRole("button", { name: /Gap token:/ });
      await gapPicker.click();
      const tokenSearch = inspector.getByLabel("Search Gap token");
      await tokenSearch.fill("space.24");
      await tokenSearch.press("Enter");
      await gapPicker.getByText("space.24", { exact: true }).waitFor();

      await inspector.getByLabel("Component variant").selectOption("quiet");
      await inspector.getByLabel("Component state").selectOption("working");
      await instance.getByText("Working…", { exact: true }).waitFor();
      const labelProperty = inspector.getByLabel("label", { exact: true });
      await labelProperty.fill("Send from library");
      await labelProperty.press("Enter");
      await inspector.getByLabel("Component state").selectOption("ready");
      await instance.getByText("Send from library", { exact: true }).waitFor();

      await inspector.getByRole("button", { name: "Reset", exact: true }).click();
      await instance.getByText("Continue", { exact: true }).waitFor();
      await inspector.getByRole("button", { name: "Detach", exact: true }).click();
      await inspector.getByText("Component instance", { exact: true }).waitFor({ state: "detached" });
      await componentPage.getByRole("button", { name: "Undo" }).click();
      await inspector.getByText("Component instance", { exact: true }).waitFor();

      const overflow = await componentPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`Component library workflow introduced ${overflow}px horizontal overflow`);
    },
  });

  await runSmokeScenario(browser, {
    name: "token modes and licensed asset panels",
    run: async (tokenPage) => {
      await gotoStudio(tokenPage, origin);
      await tokenPage.getByRole("tab", { name: "Tokens", exact: true }).click();
      await tokenPage.getByText("DTCG 2025.10", { exact: true }).waitFor();
      const mode = tokenPage.getByLabel("Active token mode");
      await mode.selectOption("evening");
      if (await mode.inputValue() !== "evening") throw new Error("Token mode selection did not commit");
      await tokenPage.getByLabel("Hex for color.accent").waitFor();
      if ((await tokenPage.getByLabel("Hex for color.accent").inputValue()).toLowerCase() !== "#68a990") {
        throw new Error("Sparse evening token overrides did not resolve in the Studio panel");
      }

      await tokenPage.getByLabel("Import DTCG tokens").setInputFiles({
        name: "incomplete.tokens.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
          color: {
            $type: "color",
            accent: { $value: { colorSpace: "srgb", components: [0.2, 0.4, 0.6] } },
          },
        })),
      });
      await tokenPage.getByRole("alert").getByText(/Unknown spacing token/i).waitFor();
      if (await mode.inputValue() !== "evening") throw new Error("Rejected token import mutated the active mode");

      const downloadPromise = tokenPage.waitForEvent("download");
      await tokenPage.getByRole("button", { name: "Export", exact: true }).click();
      const download = await downloadPromise;
      if (!download.suggestedFilename().endsWith(".tokens.json")) {
        throw new Error(`Unexpected DTCG export filename: ${download.suggestedFilename()}`);
      }

      await tokenPage.getByRole("tab", { name: "Assets", exact: true }).click();
      await tokenPage.getByTestId("asset-library-panel").getByText("No project assets yet.", { exact: false }).waitFor();
      const overflow = await tokenPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`Token/asset panels introduced ${overflow}px horizontal overflow`);
    },
  });

  await runSmokeScenario(browser, {
    name: "request concurrency and recovery",
    allowConsoleError: (message) => message.text().includes("503 (Service Unavailable)")
      && message.location().url.startsWith(`${origin}/api/interpret`),
    run: async (editPage) => {
      await gotoStudio(editPage, origin);
      await editPage.getByRole("button", { name: "IntentForm project menu" }).click();
      await editPage.getByRole("menuitem", { name: "Product brief" }).click();
      await editPage.getByRole("button", { name: "Semantic edit" }).click();
      await editPage.getByLabel("Edit instruction").fill("Rename the primary action label to “Pay securely”");
      let interpretationRequests = 0;
      await editPage.route("**/api/interpret", async (route) => {
        interpretationRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 350));
        await route.continue();
      });
      const applyEdit = editPage.getByRole("button", { name: "Apply typed edit" });
      await applyEdit.click();
      await editPage.waitForFunction(() => {
        const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes("Apply typed edit"));
        return button instanceof HTMLButtonElement && button.disabled;
      });
      if (!await editPage.getByRole("button", { name: "Ask agent" }).isDisabled()) {
        throw new Error("A second interpretation submit remained enabled while the first request was pending");
      }
      await editPage.getByTestId("canvas-node-payment-request.confirm").getByText("Pay securely", { exact: true }).waitFor();
      if (interpretationRequests !== 1) throw new Error(`Expected one interpretation request, received ${interpretationRequests}`);
      await editPage.unroute("**/api/interpret");
      await editPage.getByRole("button", { name: "Show workspace status" }).click();
      await editPage.getByText("Deterministic replay", { exact: false }).first().waitFor();
      await editPage.getByRole("button", { name: "Show workspace status" }).click();

      await editPage.getByRole("button", { name: "IntentForm project menu" }).click();
      await editPage.getByRole("menuitem", { name: "Product brief" }).click();
      await editPage.getByRole("button", { name: "Semantic edit" }).click();
      await editPage.getByLabel("Edit instruction").fill("Rename the primary action label to “Approve now”");
      let injectFailure = true;
      await editPage.route("**/api/interpret", async (route) => {
        if (injectFailure) {
          injectFailure = false;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "The temporary interpretation service is unavailable." }),
          });
          return;
        }
        await route.continue();
      });
      await editPage.getByRole("button", { name: "Apply typed edit" }).click();
      await editPage.getByRole("alert").getByText("The temporary interpretation service is unavailable.", { exact: true }).waitFor();
      await editPage.getByRole("button", { name: "Retry edit" }).click();
      await editPage.getByTestId("canvas-node-payment-request.confirm").getByText("Approve now", { exact: true }).waitFor();
      await editPage.unroute("**/api/interpret");
    },
  });

  await runSmokeScenario(browser, {
    name: "direct routes refresh and invalid input",
    allowRequestFailure: (request) => new URL(request.url()).pathname === "/icon.svg"
      && request.failure()?.errorText === "net::ERR_ABORTED",
    run: async (routePage) => {
      const runtimeResponse = await gotoStudio(routePage, origin, "/runtime-preview");
      assertSecurityHeaders(runtimeResponse, "Runtime preview");
      await routePage.getByRole("status").getByText("Compiling the active graph…", { exact: true }).waitFor();
      await routePage.reload({ waitUntil: "networkidle" });
      await routePage.getByRole("status").getByText("Compiling the active graph…", { exact: true }).waitFor();

      const staticPreviewResponse = await gotoStudio(routePage, origin, "/react-preview/index.html");
      assertSecurityHeaders(staticPreviewResponse, "Static React preview");
      await routePage.locator("main").waitFor();
      await routePage.reload({ waitUntil: "networkidle" });
      await routePage.locator("main").waitFor();

      const invalidDraft = await routePage.request.post(`${origin}/api/interpret`, {
        data: { operation: "create", brief: "" },
      });
      if (invalidDraft.status() !== 422) {
        throw new Error(`Invalid draft returned ${invalidDraft.status()} instead of 422`);
      }
      assertSecurityHeaders(invalidDraft, "Interpret API");
      const malformedDraft = await routePage.request.post(`${origin}/api/interpret`, {
        data: Buffer.from("{"),
        headers: { "content-type": "application/json" },
      });
      if (malformedDraft.status() !== 400) {
        throw new Error(`Malformed draft returned ${malformedDraft.status()} instead of 400`);
      }

      const rootResponse = await gotoStudio(routePage, origin, "/");
      assertSecurityHeaders(rootResponse, "Project launcher");
      await routePage.getByRole("heading", { name: "Recents", level: 1 }).waitFor();
      await routePage.reload({ waitUntil: "networkidle" });
      await routePage.getByRole("heading", { name: "Recents", level: 1 }).waitFor();

      const studioResponse = await gotoStudio(routePage, origin, "/studio");
      assertSecurityHeaders(studioResponse, "Studio workspace");
      await routePage.getByRole("button", { name: "Design canvas" }).waitFor();
      await routePage.reload({ waitUntil: "networkidle" });
      await routePage.getByRole("button", { name: "Design canvas" }).waitFor();

      await routePage.evaluate(() => localStorage.clear());
      const emptyPage = await routePage.context().newPage();
      const emptyStudioResponse = await navigateToStudio(emptyPage, origin, "/studio");
      assertSecurityHeaders(emptyStudioResponse, "Empty Studio redirect");
      await emptyPage.waitForURL(`${origin}/`);
      await emptyPage.getByRole("heading", { name: "Recents", level: 1 }).waitFor();
      await emptyPage.close();
    },
  });
  await runSmokeScenario(browser, {
    name: "large document canvas virtualization",
    run: async (page) => {
      const graph: unknown = JSON.parse(JSON.stringify(createLargeDocumentGraph(1_000, 100)));
      await page.addInitScript((project: unknown) => {
        localStorage.setItem("intentform-browser-project-v1", JSON.stringify({
          version: 1,
          graph: project,
          savedAt: "2026-07-14T20:00:00.000Z",
          projectType: "application",
          source: "recovery",
        }));
      }, graph);
      await gotoStudio(page, origin);
      const viewport = page.getByTestId("canvas-viewport");
      await viewport.waitFor();
      await page.waitForFunction(() => document.querySelector('[data-testid="canvas-viewport"]')?.getAttribute("data-total-screen-count") === "100");
      const initialRendered = Number(await viewport.getAttribute("data-rendered-screen-count"));
      if (!Number.isFinite(initialRendered) || initialRendered > 6) {
        throw new Error(`Canvas mounted ${initialRendered} of 100 screens instead of a bounded visible window`);
      }

      await page.getByRole("button", { name: /^Scale profile 100\b/ }).click();
      await page.waitForFunction(() => document.querySelector('[data-testid="device-frame"]')?.getAttribute("data-screen-id") === "scale-099");
      const selectedRendered = Number(await viewport.getAttribute("data-rendered-screen-count"));
      if (!Number.isFinite(selectedRendered) || selectedRendered > 7) {
        throw new Error(`Pinned selection expanded the canvas window to ${selectedRendered} screens`);
      }

      await page.getByRole("button", { name: "Verification" }).click();
      await page.getByText("WCAG 2.2 AA profile matrix", { exact: true }).waitFor();
      await page.screenshot({ path: join(root, "output/playwright/studio-large-document.png"), fullPage: true });
    },
  });
} finally {
  await browser?.close();
  if (server) await stopServer(server);
  if (localTestProjectDir) await rm(localTestProjectDir, { recursive: true, force: true });
}
