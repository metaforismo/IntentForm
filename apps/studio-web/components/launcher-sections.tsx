"use client";

import { ArrowRight, Check, ClockCounterClockwise, Copy, FileArrowUp, FolderOpen, HardDrives, Robot, SlidersHorizontal } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { BrowserCatalogProject } from "../lib/browser-project-catalog";
import type { CatalogFilters, CatalogSort } from "../lib/launcher-model";
import type { LauncherPreferences } from "../lib/launcher-preferences";
import type { ProjectType } from "../lib/browser-projects";

type BridgeStatus = "checking" | "available" | "unavailable";

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function LauncherHome({ projects, bridge, storageEstimate, onOpen, onOpenLocal, onImport, onAgents, onSettings }: {
  projects: BrowserCatalogProject[];
  bridge: BridgeStatus;
  storageEstimate: { usage: number; quota: number } | null;
  onOpen(project: BrowserCatalogProject): void;
  onOpenLocal(): void;
  onImport(): void;
  onAgents(): void;
  onSettings(): void;
}) {
  return <div className="mb-7 grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
    <div className="flex flex-wrap items-center gap-2 xl:col-span-2" aria-label="Home quick actions">
      <button type="button" onClick={onOpenLocal} disabled={bridge !== "available"} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--if-border)] bg-[var(--if-panel)] px-3 text-[11px] font-medium disabled:opacity-45"><FolderOpen size={13} /> Open local project</button>
      <button type="button" onClick={onImport} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--if-border)] bg-[var(--if-panel)] px-3 text-[11px] font-medium"><FileArrowUp size={13} /> Import</button>
      <button type="button" onClick={onAgents} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--if-border)] bg-[var(--if-panel)] px-3 text-[11px] font-medium"><Robot size={13} /> Connect agent</button>
    </div>
    <section className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-4" aria-labelledby="home-activity-title">
      <div className="flex items-center justify-between"><div><h2 id="home-activity-title" className="text-[13px] font-medium">Recent activity</h2><p className="mt-0.5 text-[11px] text-[var(--if-text-secondary)]">Private events derived from this local catalog.</p></div><ClockCounterClockwise size={16} className="text-[var(--if-text-tertiary)]" /></div>
      {projects.length ? <div className="mt-3 divide-y divide-[var(--if-border-subtle)]">{projects.slice(0, 4).map((project) => <button key={project.id} type="button" onClick={() => onOpen(project)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-left"><span className="min-w-0"><strong className="block truncate text-[11px] font-medium">{project.missingLocalPath ? "Local link unavailable" : project.source === "imported" && project.revision === 1 ? "Project imported" : project.revision > 1 ? "Catalog project updated" : "Project created"}</strong><span className="block truncate text-[10px] text-[var(--if-text-secondary)]">{project.name} · revision {project.revision}{project.missingLocalPath ? " · cached copy available" : ""}</span></span><time dateTime={project.updatedAt} className="text-[9px] text-[var(--if-text-tertiary)]">{new Date(project.updatedAt).toLocaleString()}</time></button>)}</div> : <p className="mt-4 text-[11px] text-[var(--if-text-secondary)]">Activity appears after the first project is created or imported.</p>}
    </section>
    <section className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-4" aria-labelledby="home-workspace-title">
      <div className="flex items-center justify-between"><h2 id="home-workspace-title" className="text-[13px] font-medium">Local workspace</h2><HardDrives size={16} className="text-[var(--if-text-tertiary)]" /></div>
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 text-[10px]"><dt className="text-[var(--if-text-secondary)]">Mode</dt><dd>{bridge === "available" ? "Desktop linked" : "Browser"}</dd><dt className="text-[var(--if-text-secondary)]">Projects</dt><dd>{projects.length}</dd><dt className="text-[var(--if-text-secondary)]">Storage</dt><dd>{storageEstimate ? `${formatBytes(storageEstimate.usage)} used` : "Unavailable"}</dd><dt className="text-[var(--if-text-secondary)]">Agent bridge</dt><dd className={bridge === "available" ? "text-[var(--if-green)]" : "text-[var(--if-text-secondary)]"}>{bridge}</dd></dl>
      <button type="button" onClick={onSettings} className="mt-4 h-7 rounded-md border border-[var(--if-border)] px-2.5 text-[10px] font-medium hover:bg-[var(--if-hover)]">Storage and preferences</button>
    </section>
  </div>;
}

const AGENT_CLIENTS = [
  { id: "codex", label: "Codex", transport: "stdio", command: "pnpm mcp:install --client codex --print" },
  { id: "claude", label: "Claude Code", transport: "stdio", command: "pnpm mcp:install --client claude --print" },
  { id: "opencode", label: "OpenCode", transport: "stdio", command: "pnpm mcp:install --client opencode --print" },
  { id: "pi", label: "Pi", transport: "stdio", command: "pnpm mcp:install --client pi --print" },
  { id: "generic", label: "Generic MCP", transport: "loopback HTTP", command: "INTENTFORM_MCP_TOKEN=<32+ chars> pnpm mcp:http" },
] as const;

const FIRST_SAFE_TASK = `Inspect the selected primary action.
Propose a compact-safe placement.
Do not change text or colors.`;

function CopyValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true);
          if (timer.current !== null) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setCopied(false), 1400);
        }).catch(() => setCopied(false));
      }}
      className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[4px] border border-[var(--if-border)] px-1.5 text-[9.5px] font-semibold text-[var(--if-text-secondary)] hover:bg-[var(--if-hover)] hover:text-[var(--if-text)]"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}{copied ? "Copied" : "Copy"}
    </button>
  );
}

