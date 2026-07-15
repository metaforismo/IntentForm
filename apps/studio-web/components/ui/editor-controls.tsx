"use client";

import { CaretDown, Check, LinkSimple, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export const numericStep = (value: number, direction: -1 | 1, step: number, shift: boolean, alt: boolean) => {
  const multiplier = shift ? 10 : alt ? 0.1 : 1;
  return Number((value + direction * step * multiplier).toFixed(6));
};

export function PropertyRow({ label, children, error, htmlFor }: { label: ReactNode; children: ReactNode; error?: string | null; htmlFor?: string }) {
  return <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-2 gap-y-1 text-[11px]">
    <label htmlFor={htmlFor} className="flex min-h-7 items-center truncate text-[var(--if-text-secondary)]">{label}</label>
    <div className="min-w-0">{children}</div>
    {error ? <p role="alert" className="col-start-2 text-[10px] leading-4 text-[var(--if-red)]">{error}</p> : null}
  </div>;
}

export function CompositionSafeField({ label, ariaLabel, value, placeholder, multiline = false, mixed = false, onCommit }: { label: string; ariaLabel?: string; value: string; placeholder?: string; multiline?: boolean; mixed?: boolean; onCommit(next: string): void }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  const composing = useRef(false);
  useEffect(() => { if (!focused.current && !composing.current) setDraft(value); }, [value]);
  const commit = (source = draft) => {
    if (composing.current) return;
    const next = source.trim();
    if (!mixed && next === value) return;
    onCommit(next);
  };
  const shared = "w-full rounded-[5px] border border-[var(--if-border)] bg-[var(--if-input)] px-2 text-[12px] text-[var(--if-text)] outline-none hover:border-[var(--if-border-strong)] focus:border-[var(--if-blue)] focus:ring-1 focus:ring-[var(--if-blue)] placeholder:text-[var(--if-text-tertiary)]";
  const props = { id, "aria-label": ariaLabel, value: draft, placeholder: mixed ? "Mixed" : placeholder, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(event.target.value), onFocus: () => { focused.current = true; }, onBlur: () => { focused.current = false; commit(); }, onCompositionStart: () => { composing.current = true; }, onCompositionEnd: (event: React.CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => { composing.current = false; if (!focused.current) commit(event.currentTarget.value); } };
  return <PropertyRow label={label} htmlFor={id}>{multiline
    ? <textarea {...props} rows={2} className={`${shared} min-h-14 resize-y py-1.5 leading-5`} />
    : <input {...props} onKeyDown={(event) => { if (event.key === "Enter" && !composing.current) event.currentTarget.blur(); }} className={`${shared} h-7`} />}</PropertyRow>;
}

export function NumericScrubField({ label, ariaLabel, value, min = -10_000, max = 10_000, step = 1, disabled = false, mixed = false, onCommit }: { label: string; ariaLabel?: string; value: number | undefined; min?: number; max?: number; step?: number; disabled?: boolean; mixed?: boolean; onCommit(next: number | undefined): void }) {
  const id = useId();
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  const scrub = useRef<{ x: number; value: number } | null>(null);
  useEffect(() => { if (!focused.current) setDraft(value === undefined ? "" : String(value)); }, [value]);
  const commit = (source = draft) => {
    if (!source.trim()) { setError(null); if (value !== undefined) onCommit(undefined); return; }
    const next = Number(source);
    if (!Number.isFinite(next) || next < min || next > max) { setError(`Enter a value from ${min} to ${max}.`); return; }
    setError(null); setDraft(String(next)); if (next !== value || mixed) onCommit(next);
  };
  const setStepped = (direction: -1 | 1, shift: boolean, alt: boolean) => {
    const next = Math.min(max, Math.max(min, numericStep(Number(draft) || value || 0, direction, step, shift, alt)));
    setDraft(String(next)); setError(null); onCommit(next);
  };
  return <PropertyRow label={<button type="button" disabled={disabled} title="Drag to scrub; double click to reset" onDoubleClick={() => { setDraft(""); onCommit(undefined); }} onPointerDown={(event) => { if (disabled) return; scrub.current = { x: event.clientX, value: Number(draft) || value || 0 }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!scrub.current) return; const next = Math.min(max, Math.max(min, scrub.current.value + (event.clientX - scrub.current.x) * step)); setDraft(String(Number(next.toFixed(6)))); }} onPointerUp={(event) => { if (!scrub.current) return; scrub.current = null; event.currentTarget.releasePointerCapture(event.pointerId); commit(); }} className="h-7 cursor-ew-resize truncate text-left text-[var(--if-text-secondary)] disabled:cursor-default">{label}</button>} htmlFor={id} error={error}>
    <input id={id} aria-label={ariaLabel} type="text" inputMode="decimal" value={draft} disabled={disabled} placeholder={mixed ? "Mixed" : "Auto"} onFocus={() => { focused.current = true; }} onChange={(event) => { setDraft(event.target.value); setError(null); }} onBlur={() => { focused.current = false; commit(); }} onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); setStepped(event.key === "ArrowUp" ? 1 : -1, event.shiftKey, event.altKey); } else if (event.key === "Enter") event.currentTarget.blur(); else if (event.key === "Escape") { setDraft(value === undefined ? "" : String(value)); setError(null); event.currentTarget.blur(); } }} className="h-7 w-full rounded-[5px] border border-[var(--if-border)] bg-[var(--if-input)] px-2 font-mono text-[11px] text-[var(--if-text)] outline-none hover:border-[var(--if-border-strong)] focus:border-[var(--if-blue)] focus:ring-1 focus:ring-[var(--if-blue)] disabled:opacity-45" />
  </PropertyRow>;
}

