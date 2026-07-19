"use client";

import { ArrowsMerge, ClockCounterClockwise, GitBranch, WarningCircle } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

interface HistoryBranch {
  name: string;
  createdAt: string;
  updatedAt: string;
  baseFingerprint: string;
  headFingerprint: string;
}

interface HistoryOperation {
  id: string;
  at: string;
  branch: string;
  kind: string;
  author: "human" | "agent" | "system";
  reason: string;
  resultFingerprint: string;
  changes: Array<{ path: string }>;
}

interface HistoryResponse {
  integrity: "valid" | "needs-recovery";
  currentFingerprint: string;
  compactedBeforeSequence: number | null;
  branches: HistoryBranch[];
  operations: HistoryOperation[];
  diagnostics: string[];
}

interface MergeConflict {
  path: string;
  reason: "both-modified" | "delete-modify" | "order-conflict";
}

interface MergePreview {
  branch?: HistoryBranch;
  operation?: HistoryOperation;
  currentFingerprint: string;
  previewFingerprint: string;
  changes: Array<{ path: string }>;
  conflicts: MergeConflict[];
}

function errorMessage(input: unknown, fallback: string): string {
  return input && typeof input === "object" && "error" in input && typeof input.error === "string"
    ? input.error
    : fallback;
}

function operationLabel(kind: string): string {
  return kind.replaceAll("-", " ");
}

