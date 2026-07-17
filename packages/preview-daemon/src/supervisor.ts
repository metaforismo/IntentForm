import { existsSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import {
  MAX_PREVIEW_LOGS,
  createQueuedManifest,
  readPreviewEvidence,
  previewEvidenceManifestSchema,
  type PreviewArtifact,
  type PreviewBinding,
  type PreviewEvidenceLevel,
  type PreviewEvidenceManifest,
  type PreviewLog,
  type PreviewPhase,
  type PreviewTarget,
  writePreviewEvidence,
} from "./evidence.ts";

export interface PreviewRunResult {
  evidence: Extract<PreviewEvidenceLevel, "built" | "render-verified">;
  artifacts?: PreviewArtifact[];
}

export interface PreviewRunContext {
  projectDir: string;
  graph: SemanticInterfaceGraph;
  binding: PreviewBinding;
  buildRoot: string;
  signal: AbortSignal;
  log: (stream: PreviewLog["stream"], text: string) => void;
  update: (phase: Extract<PreviewPhase, "generating" | "building">, evidence: PreviewEvidenceLevel) => void;
}

export type PreviewRunner = (context: PreviewRunContext) => Promise<PreviewRunResult>;

export class PreviewAlreadyRunningError extends Error {
  constructor(readonly target: PreviewTarget) {
    super(`A ${target} preview is already queued or running.`);
    this.name = "PreviewAlreadyRunningError";
  }
}

export class PreviewToolchainMissingError extends Error {
  constructor(readonly toolchain: string) {
    super(`The ${toolchain} toolchain is not installed or is not available to IntentForm.`);
    this.name = "PreviewToolchainMissingError";
  }
}

export class PreviewBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewBuildError";
  }
}

interface PreviewJob {
  key: string;
  projectDir: string;
  graph: SemanticInterfaceGraph;
  binding: PreviewBinding;
  runner: PreviewRunner;
  controller: AbortController;
  manifest: PreviewEvidenceManifest;
  timeoutMs: number;
  timeout: ReturnType<typeof setTimeout> | null;
  state: "queued" | "running" | "settled";
}

function jobKey(projectDir: string, target: PreviewTarget): string {
  return `${resolve(projectDir)}\u0000${target}`;
}

function terminal(phase: PreviewPhase): boolean {
  return ["ready", "failed", "cancelled", "toolchain-missing"].includes(phase);
}

