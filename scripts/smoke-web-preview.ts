import { spawn, type ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

const root = process.cwd();
const previewRoot = join(root, "apps/web-preview");
const origin = "http://127.0.0.1:4320";
const server = spawn(process.execPath, [join(previewRoot, "node_modules/vite/bin/vite.js"), "preview", "--host", "127.0.0.1", "--port", "4320", "--strictPort"], {
  cwd: previewRoot,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout?.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr?.on("data", (chunk) => { serverOutput += chunk.toString(); });

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Responsive-web preview exited before startup:\n${serverOutput}`);
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The local preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Responsive-web preview did not become ready:\n${serverOutput}`);
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
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const failures: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(`console.error: ${message.text()} (${message.location().url || "unknown source"})`);
  });
  page.on("pageerror", (error) => failures.push(`page error: ${error.message}`));
  page.on("requestfailed", (request) => failures.push(`request failed: ${request.method()} ${new URL(request.url()).pathname}`));
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`response ${response.status()}: ${new URL(response.url()).pathname}`);
  });

  await page.goto(`${origin}/?state=idle`, { waitUntil: "networkidle" });
  await page.getByRole("navigation", { name: "Primary" }).waitFor();
  await page.getByRole("main").waitFor();
  await page.keyboard.press("Tab");
  if (await page.evaluate(() => document.activeElement?.textContent?.trim()) !== "Skip to content") {
    throw new Error("Skip navigation was not the first keyboard focus target");
  }

  await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Request payment" }).click();
  await page.waitForURL(`${origin}/request`);
  await page.goBack({ waitUntil: "networkidle" });
  await page.waitForURL(`${origin}/?state=idle`);

  await page.goto(`${origin}/request?state=failed`, { waitUntil: "networkidle" });
  await page.getByRole("status").filter({ hasText: "Payment could not be sent" }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/layout-lab`, { waitUntil: "networkidle" });
  const layoutLab = page.locator('[data-node-id="layout-lab.adaptive"]');
  if (await layoutLab.evaluate((element) => getComputedStyle(element).display) !== "block") {
    throw new Error("Small responsive-web breakpoint did not lower to block layout");
  }
  const compactOverflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (compactOverflow > 1) throw new Error(`Generated responsive-web preview has ${compactOverflow}px compact overflow`);

  await page.setViewportSize({ width: 1440, height: 1000 });
  if (await layoutLab.evaluate((element) => getComputedStyle(element).display) !== "grid") {
    throw new Error("Large responsive-web breakpoint did not lower to intrinsic grid layout");
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior) !== "auto") {
    throw new Error("Reduced-motion mode did not disable smooth scrolling");
  }
  if (failures.length > 0) throw new Error(failures.join("\n"));

  await mkdir(join(root, "output/playwright"), { recursive: true });
  await page.screenshot({ path: join(root, "output/playwright/responsive-web-runtime.png"), fullPage: true });
  await context.close();
  console.log("Responsive-web runtime scenarios: keyboard, history, fixtures, compact, desktop, reduced motion passed");
} finally {
  await browser?.close();
  await stopServer(server);
}
