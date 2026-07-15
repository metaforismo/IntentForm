import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { demoGraph } from "../packages/proof-report/src/demo.ts";
import { assertSecurityHeaders, gotoStudio, runSmokeScenario } from "./smoke-studio-support.ts";

const root = process.cwd();
const studioRoot = join(root, "apps/studio-web");
const remoteOrigin = process.env.STUDIO_ORIGIN?.replace(/\/$/, "");
const origin = remoteOrigin || "http://127.0.0.1:4319";
const server = remoteOrigin ? undefined : spawn(process.execPath, [join(studioRoot, "node_modules/next/dist/bin/next"), "start"], {
  cwd: studioRoot,
  env: { ...process.env, OPENAI_API_KEY: "", HOSTNAME: "127.0.0.1", PORT: "4319" },
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
              error: "Project schema 0.0.1 must be migrated to 0.1.0 before it can be opened.",
              migration: {
                status: "migration-required",
                sourceFingerprint: "a".repeat(64),
                fromVersion: "0.0.1",
                toVersion: "0.1.0",
                diagnostics: [{
                  severity: "info",
                  code: "schema.migrated.0.0.1.to.0.1.0",
                  path: "schemaVersion",
                  message: "Converted schema 0.0.1 to 0.1.0.",
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
      await page.getByRole("heading", { name: "Open intent. Build native interfaces." }).waitFor();
      await page.getByText("No browser project yet", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Open local project" }).click();
      await page.getByText("Schema update required", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Checkpoint and update" }).waitFor();
      await mkdir(join(root, "output/playwright"), { recursive: true });
      await page.screenshot({ path: join(root, "output/playwright/schema-migration-preview.png"), fullPage: true });
      await page.getByRole("button", { name: "Not now" }).click();
      await page.getByText("Schema update required", { exact: true }).waitFor({ state: "detached" });
      await page.screenshot({ path: join(root, "output/playwright/project-launcher-wide.png"), fullPage: true });

      await page.evaluate(() => localStorage.setItem("intentform-browser-project-v1", "{broken"));
      await page.reload({ waitUntil: "networkidle" });
      await page.getByText("Recovery needs attention", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await page.getByText("No browser project yet", { exact: true }).waitFor();

      const importInput = page.getByLabel("Import IntentForm project");
      await importInput.setInputFiles({
        name: "invalid.intentform.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ schemaVersion: "0.1.0" })),
      });
      await page.getByRole("alert").getByText(/Import failed:/).waitFor();
      await page.getByRole("button", { name: "Dismiss launcher error" }).click();

      const legacyImport = structuredClone(demoGraph) as unknown as Record<string, unknown>;
      legacyImport.schemaVersion = "0.0.1";
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
      await page.getByText(/Application · saved/).waitFor();

      await page.getByRole("button", { name: "New project" }).click();
      await page.getByRole("heading", { name: "Begin with product intent, not a sample file." }).waitFor();
      await page.getByLabel("Project name").fill("Northline Field Notes");
      await page.getByLabel("Primary audience").fill("Distributed research teams");
      await page.getByLabel("First outcome").fill("Review and organize field observations");
      await page.getByLabel("SwiftUI").uncheck();
      await page.getByRole("button", { name: "Create blank canvas" }).click();
      await page.waitForURL(`${origin}/studio`);
      await page.getByText("Northline Field Notes", { exact: true }).first().waitFor();
      await page.getByTestId("canvas-node-home.start").waitFor();

      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menuitem", { name: "Back to project launcher" }).click();
      await page.waitForURL(`${origin}/`);
      await page.getByText("Northline Field Notes", { exact: true }).waitFor();
      await page.getByText(/Application · saved/).waitFor();

      await page.setViewportSize({ width: 375, height: 667 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) throw new Error(`Compact project launcher has ${overflow}px horizontal overflow`);
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(root, "output/playwright/project-launcher-compact.png"), fullPage: true });
      await page.getByRole("button", { name: /Adaptive payment flow/ }).click();
      await page.waitForURL(`${origin}/studio`);
      await page.getByTestId("canvas-node-home.balance").waitFor();
      await page.getByRole("button", { name: "IntentForm project menu" }).click();
      await page.getByRole("menu").getByText("Verdant Pay", { exact: true }).waitFor();
    },
  });

  await runSmokeScenario(browser, {
    name: "desktop editor and active runtime",
    run: async (page) => {
      await gotoStudio(page, origin);

      const workspaceStatus = page.getByRole("button", { name: "Show workspace status" });
      await workspaceStatus.click();
      await page.getByRole("status").waitFor();
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

      await page.getByLabel("Preview device").selectOption("regular-phone");
      if (await page.getByTestId("device-frame").getAttribute("data-breakpoint") !== "regular") {
        throw new Error("Device profile did not switch the semantic preview breakpoint");
      }
      await page.getByRole("button", { name: "Verification" }).click();
      const regularScenario = page.getByRole("button", { name: "Regular phone", exact: true });
      if (await regularScenario.getAttribute("aria-pressed") !== "true") {
        throw new Error("Verification did not inherit the active canvas device");
      }
      await page.getByText("402 × 874", { exact: true }).waitFor();
      await page.getByText("Build evidence pending", { exact: true }).waitFor();
      await page.getByText("Not run for this graph", { exact: true }).waitFor();
      await page.getByRole("button", { name: "Proof report" }).click();
      await page.getByRole("heading", { name: "Source generated. Build evidence is still pending." }).waitFor();
      await page.getByRole("button", { name: "Design canvas" }).click();
      if (await page.getByLabel("Preview device").inputValue() !== "regular-phone") {
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
      await page.getByLabel("Preview device").selectOption("compact-phone");

      await mkdir(join(root, "output/playwright"), { recursive: true });
      await page.screenshot({ path: join(root, "output/playwright/studio-redesign-wide.png"), fullPage: true });

      await page.getByTestId("layer-payment-request.confirm").click();
      const action = page.getByTestId("canvas-node-payment-request.confirm");
      const bounds = await action.boundingBox();
      if (!bounds) throw new Error("Primary action is not visible on the semantic canvas");
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (const delta of [8, 18, 30, 44, 60, 76]) await page.mouse.move(x, y + delta);
      await page.mouse.up();
      await page.getByText("Bottom safe area · compact", { exact: true }).waitFor();

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
      const animationSeconds = await reducedPage.locator(".status-breathe").evaluate((element) => Number.parseFloat(getComputedStyle(element).animationDuration));
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
      await transactionPage.getByTestId(`canvas-node-${insertedId}`).waitFor();
      await transactionPage.getByLabel("Visual state").selectOption("idle");
      await transactionPage.getByTestId(`canvas-node-${insertedId}`).waitFor({ state: "detached" });
      if (await transactionPage.getByTestId(`layer-${insertedId}`).getAttribute("data-state-visible") !== "false") {
        throw new Error("A layer inserted in the failed state leaked into the idle state");
      }
      await transactionPage.getByRole("button", { name: "Undo" }).click();
      await transactionPage.getByTestId(`layer-${insertedId}`).waitFor({ state: "detached" });

      await transactionPage.getByRole("button", { name: "IntentForm project menu" }).click();
      await transactionPage.getByRole("menuitem", { name: "Reset to verified sample" }).click();
      await transactionPage.getByRole("button", { name: "Verification" }).click();
      await transactionPage.getByRole("button", { name: "Plan repair" }).click();
      await transactionPage.getByRole("heading", { name: "The repair changed the graph. Available output was regenerated; verification is still pending." }).waitFor();
      await transactionPage.getByRole("button", { name: "Design canvas" }).click();
      await transactionPage.getByTestId("layer-payment-request.confirm").click();
      const repairedPlacement = transactionPage.getByText("Bottom safe area · compact", { exact: true });
      await repairedPlacement.waitFor();
      const undo = transactionPage.getByRole("button", { name: "Undo" });
      if (await undo.isDisabled()) throw new Error("The accepted repair bypassed semantic undo history");
      await undo.click();
      await repairedPlacement.waitFor({ state: "detached" });
      await transactionPage.getByRole("button", { name: "Redo" }).click();
      await repairedPlacement.waitFor();
    },
  });

  await runSmokeScenario(browser, {
    name: "request concurrency and recovery",
    allowConsoleError: (message) => message.text().includes("503 (Service Unavailable)")
      && message.location().url.startsWith(`${origin}/api/interpret`),
    run: async (editPage) => {
      await gotoStudio(editPage, origin);
      await editPage.getByRole("button", { name: "Brief", exact: true }).click();
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
      if (!await editPage.getByRole("button", { name: "Compile intent" }).isDisabled()) {
        throw new Error("A second interpretation submit remained enabled while the first request was pending");
      }
      await editPage.getByTestId("canvas-node-payment-request.confirm").getByText("Pay securely", { exact: true }).waitFor();
      if (interpretationRequests !== 1) throw new Error(`Expected one interpretation request, received ${interpretationRequests}`);
      await editPage.unroute("**/api/interpret");
      await editPage.getByText("Deterministic replay", { exact: false }).first().waitFor();

      await editPage.getByRole("button", { name: "Brief", exact: true }).click();
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
      await routePage.getByRole("heading", { name: "Open intent. Build native interfaces." }).waitFor();
      await routePage.reload({ waitUntil: "networkidle" });
      await routePage.getByRole("heading", { name: "Open intent. Build native interfaces." }).waitFor();

      const studioResponse = await gotoStudio(routePage, origin, "/studio");
      assertSecurityHeaders(studioResponse, "Studio workspace");
      await routePage.getByRole("button", { name: "Design canvas" }).waitFor();
      await routePage.reload({ waitUntil: "networkidle" });
      await routePage.getByRole("button", { name: "Design canvas" }).waitFor();
    },
  });
} finally {
  await browser?.close();
  if (server) await stopServer(server);
}
