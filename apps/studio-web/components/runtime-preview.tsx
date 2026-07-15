"use client";

import {
  compileReact,
  lowerGraph,
  type PlatformIR,
  type PlatformIRNode,
  type PlatformIRScreen,
} from "@intentform/compiler-react";
import {
  parseGraph,
  resolveTokenMode,
  type Expression,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  PREVIEW_READY,
  PREVIEW_STATUS,
  isPreviewRequest,
  type ActivePreviewReady,
  type ActivePreviewStatus,
} from "./runtime-preview-protocol";

interface LoadedPreview {
  fingerprint: string;
  graph: SemanticInterfaceGraph;
  ir: PlatformIR;
}

function sendToParent(message: ActivePreviewReady | ActivePreviewStatus) {
  window.parent.postMessage(message, "*");
}

function evaluateExpression(expression: Expression, data: Record<string, unknown>): unknown {
  if (expression.op === "value") return expression.value;
  if (expression.op === "field") return data[expression.path.slice("data.".length)];
  if (expression.op === "not") return !evaluateExpression(expression.value, data);
  return evaluateExpression(expression.left, data) === evaluateExpression(expression.right, data);
}

function isVisible(node: PlatformIRNode, data: Record<string, unknown>): boolean {
  if (node.visibility.length === 0) return true;
  return node.visibility.some((visibility) => visibility.expression
    ? evaluateExpression(visibility.expression, data) === true
    : node.bindings.status
      ? data[node.bindings.status.name] === visibility.state
      : true);
}

const display = (data: Record<string, unknown>, field: PlatformIRNode["bindings"]["value"]): string =>
  field ? String(data[field.name] ?? "") : "";

function RuntimeNode({
  node,
  data,
  emit,
}: {
  node: PlatformIRNode;
  data: Record<string, unknown>;
  emit: (node: PlatformIRNode) => void;
}) {
  if (!isVisible(node, data)) return null;
  const value = display(data, node.bindings.value);
  const detail = node.bindings.detail?.name === node.bindings.value?.name
    ? ""
    : display(data, node.bindings.detail);
  const accessibility = {
    "aria-label": node.accessibility.label,
    ...(node.accessibility.hint ? { "aria-description": node.accessibility.hint } : {}),
    ...(node.accessibility.live === "off" ? {} : { "aria-live": node.accessibility.live }),
  } as const;
  let content: ReactNode;
  if (node.kind === "balance-summary") {
    content = <section className="runtime-balance" {...accessibility}><span>{node.intent.label}</span>{value ? <strong>{value}</strong> : null}{detail ? <small>{detail}</small> : null}</section>;
  } else if (node.kind === "transaction-list") {
    content = <section {...accessibility}><h2>{node.intent.label}</h2>{value ? <p className="runtime-activity">{value}</p> : null}</section>;
  } else if (node.kind === "money-input") {
    content = <label className="runtime-money"><span>{node.intent.label}</span><input key={`${node.id}:${value}`} inputMode="decimal" defaultValue={value} {...accessibility} /></label>;
  } else if (node.kind === "recipient-identity") {
    content = <section className="runtime-recipient" {...accessibility}>{value ? <span className="runtime-avatar" aria-hidden="true">{value.slice(0, 2).toUpperCase()}</span> : null}<span><strong>{value || node.intent.label}</strong>{detail ? <small>{detail}</small> : null}</span></section>;
  } else if (node.kind === "primary-action") {
    const compact = node.layout.compactPlacement === "persistent-bottom" ? "persistent" : "inline";
    const regular = node.layout.regularPlacement === "persistent-bottom" ? "persistent" : "inline";
    content = <button className={`runtime-primary runtime-compact-${compact} runtime-regular-${regular}`} type="button" {...accessibility} onClick={() => emit(node)}>{node.intent.label}</button>;
  } else if (node.kind === "secondary-action") {
    content = <button className="runtime-secondary" type="button" {...accessibility} onClick={() => emit(node)}>{node.intent.label}</button>;
  } else if (node.kind === "status-message") {
    content = <p role="status" className="runtime-status" {...accessibility}>{node.intent.label}</p>;
  } else if (node.kind === "receipt-summary") {
    content = <section className="runtime-receipt" {...accessibility}><span>{node.intent.label}</span>{detail ? <strong>{detail}</strong> : null}{value ? <small>{value}</small> : null}</section>;
  } else {
    content = (
      <div
        className={`runtime-container runtime-mode-compact-${node.layout.compactMode} runtime-mode-regular-${node.layout.regularMode}`}
        style={{ "--runtime-columns": node.layout.columns, "--runtime-split-ratio": node.layout.splitRatio } as CSSProperties}
        {...accessibility}
      >
        {node.children.map((child) => <RuntimeNode key={child.id} node={child} data={data} emit={emit} />)}
      </div>
    );
  }
  if (node.asset && node.asset.exportPolicy !== "blocked") {
    const source = `/api/project/assets/${node.asset.digest}`;
    const position = `${Math.round(node.asset.focalPoint.x * 100)}% ${Math.round(node.asset.focalPoint.y * 100)}%`;
    const media = node.asset.kind === "video"
      ? <video className="runtime-asset-media" src={source} controls preload="metadata" aria-label={node.asset.decorative ? undefined : node.accessibility.label} />
      : node.asset.kind === "audio"
        ? <audio className="runtime-asset-audio" src={source} controls preload="metadata" aria-label={node.asset.decorative ? undefined : node.accessibility.label} />
        : <img className="runtime-asset-media" src={source} loading="lazy" decoding="async" alt={node.asset.decorative ? "" : node.accessibility.label} style={{ objectFit: node.asset.fit, objectPosition: position }} />;
    content = <div className="runtime-asset-content" data-asset-id={node.asset.id}>{media}{content}</div>;
  }
  const semantics = {
    "--runtime-node-gap": `${node.layout.gap}px`,
    "--runtime-node-padding": `${node.layout.padding}px`,
    "--runtime-x": `${node.layout.position?.x ?? 0}px`,
    "--runtime-y": `${node.layout.position?.y ?? 0}px`,
    "--runtime-z": node.layout.position?.z ?? 0,
    width: node.layout.fixedWidth,
    height: node.layout.fixedHeight,
    minWidth: node.layout.minWidth,
    maxWidth: node.layout.maxWidth,
    minHeight: node.layout.minHeight,
    maxHeight: node.layout.maxHeight,
  } as CSSProperties;
  return (
    <div
      className={`runtime-node runtime-axis-${node.layout.axis} runtime-width-${node.layout.width} runtime-height-${node.layout.height} runtime-align-${node.layout.align} runtime-justify-${node.layout.justify} runtime-overflow-${node.layout.overflow} runtime-emphasis-${node.style.emphasis} runtime-importance-${node.intent.importance}`}
      data-intent-purpose={node.intent.purpose}
      data-intent-role={node.style.role}
      style={semantics}
    >
      {content}
    </div>
  );
}