export function LauncherAgents({ bridge }: { bridge: BridgeStatus }) {
  return (
    <section className="max-w-4xl" aria-labelledby="agents-title">
      <div className="mb-4">
        <h2 id="agents-title" className="text-[13px] font-medium">Connected agents</h2>
        <p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Humans and agents edit the same validated semantic graph. New MCP connections are read-only; writes require <code className="font-mono text-[10px]">INTENTFORM_MCP_PERMISSION=write</code> and every accepted change stays fingerprint-bound and reversible.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {AGENT_CLIENTS.map((client) => {
          const connected = client.id === "codex" && bridge === "available";
          return (
            <article key={client.id} className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <strong className="text-[12px] font-medium">{client.label}</strong>
                <span className="inline-flex items-center gap-1.5 text-[9.5px] text-[var(--if-text-secondary)]">
                  <span className={`size-2 rounded-full ${connected ? "bg-[var(--if-green)]" : "bg-[var(--if-text-tertiary)]"}`} />
                  {connected ? "Configured · reviewed writes" : "Not configured"}
                </span>
              </div>
              <p className="mt-1.5 text-[10px] text-[var(--if-text-secondary)]">{client.transport} · prints the exact configuration plan without changing your client; add <code className="font-mono">--apply</code> after review.</p>
              <div className="mt-2.5 flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded-[4px] border border-[var(--if-border-subtle)] bg-[var(--if-panel-alt)] px-2 py-1.5 font-mono text-[9.5px] text-[var(--if-text)]">{client.command}</code>
                <CopyValue value={client.command} label={`Copy ${client.label} setup command`} />
              </div>
            </article>
          );
        })}
        <article className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <strong className="text-[12px] font-medium">First safe task</strong>
            <CopyValue value={FIRST_SAFE_TASK} label="Copy the first safe agent task" />
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--if-text-secondary)]">Paste into a connected agent. The proposal arrives as a previewable transaction you commit or reject in Studio.</p>
          <pre className="mt-2.5 whitespace-pre-wrap rounded-[4px] border border-[var(--if-border-subtle)] bg-[var(--if-panel-alt)] px-2 py-1.5 font-mono text-[9.5px] leading-relaxed text-[var(--if-text)]">{FIRST_SAFE_TASK}</pre>
        </article>
      </div>
      <section className="mt-4 rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-3.5" aria-labelledby="agents-troubleshooting-title">
        <h3 id="agents-troubleshooting-title" className="text-[11px] font-medium">Troubleshooting</h3>
        <ul className="mt-2 grid gap-1.5 text-[10px] leading-relaxed text-[var(--if-text-secondary)] sm:grid-cols-2">
          <li><strong className="font-medium text-[var(--if-text)]">Agent bridge {bridge}.</strong> Browser-only projects have no MCP endpoint; open a local .intentform project (desktop app or repository checkout) to expose one.</li>
          <li><strong className="font-medium text-[var(--if-text)]">Connection test is read-only.</strong> Ask the agent to call intentform_describe_project; it reports the project and fingerprint without changing anything.</li>
          <li><strong className="font-medium text-[var(--if-text)]">Writes are rejected?</strong> The server defaults to read-only. Set INTENTFORM_MCP_PERMISSION=write in the client environment after reviewing the plan.</li>
          <li><strong className="font-medium text-[var(--if-text)]">HTTP transport refuses connections?</strong> It binds to 127.0.0.1 only and requires INTENTFORM_MCP_TOKEN (32–512 chars) as a bearer token.</li>
          <li><strong className="font-medium text-[var(--if-text)]">Wrong project opens?</strong> Pass --project /absolute/path to the installer, or set INTENTFORM_PROJECT_DIR for the server process.</li>
          <li><strong className="font-medium text-[var(--if-text)]">Stale fingerprint conflicts?</strong> That is the concurrency guard working: the agent re-reads the project and proposes against the current fingerprint.</li>
        </ul>
      </section>
    </section>
  );
}

