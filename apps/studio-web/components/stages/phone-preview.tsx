"use client";

import { DeviceMobile } from "@phosphor-icons/react";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { NodePreview } from "../editor/node-preview";
import { editorProfiles, fixtureFor, isNodeVisible } from "../editor/support";

/* A single scaled-down frame that reuses the canvas node renderer, so every
   preview in the product draws from one source of truth. */
export function PhonePreview({ graph, selectedScreen }: { graph: SemanticInterfaceGraph; selectedScreen: string }) {
  const screen = graph.screens.find((item) => item.id === selectedScreen) ?? graph.screens[0];
  if (!screen) return null;
  const scale = 0.68;
  const profiles = editorProfiles(graph);
  const profile = profiles.find((item) => item.id === `device:${graph.devices.defaultProfile}`) ?? profiles[0]!;
  const { width, height } = profile;
  const nodes = screen.nodes.filter((node) => isNodeVisible(node, "idle"));
  const fixture = fixtureFor(graph, screen.id, "idle");
  return (
    <div className="relative grid min-h-[520px] place-items-center rounded-[32px] border border-[var(--line)] bg-[var(--inset)] p-6">
      <div style={{ width: width * scale, height: height * scale }}>
        <div
          className="phone-shell flex flex-col overflow-hidden bg-[#fcfdfb]"
          style={{
            width,
            height,
            borderRadius: profile.corners.radius,
            paddingTop: Math.max(20, profile.safeArea.top),
            paddingRight: Math.max(28, profile.safeArea.right),
            paddingBottom: Math.max(28, profile.safeArea.bottom),
            paddingLeft: Math.max(28, profile.safeArea.left),
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <div className="mb-4 flex items-center justify-between text-[12px] font-semibold text-[#2a2f2c]">
            <span className="pl-1 font-mono tracking-[-.02em]">9:41</span>
            <span className="flex items-center gap-1 pr-1" aria-hidden="true">
              <span className="h-2 w-3.5 rounded-[2px] border border-[#2a2f2c]/70" />
              <span className="h-2 w-2 rounded-full border border-[#2a2f2c]/70" />
            </span>
          </div>
          <span className="text-[11px] font-bold uppercase tracking-[.16em] text-[var(--accent)]">{graph.product.name}</span>
          <h3 className="mb-6 mt-1.5 text-[27px] font-semibold leading-[1.05] tracking-[-.045em]">{screen.title}</h3>
          <div className="flex min-h-0 flex-1 flex-col" style={{ gap: 18 }}>
            {nodes.map((node) => (
              <div key={node.id} className={node.kind === "primary-action" && node.layout.placement?.[profile.breakpoint] === "persistent-bottom" ? "mt-auto" : ""}>
                <NodePreview node={node} graph={graph} fixture={fixture} state="idle" viewport={profile} />
              </div>
            ))}
          </div>
          <div className="mx-auto mt-5 h-[5px] w-28 shrink-0 rounded-full bg-[#1d211f]" />
        </div>
      </div>
      <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--float)] px-3 py-1.5 text-[10px] font-medium text-[var(--muted)] backdrop-blur-xl">
        <DeviceMobile size={13} /> {profile.detail} · {profile.breakpoint === "compact" ? "Compact" : "Regular"}
      </div>
    </div>
  );
}
