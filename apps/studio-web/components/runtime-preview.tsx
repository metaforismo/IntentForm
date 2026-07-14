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
  type Expression,
  type SemanticInterfaceGraph,
} from "@intentform/semantic-schema";
import { useEffect, useState, type CSSProperties } from "react";
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
  emit: () => void;
}) {
  if (!isVisible(node, data)) return null;
  const value = display(data, node.bindings.value);
  const detail = node.bindings.detail?.name === node.bindings.value?.name
    ? ""
    : display(data, node.bindings.detail);

  if (node.kind === "balance-summary") {
    return <section className="runtime-balance" aria-label={node.accessibilityLabel}><span>{node.label}</span>{value ? <strong>{value}</strong> : null}{detail ? <small>{detail}</small> : null}</section>;
  }
  if (node.kind === "transaction-list") {
    return <section aria-label={node.accessibilityLabel}><h2>{node.label}</h2>{value ? <p className="runtime-activity">{value}</p> : null}</section>;
  }
  if (node.kind === "money-input") {
    return <label className="runtime-money"><span>{node.label}</span><input key={`${node.id}:${value}`} inputMode="decimal" defaultValue={value} aria-label={node.accessibilityLabel} /></label>;
  }
  if (node.kind === "recipient-identity") {
    return <section className="runtime-recipient" aria-label={node.accessibilityLabel}>{value ? <span className="runtime-avatar" aria-hidden="true">{value.slice(0, 2).toUpperCase()}</span> : null}<span><strong>{value || node.label}</strong>{detail ? <small>{detail}</small> : null}</span></section>;
  }
  if (node.kind === "primary-action") {
    const compact = node.compactPlacement === "persistent-bottom" ? "persistent" : "inline";
    const regular = node.regularPlacement === "persistent-bottom" ? "persistent" : "inline";
    return <button className={`runtime-primary runtime-compact-${compact} runtime-regular-${regular}`} type="button" aria-label={node.accessibilityLabel} onClick={emit}>{node.label}</button>;
  }
  if (node.kind === "secondary-action") {
    return <button className="runtime-secondary" type="button" aria-label={node.accessibilityLabel} onClick={emit}>{node.label}</button>;
  }
  if (node.kind === "status-message") {
    return <p role="status" className="runtime-status">{node.label}</p>;
  }
  return <section className="runtime-receipt" aria-label={node.accessibilityLabel}><span>{node.label}</span>{detail ? <strong>{detail}</strong> : null}{value ? <small>{value}</small> : null}</section>;
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
  const colors = preview.graph.tokens.colors;
  const radii = preview.graph.tokens.radii;
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
      style={style}
    >
      <header><span className="runtime-eyebrow">{preview.ir.productName}</span><h1>{screen.title}</h1></header>
      <div className="runtime-screen-content">
        {screen.nodes.map((node) => (
          <RuntimeNode
            key={node.id}
            node={node}
            data={data}
            emit={() => {
              for (const event of node.events) {
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