const TARGET_LABELS: Record<string, string> = { react: "React", web: "Web", expo: "Expo", swiftui: "SwiftUI", compose: "Compose" };

export function LauncherBuilds({ projects, onOpen }: { projects: BrowserCatalogProject[]; onOpen(project: BrowserCatalogProject): void }) {
  return (
    <section className="max-w-5xl" aria-labelledby="builds-title">
      <div className="mb-4"><h2 id="builds-title" className="text-[13px] font-medium">Builds and verification</h2><p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Truthful per-target state: every target stays “not run” until evidence is produced in Code or Verify — generation is never presented as proof.</p></div>
      {projects.length ? (
        <div className="overflow-hidden rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)]">
          {projects.slice(0, 12).map((project) => {
            const targets = project.graph.platforms.filter((platform) => platform.enabled);
            return (
              <button key={project.id} type="button" onClick={() => onOpen(project)} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-[var(--if-border-subtle)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--if-hover)]">
                <span className="min-w-0">
                  <strong className="block truncate text-[11px] font-medium">{project.name}</strong>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {targets.length ? targets.map((platform) => (
                      <span key={platform.target} className="inline-flex items-center gap-1.5 rounded-[4px] border border-[var(--if-border-subtle)] bg-[var(--if-panel-alt)] px-1.5 py-0.5 text-[9px] text-[var(--if-text-secondary)]">
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--if-text-tertiary)]" />{TARGET_LABELS[platform.target] ?? platform.target} · not run
                      </span>
                    )) : <span className="text-[9px] text-[var(--if-text-tertiary)]">No enabled target</span>}
                  </span>
                </span>
                <span className="flex items-center gap-2 text-[9.5px] text-[var(--if-text-secondary)]">Open in Code <ArrowRight size={13} /></span>
              </button>
            );
          })}
        </div>
      ) : <p className="rounded-lg border border-dashed border-[var(--if-border)] p-5 text-[11px] text-[var(--if-text-secondary)]">Create or import a project, then run a target build from Code.</p>}
    </section>
  );
}

