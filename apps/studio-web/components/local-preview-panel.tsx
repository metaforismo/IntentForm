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
  if (["stale", "generated", "queued", "running"].includes(entry.buildState)) return "text-amber-300";
  if (entry.buildState === "passed") return "text-emerald-300";
  if (entry.buildState === "failed" || entry.buildState === "unavailable") return "text-red-300";
  return "text-white/50";
}

export function LocalPreviewPanel({ previews }: { previews: LocalPreviewsController }) {
  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border border-[#303a35] bg-[#1c211f] text-[#dce5df]" aria-labelledby="local-preview-heading">
      <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h3 id="local-preview-heading" className="text-[11px] font-semibold text-white">Continuous local evidence</h3>
          <p className="mt-1 text-[10px] leading-relaxed text-white/45">
            Exact graph, compiler, target and device fingerprints. Instant canvas remains available while native builds run.
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 font-mono text-[9px] ${previews.graphIsSaved ? "border-emerald-300/20 text-emerald-300" : "border-amber-300/20 text-amber-200"}`}>
          {previews.graphIsSaved ? "saved graph" : "save before preview"}
        </span>
      </div>
      {!previews.enabled ? (
        <p className="px-4 py-4 text-[11px] leading-relaxed text-white/50">Open a local .intentform project to run durable preview builds.</p>
      ) : (
        <div className="grid gap-px bg-white/10 sm:grid-cols-2">
          {LOCAL_PREVIEW_TARGETS.map((target) => {
            const entry = previews.byTarget[target];
            const unavailable = entry && "unavailable" in entry;
            const status = entry && !("unavailable" in entry) ? entry : null;
            const active = status ? activePhases.has(status.phase) : false;
            const pending = previews.pendingTarget === target;
            const logs = status?.manifest?.logs.slice(-3) ?? [];
            return (
              <article key={target} className="min-w-0 bg-[#1c211f] p-4" data-preview-target={target}>
                <div className="flex items-center justify-between gap-3">
                  <strong className="text-[11px] text-white/85">{labels[target]}</strong>
                  <span className={`font-mono text-[9px] ${status ? statusTone(status) : "text-white/40"}`}>
                    {unavailable ? "unavailable" : status ? status.buildState : "loading"}
                  </span>
                </div>
                {unavailable ? (
                  <p className="mt-3 text-[10px] leading-relaxed text-red-200/70">{entry.message}</p>
                ) : status ? (
                  <>
                    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[9px] text-white/40">
                      <dt>compiler</dt><dd className="truncate text-white/60">{status.expectedBinding.compilerTarget} · {status.expectedBinding.compilerFingerprint}</dd>
                      <dt>profile</dt><dd className="truncate text-white/60">{status.expectedBinding.profileId}</dd>
                      <dt>revision</dt><dd className="truncate text-white/60">{status.manifest?.lastVerifiedRevision ?? "not verified"}</dd>
                    </dl>
                    {status.priorValidEvidence && status.buildState !== "passed" ? <p className="mt-2 text-[8px] text-white/45">Prior verified evidence retained · {status.priorValidEvidence.binding.revisionFingerprint}</p> : null}
                    {status.manifest?.failure ? <p role="alert" className="mt-2 text-[10px] leading-relaxed text-red-200/75">{status.manifest.failure.message}</p> : null}
                    {logs.length > 0 ? (
                      <div className="mt-3 max-h-24 overflow-auto rounded-lg bg-black/20 p-2 font-mono text-[8px] leading-relaxed text-white/40" aria-label={`${labels[target]} recent logs`}>
                        {logs.map((log) => <div key={`${log.at}:${log.stream}:${log.text}`}>{log.stream === "stderr" ? "! " : "› "}{log.text}</div>)}
                      </div>
                    ) : null}
                    <div className="mt-3 flex gap-2">
                      {active ? (
                        <button type="button" disabled={pending} onClick={() => void previews.mutate("cancel", target)} className="rounded-md border border-white/10 px-2.5 py-1.5 text-[9px] text-white/65 hover:bg-white/5 disabled:opacity-40">Cancel</button>
                      ) : (
                        <button type="button" disabled={pending || !previews.graphIsSaved} onClick={() => void previews.mutate(status.manifest ? "restart" : "start", target)} className="rounded-md bg-white/10 px-2.5 py-1.5 text-[9px] font-semibold text-white/75 hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-35">
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
      {previews.error ? <p role="alert" className="border-t border-red-300/15 px-4 py-3 text-[10px] text-red-200/75">{previews.error}</p> : null}
    </section>
  );
}
