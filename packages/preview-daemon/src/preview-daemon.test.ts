import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { demoGraph, responsiveWebDemoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import {
  MAX_PREVIEW_LOGS,
  PreviewBuildError,
  PreviewBindingCache,
  PreviewSupervisor,
  PreviewToolchainMissingError,
  buildEvidenceState,
  createPreviewBinding,
  createQueuedManifest,
  evidenceManifestPath,
  readPreviewEvidence,
  recoverOrphanedPreviewEvidence,
  resolvePreviewEvidence,
  runLocalPreview,
  samePreviewBinding,
  sanitizePreviewLog,
  writePreviewEvidence,
  type PreviewEvidenceManifest,
  type PreviewRunner,
  type PreviewTarget,
} from "./index.ts";

const temporaryDirectories: string[] = [];

function temporaryProject(): string {
  const directory = join(tmpdir(), `intentform-preview-${randomUUID()}`);
  mkdirSync(directory, { recursive: true });
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function binding(target: PreviewTarget = "browser") {
  return createPreviewBinding(demoGraph, "1234abcd", target);
}

function terminalManifest(
  target: PreviewTarget,
  patch: Partial<PreviewEvidenceManifest> = {},
): PreviewEvidenceManifest {
  const queued = createQueuedManifest(binding(target));
  const now = new Date().toISOString();
  return {
    ...queued,
    phase: "ready",
    evidence: "built",
    updatedAt: now,
    completedAt: now,
    lastVerifiedRevision: queued.binding.revisionFingerprint,
    ...patch,
  };
}

async function waitFor(
  supervisor: PreviewSupervisor,
  projectDir: string,
  target: PreviewTarget,
  expected: PreviewEvidenceManifest["phase"],
): Promise<PreviewEvidenceManifest> {
  const deadline = Date.now() + 4_000;
  while (Date.now() < deadline) {
    const current = supervisor.current(projectDir, target);
    if (current?.phase === expected) return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${target} to become ${expected}.`);
}

describe("preview evidence bindings", () => {
  it("binds the full graph, compiler, target, revision and device profile", () => {
    const first = binding("expo-ios");
    expect(first).toMatchObject({
      revisionFingerprint: "1234abcd",
      compilerTarget: "expo",
      target: "expo-ios",
    });
    expect(first.graphDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.profileChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(first.bindingKey).toMatch(/^[a-f0-9]{64}$/);
    expect(samePreviewBinding(first, createPreviewBinding(demoGraph, "1234abcd", "expo-ios"))).toBe(true);
    expect(samePreviewBinding(first, createPreviewBinding(demoGraph, "feedc0de", "expo-ios"))).toBe(false);
    expect(samePreviewBinding(first, createPreviewBinding(demoGraph, "1234abcd", "expo-android"))).toBe(false);
  });

  it("changes when semantic source or device profile changes", () => {
    const edited = structuredClone(demoGraph);
    edited.screens[0]!.title = "A changed screen title";
    const parsed = parseGraph(edited);
    expect(createPreviewBinding(parsed, "1234abcd", "browser").bindingKey).not.toBe(binding("browser").bindingKey);
    const compact = createPreviewBinding(demoGraph, "1234abcd", "expo-ios", "device:neutral.phone.compact");
    const regular = createPreviewBinding(demoGraph, "1234abcd", "expo-ios", "device:neutral.phone.regular");
    expect(compact.profileChecksum).not.toBe(regular.profileChecksum);
    expect(createPreviewBinding(demoGraph, "1234abcd", "expo-ios", "device:neutral.android.phone").profileId)
      .not.toBe("device:neutral.android.phone");
    expect(createPreviewBinding(demoGraph, "1234abcd", "expo-android", "device:neutral.phone.compact").profileId)
      .toBe("device:neutral.android.phone");
  });

  it("uses responsive-web frames and compiler output for browser projects", () => {
    const result = createPreviewBinding(responsiveWebDemoGraph, "1234abcd", "browser");
    expect(result.compilerTarget).toBe("web");
    expect(result.profileId).toBe(`web:${responsiveWebDemoGraph.web!.defaultFrame}`);
  });

  it("caches exact graph bindings while rejecting short-fingerprint collisions", () => {
    const cache = new PreviewBindingCache(2);
    const first = cache.resolve(demoGraph, "1234abcd", "browser");
    expect(cache.resolve(demoGraph, "1234abcd", "browser")).toBe(first);

    const edited = structuredClone(demoGraph);
    edited.screens[0]!.title = "Same short fingerprint, different canonical graph";
    const changed = cache.resolve(parseGraph(edited), "1234abcd", "browser");
    expect(changed).not.toBe(first);
    expect(changed.graphDigest).not.toBe(first.graphDigest);
    expect(() => new PreviewBindingCache(0)).toThrow(/cache size/i);
  });

  it("accepts passed build evidence only for the exact active binding", () => {
    const projectDir = temporaryProject();
    const expected = binding("browser");
    const manifest = terminalManifest("browser");
    writePreviewEvidence(projectDir, manifest);
    expect(resolvePreviewEvidence(projectDir, expected)).toMatchObject({ freshness: "fresh", buildStatus: "passed" });

    const stale = createPreviewBinding(demoGraph, "feedc0de", "browser");
    expect(resolvePreviewEvidence(projectDir, stale)).toMatchObject({ freshness: "stale", buildStatus: "not-run" });
  });

  it("maps matching failure and non-terminal evidence truthfully", () => {
    const projectDir = temporaryProject();
    const expected = binding("swiftui");
    const failed = terminalManifest("swiftui", {
      phase: "failed",
      evidence: "failed",
      lastVerifiedRevision: null,
      failure: { code: "build-failed", message: "Compile failed." },
    });
    expect(resolvePreviewEvidence(projectDir, expected, failed).buildStatus).toBe("failed");
    expect(resolvePreviewEvidence(projectDir, expected, createQueuedManifest(expected)).buildStatus).toBe("not-run");
    expect(resolvePreviewEvidence(projectDir, expected, null)).toMatchObject({ phase: "idle", freshness: "not-run" });
  });

  it("maps the complete typed build lifecycle without treating generation as a pass", () => {
    const expected = binding("browser");
    const queued = createQueuedManifest(expected);
    expect(buildEvidenceState(expected, null)).toBe("not-generated");
    expect(buildEvidenceState(expected, queued)).toBe("queued");
    expect(buildEvidenceState(expected, { ...queued, phase: "generating" })).toBe("running");
    expect(buildEvidenceState(expected, { ...queued, phase: "building", evidence: "generated" })).toBe("generated");
    expect(buildEvidenceState(expected, terminalManifest("browser"))).toBe("passed");
    expect(buildEvidenceState(expected, { ...queued, phase: "ready", evidence: "validated" })).toBe("generated");
    expect(buildEvidenceState(expected, { ...queued, phase: "failed", evidence: "failed" })).toBe("failed");
    expect(buildEvidenceState(expected, { ...queued, phase: "cancelled" })).toBe("cancelled");
    expect(buildEvidenceState(expected, { ...queued, phase: "toolchain-missing" })).toBe("unavailable");
    expect(buildEvidenceState(expected, { ...queued, phase: "idle" })).toBe("not-run");
    expect(buildEvidenceState(createPreviewBinding(demoGraph, "feedc0de", "browser"), queued)).toBe("stale");
  });
});

describe("preview evidence storage", () => {
  it("round-trips strict manifests through an atomic regular file", () => {
    const projectDir = temporaryProject();
    const manifest = terminalManifest("expo-android");
    writePreviewEvidence(projectDir, manifest);
    expect(readPreviewEvidence(projectDir, "expo-android")).toEqual(manifest);
    expect(JSON.parse(readFileSync(evidenceManifestPath(projectDir, "expo-android"), "utf8"))).toEqual(manifest);
  });

  it("rejects symlinked evidence and oversized or malformed input", () => {
    const projectDir = temporaryProject();
    const evidenceDirectory = join(projectDir, "evidence", "previews");
    mkdirSync(evidenceDirectory, { recursive: true });
    const outside = join(projectDir, "outside.json");
    writeFileSync(outside, "{}\n");
    symlinkSync(outside, evidenceManifestPath(projectDir, "browser"));
    expect(() => readPreviewEvidence(projectDir, "browser")).toThrow(/regular file/i);
    expect(() => writePreviewEvidence(projectDir, terminalManifest("browser"))).toThrow(/symlinked/i);
    rmSync(evidenceManifestPath(projectDir, "browser"));
    writeFileSync(evidenceManifestPath(projectDir, "browser"), "x".repeat(256_001));
    expect(() => readPreviewEvidence(projectDir, "browser")).toThrow(/size limit/i);
  });

  it("rejects a symlinked evidence directory and preview target directory", async () => {
    const projectDir = temporaryProject();
    const outside = join(projectDir, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(projectDir, "evidence"), "dir");
    expect(() => writePreviewEvidence(projectDir, terminalManifest("browser"))).toThrow(/regular directories/i);

    rmSync(join(projectDir, "evidence"));
    mkdirSync(join(projectDir, "preview-builds"));
    symlinkSync(outside, join(projectDir, "preview-builds", "browser"), "dir");
    const previewBinding = binding("browser");
    await expect(runLocalPreview({
      projectDir,
      graph: demoGraph,
      binding: previewBinding,
      buildRoot: join(projectDir, "preview-builds", "browser", previewBinding.bindingKey),
      signal: new AbortController().signal,
      log: () => undefined,
      update: () => undefined,
    })).rejects.toThrow(/regular directory/i);
  });

  it("turns interrupted non-terminal evidence into an explicit orphan failure", () => {
    const projectDir = temporaryProject();
    writePreviewEvidence(projectDir, { ...createQueuedManifest(binding("browser")), ownerPid: 2_147_483_647 });
    expect(recoverOrphanedPreviewEvidence(projectDir, "browser")).toMatchObject({
      phase: "failed",
      evidence: "failed",
      failure: { code: "orphaned" },
    });
    expect(recoverOrphanedPreviewEvidence(projectDir, "browser")?.failure?.code).toBe("orphaned");
  });
});

describe("preview supervisor", () => {
  it("persists generating, building and ready lifecycle evidence", async () => {
    const projectDir = temporaryProject();
    const supervisor = new PreviewSupervisor();
    const runner: PreviewRunner = async (context) => {
      context.log("stdout", "generated exact source");
      context.update("building", "validated");
      return { evidence: "built", artifacts: [{ kind: "bundle", path: "preview-builds/browser/out" }] };
    };
    supervisor.start({ projectDir, graph: demoGraph, binding: binding("browser"), runner });
    const ready = await waitFor(supervisor, projectDir, "browser", "ready");
    expect(ready.lastVerifiedRevision).toBe("1234abcd");
    expect(ready.logs.some((entry) => entry.text === "generated exact source")).toBe(true);
    expect(readPreviewEvidence(projectDir, "browser")?.phase).toBe("ready");
  });

  it("records build failures and missing toolchains without claiming a pass", async () => {
    const projectDir = temporaryProject();
    const supervisor = new PreviewSupervisor();
    supervisor.start({ projectDir, graph: demoGraph, binding: binding("browser"), runner: async () => { throw new PreviewBuildError("tsc failed"); } });
    expect(await waitFor(supervisor, projectDir, "browser", "failed")).toMatchObject({ evidence: "failed", failure: { code: "build-failed" } });

    supervisor.start({ projectDir, graph: demoGraph, binding: binding("swiftui"), runner: async () => { throw new PreviewToolchainMissingError("Xcode"); } });
    expect(await waitFor(supervisor, projectDir, "swiftui", "toolchain-missing")).toMatchObject({ evidence: "not-run", failure: { code: "toolchain-missing" } });
  });

  it("cancels running and queued jobs and never lets them publish ready evidence", async () => {
    const projectDir = temporaryProject();
    const supervisor = new PreviewSupervisor(1);
    let runningBuildRoot = "";
    const blocking: PreviewRunner = (context) => new Promise((_resolve, reject) => {
      runningBuildRoot = context.buildRoot;
      mkdirSync(context.buildRoot, { recursive: true });
      writeFileSync(join(context.buildRoot, "partial-output"), "incomplete");
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    supervisor.start({ projectDir, graph: demoGraph, binding: binding("browser"), runner: blocking });
    supervisor.start({ projectDir, graph: demoGraph, binding: binding("expo-ios"), runner: blocking });
    expect(supervisor.current(projectDir, "expo-ios")?.phase).toBe("queued");
    expect(supervisor.cancel(projectDir, "expo-ios")?.phase).toBe("cancelled");
    expect(supervisor.cancel(projectDir, "browser")?.phase).toBe("cancelled");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(supervisor.current(projectDir, "browser")?.phase).toBe("cancelled");
    expect(runningBuildRoot).not.toBe("");
    expect(existsSync(runningBuildRoot)).toBe(false);
  });

  it("retains prior valid evidence separately across a cancelled replacement run", async () => {
    const projectDir = temporaryProject();
    const supervisor = new PreviewSupervisor();
    supervisor.start({ projectDir, graph: demoGraph, binding: binding("browser"), runner: async () => ({ evidence: "built", artifacts: [{ kind: "bundle", path: "preview-builds/browser/verified" }] }) });
    const verified = await waitFor(supervisor, projectDir, "browser", "ready");
    supervisor.start({ projectDir, graph: demoGraph, binding: binding("browser"), runner: (context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    }) });
    expect(supervisor.current(projectDir, "browser")?.priorValidEvidence).toMatchObject({
      binding: verified.binding,
      evidence: "built",
      completedAt: verified.completedAt,
    });
    supervisor.cancel(projectDir, "browser");
    expect(supervisor.current(projectDir, "browser")?.priorValidEvidence?.artifacts).toEqual(verified.artifacts);
  });

  it("restarts against a new run id and ignores completion from the cancelled run", async () => {
    const projectDir = temporaryProject();
    const supervisor = new PreviewSupervisor();
    const blocking: PreviewRunner = (context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    const first = supervisor.start({ projectDir, graph: demoGraph, binding: binding("browser"), runner: blocking });
    const second = supervisor.restart({ projectDir, graph: demoGraph, binding: binding("browser"), runner: async () => ({ evidence: "built" }) });
    expect(second.runId).not.toBe(first.runId);
    expect((await waitFor(supervisor, projectDir, "browser", "ready")).runId).toBe(second.runId);
  });

  it("times out slow jobs and bounds and redacts logs", async () => {
    const projectDir = temporaryProject();
    const supervisor = new PreviewSupervisor(1, 1_000);
    const runner: PreviewRunner = (context) => new Promise((_resolve, reject) => {
      for (let index = 0; index < MAX_PREVIEW_LOGS + 20; index += 1) context.log("stdout", `line ${index} token=super-secret`);
      context.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    supervisor.start({ projectDir, graph: demoGraph, binding: binding("browser"), runner });
    const failed = await waitFor(supervisor, projectDir, "browser", "failed");
    expect(failed.failure?.code).toBe("timeout");
    expect(failed.logs).toHaveLength(MAX_PREVIEW_LOGS);
    expect(failed.logs.every((entry) => !entry.text.includes("super-secret"))).toBe(true);
    expect(sanitizePreviewLog("\u001b[31merror\u001b[0m api_key=abc secret=password authorization: Bearer private-token")).toBe("error api_key=[redacted] secret=[redacted] authorization=[redacted]");
  });
});