const LEARN_GUIDES: Array<{ title: string; detail: string; steps: string[] }> = [
  {
    title: "60-second product tour",
    detail: "Launcher → Design → Code → Verify",
    steps: [
      "Open Examples and choose Aster Sound — a complete responsive project.",
      "On the Design canvas, click any layer; the Inspector names its exact semantic role.",
      "Switch to Code: the same graph compiled to Web, React, Expo, and SwiftUI source.",
      "Switch to Verify: findings carry evidence, an exact node, and a previewable repair.",
    ],
  },
  {
    title: "Create the first project",
    detail: "Choose intent, targets, and a durable local start",
    steps: [
      "Press ⌘/Ctrl N or click New project.",
      "Pick a project type — Application, Prototype, Component library, or Responsive web.",
      "Name the product, audience, and first outcome; choose compiler targets.",
      "Create. The project autosaves to the durable browser catalog on every edit.",
    ],
  },
  {
    title: "Work with components",
    detail: "Definitions, variants, states, and instances",
    steps: [
      "Open the Components tab in the left dock to browse definitions.",
      "Use the Insert menu (+) on the tool rail to place a semantic component instance.",
      "Select an instance: the Inspector's Component section switches variant and state.",
      "Overrides stay tracked — detach or reset them from the same section.",
    ],
  },
  {
    title: "Connect an agent",
    detail: "Install an MCP client and review every write",
    steps: [
      "Open the Agents page and copy the installer command for your client.",
      "Run it with --print first; re-run with --apply after reviewing the plan.",
      "Connections start read-only; set INTENTFORM_MCP_PERMISSION=write for edits.",
      "Proposals arrive in Ask agent as fingerprint-bound diffs you commit or reject.",
    ],
  },
  {
    title: "Generate and verify",
    detail: "Separate generated output from observed evidence",
    steps: [
      "In Code, pick a target — files regenerate deterministically from the graph.",
      "Build produces runtime evidence; without it, status stays honestly “not run”.",
      "In Verify, open a finding: exact node, measurable evidence, responsible layer.",
      "Preview repair shows the smallest typed change; Apply, then re-run to confirm.",
    ],
  },
  {
    title: "Responsive Web",
    detail: "Frames, breakpoints, import, and runtime parity",
    steps: [
      "Create a Responsive web project; frames and breakpoints live in the Inspector.",
      "Import HTML/CSS renders in a sandbox and becomes a reviewed semantic diff.",
      "In Code (Web target), Runtime parity measures the real rendered document.",
      "Each difference links to the exact node — edit intent, regenerate, re-run.",
    ],
  },
  {
    title: "Expo and SwiftUI",
    detail: "Native projects with explicit diagnostics",
    steps: [
      "Enable Expo or SwiftUI targets when creating a project, or in the graph later.",
      "Code shows readable native source; unsupported relations become diagnostics.",
      "Local builds and Simulator evidence run through a desktop-linked project.",
      "No production app ships an IntentForm runtime — output is plain native code.",
    ],
  },
  {
    title: "Keyboard shortcuts",
    detail: "The essentials for fast editing",
    steps: [
      "⌘/Ctrl K — command palette · ? — full shortcut reference.",
      "V — select tool · H — pan tool · Space — temporary pan.",
      "⌘/Ctrl Z / ⇧⌘Z — undo and redo semantic edits.",
      "⌘/Ctrl N — new project · ⌘/Ctrl O — import a project file.",
    ],
  },
];

