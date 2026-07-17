import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { compileExpo } from "@intentform/compiler-expo";
import { compileReact } from "@intentform/compiler-react";
import { compileSwiftUI } from "@intentform/compiler-swiftui";
import { compileWeb } from "@intentform/compiler-web";
import { deviceProfileChecksum, resolveDeviceConfiguration } from "@intentform/device-registry";
import { stableSerialize, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { z } from "zod";

export const PREVIEW_TARGETS = ["browser", "expo-ios", "expo-android", "swiftui"] as const;
export type PreviewTarget = typeof PREVIEW_TARGETS[number];

export const PREVIEW_PHASES = [
  "idle",
  "queued",
  "generating",
  "building",
  "ready",
  "failed",
  "cancelled",
  "toolchain-missing",
] as const;
export type PreviewPhase = typeof PREVIEW_PHASES[number];

export const PREVIEW_EVIDENCE_LEVELS = [
  "not-run",
  "generated",
  "validated",
  "built",
  "render-verified",
  "failed",
] as const;
export type PreviewEvidenceLevel = typeof PREVIEW_EVIDENCE_LEVELS[number];

export const BUILD_EVIDENCE_STATES = [
  "not-generated",
  "generated",
  "stale",
  "not-run",
  "queued",
  "running",
  "passed",
  "failed",
  "cancelled",
  "unavailable",
] as const;
export type BuildEvidenceState = typeof BUILD_EVIDENCE_STATES[number];

const fingerprint8 = z.string().regex(/^[a-f0-9]{8}$/);
const fingerprint64 = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = z.string().max(1_000);
const boundedLogText = z.string().max(600);

export const previewBindingSchema = z.strictObject({
  revisionFingerprint: fingerprint8,
  graphDigest: fingerprint64,
  compilerTarget: z.enum(["react", "web", "expo", "swiftui"]),
  compilerFingerprint: fingerprint8,
  target: z.enum(PREVIEW_TARGETS),
  profileId: z.string().min(1).max(160),
  profileChecksum: fingerprint64,
  bindingKey: fingerprint64,
});
export type PreviewBinding = z.infer<typeof previewBindingSchema>;

export const previewLogSchema = z.strictObject({
  at: z.string().datetime({ offset: true }),
  stream: z.enum(["system", "stdout", "stderr"]),
  text: boundedLogText,
});
export type PreviewLog = z.infer<typeof previewLogSchema>;

export const previewArtifactSchema = z.strictObject({
  kind: z.enum(["bundle", "build-log", "screenshot", "report"]),
  path: z.string().min(1).max(400).refine((value) => !value.startsWith("/") && !value.split("/").includes("..")),
});
export type PreviewArtifact = z.infer<typeof previewArtifactSchema>;

export const priorValidPreviewEvidenceSchema = z.strictObject({
  binding: previewBindingSchema,
  evidence: z.enum(["built", "render-verified"]),
  completedAt: z.string().datetime({ offset: true }),
  artifacts: z.array(previewArtifactSchema).max(24),
});
export type PriorValidPreviewEvidence = z.infer<typeof priorValidPreviewEvidenceSchema>;

export const previewEvidenceManifestSchema = z.strictObject({
  version: z.literal("1.0.0"),
  runId: z.string().uuid(),
  ownerPid: z.number().int().positive(),
  binding: previewBindingSchema,
  phase: z.enum(PREVIEW_PHASES),
  evidence: z.enum(PREVIEW_EVIDENCE_LEVELS),
  startedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }).nullable(),
  lastVerifiedRevision: fingerprint8.nullable(),
  failure: z.strictObject({
    code: z.enum(["build-failed", "cancelled", "timeout", "toolchain-missing", "orphaned", "internal"]),
    message: boundedText,
  }).nullable(),
  logs: z.array(previewLogSchema).max(240),
  artifacts: z.array(previewArtifactSchema).max(24),
  priorValidEvidence: priorValidPreviewEvidenceSchema.nullable().default(null),
});
export type PreviewEvidenceManifest = z.infer<typeof previewEvidenceManifestSchema>;

export interface PreviewEvidenceView {
  target: PreviewTarget;
  phase: PreviewPhase;
  evidence: PreviewEvidenceLevel;
  freshness: "fresh" | "stale" | "not-run";
  buildStatus: "passed" | "failed" | "not-run";
  buildState: BuildEvidenceState;
  expectedBinding: PreviewBinding;
  manifest: PreviewEvidenceManifest | null;
  priorValidEvidence: PriorValidPreviewEvidence | null;
}

