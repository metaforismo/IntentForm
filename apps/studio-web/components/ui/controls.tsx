"use client";

import type { ReactNode } from "react";

export function IconButton({
  ariaLabel,
  onClick,
  disabled,
  danger,
  size = 8,
  title,
  ariaExpanded,
  children,
}: {
  ariaLabel: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  size?: 7 | 8 | 11;
  title?: string;
  ariaExpanded?: boolean;
  children: ReactNode;
}) {
  const sizeClass = size === 11 ? "size-11" : size === 8 ? "size-8" : "size-7";
  const tone = danger
    ? "hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
    : "hover:bg-[var(--hover)] hover:text-[var(--ink)]";
  const className = `grid ${sizeClass} place-items-center rounded-md text-[var(--muted)] ${tone}${disabled !== undefined ? " disabled:opacity-25" : ""}`;
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-expanded={ariaExpanded}
      className={className}
    >
      {children}
    </button>
  );
}

export function Keycap({ children, className = "" }: { children: ReactNode; className?: string }) {
  const base = "rounded-md border border-[var(--line)] bg-[var(--chip)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--muted)]";
  return <kbd className={[className, base].filter(Boolean).join(" ")}>{children}</kbd>;
}

export function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  const base = "text-[9px] font-semibold uppercase tracking-[.12em] text-[var(--faint)]";
  return <span className={[className, base].filter(Boolean).join(" ")}>{children}</span>;
}

export function MenuItem({
  icon,
  label,
  shortcut,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  shortcut?: string | undefined;
  onClick?: () => void;
}) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className="flex min-h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[11px] text-[var(--t-strong)] hover:bg-[var(--hover)]">
      <span className="grid size-7 place-items-center rounded-md border border-[var(--line)] bg-[var(--chip)] text-[var(--t-strong)]">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut ? <kbd className="font-mono text-[9px] text-[var(--faint)]">{shortcut}</kbd> : null}
    </button>
  );
}
