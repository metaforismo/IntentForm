"use client";

import { MagnifyingGlass, X, type Icon } from "@phosphor-icons/react";

export interface EditorCommand {
  label: string;
  shortcut?: string;
  section: string;
  icon: Icon;
  action(): void;
}

export function CommandMenu({
  query,
  commands,
  onQuery,
  onRun,
}: {
  query: string;
  commands: EditorCommand[];
  onQuery(query: string): void;
  onRun(command: EditorCommand): void;
}) {
  const filtered = commands.filter((item) => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const sections = [...new Set(filtered.map((item) => item.section))];
  return (
    <section aria-label="Command menu" className="command-menu absolute left-1/2 top-16 z-[5] w-[min(540px,calc(100%-32px))] -translate-x-1/2 overflow-hidden rounded-[14px] border border-[var(--line-strong)] bg-white/98 shadow-[0_28px_80px_-32px_rgba(18,27,22,.42)] backdrop-blur-xl">
      <div className="flex items-center gap-3 border-b border-[#e3e6e3] px-4 py-3">
        <MagnifyingGlass size={15} className="text-[#68716c]" />
        <input autoFocus aria-label="Search commands" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search workspace commands" className="min-w-0 flex-1 bg-transparent text-[12px] text-[#313733] outline-none placeholder:text-[var(--faint)]" />
        <kbd className="rounded-md border border-[#d8ddda] bg-[#f3f5f3] px-1.5 py-0.5 font-mono text-[9px] text-[#77807a]">ESC</kbd>
      </div>
      <div className="max-h-[380px] overflow-auto p-1.5">
        {sections.map((section) => (
          <div key={section}>
            <span className="block px-2.5 pb-1.5 pt-2 text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]">{section}</span>
            {filtered.filter((item) => item.section === section).map((item) => {
              const ItemIcon = item.icon;
              return (
                <button key={item.label} type="button" onClick={() => onRun(item)} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[11px] text-[#2f3531] hover:bg-[#edf3ef]">
                  <span className="grid size-7 place-items-center rounded-md border border-[#e0e4e1] bg-[#f8f9f7] text-[#4f5a54]"><ItemIcon size={13} /></span>
                  <span className="flex-1">{item.label}</span>
                  {item.shortcut ? <kbd className="font-mono text-[9px] text-[var(--faint)]">{item.shortcut}</kbd> : null}
                </button>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 ? <div className="px-3 py-8 text-center text-[11px] text-[#7c8580]">No workspace command matches “{query}”.</div> : null}
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
  return (
    <section aria-label="Keyboard shortcuts" className="absolute left-1/2 top-16 z-[4] w-[min(440px,calc(100%-32px))] -translate-x-1/2 rounded-[14px] border border-[var(--line-strong)] bg-white/98 p-4 text-[#252a27] shadow-[0_28px_80px_-32px_rgba(18,27,22,.42)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[#e3e6e3] pb-3">
        <div><strong className="block text-[12px]">Workspace shortcuts</strong><span className="mt-1 block text-[10px] text-[#7b847f]">Fast commands pause while you edit a field.</span></div>
        <button type="button" aria-label="Close keyboard shortcuts" onClick={onClose} className="grid size-8 place-items-center rounded-md text-[#7f8883] hover:bg-[#edf0ed] hover:text-[var(--ink)]"><X size={14} /></button>
      </div>
      <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-[11px] text-[#5f6863]">
        {shortcutRows.map(([label, shortcut]) => (
          <div key={label} className="contents">
            <dt>{label}</dt>
            <dd className="rounded border border-[#d8ddda] bg-[#f3f5f3] px-1.5 py-0.5 text-right font-mono text-[10px] text-[#38413c]">{shortcut}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
