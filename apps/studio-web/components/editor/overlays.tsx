"use client";

import { MagnifyingGlass, X, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { IconButton, Keycap, MenuItem, SectionLabel } from "../ui/controls";

export interface EditorCommand {
  label: string;
  shortcut?: string;
  section: string;
  icon: Icon;
  action(): void;
}

function useDialogFocus(onClose: () => void) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => dialog
      ? [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      : [];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = items[0]!;
      const last = items.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener("keydown", onKeyDown);
    return () => {
      dialog?.removeEventListener("keydown", onKeyDown);
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  return dialogRef;
}

export function CommandMenu({
  query,
  commands,
  onQuery,
  onRun,
  onClose,
}: {
  query: string;
  commands: EditorCommand[];
  onQuery(query: string): void;
  onRun(command: EditorCommand): void;
  onClose(): void;
}) {
  const dialogRef = useDialogFocus(onClose);
  const filtered = commands.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const sections = [...new Set(filtered.map((item) => item.section))];
  return (
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Command menu" tabIndex={-1} className="command-menu absolute left-1/2 top-16 z-[5] w-[min(540px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-[14px] border border-[var(--line-strong)] bg-[var(--menu)] shadow-[0_28px_80px_-32px_var(--shadow-strong)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <MagnifyingGlass size={15} className="text-[var(--muted)]" />
        <input autoFocus aria-label="Search commands" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search workspace commands" className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--t-strong)] outline-none placeholder:text-[var(--faint)]" />
        <Keycap>ESC</Keycap>
      </div>
      <div className="max-h-[380px] overflow-auto p-1.5">
        {sections.map((section) => (
          <div key={section}>
            <SectionLabel className="block px-2.5 pb-1.5 pt-2">{section}</SectionLabel>
            {filtered.filter((item) => item.section === section).map((item) => {
              const ItemIcon = item.icon;
              return (
                <MenuItem key={item.label} icon={<ItemIcon size={13} />} label={item.label} shortcut={item.shortcut} onClick={() => onRun(item)} />
              );
            })}
          </div>
        ))}
        {filtered.length === 0 ? <div className="px-3 py-8 text-center text-[11px] text-[var(--muted)]">No workspace command matches “{query}”.</div> : null}
      </div>
    </section>
  );
}

const shortcutRows: Array<[string, string]> = [
  ["Select / Hand tool", "V / H"],
  ["Temporary hand tool", "Space"],
  ["Preview mode", "P"],
  ["Command menu", "⌘K"],
  ["Duplicate layer", "⌘D"],
  ["Delete layer", "⌫"],
  ["Reorder layer", "⌥↑ / ⌥↓"],
  ["Undo / Redo", "⌘Z / ⇧⌘Z"],
  ["Fit board / 100% / 200%", "0 / 1 / 2"],
  ["Zoom", "⌘ Scroll or + / −"],
  ["Pan board", "Scroll or drag"],
  ["Layers / Inspector", "⌥L / ⌥I"],
  ["Close panels", "Esc"],
];

export function ShortcutsSheet({ onClose }: { onClose(): void }) {
  const dialogRef = useDialogFocus(onClose);
  return (
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" tabIndex={-1} className="absolute left-1/2 top-16 z-[4] w-[min(440px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] border border-[var(--line-strong)] bg-[var(--menu)] p-4 text-[var(--t-strong)] shadow-[0_28px_80px_-32px_var(--shadow-strong)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
        <div><strong className="block text-[12px]">Workspace shortcuts</strong><span className="mt-1 block text-[10px] text-[var(--muted)]">Fast commands pause while you edit a field.</span></div>
        <IconButton ariaLabel="Close keyboard shortcuts" onClick={onClose} size={8}><X size={14} /></IconButton>
      </div>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[11px] text-[var(--muted)]">
        {shortcutRows.map(([label, shortcut]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="rounded border border-[var(--line)] bg-[var(--chip)] px-1.5 py-0.5 text-right font-mono text-[10px] text-[var(--t-strong)]">{shortcut}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
