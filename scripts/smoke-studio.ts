import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

const root = process.cwd();
const studioRoot = join(root, "apps/studio-web");
const origin = "http://127.0.0.1:4319";
const server = spawn(process.execPath, [join(studioRoot, "node_modules/next/dist/bin/next"), "start"], {
  cwd: studioRoot,
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: "4319" },
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
  await page.getByText("Bottom safe area · semantic", { exact: true }).waitFor();

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
} finally {
  await browser?.close();
  await stopServer(server);
}
