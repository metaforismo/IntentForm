"use client";

import type { DesktopServiceId, DesktopSnapshot, IntentFormDesktopApi } from "@intentform/desktop-bridge";
import {
  ArrowClockwise,
  CheckCircle,
  ClipboardText,
  Desktop,
  GitBranch,
  HardDrives,
  Play,
  Stop,
  Warning,
  X,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

declare global {
  interface Window { intentformDesktop?: IntentFormDesktopApi }
}

const statusColor = (status: string) => status === "available" || status === "ready"
  ? "bg-emerald-500"
  : status === "failed" || status === "crashed"
    ? "bg-red-500"
    : status === "starting" || status === "checking"
      ? "bg-amber-500"
      : "bg-[var(--faint)]";

export function DesktopControl() {
  const [api, setApi] = useState<IntentFormDesktopApi | null>(null);
  const [snapshot, setSnapshot] = useState<DesktopSnapshot | null>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const desktop = window.intentformDesktop;
    if (!desktop) return;
    setApi(desktop);
    void desktop.snapshot().then(setSnapshot).catch((cause) => setError(cause instanceof Error ? cause.message : "Desktop status failed."));
    return desktop.onChanged(setSnapshot);
  }, []);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])")];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", handleKeyDown);
    requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!api || !snapshot) return null;
  const perform = async (operation: () => Promise<DesktopSnapshot | void>) => {
    setPending(true);
    setError(null);
    try {
      const result = await operation();
      if (result) setSnapshot(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Desktop operation failed.");
    } finally {
      setPending(false);
    }
  };
  const service = (id: DesktopServiceId) => snapshot.services.find((candidate) => candidate.id === id)!;
  const mcp = service("mcp");

  return (
    <>
      <button
        type="button"
        aria-label="Open desktop services"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="relative hidden size-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)] sm:grid"
      >
        <Desktop size={15} />
        <span className={`absolute right-0.5 top-0.5 size-1.5 rounded-full ${statusColor(mcp.phase)}`} />
      </button>
      {open ? createPortal(
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(9,20,17,.34)] p-3 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="desktop-control-title" className="max-h-[min(760px,calc(100dvh-24px))] w-full max-w-3xl overflow-auto rounded-[26px] border border-[var(--line)] bg-[var(--surface-strong)] shadow-[0_30px_90px_-45px_rgba(0,0,0,.7)]">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[color:var(--surface-strong)] px-5 py-4">
              <div><h2 id="desktop-control-title" className="text-sm font-semibold">Desktop services</h2><p className="mt-0.5 text-[10px] text-[var(--muted)]">Named capabilities only · renderer sandboxed</p></div>
              <button ref={closeRef} type="button" aria-label="Close desktop services" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--hover)]"><X size={14} /></button>
            </header>
            <div className="grid gap-5 p-5 lg:grid-cols-2">
              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-start justify-between gap-3"><div><span className="font-mono text-[9px] uppercase tracking-[.14em] text-[var(--faint)]">Granted project</span><strong className="mt-2 block text-sm">{snapshot.project.name}</strong><span className="mt-1 block break-all font-mono text-[9px] text-[var(--muted)]">{snapshot.project.path}</span></div><HardDrives size={16} className="text-[var(--accent)]" /></div>
                  <button type="button" disabled={pending} onClick={() => perform(() => api.chooseProject())} className="mt-4 inline-flex min-h-9 items-center gap-2 rounded-xl border border-[var(--line)] px-3 text-[10px] font-semibold hover:bg-[var(--hover)] disabled:opacity-50">Choose another project</button>
                </section>

                <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between"><div><span className="font-mono text-[9px] uppercase tracking-[.14em] text-[var(--faint)]">Local services</span><h3 className="mt-1 text-xs font-semibold">Studio + authenticated MCP</h3></div><button type="button" aria-label="Refresh desktop services" disabled={pending} onClick={() => perform(() => api.snapshot())} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--hover)] disabled:opacity-50"><ArrowClockwise size={13} /></button></div>
                  <div className="mt-3 divide-y divide-[var(--line)]">
                    {snapshot.services.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 py-3">
                        <span className={`size-2 rounded-full ${statusColor(item.phase)}`} />
                        <span className="min-w-0 flex-1"><strong className="block text-[11px] capitalize">{item.id}</strong><span className="block truncate text-[9px] text-[var(--muted)]">{item.message}{item.pid ? ` · PID ${item.pid}` : ""}</span></span>
                        {item.id === "mcp" ? item.phase === "ready" ? (
                          <button type="button" aria-label="Stop MCP service" disabled={pending} onClick={() => perform(() => api.setService({ service: "mcp", action: "stop" }))} className="grid size-8 place-items-center rounded-lg border border-[var(--line)] hover:bg-[var(--hover)] disabled:opacity-50"><Stop size={12} /></button>
                        ) : (
                          <button type="button" aria-label="Start MCP service" disabled={pending} onClick={() => perform(() => api.setService({ service: "mcp", action: "start" }))} className="grid size-8 place-items-center rounded-lg border border-[var(--line)] hover:bg-[var(--hover)] disabled:opacity-50"><Play size={12} /></button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  {mcp.phase === "ready" ? <button type="button" disabled={pending} onClick={() => perform(() => api.copyMcpConfiguration())} className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-xl bg-[var(--accent-deep)] px-3 text-[10px] font-semibold text-white disabled:opacity-50"><ClipboardText size={13} /> Copy MCP client configuration</button> : null}
                </section>
              </div>

              <div className="space-y-5">
                <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between"><div><span className="font-mono text-[9px] uppercase tracking-[.14em] text-[var(--faint)]">Toolchains</span><h3 className="mt-1 text-xs font-semibold">Installed capabilities</h3></div><button type="button" aria-label="Refresh toolchains" disabled={pending} onClick={() => perform(() => api.refreshToolchains())} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--hover)] disabled:opacity-50"><ArrowClockwise size={13} /></button></div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {snapshot.toolchains.map((item) => <div key={item.id} title={item.detail} className="rounded-xl border border-[var(--line)] bg-[var(--field)] p-2.5"><span className="flex items-center gap-2 text-[10px] font-semibold"><span className={`size-1.5 rounded-full ${statusColor(item.status)}`} />{item.label}</span><span className="mt-1 block truncate font-mono text-[8px] text-[var(--muted)]">{item.version ?? item.status}</span></div>)}
                  </div>
                </section>

                <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between"><div><span className="font-mono text-[9px] uppercase tracking-[.14em] text-[var(--faint)]">Git · read only</span><h3 className="mt-1 flex items-center gap-2 text-xs font-semibold"><GitBranch size={13} />{snapshot.git?.branch ?? "No repository"}</h3></div><button type="button" aria-label="Refresh Git status" disabled={pending} onClick={() => perform(() => api.refreshGit())} className="grid size-8 place-items-center rounded-lg hover:bg-[var(--hover)] disabled:opacity-50"><ArrowClockwise size={13} /></button></div>
                  {snapshot.git?.repository ? <><p className="mt-3 text-[10px] text-[var(--muted)]">{snapshot.git.changed} changed · {snapshot.git.ahead} ahead · {snapshot.git.behind} behind</p><div className="mt-3 space-y-2">{snapshot.git.commits.slice(0, 3).map((commit) => <div key={commit.hash} className="grid grid-cols-[52px_1fr] gap-2 text-[9px]"><code className="text-[var(--accent-dark)]">{commit.hash.slice(0, 7)}</code><span className="truncate text-[var(--muted)]">{commit.subject}</span></div>)}</div></> : <p className="mt-3 text-[10px] leading-relaxed text-[var(--muted)]">{snapshot.git?.message ?? "Git has not been inspected."}</p>}
                </section>

                <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
                  <div className="flex items-center gap-2">{snapshot.update.phase === "failed" ? <Warning size={14} className="text-red-500" /> : <CheckCircle size={14} className="text-[var(--accent)]" />}<strong className="text-[11px]">Updates · {snapshot.update.phase}</strong></div><p className="mt-2 text-[9px] leading-relaxed text-[var(--muted)]">{snapshot.update.message}</p>
                  {snapshot.update.supported ? <button type="button" disabled={pending} onClick={() => perform(() => api.checkForUpdates())} className="mt-3 min-h-9 rounded-xl border border-[var(--line)] px-3 text-[10px] font-semibold hover:bg-[var(--hover)] disabled:opacity-50">Check signed feed</button> : null}
                </section>
              </div>
            </div>
            {error ? <div role="alert" className="mx-5 mb-5 flex items-start gap-2 rounded-xl border border-red-300/40 bg-red-50 p-3 text-[10px] text-red-900"><Warning size={13} weight="fill" className="mt-0.5" />{error}</div> : null}
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