export const MAX_EVIDENCE_BYTES = 256_000;
export const MAX_PREVIEW_LOGS = 240;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function targetCompiler(
  graph: SemanticInterfaceGraph,
  target: PreviewTarget,
): { compilerTarget: PreviewBinding["compilerTarget"]; fingerprint: string } {
  if (target === "browser") {
    const webEnabled = graph.platforms.some((entry) => entry.target === "web" && entry.enabled) && graph.web;
    const reactEnabled = graph.platforms.some((entry) => entry.target === "react" && entry.enabled);
    if (!webEnabled && !reactEnabled) throw new Error("Neither the web nor React browser target is enabled by this graph.");
    const output = webEnabled ? compileWeb(graph) : compileReact(graph);
    return { compilerTarget: webEnabled ? "web" : "react", fingerprint: output.fingerprint };
  }
  if (target === "swiftui") {
    if (!graph.platforms.some((entry) => entry.target === "swiftui" && entry.enabled)) {
      throw new Error("The SwiftUI target is not enabled by this graph.");
    }
    return { compilerTarget: "swiftui", fingerprint: compileSwiftUI(graph).fingerprint };
  }
  if (!graph.platforms.some((entry) => entry.target === "expo" && entry.enabled)) {
    throw new Error("The Expo target is not enabled by this graph.");
  }
  return { compilerTarget: "expo", fingerprint: compileExpo(graph).fingerprint };
}

function targetProfile(
  graph: SemanticInterfaceGraph,
  target: PreviewTarget,
  requestedProfileId?: string,
): { id: string; checksum: string } {
  if (target === "browser" && graph.web) {
    const requested = requestedProfileId?.replace(/^web:/, "");
    const frame = graph.web.frames.find((entry) => entry.id === requested)
      ?? graph.web.frames.find((entry) => entry.id === graph.web!.defaultFrame)
      ?? graph.web.frames[0]!;
    return { id: `web:${frame.id}`, checksum: sha256(stableSerialize(frame)) };
  }

  const configuration = resolveDeviceConfiguration(graph.devices);
  const requested = requestedProfileId?.replace(/^device:/, "");
  const explicitlyRequested = requested
    ? configuration.profiles.find((entry) => entry.id === requested)
    : undefined;
  const compatibleRequest = explicitlyRequested && (
    target === "expo-android"
      ? explicitlyRequested.platform === "android"
      : target === "expo-ios" || target === "swiftui"
        ? explicitlyRequested.platform !== "android"
        : true
  ) ? explicitlyRequested : undefined;
  const platformPreferred = target === "expo-android"
    ? configuration.profiles.find((entry) => entry.platform === "android")
    : target === "expo-ios" || target === "swiftui"
      ? configuration.profiles.find((entry) => entry.platform !== "android")
      : undefined;
  const profile = compatibleRequest ?? platformPreferred ?? configuration.defaultProfile;
  return { id: `device:${profile.id}`, checksum: deviceProfileChecksum(profile) };
}

export function createPreviewBinding(
  graph: SemanticInterfaceGraph,
  revisionFingerprint: string,
  target: PreviewTarget,
  requestedProfileId?: string,
): PreviewBinding {
  const compiler = targetCompiler(graph, target);
  const profile = targetProfile(graph, target, requestedProfileId);
  const graphDigest = sha256(stableSerialize(graph));
  const base = {
    revisionFingerprint,
    graphDigest,
    compilerTarget: compiler.compilerTarget,
    compilerFingerprint: compiler.fingerprint,
    target,
    profileId: profile.id,
    profileChecksum: profile.checksum,
  };
  return previewBindingSchema.parse({ ...base, bindingKey: sha256(stableSerialize(base)) });
}

interface CachedPreviewBinding {
  graphDigest: string;
  binding: PreviewBinding;
}

/**
 * Keeps status polling cheap without weakening the evidence boundary. Cache
 * hits require the full canonical graph digest, not only the short revision
 * fingerprint shown in the UI.
 */
export class PreviewBindingCache {
  readonly #entries = new Map<string, CachedPreviewBinding>();

