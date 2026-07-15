import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import {
  app,
  autoUpdater,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  session,
  shell,
  utilityProcess,
  type IpcMainInvokeEvent,
  type UtilityProcess,
} from "electron";
import {
  DesktopServiceSupervisor,
  ProjectGrantStore,
  defaultToolchainPaths,
  desktopIpcChannels,
  desktopSnapshotSchema,
  externalUrlRequestSchema,
  inspectGitRepository,
  isTrustedRendererUrl,
  minimalDesktopEnvironment,
  probeToolchains,
  safeExternalUrl,
  sanitizeDesktopText,
  serviceCommandSchema,
  type DesktopCommandRunner,
  type DesktopManagedProcess,
  type DesktopProcessLauncher,
  type DesktopServiceId,
  type DesktopSnapshot,
  type GitSnapshot,
  type ProjectGrant,
  type ToolchainStatus,
} from "@intentform/desktop-bridge";
import { desktopWindowWebPreferences, navigationAllowed } from "./window-options.ts";

app.enableSandbox();

const EMPTY_TOOLCHAINS: ToolchainStatus[] = ([
  ["node", "Node.js"],
  ["git", "Git"],
  ["pnpm", "pnpm"],
  ["expo", "Expo"],
  ["xcode", "Xcode"],
  ["android", "Android SDK"],
] as const).map(([id, label]) => ({ id, label, status: "missing", version: null, detail: "Not checked yet." }));

function findOpenPort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a loopback port."));
      const { port } = address;
      server.close((error) => error ? reject(error) : resolvePromise(port));
    });
  });
}

class BoundedCommandRunner implements DesktopCommandRunner {
  async run(executable: string, args: readonly string[], options: { cwd?: string; timeoutMs: number }) {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolvePromise, reject) => {
      const child = spawn(executable, [...args], {
        ...(options.cwd ? { cwd: options.cwd } : {}),
        env: minimalDesktopEnvironment(process.env),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const append = (current: string, chunk: Buffer) => `${current}${chunk.toString("utf8")}`.slice(-32_768);
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
      const timeout = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
      child.once("error", (error) => { clearTimeout(timeout); reject(error); });
      child.once("exit", (code) => { clearTimeout(timeout); resolvePromise({ code, stdout, stderr }); });
    });
  }
}

class ElectronManagedProcess implements DesktopManagedProcess {
  readonly #exitListeners: Array<(code: number | null) => void> = [];
  readonly #logListeners: Array<(text: string) => void> = [];
  #exitCode: number | null | undefined;
  #lastLog = "";

