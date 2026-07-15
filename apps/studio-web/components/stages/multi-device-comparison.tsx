"use client";

import { ArrowsOutCardinal, CaretDown, DeviceMobile, Monitor } from "@phosphor-icons/react";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { NodePreview } from "../editor/node-preview";
import { fixtureFor, isNodeVisible, tokenColor, type DeviceProfile, type VisualState } from "../editor/support";

function projectionScale(profile: DeviceProfile): number {
  return Math.min(0.62, 330 / profile.width, 540 / profile.height);
}

function Projection({
  graph,
  screen,
  profile,
  visualState,
  profiles,
  index,
  onProfileChange,
}: {
  graph: SemanticInterfaceGraph;
  screen: SemanticInterfaceGraph["screens"][number];
  profile: DeviceProfile;
  visualState: VisualState;
  profiles: readonly DeviceProfile[];
  index: number;
  onProfileChange(index: number, profileId: string): void;
}) {
  const scale = projectionScale(profile);
  const nodes = screen.nodes.filter((node) => isNodeVisible(node, visualState));
  const fixture = fixtureFor(graph, screen.id, visualState);
  const browser = profile.presentation === "browser";
  const chromeHeight = browser ? 34 : 0;
  const scaledWidth = profile.width * scale;
  const scaledHeight = (profile.height + chromeHeight) * scale;

  return (
    <article className="flex min-w-[238px] flex-1 flex-col gap-2.5" data-comparison-profile={profile.id}>
      <header className="flex min-h-9 items-center justify-between gap-2 px-0.5">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">Comparison frame {index + 1}</span>
          <select
            aria-label={`Comparison frame ${index + 1}`}
            value={profile.id}
            onChange={(event) => onProfileChange(index, event.target.value)}
            className="h-8 w-full appearance-none truncate rounded-md border border-[var(--line)] bg-[var(--chip)] px-2.5 pr-7 text-[11px] font-semibold text-[var(--t-strong)] outline-none hover:bg-[var(--hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          >
            {profiles.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label} · {candidate.detail}</option>)}
          </select>
          <CaretDown size={10} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--faint)]" />
        </label>
        <span className="shrink-0 font-mono text-[9px] font-semibold tabular-nums text-[var(--t-strong)]">{profile.width} × {profile.height}</span>
      </header>

      <div className="grid min-h-[570px] flex-1 place-items-center overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--workspace)] p-4">
        <div style={{ width: scaledWidth, height: scaledHeight }}>
          <div
            className="overflow-hidden border border-black/15 bg-[#fcfdfb] shadow-[0_16px_40px_-28px_var(--shadow-strong)]"
            style={{
              width: profile.width,
              height: profile.height + chromeHeight,
              borderRadius: profile.corners.radius,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {browser ? (
              <div className="flex h-[34px] items-center gap-2 border-b border-black/10 bg-[#efefef] px-3" aria-hidden="true">
                <span className="size-2.5 rounded-full bg-[#d36b64]" /><span className="size-2.5 rounded-full bg-[#d2a85d]" /><span className="size-2.5 rounded-full bg-[#68a16f]" />
                <span className="ml-2 h-4 flex-1 rounded bg-white/80" />
              </div>
            ) : null}
            <div
              className="flex flex-col overflow-hidden"
              style={{
                width: profile.width,
                height: profile.height,
                paddingTop: Math.max(profile.presentation === "device" ? 20 : 28, profile.safeArea.top),
                paddingRight: Math.max(28, profile.safeArea.right),
                paddingBottom: Math.max(28, profile.safeArea.bottom),
                paddingLeft: Math.max(28, profile.safeArea.left),
                background: "#fcfdfb",
              }}
            >
              <span className="text-[11px] font-bold uppercase tracking-[.16em]" style={{ color: tokenColor(graph, "color.accent", "#397461") }}>{graph.product.name}</span>
              <h3 className="mb-6 mt-1.5 text-[27px] font-semibold leading-[1.05] tracking-[-.045em] text-[#181c1a]">{screen.title}</h3>
              <div className="flex min-h-0 flex-1 flex-col" style={{ gap: 18 }}>
                {nodes.map((node) => (
                  <div key={node.id} className={node.kind === "primary-action" && node.layout.placement?.[profile.breakpoint] === "persistent-bottom" ? "mt-auto" : ""}>
                    <NodePreview node={node} graph={graph} fixture={fixture} state={visualState} viewport={profile} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}

export function MultiDeviceComparison({
  graph,
  selectedScreen,
  visualState,
  profiles,
  profileIds,
  onProfileChange,
}: {
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
  visualState: VisualState;
  profiles: readonly DeviceProfile[];
  profileIds: readonly string[];
  onProfileChange(index: number, profileId: string): void;
}) {
  const screen = graph.screens.find((candidate) => candidate.id === selectedScreen) ?? graph.screens[0];
  const selectedProfiles = profileIds.flatMap((id) => {
    const profile = profiles.find((candidate) => candidate.id === id);
    return profile ? [profile] : [];
  });
  if (!screen) return null;

  return (
    <section aria-label="Multi-device comparison" className="flex h-full min-h-0 flex-col bg-[var(--canvas)]">
      <header className="flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--chrome)] px-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-text)]"><ArrowsOutCardinal size={14} /></span>
          <div className="min-w-0"><h2 className="truncate text-[11px] font-semibold">Responsive comparison</h2><p className="truncate text-[9px] text-[var(--faint)]">{screen.title} · {visualState} state · one semantic graph</p></div>
        </div>
        <span className="hidden items-center gap-1.5 text-[9px] font-medium text-[var(--muted)] sm:flex"><Monitor size={12} /><DeviceMobile size={12} /> synchronized projections</span>
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex min-w-max gap-3 xl:min-w-0" role="group" aria-label="Compared device projections">
          {selectedProfiles.map((profile, index) => (
            <Projection key={`${index}-${profile.id}`} graph={graph} screen={screen} profile={profile} visualState={visualState} profiles={profiles} index={index} onProfileChange={onProfileChange} />
          ))}
        </div>
      </div>
    </section>
  );
}