export function HistoryPanel({ enabled, onProjectChanged }: { enabled: boolean; onProjectChanged: () => void }) {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [mergePreview, setMergePreview] = useState<MergePreview | null>(null);
  const [operationPreview, setOperationPreview] = useState<MergePreview | null>(null);

  const refreshSequence = useRef(0);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return;
    const sequence = ++refreshSequence.current;
    try {
      const response = await fetch("/api/project/history", { cache: "no-store", ...(signal ? { signal } : {}) });
      const payload: unknown = await response.json();
      if (sequence !== refreshSequence.current) return;
      if (!response.ok || !payload || typeof payload !== "object" || !("operations" in payload) || !Array.isArray(payload.operations)) {
        throw new Error(errorMessage(payload, "Operation history is unavailable."));
      }
      setHistory(payload as HistoryResponse);
      setError(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      if (sequence !== refreshSequence.current) return;
      setError(caught instanceof Error ? caught.message : "Operation history is unavailable.");
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setHistory(null);
      setError(null);
      setMergePreview(null);
      setOperationPreview(null);
      return;
    }
    const controller = new AbortController();
    void refresh(controller.signal);
    const interval = window.setInterval(() => void refresh(controller.signal), 4_000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [enabled, refresh]);

  const post = useCallback(async (action: Record<string, unknown>) => {
    const response = await fetch("/api/project/history", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const payload: unknown = await response.json();
    if (!response.ok) throw new Error(errorMessage(payload, "The history action failed."));
    return payload;
  }, []);

  const run = useCallback(async (key: string, action: () => Promise<void>) => {
    setPending(key);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The history action failed.");
    } finally {
      setPending(null);
    }
  }, [refresh]);

  const createBranch = (event: FormEvent) => {
    event.preventDefault();
    const name = branchName.trim().toLowerCase();
    if (!name) return;
    void run("create", async () => {
      await post({ action: "create-branch", name });
      setBranchName("");
    });
  };

  const branches = history?.branches.filter((branch) => branch.name !== "main") ?? [];
  const recentOperations = history?.operations.slice(0, 6) ?? [];

  return (
    <section className="mt-3 overflow-hidden rounded-[6px] border border-[var(--line)] bg-[var(--panel)] text-[var(--ink)]" aria-labelledby="operation-history-heading" data-testid="operation-history-panel">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--line)] px-3 py-2.5">
        <div>
          <div className="flex items-center gap-2">
            <GitBranch size={13} className="text-[var(--muted)]" />
            <h3 id="operation-history-heading" className="text-[11px] font-semibold text-[var(--ink)]">History & branches</h3>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-[var(--muted)]">Named semantic operations, isolated agent work and conflict-reviewed merges.</p>
        </div>
        {history ? (
          <span className={`rounded-[4px] border px-1.5 py-0.5 font-mono text-[9px] ${history.integrity === "valid" ? "border-[var(--success)]/25 text-[var(--success)]" : "border-[var(--warn)]/25 text-[var(--warn)]"}`}>
            {history.integrity === "valid" ? "history valid" : "recovery needed"}
          </span>
        ) : null}
      </div>

      {!enabled ? (
        <p className="px-3 py-3 text-[11px] text-[var(--muted)]">Open the local project to inspect operation history.</p>
      ) : history ? (
        <>
          {history.integrity === "needs-recovery" ? (
            <div className="border-b border-[var(--warn)]/20 bg-[var(--warn-soft)] px-3 py-2.5">
              <div className="flex items-start gap-2 text-[10px] text-[var(--warn)]">
                <WarningCircle size={13} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <strong className="block font-semibold">History writes are paused</strong>
                  {history.diagnostics.map((diagnostic) => <p key={diagnostic} className="mt-1 break-words">{diagnostic}</p>)}
                </div>
                <button type="button" disabled={pending !== null} onClick={() => void run("recover", async () => { await post({ action: "recover-history" }); })} className="rounded-[5px] border border-[var(--warn)]/30 px-2 py-1 font-semibold text-[var(--warn)] hover:bg-[var(--warn-soft)] disabled:opacity-40">Recover</button>
              </div>
            </div>
          ) : null}

          <div className="border-b border-[var(--line)] px-3 py-2.5">
            <form onSubmit={createBranch} className="flex gap-2">
              <label htmlFor="history-branch-name" className="sr-only">New branch name</label>
              <input
                id="history-branch-name"
                value={branchName}
                onChange={(event) => setBranchName(event.target.value.replace(/[^a-z0-9-]/gi, "").slice(0, 63))}
                placeholder="agent-copy-pass"
                pattern="[a-z][a-z0-9-]{0,62}"
                disabled={pending !== null || history.integrity !== "valid"}
                className="min-h-7 min-w-0 flex-1 rounded-[5px] border border-[var(--line)] bg-[var(--field)] px-2.5 font-mono text-[10px] text-[var(--ink)] outline-none placeholder:text-[var(--faint)] focus:border-[var(--accent)]"
              />
              <button type="submit" disabled={!branchName || pending !== null || history.integrity !== "valid"} className="min-h-7 rounded-[5px] border border-[var(--line)] bg-[var(--chip)] px-2.5 text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-35">Create branch</button>
            </form>
            <p className="mt-1.5 text-[9px] leading-relaxed text-[var(--faint)]">Agents can patch a branch through MCP; main stays unchanged until a clean preview is approved.</p>
          </div>

          <div className="grid gap-px bg-[var(--line)] sm:grid-cols-2">
            <div className="bg-[var(--panel)] px-3 py-2.5">
              <span className="block text-[9px] uppercase tracking-[.12em] text-[var(--faint)]">Main head</span>
              <strong className="mt-1 block font-mono text-[10px] text-[var(--muted)]">{history.currentFingerprint}</strong>
            </div>
            <div className="bg-[var(--panel)] px-3 py-2.5">
              <span className="block text-[9px] uppercase tracking-[.12em] text-[var(--faint)]">Retention</span>
              <strong className="mt-1 block text-[10px] font-medium text-[var(--muted)]">{history.compactedBeforeSequence ? `Compacted through #${history.compactedBeforeSequence}` : "Full local log"}</strong>
            </div>
          </div>

          <div className="border-t border-[var(--line)] px-3 py-2.5">
            <span className="text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">Open branches</span>
            {branches.length > 0 ? (
              <div className="mt-2 grid gap-2">
                {branches.map((branch) => (
                  <div key={branch.name} className="rounded-[6px] border border-[var(--line)] bg-[var(--field)] p-2.5" data-testid={`history-branch-${branch.name}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <strong className="block font-mono text-[10px] text-[var(--ink)]">{branch.name}</strong>
                        <span className="mt-0.5 block font-mono text-[8px] text-[var(--faint)]">base {branch.baseFingerprint} · head {branch.headFingerprint}</span>
                      </div>
                      <div className="flex gap-1.5">
                        <button type="button" disabled={pending !== null} onClick={() => void run(`preview:${branch.name}`, async () => { setOperationPreview(null); setMergePreview(await post({ action: "preview-merge", name: branch.name }) as MergePreview); })} className="rounded-[5px] border border-[var(--line)] px-2 py-1 text-[9px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] disabled:opacity-35">Preview</button>
                        <button type="button" disabled={pending !== null} onClick={() => {
                          if (!window.confirm(`Delete branch ${branch.name}? Immutable operations remain in history.`)) return;
                          void run(`delete:${branch.name}`, async () => { await post({ action: "delete-branch", name: branch.name }); if (mergePreview?.branch?.name === branch.name) setMergePreview(null); });
                        }} className="rounded-[5px] border border-[var(--danger)]/25 px-2 py-1 text-[9px] text-[var(--danger)] hover:bg-[var(--danger-soft)] disabled:opacity-35">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="mt-2 text-[10px] text-[var(--faint)]">No isolated branches yet.</p>}
          </div>

          {mergePreview ? (
            <div className="border-t border-[var(--line)] bg-[var(--panel-alt,var(--chip))] px-3 py-2.5" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ArrowsMerge size={13} className={mergePreview.conflicts.length === 0 ? "text-[var(--success)]" : "text-[var(--warn)]"} />
                  <strong className="text-[10px] text-[var(--ink)]">Merge preview · {mergePreview.branch?.name}</strong>
                </div>
                {mergePreview.conflicts.length === 0 ? (
                  <button type="button" disabled={pending !== null} onClick={() => void run("merge", async () => { await post({ action: "merge-branch", name: mergePreview.branch?.name, expectedFingerprint: mergePreview.currentFingerprint }); setMergePreview(null); onProjectChanged(); })} className="rounded-[5px] bg-[var(--success-soft,var(--accent-soft))] px-2.5 py-1 text-[9px] font-semibold text-[var(--success)] hover:brightness-110 disabled:opacity-35">Merge {mergePreview.changes.length} changes</button>
                ) : null}
              </div>
              {mergePreview.conflicts.length > 0 ? (
                <div className="mt-2 grid gap-1" data-testid="history-merge-conflicts">
                  {mergePreview.conflicts.map((conflict) => <span key={`${conflict.path}:${conflict.reason}`} className="break-all rounded-[4px] bg-[var(--warn-soft)] px-2 py-1 font-mono text-[8px] text-[var(--warn)]">{conflict.reason} · {conflict.path}</span>)}
                </div>
              ) : <p className="mt-1 text-[9px] text-[var(--success)]">Independent stable properties merged without conflicts · preview {mergePreview.previewFingerprint}</p>}
            </div>
          ) : null}

          {operationPreview ? (
            <div className="border-t border-[var(--line)] bg-[var(--panel-alt,var(--chip))] px-3 py-2.5" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong className="text-[10px] text-[var(--ink)]">Revert preview · {operationPreview.operation?.reason}</strong>
                {operationPreview.conflicts.length === 0 ? (
                  <button type="button" disabled={pending !== null} onClick={() => void run("revert", async () => { await post({ action: "apply-operation", operationId: operationPreview.operation?.id, direction: "revert", expectedFingerprint: operationPreview.currentFingerprint }); setOperationPreview(null); onProjectChanged(); })} className="rounded-[5px] bg-[var(--warn-soft)] px-2.5 py-1 text-[9px] font-semibold text-[var(--warn)] hover:brightness-110 disabled:opacity-35">Apply inverse</button>
                ) : null}
              </div>
              <p className="mt-1 text-[9px] text-[var(--muted)]">{operationPreview.conflicts.length === 0 ? `${operationPreview.changes.length} inverse changes · preview ${operationPreview.previewFingerprint}` : `${operationPreview.conflicts.length} conflicts require review through MCP`}</p>
            </div>
          ) : null}

          <div className="border-t border-[var(--line)] px-3 py-2.5">
            <span className="text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">Recent operations</span>
            <div className="mt-2 divide-y divide-[var(--line)]">
              {recentOperations.map((operation) => (
                <div key={operation.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2">
                  <div className="min-w-0">
                    <strong className="block truncate text-[10px] font-medium text-[var(--ink)]">{operation.reason}</strong>
                    <span className="mt-0.5 block truncate font-mono text-[8px] text-[var(--faint)]">{operationLabel(operation.kind)} · {operation.author} · {operation.branch} · {operation.changes.length} changes</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {!["seed", "branch-create"].includes(operation.kind) ? (
                      <button type="button" disabled={pending !== null} aria-label={`Preview revert ${operation.reason}`} onClick={() => void run(`revert-preview:${operation.id}`, async () => { setMergePreview(null); setOperationPreview(await post({ action: "preview-operation", operationId: operation.id, direction: "revert" }) as MergePreview); })} className="rounded-[4px] p-1 text-[var(--faint)] hover:bg-[var(--hover)] hover:text-[var(--warn)] disabled:opacity-30"><ClockCounterClockwise size={12} /></button>
                    ) : null}
                    <time dateTime={operation.at} className="font-mono text-[8px] text-[var(--faint)]">{new Date(operation.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : <p className="px-3 py-3 text-[11px] text-[var(--muted)]">Loading operation history…</p>}
      {error ? <p role="alert" className="border-t border-[var(--danger)]/20 px-3 py-2.5 text-[10px] text-[var(--danger)]">{error}</p> : null}
    </section>
  );
}