  constructor(readonly maxEntries = 32) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 256) {
      throw new RangeError("Preview binding cache size must be between one and 256 entries.");
    }
  }

  resolve(
    graph: SemanticInterfaceGraph,
    revisionFingerprint: string,
    target: PreviewTarget,
    requestedProfileId?: string,
  ): PreviewBinding {
    const graphDigest = sha256(stableSerialize(graph));
    const key = `${revisionFingerprint}\u0000${target}\u0000${sha256(requestedProfileId ?? "")}`;
    const cached = this.#entries.get(key);
    if (cached?.graphDigest === graphDigest) {
      this.#entries.delete(key);
      this.#entries.set(key, cached);
      return cached.binding;
    }

    const binding = createPreviewBinding(graph, revisionFingerprint, target, requestedProfileId);
    this.#entries.set(key, { graphDigest, binding });
    while (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.#entries.delete(oldest);
    }
    return binding;
  }
}

export function samePreviewBinding(left: PreviewBinding, right: PreviewBinding): boolean {
  return left.bindingKey === right.bindingKey
    && left.revisionFingerprint === right.revisionFingerprint
    && left.graphDigest === right.graphDigest
    && left.compilerTarget === right.compilerTarget
    && left.compilerFingerprint === right.compilerFingerprint
    && left.target === right.target
    && left.profileId === right.profileId
    && left.profileChecksum === right.profileChecksum;
}

function evidenceDirectory(projectDir: string): string {
  return resolve(/* turbopackIgnore: true */ projectDir, "evidence", "previews");
}

function ensureEvidenceDirectory(projectDir: string): string {
  const root = resolve(/* turbopackIgnore: true */ projectDir);
  const segments = [
    join(/* turbopackIgnore: true */ root, "evidence"),
    join(/* turbopackIgnore: true */ root, "evidence", "previews"),
  ];
  for (const directory of segments) {
    if (!existsSync(/* turbopackIgnore: true */ directory)) mkdirSync(/* turbopackIgnore: true */ directory, { mode: 0o700 });
    const stat = lstatSync(/* turbopackIgnore: true */ directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Preview evidence directories must be regular directories.");
    }
  }
  return segments[1]!;
}

function assertContained(base: string, candidate: string): void {
  const path = relative(
    resolve(/* turbopackIgnore: true */ base),
    resolve(/* turbopackIgnore: true */ candidate),
  );
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep))) return;
  throw new Error("Preview evidence path escapes the local project directory.");
}

export function evidenceManifestPath(projectDir: string, target: PreviewTarget): string {
  const directory = evidenceDirectory(projectDir);
  const path = join(/* turbopackIgnore: true */ directory, `${target}.json`);
  assertContained(directory, path);
  return path;
}

export function readPreviewEvidence(projectDir: string, target: PreviewTarget): PreviewEvidenceManifest | null {
  const path = evidenceManifestPath(projectDir, target);
  if (!existsSync(/* turbopackIgnore: true */ path)) return null;
  const stat = lstatSync(/* turbopackIgnore: true */ path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Preview evidence must be a regular file.");
  if (stat.size > MAX_EVIDENCE_BYTES) throw new Error("Preview evidence exceeds the size limit.");
  return previewEvidenceManifestSchema.parse(JSON.parse(readFileSync(/* turbopackIgnore: true */ path, "utf8")));
}

export function writePreviewEvidence(projectDir: string, manifestInput: PreviewEvidenceManifest): void {
  const manifest = previewEvidenceManifestSchema.parse(manifestInput);
  const directory = ensureEvidenceDirectory(projectDir);
  const path = evidenceManifestPath(projectDir, manifest.binding.target);
  if (existsSync(/* turbopackIgnore: true */ path) && lstatSync(/* turbopackIgnore: true */ path).isSymbolicLink()) throw new Error("Refusing to replace symlinked preview evidence.");
  const source = `${JSON.stringify(manifest, null, 2)}\n`;
  if (Buffer.byteLength(source) > MAX_EVIDENCE_BYTES) throw new Error("Preview evidence exceeds the size limit.");
  const temporary = join(
    /* turbopackIgnore: true */ dirname(/* turbopackIgnore: true */ path),
    `.${manifest.binding.target}.${process.pid}.${randomUUID()}.tmp`,
  );
  assertContained(directory, temporary);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(/* turbopackIgnore: true */ temporary, "wx", 0o600);
    writeFileSync(descriptor, source, "utf8");
    closeSync(descriptor);
    descriptor = null;
    renameSync(/* turbopackIgnore: true */ temporary, /* turbopackIgnore: true */ path);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(/* turbopackIgnore: true */ temporary)) rmSync(/* turbopackIgnore: true */ temporary, { force: true });
  }
}

