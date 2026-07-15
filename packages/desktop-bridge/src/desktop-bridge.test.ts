import { mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  DesktopServiceSupervisor,
  ProjectGrantStore,
  assertGrantedPath,
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
} from "./index.ts";

const temporaryDirectories: string[] = [];
function temporaryDirectory(): string {
  const path = join(tmpdir(), `intentform-desktop-${randomUUID()}`);
  mkdirSync(path, { recursive: true });
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("desktop path grants", () => {
  it("stores explicit .intentform grants atomically with private permissions", () => {
    const root = temporaryDirectory();
    const project = join(root, "project");
    mkdirSync(join(project, ".intentform"), { recursive: true });
    const store = new ProjectGrantStore(join(root, "config", "path-grants.json"));
    const grant = store.grant(project, "2026-07-14T12:00:00.000Z");
    expect(grant.path).toBe(realpathSync.native(join(project, ".intentform")));
    expect(store.isGranted(project)).toBe(true);
    expect(JSON.parse(readFileSync(store.path, "utf8"))).toMatchObject({ version: 1, projects: [grant] });
  });

  it("rejects missing projects and symlinked grant files", () => {
    const root = temporaryDirectory();
    const storePath = join(root, "config", "path-grants.json");
    const store = new ProjectGrantStore(storePath);
    expect(() => store.grant(root)).toThrow(/does not contain/);
    mkdirSync(dirname(storePath), { recursive: true });
    const outside = join(root, "outside.json");
    writeFileSync(outside, "{}\n");
    symlinkSync(outside, storePath);
    expect(() => store.list()).toThrow(/regular file/);
  });

  it("requires privileged operations to match the exact active grant", () => {
    const root = temporaryDirectory();
    expect(assertGrantedPath(root, root)).toBe(root);
    expect(() => assertGrantedPath(root, join(root, "child"))).toThrow(/active path grant/);
  });
});

describe("desktop security boundaries", () => {
  it("accepts credential-free HTTPS external links only", () => {
    expect(safeExternalUrl("https://electronjs.org/docs/latest/")).toBe("https://electronjs.org/docs/latest/");
    expect(() => safeExternalUrl("http://example.com")).toThrow(/HTTPS/);
    expect(() => safeExternalUrl("https://user:secret@example.com")).toThrow(/credential-free/);
    expect(() => safeExternalUrl("file:///etc/passwd")).toThrow(/HTTPS/);
  });

  it("validates the exact Studio origin and exposed routes", () => {
    expect(isTrustedRendererUrl("http://127.0.0.1:4123/studio", "http://127.0.0.1:4123")).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:4123/runtime-preview", "http://127.0.0.1:4123")).toBe(false);
    expect(isTrustedRendererUrl("http://127.0.0.1:9999/studio", "http://127.0.0.1:4123")).toBe(false);
  });

  it("redacts logs and strips dangerous inherited process controls", () => {
    expect(sanitizeDesktopText("\u001b[31mfailed\u001b[0m token=private-value")).toBe("failed token=[redacted]");
    const environment = minimalDesktopEnvironment({ HOME: "/home/user", PATH: "/bin", NODE_OPTIONS: "--inspect", ELECTRON_RUN_AS_NODE: "1", PRIVATE: "secret" });
    expect(environment).toMatchObject({ HOME: "/home/user", PATH: "/bin", NODE_ENV: "production" });
    expect(environment.NODE_OPTIONS).toBeUndefined();
    expect(environment.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(environment.PRIVATE).toBeUndefined();
  });

  it("rejects generic or malformed service IPC payloads", () => {
    expect(serviceCommandSchema.parse({ service: "mcp", action: "start" })).toEqual({ service: "mcp", action: "start" });
    expect(() => serviceCommandSchema.parse({ service: "shell", action: "run", command: "rm" })).toThrow();
  });
});

describe("toolchain probes", () => {
  it("runs fixed executable/argument arrays and reports platform capability", async () => {
    const calls: Array<{ executable: string; args: readonly string[] }> = [];
    const runner: DesktopCommandRunner = {
      async run(executable, args) {
        calls.push({ executable, args });
        return { code: 0, stdout: executable.includes("xcrun") ? "Xcode 26.6\nBuild 17F113\n" : "v1.2.3\n", stderr: "" };
      },
    };
    const statuses = await probeToolchains("darwin", {
      node: "/trusted/node",
      git: "/usr/bin/git",
      pnpmCli: "/trusted/pnpm.cjs",
      expoCli: "/trusted/expo",
      xcrun: "/usr/bin/xcrun",
      adb: "/trusted/adb",
    }, runner);
    expect(statuses.every((status) => status.status === "available")).toBe(true);
    expect(calls.find((call) => call.executable === "/trusted/node" && call.args[0] === "/trusted/pnpm.cjs")).toBeTruthy();
    expect(calls.find((call) => call.executable === "/usr/bin/xcrun")?.args).toEqual(["xcodebuild", "-version"]);
  });

  it("distinguishes missing, unsupported, and failed probes without leaking secrets", async () => {
    const runner: DesktopCommandRunner = { async run() { return { code: 2, stdout: "", stderr: "token=secret failure" }; } };
    const statuses = await probeToolchains("linux", { git: "/usr/bin/git" }, runner);
    expect(statuses.find((status) => status.id === "xcode")?.status).toBe("unsupported");
    expect(statuses.find((status) => status.id === "node")?.status).toBe("missing");
    expect(statuses.find((status) => status.id === "git")).toMatchObject({ status: "failed", detail: "token=[redacted] failure" });
  });
});

describe("read-only Git integration", () => {
  it("parses branch, divergence, changes, branches and bounded history", async () => {
    const runner: DesktopCommandRunner = {
      async run(_executable, args) {
        const operation = args[2];
        if (operation === "status") return { code: 0, stdout: "# branch.oid abcdef1\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 .M N... 100644 100644 100644 a b src.ts\n? new.ts\n", stderr: "" };
        if (operation === "branch") return { code: 0, stdout: "*\tmain\n \tfeature/safe\n", stderr: "" };
        return { code: 0, stdout: "abcdef1234567890\x1f2026-07-14T12:00:00Z\x1fAdd desktop shell\n", stderr: "" };
      },
    };
    const snapshot = await inspectGitRepository("/granted/project", "/usr/bin/git", runner);
    expect(snapshot).toMatchObject({ available: true, repository: true, branch: "main", upstream: "origin/main", ahead: 2, behind: 1, changed: 2 });
    expect(snapshot.branches).toEqual([{ name: "main", current: true }, { name: "feature/safe", current: false }]);
    expect(snapshot.commits[0]?.subject).toBe("Add desktop shell");
  });

  it("reports missing Git and non-repositories without mutating anything", async () => {
    const runner: DesktopCommandRunner = { async run() { return { code: 128, stdout: "", stderr: "not a repository" }; } };
    expect(await inspectGitRepository("/project", undefined, runner)).toMatchObject({ available: false, repository: false });
    expect(await inspectGitRepository("/project", "/usr/bin/git", runner)).toMatchObject({ available: true, repository: false });
  });
});

class FakeProcess implements DesktopManagedProcess {
  readonly logs: Array<(text: string) => void> = [];
  readonly exits: Array<(code: number | null) => void> = [];
  terminated = false;
  constructor(readonly pid: number) {}
  terminate() { this.terminated = true; }
  onExit(listener: (code: number | null) => void) { this.exits.push(listener); }
  onLog(listener: (text: string) => void) { this.logs.push(listener); }
  exit(code: number | null) { for (const listener of this.exits) listener(code); }
}

describe("desktop service supervisor", () => {
  it("starts, reports bounded logs, restarts and stops named services", async () => {
    const processes: FakeProcess[] = [];
    const launcher: DesktopProcessLauncher = {
      async launch(_service: DesktopServiceId) {
        const process = new FakeProcess(100 + processes.length);
        processes.push(process);
        return process;
      },
    };
    const supervisor = new DesktopServiceSupervisor(launcher);
    expect(await supervisor.start("studio")).toMatchObject({ phase: "ready", pid: 100 });
    processes[0]!.logs[0]!("token=secret Studio ready");
    expect(supervisor.snapshots()[0]?.message).toBe("token=[redacted] Studio ready");
    expect(await supervisor.restart("studio")).toMatchObject({ phase: "ready", pid: 101, restarts: 0 });
    expect(processes[0]!.terminated).toBe(true);
    expect(await supervisor.stop("studio")).toMatchObject({ phase: "stopped", pid: null });
    expect(processes[1]!.terminated).toBe(true);
  });

  it("recovers one unexpected crash by default and then stops", async () => {
    const processes: FakeProcess[] = [];
    const launcher: DesktopProcessLauncher = { async launch() {
      const process = new FakeProcess(200 + processes.length);
      processes.push(process);
      return process;
    } };
    const supervisor = new DesktopServiceSupervisor(launcher);
    await supervisor.start("mcp");
    processes[0]!.exit(9);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(supervisor.snapshots()[1]).toMatchObject({ phase: "ready", restarts: 1, pid: 201 });
    processes[1]!.exit(10);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(supervisor.snapshots()[1]).toMatchObject({ phase: "crashed", restarts: 1, pid: null });
  });

  it("fails closed when a named service cannot launch", async () => {
    const launcher: DesktopProcessLauncher = { async launch() { throw new Error("authorization=Bearer private launch failed"); } };
    const supervisor = new DesktopServiceSupervisor(launcher);
    expect(await supervisor.start("studio")).toMatchObject({ phase: "crashed", message: "authorization=[redacted] private launch failed" });
  });
});
