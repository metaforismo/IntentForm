"use client";

import {
  LOCAL_PREVIEW_TARGETS,
  type LocalPreviewStatus,
  type LocalPreviewsController,
} from "./use-local-previews";

const labels = {
  browser: "Browser",
  "expo-ios": "Expo iOS",
  "expo-android": "Expo Android",
  swiftui: "SwiftUI",
} as const;

const activePhases = new Set(["queued", "generating", "building"]);

function statusTone(entry: LocalPreviewStatus): string {
  if (["stale", "generated", "queued", "running"].includes(entry.buildState)) return "text-[var(--warn)]";
  if (entry.buildState === "passed") return "text-[var(--success)]";
  if (entry.buildState === "failed" || entry.buildState === "unavailable") return "text-[var(--danger)]";
  return "text-[var(--muted)]";
}

export function LocalPreviewPanel({ previews }: { previews: LocalPreviewsController }) {
  return (
    <section className="mt-3 overflow-hidden rounded-[6px] border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]" aria-labelledby="local-preview-heading">
      <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] px-3 py-2.5">
        <div>
          <h3 id="local-preview-heading" className="text-[11px] font-semibold text-[var(--ink)]">Continuous local evidence</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">
            Exact graph, compiler, target and device fingerprints. Instant canvas remains available while native builds run.
          </p>
        </div>
        <span className={`shrink-0 rounded-[4px] border px-1.5 py-0.5 font-mono text-[9px] ${previews.graphIsSaved ? "border-[var(--success)]/25 text-[var(--success)]" : "border-[var(--warn)]/25 text-[var(--warn)]"}`}>
          {previews.graphIsSaved ? "saved graph" : "save before preview"}
        </span>
      </div>
      {!previews.enabled ? (
        <p className="px-3 py-3 text-[11px] leading-relaxed text-[var(--muted)]">Open a local .intentform project to run durable preview builds.</p>
      ) : (
        <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2">
          {LOCAL_PREVIEW_TARGETS.map((target) => {
            const entry = previews.byTarget[target];
            const unavailable = entry && "unavailable" in entry;
            const status = entry && !("unavailable" in entry) ? entry : null;
            const active = status ? activePhases.has(status.phase) : false;
            const pending = previews.pendingTarget === target;
            const logs = status?.manifest?.logs.slice(-3) ?? [];
            return (
              <article key={target} className="min-w-0 bg-[var(--panel)] p-3" data-preview-target={target}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-[11px] font-medium text-[var(--ink)]">{labels[target]}</strong>
                  <span className={`font-mono text-[9px] ${status ? statusTone(status) : "text-[var(--faint)]"}`}>
                    {unavailable ? "unavailable" : status ? status.buildState : "loading"}
                  </span>
                </div>
                {unavailable ? (
                  <p className="mt-3 text-[10px] leading-relaxed text-[var(--danger)]">{entry.message}</p>
                ) : status ? (
                  <>
                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[9px] text-[var(--faint)]">
                      <dt>compiler</dt><dd className="truncate text-[var(--muted)]">{status.expectedBinding.compilerTarget} · {status.expectedBinding.compilerFingerprint}</dd>
                      <dt>profile</dt><dd className="truncate text-[var(--muted)]">{status.expectedBinding.profileId}</dd>
                      <dt>revision</dt><dd className="truncate text-[var(--muted)]">{status.manifest?.lastVerifiedRevision ?? "not verified"}</dd>
                    </dl>
                    {status.priorValidEvidence && status.buildState !== "passed" ? <p className="mt-2 text-[8px] text-[var(--faint)]">Prior verified evidence retained · {status.priorValidEvidence.binding.revisionFingerprint}</p> : null}
                    {status.manifest?.failure ? <p role="alert" className="mt-2 text-[10px] leading-relaxed text-[var(--danger)]">{status.manifest.failure.message}</p> : null}
                    {logs.length > 0 ? (
                      <div className="mt-3 max-h-24 overflow-auto rounded-[5px] border border-[var(--line)] bg-[var(--field)] p-2 font-mono text-[8px] leading-relaxed text-[var(--muted)]" aria-label={`${labels[target]} recent logs`}>
                        {logs.map((log) => <div key={`${log.at}:${log.stream}:${log.text}`}>{log.stream === "stderr" ? "! " : "› "}{log.text}</div>)}
                      </div>
                    ) : null}
                    <div className="mt-3 flex gap-2">
                      {active ? (
                        <button type="button" disabled={pending} onClick={() => void previews.mutate("cancel", target)} className="rounded-[5px] border border-[var(--warn)]/30 px-2.5 py-1.5 text-[9px] font-semibold text-[var(--warn)] hover:bg-[var(--warn-soft)] disabled:opacity-40">Cancel</button>
                      ) : (
                        <button type="button" disabled={pending || !previews.graphIsSaved} onClick={() => void previews.mutate(status.manifest ? "restart" : "start", target)} className="rounded-[5px] border border-[var(--line)] bg-[var(--chip)] px-2.5 py-1.5 text-[9px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-35">
                          {pending ? "Working…" : status.manifest ? "Restart" : "Start"}
                        </button>
                      )}
                    </div>
                  </>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      {previews.error ? <p role="alert" className="border-t border-[var(--danger)]/20 px-3 py-2.5 text-[10px] text-[var(--danger)]">{previews.error}</p> : null}
    </section>
  );
}