export function sanitizePreviewLog(input: string): string {
  return input
    .replace(/\u001B(?:[@-_][0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\))/g, "")
    .replace(/\b(?:sk|rk|pk)_[A-Za-z0-9_-]{12,}\b/g, "[redacted]")
    .replace(/\bauthorization\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, "authorization=[redacted]")
    .replace(/\b(api[-_]?key|authorization|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 600);
}

export class PreviewSupervisor {
  readonly #jobs = new Map<string, PreviewJob>();
  readonly #queue: PreviewJob[] = [];
  #running = 0;

  constructor(
    readonly maxConcurrent = 2,
    readonly defaultTimeoutMs = 120_000,
  ) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 4) {
      throw new RangeError("Preview concurrency must be between one and four.");
    }
  }

  current(projectDir: string, target: PreviewTarget): PreviewEvidenceManifest | null {
    return this.#jobs.get(jobKey(projectDir, target))?.manifest ?? null;
  }

  start(input: {
    projectDir: string;
    graph: SemanticInterfaceGraph;
    binding: PreviewBinding;
    runner: PreviewRunner;
    timeoutMs?: number;
  }): PreviewEvidenceManifest {
    const key = jobKey(input.projectDir, input.binding.target);
    const prior = this.#jobs.get(key);
    if (prior && !terminal(prior.manifest.phase)) throw new PreviewAlreadyRunningError(input.binding.target);

    const controller = new AbortController();
    const previous = prior?.manifest ?? readPreviewEvidence(input.projectDir, input.binding.target);
    const job: PreviewJob = {
      key,
      projectDir: resolve(input.projectDir),
      graph: input.graph,
      binding: input.binding,
      runner: input.runner,
      controller,
      manifest: createQueuedManifest(input.binding, new Date().toISOString(), previous),
      timeoutMs: input.timeoutMs ?? this.defaultTimeoutMs,
      timeout: null,
      state: "queued",
    };
    if (!Number.isSafeInteger(job.timeoutMs) || job.timeoutMs < 1_000 || job.timeoutMs > 600_000) {
      throw new RangeError("Preview timeout must be between one second and ten minutes.");
    }
    this.#jobs.set(key, job);
    this.#queue.push(job);
    writePreviewEvidence(job.projectDir, job.manifest);
    this.#drain();
    return job.manifest;
  }

  restart(input: {
    projectDir: string;
    graph: SemanticInterfaceGraph;
    binding: PreviewBinding;
    runner: PreviewRunner;
    timeoutMs?: number;
  }): PreviewEvidenceManifest {
    this.cancel(input.projectDir, input.binding.target, "Restarted with the current graph binding.");
    return this.start(input);
  }

  cancel(projectDir: string, target: PreviewTarget, reason = "Cancelled by the user."): PreviewEvidenceManifest | null {
    const job = this.#jobs.get(jobKey(projectDir, target));
    if (!job || terminal(job.manifest.phase)) return job?.manifest ?? null;
    job.controller.abort();
    const now = new Date().toISOString();
    job.manifest = this.#nextManifest(job, {
      phase: "cancelled",
      evidence: "not-run",
      completedAt: now,
      lastVerifiedRevision: null,
      failure: { code: "cancelled", message: sanitizePreviewLog(reason) || "Preview cancelled." },
    });
    writePreviewEvidence(job.projectDir, job.manifest);
    if (job.state === "queued") {
      const position = this.#queue.indexOf(job);
      if (position >= 0) this.#queue.splice(position, 1);
      job.state = "settled";
    }
    return job.manifest;
  }

  #drain(): void {
    while (this.#running < this.maxConcurrent) {
      const job = this.#queue.shift();
      if (!job) return;
      if (job.controller.signal.aborted) continue;
      this.#running += 1;
      job.state = "running";
      void this.#execute(job).finally(() => {
        if (job.manifest.phase === "cancelled") this.#cleanupBuildRoot(job);
        job.state = "settled";
        this.#running -= 1;
        if (job.timeout) clearTimeout(job.timeout);
        this.#drain();
      });
    }
  }

  async #execute(job: PreviewJob): Promise<void> {
    job.timeout = setTimeout(() => {
      if (terminal(job.manifest.phase)) return;
      job.controller.abort();
      const now = new Date().toISOString();
      job.manifest = this.#nextManifest(job, {
        phase: "failed",
        evidence: "failed",
        completedAt: now,
        lastVerifiedRevision: null,
        failure: { code: "timeout", message: `Preview exceeded the ${job.timeoutMs} ms local timeout.` },
      });
      writePreviewEvidence(job.projectDir, job.manifest);
    }, job.timeoutMs);

    const stillCurrent = () => this.#jobs.get(job.key)?.manifest.runId === job.manifest.runId;
    const persist = () => {
      if (stillCurrent()) writePreviewEvidence(job.projectDir, job.manifest);
    };
    const log = (stream: PreviewLog["stream"], input: string) => {
      if (!stillCurrent() || terminal(job.manifest.phase)) return;
      for (const source of input.split(/\r?\n/)) {
        const text = sanitizePreviewLog(source);
        if (!text) continue;
        const entry = previewEvidenceManifestSchema.shape.logs.element.parse({ at: new Date().toISOString(), stream, text });
        job.manifest = previewEvidenceManifestSchema.parse({
          ...job.manifest,
          updatedAt: entry.at,
          logs: [...job.manifest.logs, entry].slice(-MAX_PREVIEW_LOGS),
        });
      }
      persist();
    };
    const update = (phase: "generating" | "building", evidence: PreviewEvidenceLevel) => {
      if (!stillCurrent() || terminal(job.manifest.phase)) return;
      job.manifest = this.#nextManifest(job, { phase, evidence, failure: null });
      persist();
    };

    try {
      update("generating", "not-run");
      const result = await job.runner({
        projectDir: job.projectDir,
        graph: job.graph,
        binding: job.binding,
        buildRoot: join(job.projectDir, "preview-builds", job.binding.target, job.binding.bindingKey, job.manifest.runId),
        signal: job.controller.signal,
        log,
        update,
      });
      if (!stillCurrent() || terminal(job.manifest.phase)) return;
      const now = new Date().toISOString();
      job.manifest = this.#nextManifest(job, {
        phase: "ready",
        evidence: result.evidence,
        completedAt: now,
        lastVerifiedRevision: job.binding.revisionFingerprint,
        failure: null,
        artifacts: result.artifacts ?? [],
      });
      persist();
    } catch (error) {
      if (!stillCurrent() || terminal(job.manifest.phase)) return;
      const now = new Date().toISOString();
      const missing = error instanceof PreviewToolchainMissingError;
      const cancelled = job.controller.signal.aborted;
      job.manifest = this.#nextManifest(job, {
        phase: cancelled ? "cancelled" : missing ? "toolchain-missing" : "failed",
        evidence: cancelled || missing ? "not-run" : "failed",
        completedAt: now,
        lastVerifiedRevision: null,
        failure: {
          code: cancelled ? "cancelled" : missing ? "toolchain-missing" : error instanceof PreviewBuildError ? "build-failed" : "internal",
          message: cancelled
            ? "Preview cancelled before completion."
            : sanitizePreviewLog(error instanceof Error ? error.message : "The local preview failed."),
        },
      });
      persist();
    }
  }

  #cleanupBuildRoot(job: PreviewJob): void {
    const root = resolve(job.projectDir);
    const buildRoot = resolve(job.projectDir, "preview-builds", job.binding.target, job.binding.bindingKey, job.manifest.runId);
    const path = relative(root, buildRoot);
    if (path === "" || path === ".." || path.startsWith(`..${sep}`) || path.startsWith(sep)) return;
    if (existsSync(buildRoot)) rmSync(buildRoot, { recursive: true, force: true });
  }

  #nextManifest(
    job: PreviewJob,
    patch: Partial<Omit<PreviewEvidenceManifest, "version" | "runId" | "ownerPid" | "binding" | "startedAt" | "logs">>,
  ): PreviewEvidenceManifest {
    return previewEvidenceManifestSchema.parse({
      ...job.manifest,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }
}
