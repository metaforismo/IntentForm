import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, BrowserContext, BrowserContextOptions, ConsoleMessage, Page, Request } from "playwright";

const artifactRoot = join(process.cwd(), "output/playwright/failures");

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function redact(value: string) {
  return value
    .replace(/(?:sk|sess|key)-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 500);
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split("?", 1)[0] ?? value;
  }
}

function consoleFailure(message: ConsoleMessage) {
  const location = message.location();
  const source = location.url ? ` (${safeUrl(location.url)}:${location.lineNumber ?? 0})` : "";
  return `console.error: ${redact(message.text())}${source}`;
}

function requestFailure(request: Request) {
  const reason = request.failure()?.errorText ?? "unknown network error";
  return `request failed: ${request.method()} ${safeUrl(request.url())} (${redact(reason)})`;
}

export interface SmokeScenario {
  name: string;
  context?: BrowserContextOptions;
  allowConsoleError?(message: ConsoleMessage): boolean;
  run(page: Page, context: BrowserContext): Promise<void>;
}

export async function runSmokeScenario(browser: Browser, scenario: SmokeScenario) {
  const requestedScenario = process.env.SMOKE_SCENARIO?.trim().toLowerCase();
  if (requestedScenario && !scenario.name.toLowerCase().includes(requestedScenario)) return;
  const name = slug(scenario.name);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    ...scenario.context,
  });
  const failures: string[] = [];
  let scenarioError: unknown;

  const attachGuards = (page: Page) => {
    page.setDefaultTimeout(10_000);
    page.on("console", (message) => {
      if (message.type() === "error" && !scenario.allowConsoleError?.(message)) {
        failures.push(consoleFailure(message));
      }
    });
    page.on("pageerror", (error) => failures.push(`page error: ${redact(error.message)}`));
    page.on("requestfailed", (request) => failures.push(requestFailure(request)));
  };

  context.on("page", attachGuards);
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();

  try {
    await scenario.run(page, context);
    await page.waitForTimeout(50);
    if (failures.length > 0) throw new Error(failures.join("\n"));
  } catch (error) {
    scenarioError = error;
    await mkdir(artifactRoot, { recursive: true });
    const pages = context.pages();
    await Promise.all(pages.map(async (candidate, index) => {
      try {
        await candidate.screenshot({ path: join(artifactRoot, `${name}-${index + 1}.png`), fullPage: true });
      } catch {
        // A closed or crashed page may not be capturable; the trace still records it.
      }
    }));
    await context.tracing.stop({ path: join(artifactRoot, `${name}.zip`) });
  } finally {
    if (!scenarioError) await context.tracing.stop();
    await context.close();
  }

  if (scenarioError) {
    const message = scenarioError instanceof Error ? scenarioError.message : String(scenarioError);
    throw new Error(`[${scenario.name}] ${message}\nArtifacts: ${join(artifactRoot, name)}`);
  }
  console.log(`Studio scenario ${scenario.name}: passed`);
}

export async function gotoStudio(page: Page, origin: string, path = "/") {
  const response = await page.goto(`${origin}${path}`, { waitUntil: "networkidle" });
  if (!response?.ok()) throw new Error(`Navigation to ${path} returned ${response?.status() ?? "no response"}`);
  return response;
}

interface HeaderResponse {
  headers(): Record<string, string>;
}

export function assertSecurityHeaders(response: HeaderResponse, label: string) {
  const headers = response.headers();
  const expected: Record<string, string> = {
    "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-content-type-options": "nosniff",
    "x-frame-options": "SAMEORIGIN",
  };
  for (const [name, value] of Object.entries(expected)) {
    if (headers[name] !== value) throw new Error(`${label} has an invalid ${name} header`);
  }
  const policy = headers["content-security-policy"] ?? "";
  for (const directive of [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "frame-src 'self'",
    "script-src-attr 'none'",
  ]) {
    if (!policy.includes(directive)) throw new Error(`${label} CSP is missing ${directive}`);
  }
  if (policy.includes("'unsafe-eval'")) throw new Error(`${label} production CSP allows unsafe-eval`);
  if (headers["x-powered-by"]) throw new Error(`${label} exposes X-Powered-By`);
}
