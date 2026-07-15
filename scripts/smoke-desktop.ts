import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { IntentFormDesktopApi } from "../packages/desktop-bridge/src/protocol.ts";
import { demoGraph } from "../packages/proof-report/src/demo.ts";
import { _electron as electron, type Page } from "playwright";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "apps/studio-desktop/package.json"));
const electronPath = require("electron") as string;
const defaultPackagedExecutable = process.platform === "darwin"
  ? join(root, `output/desktop/IntentForm-darwin-${process.arch}/IntentForm.app/Contents/MacOS/IntentForm`)
  : process.platform === "win32"
    ? join(root, `output/desktop/IntentForm-win32-${process.arch}/IntentForm.exe`)
    : join(root, `output/desktop/IntentForm-linux-${process.arch}/IntentForm`);
const packagedExecutable = process.env.INTENTFORM_DESKTOP_EXECUTABLE
  ?? (process.argv.includes("--packaged") ? defaultPackagedExecutable : undefined);
const isolatedProjectRoot = process.env.INTENTFORM_PROJECT_DIR
  ? undefined
  : await mkdtemp(join(tmpdir(), "intentform-desktop-smoke-"));
const projectDirectory = process.env.INTENTFORM_PROJECT_DIR ?? join(isolatedProjectRoot!, ".intentform");
if (isolatedProjectRoot) {
  await mkdir(projectDirectory, { recursive: true });
  await writeFile(join(projectDirectory, "graph.json"), `${JSON.stringify(demoGraph)}\n`, "utf8");
  const initialized = spawnSync("git", ["init", "--quiet", isolatedProjectRoot], { encoding: "utf8" });
  if (initialized.error) throw initialized.error;
  if (initialized.status !== 0) throw new Error(`Could not initialize the isolated desktop Git fixture: ${initialized.stderr}`);
}
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

const desktopEnvironment = {
  ...process.env,
  INTENTFORM_PROJECT_DIR: projectDirectory,
  INTENTFORM_NODE_PATH: process.execPath,
  ELECTRON_ENABLE_SECURITY_WARNINGS: "1",
};

type DesktopHarness = {
  page: Page;
  readClipboard: () => Promise<string>;
  close: () => Promise<void>;
};

function findOpenPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not reserve a desktop debugging port."));
      const { port } = address;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

async function launchDesktop(): Promise<DesktopHarness> {
  const desktop = await electron.launch({
    executablePath: electronPath,
    args: [join(root, "apps/studio-desktop")],
    cwd: root,
    env: desktopEnvironment,
    timeout: 60_000,
  });
  return {
    page: await desktop.firstWindow({ timeout: 60_000 }),
    readClipboard: () => desktop.evaluate(({ clipboard }) => clipboard.readText()),
    close: () => desktop.close(),
  };
}

type CdpResponse = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message?: string } };

