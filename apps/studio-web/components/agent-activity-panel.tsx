"use client";

import { LockKey, ShieldCheck } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

interface AgentActivityEntry {
  id: string;
  at: string;
  transport: "stdio" | "http";
  tool: string;
  access: "read" | "write" | "transaction" | "preview";
  outcome: "succeeded" | "failed" | "cancelled" | "rejected";
  durationMs: number;
}

interface AgentActivityResponse {
  policy: {
    scope: "current-local-project";
    semanticWrites: string;
    arbitraryShell: false;
    arbitraryFilesystem: false;
    outboundNetwork: false;
    stdio: { available: true; boundary: "local-process" };
    http: { configured: boolean; binding: "127.0.0.1"; bearerAuthentication: "required" };
    excludedFields: readonly string[];
  };
  entries: AgentActivityEntry[];
}

function displayTool(tool: string): string {
  return tool.replace(/^intentform_/, "").replaceAll("_", " ");
}

function outcomeTone(outcome: AgentActivityEntry["outcome"]): string {
  if (outcome === "succeeded") return "text-emerald-300";
  if (outcome === "cancelled") return "text-amber-200";
  return "text-red-300";
}

export function AgentActivityPanel({ enabled }: { enabled: boolean }) {
  const [response, setResponse] = useState<AgentActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setResponse(null);
      setError(null);
      return;
    }
    let active = true;
    let controller: AbortController | null = null;
    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const result = await fetch("/api/project/agent-activity", { cache: "no-store", signal: controller.signal });
        const payload = await result.json() as AgentActivityResponse | { error?: string };
        if (!result.ok || !("policy" in payload) || !Array.isArray(payload.entries)) {
          throw new Error("error" in payload && payload.error ? payload.error : "Agent activity is unavailable.");
        }
        if (active) {
          setResponse(payload);
          setError(null);
        }
      } catch (refreshError) {
        if (active && !(refreshError instanceof DOMException && refreshError.name === "AbortError")) {
          setError(refreshError instanceof Error ? refreshError.message : "Agent activity is unavailable.");
        }
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
    };
  }, [enabled]);

  const entries = response?.entries.slice(0, 8) ?? [];
  return (
    <section className="mt-4 overflow-hidden rounded-[24px] border border-[#303a35] bg-[#1c211f] text-[#dce5df]" aria-labelledby="agent-access-heading">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck size={14} weight="fill" className="text-emerald-300" />
            <h3 id="agent-access-heading" className="text-[11px] font-semibold text-white">Agent access</h3>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-white/45">
            Local project only. Semantic writes are validated, fingerprint-checked and revisioned.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300/20 px-2 py-1 font-mono text-[9px] text-emerald-300">
          <LockKey size={10} weight="fill" /> least authority
        </span>
      </div>

      {!enabled ? (
        <p className="px-4 py-4 text-[11px] leading-relaxed text-white/50">Open a local .intentform project to inspect MCP access and activity.</p>
      ) : response ? (
        <>
          <div className="grid gap-px bg-white/10 sm:grid-cols-3" aria-label="Agent access policy">
            <div className="bg-[#1c211f] px-4 py-3">
              <span className="block text-[9px] uppercase tracking-[.12em] text-white/35">Semantic project</span>
              <strong className="mt-1 block text-[10px] font-medium text-white/75">Reviewed transactions</strong>
            </div>
            <div className="bg-[#1c211f] px-4 py-3">
              <span className="block text-[9px] uppercase tracking-[.12em] text-white/35">System access</span>
              <strong className="mt-1 block text-[10px] font-medium text-white/75">No shell · no network</strong>
            </div>
            <div className="bg-[#1c211f] px-4 py-3">
              <span className="block text-[9px] uppercase tracking-[.12em] text-white/35">HTTP transport</span>
              <strong className="mt-1 block text-[10px] font-medium text-white/75">127.0.0.1 · token required</strong>
              <span className="mt-0.5 block font-mono text-[8px] text-white/35">{response.policy.http.configured ? "token configured" : "not configured"}</span>
            </div>
          </div>
          <div className="px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[9px] font-semibold uppercase tracking-[.12em] text-white/35">Recent MCP calls</span>
              <span className="text-[9px] text-white/30">No arguments, tokens, paths, content or outputs logged</span>
            </div>
            {entries.length > 0 ? (
              <div className="mt-2 divide-y divide-white/8">
                {entries.map((entry) => (
                  <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2 text-[10px]">
                    <div className="min-w-0">
                      <strong className="block truncate font-medium text-white/75">{displayTool(entry.tool)}</strong>
                      <span className="mt-0.5 block font-mono text-[8px] text-white/35">{entry.transport} · {entry.access} · {entry.durationMs} ms</span>
                    </div>
                    <div className="text-right">
                      <span className={`block font-mono text-[8px] ${outcomeTone(entry.outcome)}`}>{entry.outcome}</span>
                      <time dateTime={entry.at} className="mt-0.5 block font-mono text-[8px] text-white/30">{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-[10px] leading-relaxed text-white/40">No MCP tool calls have been recorded for this local project.</p>
            )}
          </div>
        </>
      ) : (
        <p className="px-4 py-4 text-[11px] leading-relaxed text-white/50">Loading local agent policy and activity…</p>
      )}
      {error ? <p role="alert" className="border-t border-red-300/15 px-4 py-3 text-[10px] text-red-200/75">{error}</p> : null}
    </section>
  );
}
