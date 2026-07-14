import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

const root = process.cwd();
const studioRoot = join(root, "apps/studio-web");
const origin = "http://127.0.0.1:4319";
const server = spawn(process.execPath, [join(studioRoot, "node_modules/next/dist/bin/next"), "start"], {
  cwd: studioRoot,
  env: { ...process.env, OPENAI_API_KEY: "", HOSTNAME: "127.0.0.1", PORT: "4319" },
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout?.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr?.on("data", (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Studio exited before startup:\n${serverOutput}`);
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.setDefaultTimeout(10_000);
  await page.goto(origin, { waitUntil: "networkidle" });

  const workspaceStatus = page.getByRole("button", { name: "Show workspace status" });
  await workspaceStatus.click();
  await page.getByRole("status").waitFor();
  await workspaceStatus.click();

  await page.keyboard.press("Control+k");
  await page.getByRole("region", { name: "Command menu" }).waitFor();
  await page.getByLabel("Search commands").fill("preview");
  await page.getByRole("button", { name: "Enter preview mode" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Command menu" }).waitFor({ state: "detached" });

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

  if (await page.getByTestId("canvas-node-payment-request.failure").count() !== 0) {
    throw new Error("Idle canvas rendered a node bound only to the failed visual state");
  }
  if (await page.getByTestId("layer-payment-request.failure").getAttribute("data-state-visible") !== "false") {
    throw new Error("Layers panel did not expose state-bound visibility");
  }
  await page.getByLabel("Visual state").selectOption("failed");
  await page.getByTestId("canvas-node-payment-request.failure").waitFor();
  await page.getByLabel("Visual state").selectOption("idle");
  await page.getByTestId("canvas-node-payment-request.failure").waitFor({ state: "detached" });

  await page.getByLabel("Preview device").selectOption("regular-phone");
  if (await page.getByTestId("device-frame").getAttribute("data-breakpoint") !== "regular") {
    throw new Error("Device profile did not switch the semantic preview breakpoint");
  }
  await page.keyboard.press("h");
  if (await page.getByRole("button", { name: "Pan", exact: true }).getAttribute("aria-pressed") !== "true") {
    throw new Error("Hand-tool keyboard shortcut did not update the active tool");
  }
  await page.keyboard.press("v");
  await page.keyboard.type("?");
  await page.getByRole("region", { name: "Keyboard shortcuts" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("region", { name: "Keyboard shortcuts" }).waitFor({ state: "detached" });
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
  if (!generatedCode?.includes("Send verified request") || !generatedCode.includes("primary persistent")) {
    throw new Error("Manual semantic edits did not reach generated React code");
  }
  const preview = page.frameLocator('iframe[title^="Generated React preview"]');
  await preview.getByRole("heading", { name: "Request payment" }).waitFor();
  await preview.getByRole("button", { name: "Confirm request" }).click();
  await preview.getByRole("heading", { name: "Request sent" }).waitFor();
  console.log("Studio embedded generated React flow: passed");
  console.log("Studio state, device and keyboard command model: passed");

  await page.getByRole("button", { name: "Design canvas" }).click();
  await page.getByTestId("canvas-viewport").waitFor();
  if (await page.getByTestId("canvas-node-home.balance").count() !== 1
    || await page.getByTestId("canvas-node-receipt.summary").count() !== 1) {
    throw new Error("The board did not render every semantic screen as a frame");
  }

  await page.getByTestId("canvas-node-payment-request.recipient").click();
  await page.getByTestId("canvas-node-payment-request.recipient").click({ button: "right" });
  await page.getByRole("menu", { name: "Layer actions" }).waitFor();
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
  console.log("Studio board, design tokens, flow preview and flow editing: passed");

  const adaptivePage = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  adaptivePage.setDefaultTimeout(10_000);
  await adaptivePage.goto(origin, { waitUntil: "networkidle" });
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
  console.log("Studio adaptive layer and inspector drawers: passed");

  const editContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const editPage = await editContext.newPage();
  editPage.setDefaultTimeout(10_000);
  await editPage.goto(origin, { waitUntil: "networkidle" });
  await editPage.getByRole("button", { name: "Brief", exact: true }).click();
  await editPage.getByRole("button", { name: "Semantic edit" }).click();
  await editPage.getByLabel("Edit instruction").fill("Rename the primary action label to “Pay securely”");
  await editPage.getByRole("button", { name: "Apply typed edit" }).click();
  await editPage.getByTestId("canvas-node-payment-request.confirm").getByText("Pay securely", { exact: true }).waitFor();
  await editPage.getByText("Deterministic replay", { exact: false }).first().waitFor();
  await editContext.close();
  console.log("Studio typed semantic edit and replay disclosure: passed");
} finally {
  await browser?.close();
  await stopServer(server);
}
