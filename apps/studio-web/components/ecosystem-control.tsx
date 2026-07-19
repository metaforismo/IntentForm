"use client";

import { CloudSlash, Cube, Package, ShieldCheck, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface EcosystemStatus {
  fingerprint: string;
  localFirst: true;
  compilersFetchPackages: false;
  executablePlugins: false;
  trust: { keyCount: number; activeKeyCount: number };
  sync: {
    mode: "disabled" | "hosted" | "self-hosted";
    endpoint: string | null;
    region: "eu" | "us" | "apac" | "self-hosted";
    retentionDays: number;
    keyOwnership: "client-managed";
  };
  packages: Array<{
    id: string;
    version: string;
    kind: "component-library" | "token-library" | "plugin";
    cache: "verified" | "missing" | "invalid";
    visibility: "public" | "private" | "local";
    plugin: null | { requestedPermissions: string[]; grantedPermissions: string[] };
  }>;
}

export function EcosystemControl() {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<EcosystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch("/api/project/ecosystem", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as EcosystemStatus | { error?: string };
        if (!response.ok) throw new Error("error" in body && body.error ? body.error : "The local ecosystem state is unavailable.");
        setStatus(body as EcosystemStatus);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "The local ecosystem state is unavailable.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : triggerRef.current;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setOpen(false); return; }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")];
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialogRef.current.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Open ecosystem status"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="hidden size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] md:grid"
      >
        <Package size={14} />
      </button>
      {open ? createPortal(
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/35 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ecosystem-title" tabIndex={-1} className="max-h-[min(720px,calc(100dvh-32px))] w-full max-w-2xl overflow-auto rounded-[8px] border border-[var(--line)] bg-[var(--surface)] p-5 text-[var(--ink)] shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-[var(--accent)]">Local-first ecosystem</p>
                <h2 id="ecosystem-title" className="mt-1 text-xl font-semibold tracking-[-.03em]">Packages and collaboration</h2>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">Signed, version-locked data packages and encrypted review remain optional. Editing, compiling, and verification never require this service.</p>
              </div>
              <button ref={closeRef} type="button" aria-label="Close ecosystem status" onClick={() => setOpen(false)} className="grid size-9 shrink-0 place-items-center rounded-[5px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]"><X size={16} /></button>
            </div>

            {loading ? <div role="status" className="mt-6 rounded-[6px] border border-[var(--line)] bg-[var(--chip)] p-5 text-sm text-[var(--muted)]">Reading local integrity state…</div> : null}
            {error ? <div role="alert" className="mt-6 rounded-[6px] border border-red-200 bg-red-50 p-4 text-sm text-red-950">{error}</div> : null}
            {status && !loading ? (
              <div className="mt-6 grid gap-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <article className="rounded-[6px] border border-[var(--line)] bg-[var(--chip)] p-4"><ShieldCheck size={18} className="text-[var(--accent)]" /><strong className="mt-3 block text-sm">{status.trust.activeKeyCount} active trust roots</strong><span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">Unknown and revoked publishers fail closed.</span></article>
                  <article className="rounded-[6px] border border-[var(--line)] bg-[var(--chip)] p-4"><Cube size={18} className="text-[var(--accent)]" /><strong className="mt-3 block text-sm">{status.packages.length} locked packages</strong><span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">Compilers use vendored graph data and never fetch.</span></article>
                  <article className="rounded-[6px] border border-[var(--line)] bg-[var(--chip)] p-4"><CloudSlash size={18} className="text-[var(--accent)]" /><strong className="mt-3 block text-sm">Sync {status.sync.mode}</strong><span className="mt-1 block text-xs leading-relaxed text-[var(--muted)]">{status.sync.keyOwnership}; {status.sync.retentionDays}-day policy.</span></article>
                </div>
                <section aria-labelledby="installed-packages-title" className="rounded-[6px] border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between gap-3"><h3 id="installed-packages-title" className="text-sm font-semibold">Installed packages</h3><span className="font-mono text-[10px] text-[var(--faint)]">graph {status.fingerprint}</span></div>
                  {status.packages.length === 0 ? <p className="mt-3 text-xs leading-relaxed text-[var(--muted)]">No external package is installed. The built-in component and token libraries remain fully available offline.</p> : (
                    <ul className="mt-3 grid gap-2">
                      {status.packages.map((entry) => <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[5px] bg-[var(--chip)] px-3 py-2 text-xs"><span><strong>{entry.id}</strong> <span className="font-mono text-[var(--muted)]">{entry.version}</span></span><span className={entry.cache === "verified" ? "text-[var(--accent)]" : "text-[var(--danger)]"}>{entry.cache}</span></li>)}
                    </ul>
                  )}
                </section>
                <p className="text-[11px] leading-relaxed text-[var(--faint)]">Plugins are declarative commands only, request explicit permissions, and cannot load executable entrypoints. Remote evidence is signature-checked and remains separate from local build evidence.</p>
              </div>
            ) : null}
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
