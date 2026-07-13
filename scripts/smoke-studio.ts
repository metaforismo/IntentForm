import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser } from "playwright";

const origin = "http://127.0.0.1:4319";
const server = spawn("pnpm", ["--filter", "@intentform/studio-web", "start"], {
  cwd: process.cwd(),
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
  await page.getByRole("button", { name: "Native outputs" }).click();
  const preview = page.frameLocator('iframe[title^="Generated React preview"]');
  await preview.getByRole("heading", { name: "Request payment" }).waitFor();
  await preview.getByRole("button", { name: "Confirm request" }).click();
  await preview.getByRole("heading", { name: "Request sent" }).waitFor();
  console.log("Studio embedded generated React flow: passed");
} finally {
  await browser?.close();
  await stopServer(server);
}
