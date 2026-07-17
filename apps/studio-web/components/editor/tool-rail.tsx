"use client";

import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Command,
  Cursor,
  FrameCorners,
  Hand,
  ChatCircle,
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

const quietButton = "if-editor-icon grid size-8 place-items-center";

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
      <button key={id} type="button" title={label} aria-label={label} aria-pressed={tool === id} data-state={active || (id === "hand" && spaceHeld) ? "active" : "idle"} onClick={() => onTool(id)} className={quietButton}>
        <Icon size={15} weight={active ? "fill" : "regular"} />
      </button>
    );
  };

  return (
    <aside aria-label="Canvas tools" className="z-[4] hidden min-h-0 flex-col items-center border-r border-[var(--if-border-subtle)] bg-[var(--if-panel)] py-1.5 xl:flex">
      <div className="flex flex-col items-center gap-1">
        {toolButton("select", "Select", Cursor)}
        {toolButton("hand", "Pan", Hand)}
        {toolButton("comment", "Add comment", ChatCircle)}
        <div className="relative" onPointerDown={(event) => event.stopPropagation()}>
          <button type="button" title="Insert semantic component" aria-label="Insert component" aria-expanded={insertOpen} data-state={insertOpen ? "active" : "idle"} onClick={onInsert} className={quietButton}>
            <Plus size={15} weight="bold" />
          </button>
          {insertMenu}
        </div>
        <span className="my-0.5 h-px w-5 bg-[var(--line)]" />
        <button type="button" title="Undo" aria-label="Undo" disabled={!canUndo} onClick={onUndo} className={`${quietButton} disabled:opacity-25`}><ArrowCounterClockwise size={14} /></button>
        <button type="button" title="Redo" aria-label="Redo" disabled={!canRedo} onClick={onRedo} className={`${quietButton} disabled:opacity-25`}><ArrowClockwise size={14} /></button>
      </div>
      <div className="mt-auto flex flex-col items-center gap-1">
        <button type="button" title="Pages and layers · ⌥L" aria-label="Open pages and layers" aria-pressed={structureOpen} data-state={structureOpen ? "active" : "idle"} onClick={onStructure} className={quietButton}><TreeStructure size={15} weight={structureOpen ? "fill" : "regular"} /></button>
        <button type="button" title="Design inspector · ⌥I" aria-label="Toggle design inspector" aria-pressed={inspectorOpen} data-state={inspectorOpen ? "active" : "idle"} onClick={onInspector} className={quietButton}><Selection size={15} weight={inspectorOpen ? "fill" : "regular"} /></button>
        <button type="button" title="Commands · ⌘K" aria-label="Open command menu" aria-expanded={commandOpen} onClick={onCommands} className={quietButton}><Command size={15} /></button>
        <button type="button" title={`${minimalUi ? "Exit" : "Enter"} minimal UI · ⌘\\`} aria-label="Toggle minimal UI" aria-pressed={minimalUi} data-state={minimalUi ? "active" : "idle"} onClick={onMinimalUi} className={quietButton}><FrameCorners size={15} /></button>
      </div>
    </aside>
  );
}