class CdpClient {
  #nextId = 1;
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  readonly errors: string[] = [];
  readonly contexts: Array<{ id: number; name?: string; auxData?: { isDefault?: boolean; frameId?: string } }> = [];
  readonly socket: WebSocket;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as CdpResponse;
      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        this.#pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message ?? "CDP command failed."));
        else pending.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") this.errors.push(JSON.stringify(message.params));
      if (message.method === "Runtime.consoleAPICalled" && (message.params as { type?: unknown } | undefined)?.type === "error") this.errors.push(JSON.stringify(message.params));
      if (message.method === "Runtime.executionContextCreated") {
        const context = (message.params as { context?: { id?: unknown; name?: unknown; auxData?: { isDefault?: boolean; frameId?: string } } } | undefined)?.context;
        if (typeof context?.id === "number") this.contexts.push({ id: context.id, ...(typeof context.name === "string" ? { name: context.name } : {}), ...(context.auxData ? { auxData: context.auxData } : {}) });
      }
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out connecting to the packaged renderer.")), 10_000);
      socket.addEventListener("open", () => { clearTimeout(timeout); resolvePromise(); }, { once: true });
      socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error("Could not connect to the packaged renderer.")); }, { once: true });
    });
    return new CdpClient(socket);
  }

  send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.#nextId++;
    const result = new Promise<T>((resolvePromise, reject) => this.#pending.set(id, {
      resolve: (value) => resolvePromise(value as T),
      reject,
    }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  async evaluate<T>(expression: string, contextId?: number): Promise<T> {
    const response = await this.send<{ result?: { value?: T; description?: string }; exceptionDetails?: unknown }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      ...(contextId ? { contextId } : {}),
    });
    if (response.exceptionDetails) throw new Error(`Packaged renderer evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
    return response.result?.value as T;
  }

  close(): void { this.socket.close(); }
}

async function readSystemClipboard(): Promise<string> {
  if (process.platform !== "darwin") throw new Error("The packaged clipboard smoke gate currently requires macOS.");
  const clipboard = await import("node:child_process");
  return new Promise<string>((resolvePromise, reject) => clipboard.execFile("/usr/bin/pbpaste", (error, stdout) => error ? reject(error) : resolvePromise(stdout)));
}

async function runPackagedDesktopSmoke(executable: string): Promise<void> {
  // The hardened packaged binary disables Node inspection, so Playwright's
  // Electron launcher is intentionally unavailable. Use the renderer's
  // test-only Chromium target directly without weakening production fuses.
  await mkdir(projectDirectory, { recursive: true });
  const port = await findOpenPort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`, "--enable-logging=stderr"], {
    cwd: root,
    env: desktopEnvironment,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let diagnostics = "";
  const append = (chunk: Buffer) => { diagnostics = `${diagnostics}${chunk.toString("utf8")}`.slice(-16_384); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);

  let cdp: CdpClient | null = null;
  try {
    const deadline = Date.now() + 60_000;
    let target: { url: string; webSocketDebuggerUrl: string } | undefined;
    while (Date.now() < deadline && !target) {
      if (child.exitCode !== null) throw new Error(`Packaged desktop exited before its renderer was ready.\n${diagnostics}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) });
        const targets = await response.json() as Array<{ type?: unknown; url?: unknown; webSocketDebuggerUrl?: unknown }>;
        target = targets.find((candidate): candidate is { url: string; webSocketDebuggerUrl: string } => candidate.type === "page"
          && typeof candidate.url === "string" && candidate.url.includes("/studio") && typeof candidate.webSocketDebuggerUrl === "string");
      } catch { /* Browser or renderer is still starting. */ }
      if (!target) await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
    if (!target) throw new Error(`Packaged desktop did not expose its renderer test target.\n${diagnostics}`);
    const response = await fetch(target.url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Packaged Studio returned HTTP ${response.status}.`);

    cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    const frameTree = await cdp.send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree");
    const mainContext = cdp.contexts.filter((context) => context.auxData?.isDefault && context.auxData.frameId === frameTree.frameTree.frame.id).at(-1)?.id;
    if (!mainContext) throw new Error(`Packaged renderer did not expose its default JavaScript context: ${JSON.stringify(cdp.contexts)}`);
    let result: {
      nodeProcess: string;
      require: string;
      apiKeys: string[];
      runtimeSecurity: { rendererSandboxed?: boolean; contextIsolated?: boolean };
      snapshot: Awaited<ReturnType<IntentFormDesktopApi["snapshot"]>>;
      closeFocused: boolean;
    };
    try {
      result = await cdp.evaluate<typeof result>(`(async () => {
      for (let attempt = 0; attempt < 100 && !window.intentformDesktop; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const api = window.intentformDesktop;
      if (!api) throw new Error("Desktop preload API is missing.");
      await api.setService({ service: "mcp", action: "start" });
      await api.copyMcpConfiguration();
      document.querySelector('[aria-label="Show workspace status"]')?.click();
      for (let attempt = 0; attempt < 40 && !document.querySelector('[aria-label="Open desktop services"]'); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const desktopTrigger = document.querySelector('[aria-label="Open desktop services"]');
      desktopTrigger?.focus();
      desktopTrigger?.click();
      for (let attempt = 0; attempt < 40 && document.activeElement?.getAttribute("aria-label") !== "Close desktop services"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      let snapshot = await api.snapshot();
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const ready = snapshot.project.granted
          && snapshot.toolchains.length === 6
          && snapshot.git?.repository === true
          && snapshot.services.find((service) => service.id === "mcp")?.phase === "ready";
        if (ready) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
        snapshot = snapshot.git?.repository ? await api.snapshot() : await api.refreshGit();
      }
      return {
        nodeProcess: typeof globalThis.process,
        require: typeof globalThis.require,
        apiKeys: Object.keys(api).sort(),
        runtimeSecurity: api.runtimeSecurity,
        snapshot,
        closeFocused: document.activeElement?.getAttribute("aria-label") === "Close desktop services",
      };
      })()`, mainContext);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nContexts: ${JSON.stringify(cdp.contexts)}\n${diagnostics}`);
    }
    if (result.nodeProcess !== "undefined" || result.require !== "undefined"
      || !result.runtimeSecurity.rendererSandboxed || !result.runtimeSecurity.contextIsolated
      || result.apiKeys.some((key) => ["invoke", "send", "on", "spawn", "readFile"].includes(key))) {
      throw new Error("The packaged renderer exposed an unsafe runtime boundary.");
    }
    if (!result.snapshot.project.granted || result.snapshot.toolchains.length !== 6 || !result.snapshot.git?.repository
      || result.snapshot.services.find((service) => service.id === "mcp")?.phase !== "ready" || !result.closeFocused) {
      throw new Error(`The packaged desktop did not expose the granted project, capabilities, Git, ready MCP, and dialog focus state: ${JSON.stringify({
        project: result.snapshot.project,
        toolchainCount: result.snapshot.toolchains.length,
        git: result.snapshot.git,
        services: result.snapshot.services,
        closeFocused: result.closeFocused,
      })}`);
    }

    const copied = await readSystemClipboard();
    const configuration = JSON.parse(copied) as { url?: unknown; headers?: { Authorization?: unknown } };
    if (typeof configuration.url !== "string" || !configuration.url.startsWith("http://127.0.0.1:")
      || typeof configuration.headers?.Authorization !== "string" || !configuration.headers.Authorization.startsWith("Bearer ")
      || JSON.stringify(result.snapshot).includes(configuration.headers.Authorization)) {
      throw new Error("The packaged MCP configuration was not loopback-authenticated or its token leaked into renderer state.");
    }

    const screenshot = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    await mkdir(join(root, "output/playwright"), { recursive: true });
    await writeFile(join(root, "output/playwright/studio-desktop-services.png"), Buffer.from(screenshot.data, "base64"));
    const closed = await cdp.evaluate<{ dialogClosed: boolean; focusReturned: boolean }>(`(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      for (let attempt = 0; attempt < 40 && document.activeElement?.getAttribute("aria-label") !== "Open desktop services"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const focusReturned = document.activeElement?.getAttribute("aria-label") === "Open desktop services";
      await window.intentformDesktop.setService({ service: "mcp", action: "stop" });
      return { dialogClosed: !document.querySelector('[role="dialog"]'), focusReturned };
    })()`, mainContext);
    if (!closed.dialogClosed || !closed.focusReturned || cdp.errors.length > 0) {
      throw new Error(`The packaged renderer failed dialog/error checks: ${JSON.stringify({ ...closed, errors: cdp.errors })}`);
    }
  } finally {
    cdp?.close();
    if (child.exitCode === null) child.kill("SIGTERM");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

if (packagedExecutable) {
  try {
    await runPackagedDesktopSmoke(packagedExecutable);
    process.stdout.write("Packaged desktop scenario: signed launch, sandbox, grant, Git/toolchains, MCP token isolation and dialog lifecycle passed\n");
  } finally {
    if (isolatedProjectRoot) await rm(isolatedProjectRoot, { recursive: true, force: true });
  }
} else {
const desktop = await launchDesktop();

try {
  const page = desktop.page;
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForURL(/\/studio$/, { timeout: 30_000 });
  await page.getByRole("button", { name: "Show workspace status" }).click();
  await page.getByRole("button", { name: "Open desktop services" }).click();
  await page.getByRole("dialog", { name: "Desktop services" }).waitFor();
  await page.getByText("Installed capabilities").waitFor();
  await page.getByText("Git · read only").waitFor();

  const rendererBoundary = await page.evaluate(() => ({
    nodeProcess: typeof (globalThis as { process?: unknown }).process,
    require: typeof (globalThis as { require?: unknown }).require,
    apiKeys: Object.keys((window as Window & { intentformDesktop?: IntentFormDesktopApi }).intentformDesktop ?? {}).sort(),
    snapshot: Boolean((window as Window & { intentformDesktop?: IntentFormDesktopApi }).intentformDesktop?.snapshot),
    runtimeSecurity: (window as Window & { intentformDesktop?: IntentFormDesktopApi }).intentformDesktop?.runtimeSecurity,
  }));
  if (rendererBoundary.nodeProcess !== "undefined" || rendererBoundary.require !== "undefined") {
    throw new Error("The desktop renderer exposed Node.js globals.");
  }
  if (!rendererBoundary.snapshot || !rendererBoundary.runtimeSecurity?.rendererSandboxed || !rendererBoundary.runtimeSecurity.contextIsolated
    || rendererBoundary.apiKeys.some((key) => ["invoke", "send", "on", "spawn", "readFile"].includes(key))) {
    throw new Error("The desktop preload exposed a generic privileged API.");
  }

  await page.getByRole("button", { name: "Start MCP service" }).click();
  const mcpDeadline = Date.now() + 20_000;
  while (Date.now() < mcpDeadline) {
    const current = await page.evaluate(() => (window as unknown as { intentformDesktop: IntentFormDesktopApi }).intentformDesktop.snapshot());
    const mcp = current.services.find((service) => service.id === "mcp");
    if (mcp?.phase === "ready") break;
    if (mcp?.phase === "crashed") throw new Error(`Desktop MCP failed to start: ${mcp.message}`);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  await page.getByRole("button", { name: "Stop MCP service" }).waitFor({ timeout: 2_000 });
  await page.getByRole("button", { name: "Copy MCP client configuration" }).click();
  const copied = await desktop.readClipboard();
  const configuration = JSON.parse(copied) as { url?: unknown; headers?: { Authorization?: unknown } };
  if (typeof configuration.url !== "string" || !configuration.url.startsWith("http://127.0.0.1:")
    || typeof configuration.headers?.Authorization !== "string" || !configuration.headers.Authorization.startsWith("Bearer ")) {
    throw new Error("The desktop shell did not copy a bounded authenticated loopback MCP configuration.");
  }
  const rendererSnapshot = await page.evaluate(() => (window as unknown as { intentformDesktop: IntentFormDesktopApi }).intentformDesktop.snapshot());
  if (JSON.stringify(rendererSnapshot).includes(configuration.headers.Authorization)) {
    throw new Error("The MCP bearer token leaked into the renderer snapshot.");
  }

  const dialog = page.getByRole("dialog", { name: "Desktop services" });
  await dialog.evaluate((element) => { element.scrollTo({ top: 0 }); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(root, "output/playwright/studio-desktop-services.png") });
  await page.getByRole("button", { name: "Stop MCP service" }).click();
  await page.getByRole("button", { name: "Start MCP service" }).waitFor({ timeout: 10_000 });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  if (await page.getByRole("button", { name: "Open desktop services" }).evaluate((element) => element !== document.activeElement)) {
    throw new Error("Closing the desktop dialog did not restore trigger focus.");
  }
  if (consoleErrors.length > 0 || pageErrors.length > 0) {
    throw new Error(`Desktop renderer emitted errors: ${[...consoleErrors, ...pageErrors].join(" | ")}`);
  }
  process.stdout.write("Desktop scenario: sandbox, named IPC, project grant, toolchains, Git, MCP lifecycle and token isolation passed\n");
} finally {
  await desktop.close();
  if (isolatedProjectRoot) await rm(isolatedProjectRoot, { recursive: true, force: true });
}
}
