"use client";

import {
  ArrowSquareOut,
  Check,
  Clock,
  LockKey,
  ShieldCheck,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface AgentActivityEntry {
  id: string;
  at: string;
  transport: "stdio" | "http";
  tool: string;
  access: "read" | "write" | "transaction" | "preview";
  outcome: "succeeded" | "failed" | "cancelled" | "rejected";
  durationMs: number;
}

export interface AgentReviewChange {
  path: string;
  before: unknown;
  after: unknown;
}

interface AgentTransactionReview {
  transactionId: string;
  transport: "stdio" | "http";
  rationale: string;
  createdAt: string;
  expiresAt: string;
  resolvedAt: string | null;
  commentId: string | null;
  historyOperationId: string | null;
  baseFingerprint: string;
  previewFingerprint: string;
  status: "previewed" | "committed" | "rejected" | "expired" | "stale";
  changes: AgentReviewChange[];
  verification: {
    passed: boolean;
    buildStatus: "passed" | "failed" | "not-run";
    findings: Array<{ id: string; severity: "info" | "warning" | "error"; violatedIntent: string }>;
  };
}

interface AgentActivityResponse {
  policy: {
    scope: "current-local-project";
    semanticWrites: string;
    arbitraryShell: false;
    arbitraryFilesystem: false;
    outboundNetwork: false;
    http: { configured: boolean; binding: "127.0.0.1"; bearerAuthentication: "required" };
  };
  entries: AgentActivityEntry[];
  reviews: AgentTransactionReview[];
}

interface AgentActivityPanelProps {
  enabled: boolean;
  projectId: string;
  projectName: string;
  documentId: string;
  screenLabel: string;
  selectionLabel: string | null;
  workspaceLabel: string;
  targetLabel: string | null;
  fileLabel: string | null;
  deviceLabel: string;
  visualState: string;
  currentFingerprint: string;
  onPreviewChanges: (changes: AgentReviewChange[], transactionId: string) => void;
  onOpenLinkedComment: (commentId: string, changes: AgentReviewChange[], transactionId: string) => void;
  onProjectChanged: () => void;
}

function displayTool(tool: string): string {
  return tool.replace(/^intentform_/, "").replaceAll("_", " ");
}

function displayValue(value: unknown): string {
  if (value === undefined) return "not set";
  if (value === null) return "none";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  const serialized = JSON.stringify(value);
  return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
}

function outcomeTone(outcome: AgentActivityEntry["outcome"]): string {
  if (outcome === "succeeded") return "text-[var(--success)]";
  if (outcome === "cancelled") return "text-[var(--warn)]";
  return "text-[var(--danger)]";
}

export function AgentActivityPanel({
  enabled,
  projectId,
  projectName,
  documentId,
  screenLabel,
  selectionLabel,
  workspaceLabel,
  targetLabel,
  fileLabel,
  deviceLabel,
  visualState,
  currentFingerprint,
  onPreviewChanges,
  onOpenLinkedComment,
  onProjectChanged,
}: AgentActivityPanelProps) {
  const [response, setResponse] = useState<AgentActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"commit" | "reject" | "preview-revert" | "revert" | null>(null);
  const [revertPreview, setRevertPreview] = useState<{ operationId: string; previewFingerprint: string; changes: AgentReviewChange[]; conflicts: unknown[] } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const result = await fetch("/api/project/agent-activity", { cache: "no-store" });
    const payload = await result.json() as AgentActivityResponse | { error?: string };
    if (!result.ok || !("policy" in payload) || !Array.isArray(payload.entries) || !Array.isArray(payload.reviews)) {
      throw new Error("error" in payload && payload.error ? payload.error : "Agent activity is unavailable.");
    }
    setResponse(payload);
    setError(null);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setResponse(null);
      setError(null);
      return;
    }
    let active = true;
    void refresh().catch((refreshError) => {
      if (active) setError(refreshError instanceof Error ? refreshError.message : "Agent activity is unavailable.");
    });
    const stream = new EventSource("/api/project/agent-activity?stream=1");
    stream.onmessage = (event) => {
      if (!active) return;
      try {
        const payload = JSON.parse(event.data) as AgentActivityResponse;
        if (payload.policy && Array.isArray(payload.entries) && Array.isArray(payload.reviews)) {
          setResponse(payload);
          setError(null);
        }
      } catch {
        setError("Agent activity stream returned an invalid event.");
      }
    };
    stream.onerror = () => {
      if (active) setError("Live agent updates are reconnecting…");
    };
    return () => {
      active = false;
      stream.close();
    };
  }, [enabled, refresh]);

  const current = response?.reviews.find((review) => ["previewed", "expired", "stale"].includes(review.status)) ?? null;
  const entries = response?.entries.slice(0, 8) ?? [];
  const errorFindings = current?.verification.findings.filter((finding) => finding.severity === "error").length ?? 0;
  const warningFindings = current?.verification.findings.filter((finding) => finding.severity === "warning").length ?? 0;
  const affectedPaths = useMemo(() => [...new Set(current?.changes.map((change) => change.path) ?? [])], [current]);
  const committed = response?.reviews.find((review) => review.status === "committed" && review.historyOperationId) ?? null;
  const fingerprintMismatch = current?.status === "previewed" && current.baseFingerprint !== currentFingerprint;

  const previewRevert = async () => {
    if (!committed?.historyOperationId) return;
    setPending("preview-revert");
    setError(null);
    try {
      const result = await fetch("/api/project/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "preview-operation", operationId: committed.historyOperationId, direction: "revert" }) });
      const payload = await result.json() as { error?: string; previewFingerprint?: string; changes?: AgentReviewChange[]; conflicts?: unknown[] };
      if (!result.ok || !payload.previewFingerprint || !Array.isArray(payload.changes)) throw new Error(payload.error ?? "The agent decision revert could not be previewed.");
      if (mounted.current) setRevertPreview({ operationId: committed.historyOperationId, previewFingerprint: payload.previewFingerprint, changes: payload.changes, conflicts: payload.conflicts ?? [] });
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "The agent decision revert could not be previewed.");
    } finally { if (mounted.current) setPending(null); }
  };

  const applyRevert = async () => {
    if (!revertPreview) return;
    setPending("revert");
    setError(null);
    try {
      const result = await fetch("/api/project/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "apply-operation", operationId: revertPreview.operationId, direction: "revert", expectedFingerprint: currentFingerprint }) });
      const payload = await result.json() as { error?: string };
      if (!result.ok) throw new Error(payload.error ?? "The agent decision could not be reverted.");
      if (!mounted.current) return;
      setRevertPreview(null);
      await refresh();
      onProjectChanged();
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "The agent decision could not be reverted.");
    } finally { if (mounted.current) setPending(null); }
  };

  const decide = async (action: "commit" | "reject") => {
    if (!current || current.status !== "previewed") return;
    setPending(action);
    setError(null);
    try {
      const result = await fetch("/api/project/agent-activity", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          transactionId: current.transactionId,
          expectedPreviewFingerprint: current.previewFingerprint,
        }),
      });
      const payload = await result.json() as { error?: string };
      if (!result.ok) throw new Error(payload.error ?? `The transaction could not be ${action === "commit" ? "committed" : "rejected"}.`);
      if (!mounted.current) return;
      await refresh();
      if (action === "commit") onProjectChanged();
    } catch (actionError) {
      if (mounted.current) setError(actionError instanceof Error ? actionError.message : "The transaction decision failed.");
    } finally {
      if (mounted.current) setPending(null);
    }
  };

  if (!enabled) {
    return <p className="p-4 text-[11px] leading-relaxed text-[var(--muted)]">Open a local .intentform project to review MCP access and proposed transactions.</p>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col text-[var(--ink)]">
      <section className="border-b border-[var(--line)] p-3" aria-labelledby="agent-connection-heading">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><span className={`size-2 rounded-full ${response ? "bg-[var(--success)]" : "bg-[var(--faint)]"}`} /><h3 id="agent-connection-heading" className="text-[11px] font-semibold">Local MCP agent</h3></div>
            <p className="mt-1 truncate font-mono text-[9px] text-[var(--faint)]">{response ? `${current?.transport ?? entries[0]?.transport ?? "stdio"} · ${response.policy.http.configured ? "HTTP authenticated" : "local process"}` : error ? "Disconnected · reconnect required" : "Connecting…"}</p>
          </div>
          {response ? <span className="inline-flex items-center gap-1 rounded border border-[var(--line)] px-2 py-1 text-[9px] font-semibold text-[var(--muted)]"><LockKey size={10} /> reviewed write</span> : <button type="button" onClick={() => void refresh().catch((caught) => setError(caught instanceof Error ? caught.message : "Agent activity is unavailable."))} className="min-h-7 rounded border border-[var(--line)] px-2 py-1 text-[9px] font-semibold text-[var(--muted)]">Retry</button>}
        </div>
        <dl data-testid="agent-context-identity" className="mt-3 grid grid-cols-[76px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[9px]"><dt className="text-[var(--faint)]">Project</dt><dd className="truncate">{projectName}</dd><dt className="text-[var(--faint)]">Project ID</dt><dd className="truncate font-mono">{projectId}</dd><dt className="text-[var(--faint)]">Document</dt><dd className="truncate font-mono">{documentId}</dd><dt className="text-[var(--faint)]">Workspace</dt><dd className="truncate capitalize">{workspaceLabel}</dd><dt className="text-[var(--faint)]">Target / file</dt><dd className="truncate font-mono">{targetLabel ? `${targetLabel} · ${fileLabel ?? "No file"}` : "Not in Code"}</dd><dt className="text-[var(--faint)]">Page</dt><dd className="truncate">{screenLabel}</dd><dt className="text-[var(--faint)]">Node</dt><dd className="truncate font-mono">{selectionLabel ?? "No selection"}</dd><dt className="text-[var(--faint)]">Device / state</dt><dd className="truncate font-mono">{deviceLabel} · {visualState}</dd><dt className="text-[var(--faint)]">Fingerprint</dt><dd className="truncate font-mono">{currentFingerprint}</dd><dt className="text-[var(--faint)]">Authority</dt><dd>No shell · no filesystem escape · no network</dd></dl>
      </section>

      <div className="min-h-0 flex-1 overflow-auto">
        <section className="border-b border-[var(--line)] p-3" aria-labelledby="agent-transaction-heading">
          <div className="flex items-center justify-between gap-2"><h3 id="agent-transaction-heading" className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--faint)]">Current transaction</h3>{current ? <span className={`rounded px-1.5 py-0.5 font-mono text-[8px] ${current.status === "previewed" ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : "bg-[var(--warn-soft)] text-[var(--warn)]"}`}>{current.status}</span> : null}</div>
          {current ? <>
            <h4 className="mt-3 text-[13px] font-semibold leading-snug">{current.rationale}</h4>
            {current.commentId ? <button type="button" onClick={() => onOpenLinkedComment(current.commentId!, current.changes, current.transactionId)} className="mt-2 min-h-7 rounded border border-[var(--accent)]/25 bg-[var(--accent-soft)] px-2 py-1 font-mono text-[8px] text-[var(--accent-text)]">Open linked comment · {current.commentId}</button> : null}
            <p className="mt-1 font-mono text-[8px] text-[var(--faint)]">{current.baseFingerprint} → {current.previewFingerprint} · expires {new Date(current.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
            {fingerprintMismatch || current.status === "stale" ? <p role="alert" className="mt-2 rounded border border-[var(--warn)]/25 bg-[var(--warn-soft)] p-2 text-[9px] leading-relaxed text-[var(--warn)]">This transaction targets an older graph fingerprint. Re-open the latest project and ask the agent for a new preview.</p> : null}
            <div className="mt-3 flex flex-wrap gap-1.5 text-[9px]"><span className="rounded bg-[var(--field)] px-2 py-1">{current.changes.length} changes</span><span className="rounded bg-[var(--field)] px-2 py-1">{affectedPaths.length} affected paths</span><span className={`rounded px-2 py-1 ${errorFindings ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--success-soft)] text-[var(--success)]"}`}>{errorFindings} errors · {warningFindings} warnings</span></div>
            <div className="mt-3 divide-y divide-[var(--line)] border-y border-[var(--line)]" aria-label="Semantic transaction diff">{current.changes.map((change, index) => <div key={`${change.path}:${index}`} className="py-2"><strong className="block break-all font-mono text-[9px] font-medium">{change.path}</strong><div className="mt-1 grid grid-cols-[14px_minmax(0,1fr)] gap-1 font-mono text-[8px]"><span className="text-[var(--danger)]">−</span><span className="break-all text-[var(--muted)]">{displayValue(change.before)}</span><span className="text-[var(--success)]">+</span><span className="break-all text-[var(--ink)]">{displayValue(change.after)}</span></div></div>)}</div>
            {current.verification.findings.length ? <div className="mt-3"><strong className="text-[9px] text-[var(--faint)]">Diagnostics</strong>{current.verification.findings.slice(0, 4).map((finding) => <p key={finding.id} className="mt-1 flex gap-1.5 text-[9px] leading-relaxed text-[var(--muted)]">{finding.severity === "error" ? <Warning size={11} className="mt-0.5 shrink-0 text-[var(--danger)]" /> : <ShieldCheck size={11} className="mt-0.5 shrink-0 text-[var(--warn)]" />}{finding.violatedIntent}</p>)}</div> : <p className="mt-3 flex items-center gap-1.5 text-[9px] text-[var(--success)]"><Check size={11} /> Semantic verification has no open findings.</p>}
          </> : <p className="mt-3 text-[10px] leading-relaxed text-[var(--muted)]">No transaction is waiting for review. Use a connected MCP client to begin and preview a semantic transaction.</p>}
        </section>

        <section className="p-3" aria-labelledby="recent-agent-activity-heading"><h3 id="recent-agent-activity-heading" className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--faint)]">Recent activity</h3>{entries.length ? <div className="mt-2 divide-y divide-[var(--line)]">{entries.map((entry) => <div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 py-2 text-[9px]"><div className="min-w-0"><strong className="block truncate font-medium">{displayTool(entry.tool)}</strong><span className="font-mono text-[8px] text-[var(--faint)]">{entry.transport} · {entry.access} · {entry.durationMs} ms</span></div><div className="text-right"><span className={outcomeTone(entry.outcome)}>{entry.outcome}</span><time dateTime={entry.at} className="block font-mono text-[8px] text-[var(--faint)]">{new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div></div>)}</div> : <p className="mt-2 text-[9px] text-[var(--muted)]">No MCP calls recorded for this project.</p>}</section>
        {committed ? <section className="border-t border-[var(--line)] p-3"><div className="flex items-center justify-between gap-2"><div><h3 className="text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--faint)]">Last committed decision</h3><p className="mt-1 text-[9px] text-[var(--muted)]">{committed.rationale}</p></div><button type="button" disabled={pending !== null} onClick={() => void previewRevert()} className="rounded border border-[var(--line)] px-2 py-1 text-[9px] font-semibold disabled:opacity-35">Preview revert</button></div>{revertPreview ? <div className="mt-3 rounded border border-[var(--warn)]/25 bg-[var(--warn-soft)] p-2 text-[9px]"><strong>{revertPreview.changes.length} inverse changes · {revertPreview.previewFingerprint}</strong><p className="mt-1 text-[var(--muted)]">The current graph stays unchanged until you apply this exact inverse.</p><button type="button" disabled={pending !== null || revertPreview.conflicts.length > 0} onClick={() => void applyRevert()} className="mt-2 rounded bg-[var(--warn)] px-2 py-1 font-semibold text-black disabled:opacity-35">Apply revert</button></div> : null}</section> : null}
      </div>

      <footer className="border-t border-[var(--line)] p-3">
        <div className="mb-2 flex items-center justify-between text-[9px] text-[var(--faint)]"><span>Scope · current project / page / selection</span><span className="inline-flex items-center gap-1"><Clock size={10} /> {response ? "live" : "offline"}</span></div>
        <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2"><button type="button" disabled={!current || current.status !== "previewed" || pending !== null} onClick={() => void decide("reject")} className="inline-flex min-h-9 items-center gap-1 rounded border border-[var(--line)] px-3 text-[10px] font-semibold text-[var(--danger)] disabled:opacity-35"><X size={11} /> Reject</button><button type="button" disabled={!current} onClick={() => current && onPreviewChanges(current.changes, current.transactionId)} className="inline-flex min-h-9 items-center justify-center gap-1 rounded border border-[var(--line)] px-3 text-[10px] font-semibold disabled:opacity-35"><ArrowSquareOut size={11} /> Preview on canvas</button><button type="button" disabled={!current || current.status !== "previewed" || fingerprintMismatch || pending !== null} onClick={() => void decide("commit")} className="inline-flex min-h-9 items-center gap-1 rounded bg-[var(--accent-deep)] px-3 text-[10px] font-semibold text-white disabled:opacity-35"><Check size={11} /> Commit</button></div>
        {error ? <p role="alert" className="mt-2 text-[9px] leading-relaxed text-[var(--danger)]">{error}</p> : null}
      </footer>
    </div>
  );
}
