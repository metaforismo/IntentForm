"use client";

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Command,
  Cursor,
  FrameCorners,
  Hand,
  Plus,
  Selection,
  TreeStructure,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import type { EditorTool } from "./support";

interface ToolRailProps {
  tool: EditorTool;
  spaceHeld: boolean;
  insertOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  structureOpen: boolean;
  inspectorOpen: boolean;
  commandOpen: boolean;
  minimalUi: boolean;
  insertMenu: ReactNode;
  onTool(tool: EditorTool): void;
  onInsert(): void;
  onUndo(): void;
  onRedo(): void;
  onStructure(): void;
  onInspector(): void;
  onCommands(): void;
  onMinimalUi(): void;
}

const quietButton = "grid size-8 place-items-center rounded-[6px] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--ink)]";

export function ToolRail({
  tool,
  spaceHeld,
  insertOpen,
  canUndo,
  canRedo,
  structureOpen,
  inspectorOpen,
  commandOpen,
  minimalUi,
  insertMenu,
  onTool,
  onInsert,
  onUndo,
  onRedo,
  onStructure,
  onInspector,
  onCommands,
  onMinimalUi,
}: ToolRailProps) {
  const toolButton = (id: EditorTool, label: string, icon: typeof Cursor) => {
    const Icon = icon;
    const active = tool === id && !(id === "select" && spaceHeld);
    return (
      <button key={id} type="button" title={label} aria-label={label} aria-pressed={tool === id} onClick={() => onTool(id)} className={`${quietButton} ${active || (id === "hand" && spaceHeld) ? "bg-[var(--accent)] text-white hover:bg-[var(--accent)] hover:text-white" : ""}`}>
        <Icon size={15} weight={active ? "fill" : "regular"} />
      </button>
    );
  };

  return (
    <aside aria-label="Canvas tools" className="z-[4] hidden min-h-0 flex-col items-center border-r border-[var(--if-border-subtle)] bg-[var(--if-panel)] py-1.5 xl:flex">
      <div className="flex flex-col items-center gap-1">
        {toolButton("select", "Select", Cursor)}
        {toolButton("hand", "Pan", Hand)}
        <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" title="Insert semantic component" aria-label="Insert component" aria-expanded={insertOpen} onClick={onInsert} className={`${quietButton} ${insertOpen ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : ""}`}>
            <Plus size={15} weight="bold" />
          </button>
          {insertMenu}
        </div>
        <span className="my-0.5 h-px w-5 bg-[var(--line)]" />
        <button type="button" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo} className={`${quietButton} disabled:opacity-25`}><ArrowCounterClockwise size={14} /></button>
        <button type="button" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo} className={`${quietButton} disabled:opacity-25`}><ArrowClockwise size={14} /></button>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1">
        <button type="button" title="Pages and layers · ⌥L" aria-label="Open pages and layers" aria-pressed={structureOpen} onClick={onStructure} className={`${quietButton} ${structureOpen ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : ""}`}><TreeStructure size={15} weight={structureOpen ? "fill" : "regular"} /></button>
        <button type="button" title="Design inspector · ⌥I" aria-label="Toggle design inspector" aria-pressed={inspectorOpen} onClick={onInspector} className={`${quietButton} ${inspectorOpen ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : ""}`}><Selection size={15} weight={inspectorOpen ? "fill" : "regular"} /></button>
        <button type="button" title="Commands · ⌘K" aria-label="Open command menu" aria-expanded={commandOpen} onClick={onCommands} className={quietButton}><Command size={15} /></button>
        <button type="button" title={`${minimalUi ? "Exit" : "Enter"} minimal UI · ⌘\\`} aria-label="Toggle minimal UI" aria-pressed={minimalUi} onClick={onMinimalUi} className={`${quietButton} ${minimalUi ? "bg-[var(--accent-soft)] text-[var(--accent-text)]" : ""}`}><FrameCorners size={15} /></button>
      </div>
    </aside>
  );
}