export function recoverOrphanedPreviewEvidence(
  projectDir: string,
  target: PreviewTarget,
  at = new Date().toISOString(),
): PreviewEvidenceManifest | null {
  const manifest = readPreviewEvidence(projectDir, target);
  if (!manifest || !["queued", "generating", "building"].includes(manifest.phase)) return manifest;
  try {
    process.kill(manifest.ownerPid, 0);
    return manifest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") return manifest;
  }
  const recovered = previewEvidenceManifestSchema.parse({
    ...manifest,
    phase: "failed",
    evidence: "failed",
    updatedAt: at,
    completedAt: at,
    lastVerifiedRevision: null,
    failure: {
      code: "orphaned",
      message: "The prior preview process ended without a terminal evidence record.",
    },
    logs: [...manifest.logs, {
      at,
      stream: "system",
      text: "Recovered an orphaned preview run after process restart.",
    }].slice(-MAX_PREVIEW_LOGS),
  });
  writePreviewEvidence(projectDir, recovered);
  return recovered;
}

function priorValidEvidence(manifest: PreviewEvidenceManifest | null | undefined): PriorValidPreviewEvidence | null {
  if (manifest?.phase === "ready" && manifest.completedAt && ["built", "render-verified"].includes(manifest.evidence)) {
    return priorValidPreviewEvidenceSchema.parse({
      binding: manifest.binding,
      evidence: manifest.evidence,
      completedAt: manifest.completedAt,
      artifacts: manifest.artifacts,
    });
  }
  return manifest?.priorValidEvidence ?? null;
}

export function createQueuedManifest(
  binding: PreviewBinding,
  at = new Date().toISOString(),
  previous?: PreviewEvidenceManifest | null,
): PreviewEvidenceManifest {
  return previewEvidenceManifestSchema.parse({
    version: "1.0.0",
    runId: randomUUID(),
    ownerPid: process.pid,
    binding,
    phase: "queued",
    evidence: "not-run",
    startedAt: at,
    updatedAt: at,
    completedAt: null,
    lastVerifiedRevision: null,
    failure: null,
    logs: [{ at, stream: "system", text: `Queued local ${binding.target} preview.` }],
    artifacts: [],
    priorValidEvidence: priorValidEvidence(previous),
  });
}

export function buildEvidenceState(
  expectedBinding: PreviewBinding,
  manifest: PreviewEvidenceManifest | null,
): BuildEvidenceState {
  if (!manifest) return "not-generated";
  if (!samePreviewBinding(expectedBinding, manifest.binding)) return "stale";
  if (manifest.phase === "queued") return "queued";
  if (manifest.phase === "generating") return "running";
  if (manifest.phase === "building") return manifest.evidence === "generated" ? "generated" : "running";
  if (manifest.phase === "ready") return ["built", "render-verified"].includes(manifest.evidence) ? "passed" : "generated";
  if (manifest.phase === "failed") return "failed";
  if (manifest.phase === "cancelled") return "cancelled";
  if (manifest.phase === "toolchain-missing") return "unavailable";
  return "not-run";
}

export function resolvePreviewEvidence(
  projectDir: string,
  expectedBinding: PreviewBinding,
  manifestOverride?: PreviewEvidenceManifest | null,
): PreviewEvidenceView {
  const manifest = manifestOverride === undefined
    ? readPreviewEvidence(projectDir, expectedBinding.target)
    : manifestOverride;
  if (!manifest) {
    return { target: expectedBinding.target, phase: "idle", evidence: "not-run", freshness: "not-run", buildStatus: "not-run", buildState: "not-generated", expectedBinding, manifest: null, priorValidEvidence: null };
  }
  const fresh = samePreviewBinding(expectedBinding, manifest.binding);
  const buildStatus = !fresh
    ? "not-run"
    : manifest.phase === "ready" && ["built", "render-verified"].includes(manifest.evidence)
      ? "passed"
      : manifest.phase === "failed" || manifest.evidence === "failed"
        ? "failed"
        : "not-run";
  return {
    target: expectedBinding.target,
    phase: manifest.phase,
    evidence: manifest.evidence,
    freshness: fresh ? "fresh" : "stale",
    buildStatus,
    buildState: buildEvidenceState(expectedBinding, manifest),
    expectedBinding,
    manifest,
    priorValidEvidence: manifest.priorValidEvidence,
  };
}
