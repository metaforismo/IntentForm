import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { verifyRenderedPrimaryAction } from "../packages/verifier/src/index.ts";

const root = process.cwd();
const publicRoot = join(root, "apps/react-preview/dist");
const artifactRoot = join(root, "artifacts/react");
await mkdir(artifactRoot, { recursive: true });

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const requestPath = new URL(request.url ?? "/", "http://localhost").pathname;
    const relative = requestPath === "/" ? "index.html" : requestPath.slice(1);
    const safePath = normalize(relative).replace(/^(\.\.(\/|\\|$))+/, "");
    const body = await readFile(join(publicRoot, safePath));
    response.writeHead(200, { "content-type": contentTypes[extname(safePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("Evidence server did not expose a port");
const origin = `http://127.0.0.1:${address.port}`;

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

async function observe(page: Page, variant: "before" | "after", viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport);
  await page.goto(`${origin}/?variant=${variant}&screen=payment-request`, { waitUntil: "networkidle" });
  const action = page.getByRole("button", { name: "Confirm request" });
  await action.waitFor();
  const measurement = await action.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
      position: getComputedStyle(element).position,
    };
  });
  const screenshotPath = `artifacts/react/${variant}-${viewport.width}x${viewport.height}.png`;
  await page.screenshot({ path: join(root, screenshotPath), fullPage: true });
  const observation = {
    target: "react" as const,
    screenId: "payment-request",
    viewport,
    primaryAction: measurement.bounds,
    position: measurement.position,
    screenshotPath,
    graphExpectsPersistent: variant === "after",
  };
  return { observation, findings: verifyRenderedPrimaryAction(observation) };
}

let browser: Browser | undefined;
try {
  browser = await launchBrowser();
  const page = await browser.newPage();
  const before = await observe(page, "before", { width: 375, height: 667 });
  const after = await observe(page, "after", { width: 375, height: 667 });
  const regular = await observe(page, "after", { width: 1024, height: 768 });

  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(`${origin}/?variant=after`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Request payment" }).click();
  await page.getByRole("heading", { name: "Request payment" }).waitFor();
  await page.getByRole("button", { name: "Confirm request" }).click();
  await page.getByRole("heading", { name: "Request sent" }).waitFor();

  if (before.findings.length === 0) throw new Error("The controlled before artifact produced no rendered finding");
  if (after.findings.length > 0) throw new Error("The repaired compact artifact still has rendered findings");
  if (regular.observation.position !== "static") throw new Error("The repaired action did not return inline on a regular viewport");

  const report = {
    generatedAt: new Date().toISOString(),
    before,
    after,
    regular,
    flow: { homeToRequestToReceipt: "passed" },
    verdict: "verified",
  };
  await writeFile(join(artifactRoot, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    beforePosition: before.observation.position,
    beforeFindings: before.findings.length,
    afterPosition: after.observation.position,
    afterFindings: after.findings.length,
    regularPosition: regular.observation.position,
    flow: report.flow.homeToRequestToReceipt,
    verdict: report.verdict,
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