  constructor(readonly child: UtilityProcess) {
    child.stdout?.on("data", (chunk: Buffer) => this.#log(chunk.toString("utf8")));
    child.stderr?.on("data", (chunk: Buffer) => this.#log(chunk.toString("utf8")));
    child.once("exit", (code) => {
      this.#exitCode = code;
      for (const listener of this.#exitListeners) listener(code);
    });
  }

  get pid(): number | null { return this.child.pid ?? null; }
  terminate(): void { this.child.kill(); }
  onExit(listener: (code: number | null) => void): void {
    this.#exitListeners.push(listener);
    if (this.#exitCode !== undefined) queueMicrotask(() => listener(this.#exitCode ?? null));
  }
  onLog(listener: (text: string) => void): void {
    this.#logListeners.push(listener);
    if (this.#lastLog) queueMicrotask(() => listener(this.#lastLog));
  }
  #log(source: string): void {
    for (const line of source.split(/\r?\n/)) {
      const text = sanitizeDesktopText(line);
      if (!text) continue;
      this.#lastLog = text;
      for (const listener of this.#logListeners) listener(text);
    }
  }
}

class ElectronServiceLauncher implements DesktopProcessLauncher {
  studioOrigin = "";
  mcpAddress = "";
  mcpToken = "";

  constructor(
    readonly workspaceRoot: string,
    readonly applicationCodeRoot: string,
    readonly project: () => ProjectGrant,
  ) {}

  async launch(service: DesktopServiceId): Promise<DesktopManagedProcess> {
    return service === "studio" ? this.#launchStudio() : this.#launchMcp();
  }

  async #launchStudio(): Promise<DesktopManagedProcess> {
    const port = await findOpenPort();
    const origin = `http://127.0.0.1:${port}`;
    const studioEntry = app.isPackaged
      ? join(process.resourcesPath, "studio", "apps", "studio-web", "server.js")
      : join(dirname(this.applicationCodeRoot), "studio", "apps", "studio-web", "server.js");
    const bootstrapEntry = join(this.applicationCodeRoot, "service", "studio-service.mjs");
    if (!existsSync(studioEntry) || !existsSync(bootstrapEntry)) throw new Error(app.isPackaged ? "The packaged Studio service is missing." : "Build Studio before starting the desktop shell.");
    const args: string[] = [];
    const child = utilityProcess.fork(bootstrapEntry, args, {
      cwd: dirname(studioEntry),
      env: minimalDesktopEnvironment(process.env, {
        PORT: String(port),
        HOSTNAME: "127.0.0.1",
        INTENTFORM_ENABLE_LOCAL_PROJECT_API: "1",
        INTENTFORM_PROJECT_DIR: this.project().path,
        INTENTFORM_STUDIO_ENTRY: studioEntry,
      }),
      serviceName: "IntentForm Studio service",
      stdio: "pipe",
      allowLoadingUnsignedLibraries: false,
      disclaim: false,
    });
    const managed = new ElectronManagedProcess(child);
    let lastLog = "";
    managed.onLog((text) => { lastLog = text; });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${origin}/studio`, { redirect: "manual", signal: AbortSignal.timeout(750) });
        if (response.status >= 200 && response.status < 500) {
          this.studioOrigin = origin;
          return managed;
        }
      } catch { /* Service is still starting. */ }
      await delay(100);
    }
    managed.terminate();
    throw new Error(`The local Studio service did not become ready within 20 seconds.${lastLog ? ` Last service message: ${lastLog}` : ""}`);
  }

  async #launchMcp(): Promise<DesktopManagedProcess> {
    const entry = app.isPackaged
      ? join(app.getAppPath(), "service", "mcp-service.mjs")
      : join(this.applicationCodeRoot, "service", "mcp-service.mjs");
    if (!existsSync(entry)) throw new Error("The desktop MCP service bundle is missing.");
    this.mcpToken = randomBytes(32).toString("hex");
    const child = utilityProcess.fork(entry, [], {
      cwd: this.workspaceRoot,
      env: minimalDesktopEnvironment(process.env, {
        INTENTFORM_MCP_TOKEN: this.mcpToken,
        INTENTFORM_PROJECT_DIR: this.project().path,
      }),
      serviceName: "IntentForm MCP service",
      stdio: "pipe",
      allowLoadingUnsignedLibraries: false,
      disclaim: false,
    });
    const managed = new ElectronManagedProcess(child);
    this.mcpAddress = await new Promise<string>((resolvePromise, reject) => {
      const timeout = setTimeout(() => reject(new Error("The authenticated MCP service did not become ready.")), 10_000);
      child.on("message", (message: unknown) => {
        if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "ready") return;
        const address = (message as { address?: unknown }).address;
        if (typeof address !== "string" || !address.startsWith("http://127.0.0.1:")) return;
        clearTimeout(timeout);
        resolvePromise(address);
      });
      child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`The MCP service exited with code ${code}.`)); });
    }).catch((error) => {
      managed.terminate();
      throw error;
    });
    return managed;
  }
}

const workspaceRoot = app.isPackaged ? process.resourcesPath : resolve(app.getAppPath(), "../..");
const applicationCodeRoot = app.isPackaged ? app.getAppPath() : join(app.getAppPath(), ".desktop", "app");
const grantStore = new ProjectGrantStore(join(app.getPath("userData"), "path-grants.json"));
const commandRunner = new BoundedCommandRunner();
let activeProject: ProjectGrant;
let mainWindow: BrowserWindow | null = null;
let toolchains = EMPTY_TOOLCHAINS;
let git: GitSnapshot | null = null;
let update: DesktopSnapshot["update"] = { supported: false, phase: "disabled", message: "Updates require a signed packaged build and HTTPS feed." };
const launcher = new ElectronServiceLauncher(workspaceRoot, applicationCodeRoot, () => activeProject);
const supervisor = new DesktopServiceSupervisor(launcher);

function snapshot(): DesktopSnapshot {
  return desktopSnapshotSchema.parse({
    version: 1,
    platform: process.platform,
    appVersion: app.getVersion(),
    project: { granted: Boolean(activeProject), name: activeProject ? basename(dirname(activeProject.path)) : null, path: activeProject?.path ?? null },
    services: supervisor.snapshots(),
    toolchains,
    git,
    update,
  });
}

function broadcast(): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(desktopIpcChannels.changed, snapshot());
}
supervisor.subscribe(broadcast);

function assertTrusted(event: IpcMainInvokeEvent): void {
  const senderUrl = event.senderFrame?.url ?? "";
  if (!launcher.studioOrigin || !isTrustedRendererUrl(senderUrl, launcher.studioOrigin)) {
    throw new Error("Desktop IPC rejected an untrusted renderer.");
  }
}

async function refreshToolchains(): Promise<void> {
  const paths = defaultToolchainPaths(workspaceRoot);
  toolchains = await probeToolchains(process.platform, paths, commandRunner);
  broadcast();
}

async function refreshGit(): Promise<void> {
  const gitPath = defaultToolchainPaths(workspaceRoot).git;
  git = await inspectGitRepository(dirname(activeProject.path), gitPath, commandRunner);
  broadcast();
}

async function chooseProject(): Promise<boolean> {
  const options: Electron.OpenDialogOptions = {
    title: "Open an IntentForm project",
    properties: ["openDirectory", "createDirectory"],
    buttonLabel: "Grant project access",
    securityScopedBookmarks: false,
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || !result.filePaths[0]) return false;
  activeProject = grantStore.grant(result.filePaths[0]);
  await supervisor.restart("studio");
  if (supervisor.snapshots().find((item) => item.id === "mcp")?.phase !== "stopped") await supervisor.restart("mcp");
  await Promise.all([refreshToolchains(), refreshGit()]);
  void mainWindow?.loadURL(`${launcher.studioOrigin}/studio`);
  return true;
}

function installIpc(): void {
  ipcMain.handle(desktopIpcChannels.snapshot, (event) => { assertTrusted(event); return snapshot(); });
  ipcMain.handle(desktopIpcChannels.chooseProject, async (event) => { assertTrusted(event); await chooseProject(); return snapshot(); });
  ipcMain.handle(desktopIpcChannels.refreshToolchains, async (event) => { assertTrusted(event); await refreshToolchains(); return snapshot(); });
  ipcMain.handle(desktopIpcChannels.refreshGit, async (event) => { assertTrusted(event); await refreshGit(); return snapshot(); });
  ipcMain.handle(desktopIpcChannels.setService, async (event, input: unknown) => {
    assertTrusted(event);
    const command = serviceCommandSchema.parse(input);
    if (command.action === "start") await supervisor.start(command.service);
    else if (command.action === "stop") await supervisor.stop(command.service);
    else await supervisor.restart(command.service);
    return snapshot();
  });
  ipcMain.handle(desktopIpcChannels.copyMcpConfiguration, (event) => {
    assertTrusted(event);
    if (!launcher.mcpAddress || !launcher.mcpToken) throw new Error("Start the MCP service before copying its configuration.");
    clipboard.writeText(JSON.stringify({ transport: "streamable-http", url: launcher.mcpAddress, headers: { Authorization: `Bearer ${launcher.mcpToken}` } }, null, 2));
  });
  ipcMain.handle(desktopIpcChannels.openExternal, async (event, input: unknown) => {
    assertTrusted(event);
    const request = externalUrlRequestSchema.parse(input);
    await shell.openExternal(safeExternalUrl(request.url));
  });
  ipcMain.handle(desktopIpcChannels.checkForUpdates, async (event) => {
    assertTrusted(event);
    if (!update.supported) return snapshot();
    update = { ...update, phase: "checking", message: "Checking the signed HTTPS update feed." };
    broadcast();
    try { await autoUpdater.checkForUpdates(); } catch (error) {
      update = { ...update, phase: "failed", message: sanitizeDesktopText(error instanceof Error ? error.message : "Update check failed.") };
    }
    return snapshot();
  });
}

function installUpdateLifecycle(): void {
  const feed = process.env.INTENTFORM_UPDATE_FEED_URL;
  if (!app.isPackaged || !feed) return;
  const url = safeExternalUrl(feed);
  autoUpdater.setFeedURL({ url });
  update = { supported: true, phase: "idle", message: "Signed automatic updates are enabled." };
  autoUpdater.on("update-available", () => { update = { ...update, phase: "available", message: "A signed update is downloading." }; broadcast(); });
  autoUpdater.on("update-not-available", () => { update = { ...update, phase: "current", message: "IntentForm is current." }; broadcast(); });
  autoUpdater.on("update-downloaded", () => { update = { ...update, phase: "downloaded", message: "Update downloaded; restart IntentForm to install it." }; broadcast(); });
  autoUpdater.on("error", (error) => { update = { ...update, phase: "failed", message: sanitizeDesktopText(error.message) }; broadcast(); });
}

function installMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => void chooseProject() },
        { type: "separator" },
        process.platform === "darwin" ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow(): Promise<void> {
  const preload = join(applicationCodeRoot, "preload.cjs");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 920,
    minHeight: 640,
    show: false,
    title: "IntentForm",
    backgroundColor: "#f7f8f5",
    webPreferences: { ...desktopWindowWebPreferences, preload },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(safeExternalUrl(url));
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!navigationAllowed(url, launcher.studioOrigin)) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  await mainWindow.loadURL(`${launcher.studioOrigin}/studio`);
}

async function resolveInitialProject(): Promise<ProjectGrant | null> {
  const configured = process.env.INTENTFORM_PROJECT_DIR;
  if (configured) return grantStore.grant(configured);
  const remembered = grantStore.list()[0];
  if (remembered && grantStore.isGranted(remembered.path)) return remembered;
  if (!app.isPackaged && existsSync(join(workspaceRoot, ".intentform"))) return grantStore.grant(workspaceRoot);
  const result = await dialog.showOpenDialog({
    title: "Choose an IntentForm project",
    message: "IntentForm grants access only to the project you select.",
    properties: ["openDirectory"],
    buttonLabel: "Grant project access",
  });
  return result.canceled || !result.filePaths[0] ? null : grantStore.grant(result.filePaths[0]);
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  activeProject = await resolveInitialProject() ?? await (async () => { app.quit(); throw new Error("No project was granted."); })();
  installIpc();
  installUpdateLifecycle();
  installMenu();
  await supervisor.start("studio");
  if (supervisor.snapshots()[0]?.phase !== "ready") throw new Error(supervisor.snapshots()[0]?.message ?? "Studio failed to start.");
  await Promise.all([refreshToolchains(), refreshGit()]);
  await createWindow();
}).catch((error) => {
  const message = sanitizeDesktopText(error instanceof Error ? error.message : "Desktop startup failed.");
  console.error(`[intentform-desktop] ${message}`);
  void dialog.showErrorBox("IntentForm could not start", message);
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", () => { void supervisor.stopAll(); });
app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0 && launcher.studioOrigin) void createWindow(); });