export type PickerOption = { value: string; label?: string; resolved?: string | number; group?: string };
export function SearchablePicker({ label, value, options, onChange, allowDetach = false, token = false }: { label: string; value: string; options: PickerOption[]; onChange(value: string): void; allowDetach?: boolean; token?: boolean }) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState(""); const [active, setActive] = useState(0); const root = useRef<HTMLDivElement>(null);
  const filtered = options.filter((option) => `${option.label ?? option.value} ${option.value}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { if (!open) return; const close = (event: PointerEvent) => { if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false); }; window.addEventListener("pointerdown", close); return () => window.removeEventListener("pointerdown", close); }, [open]);
  return <PropertyRow label={label}><div ref={root} className="relative"><button type="button" aria-label={`${label}: ${(options.find((option) => option.value === value)?.label ?? value) || "None"}`} aria-haspopup="listbox" aria-expanded={open} onClick={() => { setOpen((current) => !current); setQuery(""); setActive(0); }} className="flex h-7 w-full items-center gap-1.5 rounded-[5px] border border-[var(--if-border)] bg-[var(--if-input)] px-2 text-left text-[11px] text-[var(--if-text)] hover:border-[var(--if-border-strong)]">{token ? <LinkSimple size={11} className="text-[var(--if-blue)]" /> : null}<span className="min-w-0 flex-1 truncate">{(options.find((option) => option.value === value)?.label ?? value) || "None"}</span><CaretDown size={11} /></button>{open ? <div className="menu-pop absolute right-0 top-8 z-20 w-[300px] p-1"><div className="flex h-8 items-center gap-2 border-b border-[var(--if-border)] px-2"><MagnifyingGlass size={12} /><input autoFocus aria-label={`Search ${label}`} value={query} onChange={(event) => { setQuery(event.target.value); setActive(0); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(0, Math.min(filtered.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); } else if (event.key === "Enter" && filtered[active]) { onChange(filtered[active].value); setOpen(false); } else if (event.key === "Escape") setOpen(false); else if (event.key === "Backspace" && allowDetach && !query) { onChange(""); setOpen(false); } }} className="min-w-0 flex-1 bg-transparent text-[11px] outline-none" /></div><div role="listbox" className="max-h-60 overflow-auto py-1">{allowDetach ? <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] hover:bg-[var(--if-hover)]"><X size={11} /> Detach token</button> : null}{filtered.map((option, index) => <button key={option.value} type="button" role="option" aria-selected={option.value === value} onMouseEnter={() => setActive(index)} onClick={() => { onChange(option.value); setOpen(false); }} className={`flex min-h-8 w-full items-center gap-2 rounded px-2 text-left text-[11px] ${index === active ? "bg-[var(--if-hover)]" : ""}`}><span className="min-w-0 flex-1"><span className="block truncate">{option.label ?? option.value}</span>{option.resolved !== undefined ? <span className="block truncate font-mono text-[9px] text-[var(--if-text-tertiary)]">{String(option.resolved)}</span> : null}</span>{option.value === value ? <Check size={11} /> : null}</button>)}</div></div> : null}</div></PropertyRow>;
}

export function DisclosureSection({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) { const [open, setOpen] = useState(defaultOpen); return <section className="border-b border-[var(--if-border-subtle)]"><button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex h-9 w-full items-center justify-between px-3 text-[11px] font-medium text-[var(--if-text)]">{title}<CaretDown size={12} className={open ? "rotate-180" : ""} /></button>{open ? <div className="grid gap-1.5 px-3 pb-3">{children}</div> : null}</section>; }