function RuntimeScreen({
  preview,
  screen,
  navigate,
}: {
  preview: LoadedPreview;
  screen: PlatformIRScreen;
  navigate: (screenId: string) => void;
}) {
  const data = screen.defaultFixture.data;
  const resolvedTokens = resolveTokenMode(preview.graph.tokens);
  const colors = resolvedTokens.colors;
  const radii = resolvedTokens.radii;
  const style = {
    "--runtime-accent": colors["color.accent"] ?? "#397461",
    "--runtime-ink": colors["color.ink"] ?? "#181c1a",
    "--runtime-canvas": colors["color.canvas"] ?? "#f3f5f1",
    "--runtime-surface": colors["color.surface"] ?? "#fbfcf9",
    "--runtime-control-radius": `${radii["radius.control"] ?? 18}px`,
    "--runtime-surface-radius": `${radii["radius.surface"] ?? 28}px`,
  } as CSSProperties;

  return (
    <main
      key={`${preview.fingerprint}:${screen.id}`}
      className="runtime-preview-root"
      data-compiler-fingerprint={preview.fingerprint}
      data-screen-id={screen.id}
      data-screen-purpose={screen.purpose}
      data-screen-route={screen.route}
      data-if-token-mode={preview.ir.activeTokenMode}
      style={style}
    >
      <header><span className="runtime-eyebrow">{preview.ir.productName}</span><h1>{screen.title}</h1></header>
      <div className="runtime-screen-content">
        {screen.nodes.map((node) => (
          <RuntimeNode
            key={node.id}
            node={node}
            data={data}
            emit={(emittingNode) => {
              for (const event of emittingNode.events) {
                const target = screen.eventTargets[event.name];
                if (target) navigate(target);
              }
            }}
          />
        ))}
      </div>
    </main>
  );
}

export function RuntimePreview() {
  const [preview, setPreview] = useState<LoadedPreview | null>(null);
  const [screenId, setScreenId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.source !== window.parent || !isPreviewRequest(event.data)) return;
      const request = event.data;
      try {
        const graph = parseGraph(request.graph);
        const output = compileReact(graph);
        if (output.fingerprint !== request.fingerprint) {
          throw new Error("The preview fingerprint does not match the generated React output.");
        }
        const ir = lowerGraph(graph, "react");
        const requested = ir.screens.find((screen) => screen.id === request.selectedScreen) ?? ir.screens[0];
        if (!requested) throw new Error("The active graph has no screen to preview.");
        setPreview({ fingerprint: output.fingerprint, graph, ir });
        setScreenId(requested.id);
        setError(null);
        sendToParent({ type: PREVIEW_STATUS, fingerprint: output.fingerprint, status: "ready" });
      } catch (cause) {
        const message = cause instanceof Error ? cause.message.slice(0, 240) : "The active graph could not be rendered.";
        setError(message);
        sendToParent({
          type: PREVIEW_STATUS,
          fingerprint: request.fingerprint,
          status: "error",
          message,
        });
      }
    };
    window.addEventListener("message", receive);
    sendToParent({ type: PREVIEW_READY });
    return () => window.removeEventListener("message", receive);
  }, []);

  if (error) return <div className="runtime-preview-state" role="alert"><strong>Preview unavailable</strong><span>{error}</span></div>;
  if (!preview) return <div className="runtime-preview-state" role="status"><span className="runtime-preview-spinner" />Compiling the active graph…</div>;
  const screen = preview.ir.screens.find((candidate) => candidate.id === screenId) ?? preview.ir.screens[0];
  if (!screen) return <div className="runtime-preview-state" role="alert">The active graph has no screen.</div>;
  return <RuntimeScreen preview={preview} screen={screen} navigate={setScreenId} />;
}