export function LauncherLearn() {
  const [openGuide, setOpenGuide] = useState<string | null>(null);
  return (
    <section className="max-w-5xl" aria-labelledby="learn-title">
      <div className="mb-4"><h2 id="learn-title" className="text-[13px] font-medium">Learn IntentForm</h2><p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Short local guides; no account or network request required.</p></div>
      <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {LEARN_GUIDES.map((guide) => {
          const open = openGuide === guide.title;
          return (
            <article key={guide.title} className="overflow-hidden rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)]">
              <button type="button" aria-expanded={open} onClick={() => setOpenGuide(open ? null : guide.title)} className="flex w-full items-start justify-between gap-2 p-4 text-left hover:bg-[var(--if-hover)]">
                <span><strong className="block text-[12px] font-medium">{guide.title}</strong><span className="mt-1 block text-[10px] leading-relaxed text-[var(--if-text-secondary)]">{guide.detail}</span></span>
                <ArrowRight size={12} className={`mt-1 shrink-0 text-[var(--if-text-tertiary)] transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
              {open ? (
                <ol className="grid gap-2 border-t border-[var(--if-border-subtle)] p-4 pt-3">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2 text-[10.5px] leading-relaxed text-[var(--if-text-secondary)]">
                      <span className="mt-px grid size-4 place-items-center rounded-full bg-[var(--if-panel-alt)] font-mono text-[8.5px] text-[var(--if-text-tertiary)]">{index + 1}</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function LauncherSettings({ preferences, projects, storageEstimate, onChange }: { preferences: LauncherPreferences; projects: BrowserCatalogProject[]; storageEstimate: { usage: number; quota: number } | null; onChange(update: (current: LauncherPreferences) => LauncherPreferences): void }) {
  return <section className="max-w-4xl" aria-labelledby="settings-title"><div className="mb-4"><h2 id="settings-title" className="text-[13px] font-medium">Settings</h2><p className="mt-1 text-[11px] text-[var(--if-text-secondary)]">Preferences are stored locally and apply immediately.</p></div><div className="grid gap-4 lg:grid-cols-2">
    <fieldset className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-4"><legend className="px-1 text-[11px] font-medium">Appearance</legend><div className="grid gap-3"><label className="grid gap-1 text-[10px] text-[var(--if-text-secondary)]">Theme<select value={preferences.appearance} onChange={(event) => onChange((current) => ({ ...current, appearance: event.target.value as LauncherPreferences["appearance"] }))} className="select-control h-8 text-[11px] text-[var(--if-text)]"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="grid gap-1 text-[10px] text-[var(--if-text-secondary)]">UI density<select value={preferences.density} onChange={(event) => onChange((current) => ({ ...current, density: event.target.value as LauncherPreferences["density"] }))} className="select-control h-8 text-[11px] text-[var(--if-text)]"><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></label><label className="flex items-center justify-between gap-3 text-[11px]"><span>Reduced motion</span><input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => onChange((current) => ({ ...current, reducedMotion: event.target.checked }))} className="accent-[var(--if-blue)]" /></label><label className="flex items-center justify-between gap-3 text-[11px]"><span>High contrast borders</span><input type="checkbox" checked={preferences.highContrast} onChange={(event) => onChange((current) => ({ ...current, highContrast: event.target.checked }))} className="accent-[var(--if-blue)]" /></label></div></fieldset>
    <fieldset className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-4"><legend className="px-1 text-[11px] font-medium">Canvas</legend><div className="grid gap-3"><label className="flex items-center justify-between gap-3 text-[11px]"><span>Show canvas grid</span><input type="checkbox" checked={preferences.canvasGrid} onChange={(event) => onChange((current) => ({ ...current, canvasGrid: event.target.checked }))} className="accent-[var(--if-blue)]" /></label><label className="grid gap-1 text-[10px] text-[var(--if-text-secondary)]">Grid size<select value={preferences.gridSize} onChange={(event) => onChange((current) => ({ ...current, gridSize: Number(event.target.value) as LauncherPreferences["gridSize"] }))} className="select-control h-8 text-[11px] text-[var(--if-text)]">{[8, 16, 24, 32].map((size) => <option key={size} value={size}>{size}px</option>)}</select></label></div></fieldset>
    <section className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-4"><h3 className="text-[11px] font-medium">Storage</h3><dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[10px]"><dt className="text-[var(--if-text-secondary)]">Catalog projects</dt><dd>{projects.length}</dd><dt className="text-[var(--if-text-secondary)]">Estimated usage</dt><dd>{storageEstimate ? formatBytes(storageEstimate.usage) : "Unavailable"}</dd><dt className="text-[var(--if-text-secondary)]">Estimated quota</dt><dd>{storageEstimate?.quota ? formatBytes(storageEstimate.quota) : "Unavailable"}</dd></dl></section>
    <section className="rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-4"><h3 className="text-[11px] font-medium">Keyboard</h3><div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2 text-[10px]"><span>Search projects</span><kbd>⌘/Ctrl K</kbd><span>New project</span><kbd>⌘/Ctrl N</kbd><span>Import project</span><kbd>⌘/Ctrl O</kbd></div></section>
  </div></section>;
}

export function ProjectOrganizationControls({ sort, filters, projectTypes, onSort, onFilters }: { sort: CatalogSort; filters: CatalogFilters; projectTypes: Array<{ id: ProjectType; label: string }>; onSort(sort: CatalogSort): void; onFilters(filters: CatalogFilters): void }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--if-border)] bg-[var(--if-panel)] p-2" aria-label="Project organization controls"><SlidersHorizontal size={14} className="mx-1 text-[var(--if-text-tertiary)]" /><select aria-label="Sort projects" value={sort} onChange={(event) => onSort(event.target.value as CatalogSort)} className="select-control h-7 text-[10px]"><option value="modified">Recently opened</option><option value="name">Name</option><option value="type">Type</option><option value="status">Status</option></select><select aria-label="Filter project type" value={filters.type} onChange={(event) => onFilters({ ...filters, type: event.target.value as CatalogFilters["type"] })} className="select-control h-7 text-[10px]"><option value="all">All types</option>{projectTypes.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select><select aria-label="Filter platform" value={filters.platform} onChange={(event) => onFilters({ ...filters, platform: event.target.value as CatalogFilters["platform"] })} className="select-control h-7 text-[10px]"><option value="all">All platforms</option>{["react", "web", "expo", "swiftui"].map((platform) => <option key={platform} value={platform}>{platform}</option>)}</select><label className="ml-auto flex items-center gap-2 px-1 text-[10px]"><input type="checkbox" checked={filters.missingOnly} onChange={(event) => onFilters({ ...filters, missingOnly: event.target.checked })} className="accent-[var(--if-blue)]" /> Missing paths</label></div>;
}
