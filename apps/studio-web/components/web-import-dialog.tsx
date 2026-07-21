"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DOM_IMPORT_LIMITS,
  projectComputedDom,
  type ComputedDomNode,
  type ComputedDomStyle,
  type DomImportProjection,
} from "@intentform/compiler-web/dom-import";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import {
  formatImportChangeValue,
  importChangeKind,
  summarizeImportChanges,
} from "./web-import-review";

interface WebImportDialogProps {
  open: boolean;
  graph: SemanticInterfaceGraph;
  screenId: string;
  onClose: () => void;
  onApply: (projection: DomImportProjection) => void;
}

const CSP = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; base-uri 'none'; form-action 'none'; frame-src 'none'; connect-src 'none'";
const BLOCKED_ELEMENTS = "script,iframe,frame,object,embed,link,base,meta,form,portal";
const URL_ATTRIBUTES = new Set(["src", "srcset", "href", "action", "formaction", "poster", "data", "cite"]);
const number = (value: string): number => Number.isFinite(Number.parseFloat(value)) ? Number.parseFloat(value) : 0;

function ImportReview({ projection, removed }: { projection: DomImportProjection; removed: number }) {
  const summary = summarizeImportChanges(projection.changes);
  return (
    <div className="grid gap-3" data-testid="web-import-review">
      <section aria-labelledby="web-import-impact-title" className="rounded border border-[var(--line)] bg-[var(--raised)] p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <h3 id="web-import-impact-title" className="mr-auto text-[10px] font-semibold text-[var(--ink)]">Reviewed impact</h3>
          <span className="rounded bg-[var(--if-green-soft)] px-1.5 py-0.5 font-mono text-[8.5px] text-[var(--success)]">{summary.added} added</span>
          <span className="rounded bg-[var(--danger-soft)] px-1.5 py-0.5 font-mono text-[8.5px] text-[var(--danger)]">{summary.removed} removed</span>
          <span className="rounded bg-[var(--hover)] px-1.5 py-0.5 font-mono text-[8.5px] text-[var(--muted)]">{summary.updated} updated</span>
        </div>
        <p id="web-import-impact" data-testid="web-import-impact" className="mt-2 text-[9.5px] leading-4 text-[var(--muted)]">
          This operation replaces {projection.replacedNodes} existing {projection.replacedNodes === 1 ? "node" : "nodes"} with {projection.importedNodes} imported {projection.importedNodes === 1 ? "node" : "nodes"} on the selected screen.
          {summary.destructive ? " Removed paths remain recoverable through project history." : " No semantic paths are removed."}
        </p>
        {removed ? <p className="mt-1 text-[9.5px] text-[var(--warning)]">{removed} executable, embedded, or URL-bearing {removed === 1 ? "item was" : "items were"} removed before rendering.</p> : null}
      </section>

      <section aria-labelledby="web-import-diff-title" className="overflow-hidden rounded border border-[var(--line)]">
        <header className="flex items-center justify-between bg-[var(--raised)] px-3 py-2">
          <h3 id="web-import-diff-title" className="text-[10px] font-semibold text-[var(--ink)]">Semantic diff</h3>
          <span className="font-mono text-[8.5px] text-[var(--faint)]">{summary.total} exact {summary.total === 1 ? "change" : "changes"}</span>
        </header>
        <ol className="max-h-48 divide-y divide-[var(--line)] overflow-auto" data-testid="web-import-diff">
          {projection.changes.map((change, index) => {
            const kind = importChangeKind(change);
            return (
              <li key={`${change.path}:${index}`} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2 px-3 py-2">
                <span className={`font-mono text-[8px] uppercase ${kind === "added" ? "text-[var(--success)]" : kind === "removed" ? "text-[var(--danger)]" : "text-[var(--muted)]"}`}>{kind}</span>
                <div className="min-w-0">
                  <strong className="block break-all font-mono text-[9px] font-medium text-[var(--ink)]">{change.path}</strong>
                  <div className="mt-1 grid grid-cols-[10px_minmax(0,1fr)] gap-x-1 font-mono text-[8px] leading-3.5">
                    <span className="text-[var(--danger)]">−</span><span className="break-all text-[var(--muted)]">{formatImportChangeValue(change.before)}</span>
                    <span className="text-[var(--success)]">+</span><span className="break-all text-[var(--ink)]">{formatImportChangeValue(change.after)}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="web-import-diagnostics-title" className="rounded border border-[var(--line)] bg-[var(--raised)] p-3">
        <h3 id="web-import-diagnostics-title" className="text-[10px] font-semibold text-[var(--ink)]">Diagnostics · {projection.diagnostics.length}</h3>
        {projection.diagnostics.length ? <ul className="mt-2 max-h-28 space-y-1 overflow-auto">{projection.diagnostics.map((diagnostic, index) => <li key={`${diagnostic.path}:${diagnostic.message}:${index}`} className="text-[9px] leading-4 text-[var(--muted)]"><strong className="break-all font-mono font-medium text-[var(--ink)]">{diagnostic.path}</strong> · {diagnostic.message}</li>)}</ul> : <p className="mt-1 text-[9px] text-[var(--muted)]">No unsupported properties or preserved-contract warnings.</p>}
      </section>
    </div>
  );
}

function sandboxSource(html: string, css: string): { source: string; removed: number } {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  let removed = 0;
  parsed.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => { element.remove(); removed += 1; });
  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (attribute.name.toLowerCase().startsWith("on") || URL_ATTRIBUTES.has(attribute.name.toLowerCase())) {
        element.removeAttribute(attribute.name);
        removed += 1;
      }
    }
  });
  const csp = parsed.createElement("meta");
  csp.httpEquiv = "Content-Security-Policy";
  csp.content = CSP;
  parsed.head.prepend(csp);
  const viewport = parsed.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width,initial-scale=1";
  parsed.head.append(viewport);
  const authoredStyle = parsed.createElement("style");
  // The closing-tag escape must be case-insensitive: `</STYLE` closes the
  // element just as `</style` does.
  authoredStyle.textContent = css.replace(/<\/style/gi, "<\\/style");
  parsed.head.append(authoredStyle);
  return { source: `<!doctype html>${parsed.documentElement.outerHTML}`, removed };
}

function ownText(element: Element): string {
  return [...element.childNodes]
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function computedNode(element: Element, depth: number, state: { count: number }): ComputedDomNode | null {
  if (state.count >= DOM_IMPORT_LIMITS.maxNodes || depth > DOM_IMPORT_LIMITS.maxDepth) return null;
  const view = element.ownerDocument.defaultView;
  if (!view) return null;
  const computed = view.getComputedStyle(element);
  if (computed.display === "none" || computed.visibility === "hidden") return null;
  const rect = element.getBoundingClientRect();
  state.count += 1;
  const unsupported = [
    computed.transform !== "none" ? "transform" : null,
    computed.boxShadow !== "none" ? "box-shadow" : null,
    computed.filter !== "none" ? "filter" : null,
    computed.backgroundImage !== "none" ? "background-image" : null,
    computed.animationName !== "none" ? "animation" : null,
  ].filter((value): value is string => value !== null);
  const gridTemplateColumns = computed.gridTemplateColumns === "none"
    ? []
    : computed.gridTemplateColumns.split(/\s+/).map(number).filter((value) => value > 0);
  const style: ComputedDomStyle = {
    display: computed.display,
    flexDirection: computed.flexDirection,
    flexWrap: computed.flexWrap,
    position: computed.position,
    insetBlockStart: computed.insetBlockStart === "auto" ? null : number(computed.insetBlockStart),
    overflowX: computed.overflowX,
    overflowY: computed.overflowY,
    gap: number(computed.gap),
    paddingTop: number(computed.paddingTop),
    paddingRight: number(computed.paddingRight),
    paddingBottom: number(computed.paddingBottom),
    paddingLeft: number(computed.paddingLeft),
    alignItems: computed.alignItems,
    justifyContent: computed.justifyContent,
    width: rect.width,
    height: rect.height,
    gridTemplateColumns,
    color: computed.color,
    backgroundColor: computed.backgroundColor,
    borderColor: computed.borderTopColor,
    borderWidth: number(computed.borderTopWidth),
    borderStyle: computed.borderTopStyle,
    borderRadius: number(computed.borderTopLeftRadius),
    opacity: number(computed.opacity),
    fontFamily: computed.fontFamily,
    fontSize: number(computed.fontSize),
    fontWeight: number(computed.fontWeight),
    lineHeight: computed.lineHeight === "normal" ? number(computed.fontSize) * 1.2 : number(computed.lineHeight),
    letterSpacing: computed.letterSpacing === "normal" ? 0 : number(computed.letterSpacing),
    textAlign: computed.textAlign,
  };
  const children = [...element.children].flatMap((child) => {
    const result = computedNode(child, depth + 1, state);
    return result ? [result] : [];
  });
  return {
    tag: element.tagName.toLowerCase(),
    text: ownText(element),
    accessibleName: element.getAttribute("aria-label") ?? element.getAttribute("alt") ?? (element.textContent ?? "").replace(/\s+/g, " ").trim(),
    hasImageSource: ["img", "picture", "svg"].includes(element.tagName.toLowerCase()),
    unsupported,
    style,
    children,
  };
}

export function WebImportDialog({ open, graph, screenId, onClose, onApply }: WebImportDialogProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const htmlInput = useRef<HTMLTextAreaElement>(null);
  const analyzingRef = useRef(false);
  const [html, setHtml] = useState('<main class="page"><h1>Imported interface</h1><p>Paste authored HTML and CSS, then review the semantic projection.</p><button>Continue</button></main>');
  const [css, setCss] = useState(".page { display: flex; flex-direction: column; gap: 16px; padding: 32px; max-width: 720px; margin: auto; }\nbutton { min-height: 44px; background: rgb(79, 143, 247); color: white; border: 0; border-radius: 7px; }");
  const [source, setSource] = useState("");
  const [removed, setRemoved] = useState(0);
  const [projection, setProjection] = useState<DomImportProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const byteCounts = useMemo(() => ({ html: new TextEncoder().encode(html).byteLength, css: new TextEncoder().encode(css).byteLength }), [css, html]);

  useEffect(() => {
    if (!open) return;
    setProjection(null);
    setError(null);
    requestAnimationFrame(() => htmlInput.current?.focus());
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", escape);
    return () => {
      analyzingRef.current = false;
      window.removeEventListener("keydown", escape);
    };
  }, [onClose, open]);

  if (!open) return null;

  const analyze = () => {
    setProjection(null);
    setError(null);
    if (byteCounts.html === 0 || byteCounts.html > DOM_IMPORT_LIMITS.maxHtmlBytes) {
      setError(`HTML must contain 1 through ${DOM_IMPORT_LIMITS.maxHtmlBytes.toLocaleString()} bytes.`);
      return;
    }
    if (byteCounts.css > DOM_IMPORT_LIMITS.maxCssBytes) {
      setError(`CSS must contain at most ${DOM_IMPORT_LIMITS.maxCssBytes.toLocaleString()} bytes.`);
      return;
    }
    const sandbox = sandboxSource(html, css);
    setRemoved(sandbox.removed);
    analyzingRef.current = true;
    setAnalyzing(true);
    setSource(sandbox.source);
  };

  /* Graph validation raises Zod errors whose .message is the raw serialized
     issue array; a person should read one sentence, not a JSON blob. */
  const importErrorMessage = (error: unknown): string => {
    if (error && typeof error === "object" && "issues" in error && Array.isArray((error as { issues?: unknown }).issues)) {
      const issues = (error as { issues: Array<{ message?: string }> }).issues.slice(0, 3);
      return issues.map((issue) => issue.message ?? "Invalid value").join(" · ");
    }
    const message = error instanceof Error ? error.message : "";
    if (message.trim().startsWith("[")) {
      try {
        const parsed = JSON.parse(message) as Array<{ message?: string }>;
        if (Array.isArray(parsed)) return parsed.slice(0, 3).map((issue) => issue?.message ?? "Invalid value").join(" · ");
      } catch {
        // Not JSON after all; fall through to the raw message.
      }
    }
    return message || "The browser could not analyze this HTML/CSS input.";
  };

  const capture = () => {
    if (!analyzingRef.current) return;
    try {
      const document = frame.current?.contentDocument;
      if (!document) throw new Error("The isolated browser document is unavailable.");
      const state = { count: 0 };
      const roots = [...document.body.children].flatMap((element) => {
        const result = computedNode(element, 0, state);
        return result ? [result] : [];
      });
      setProjection(projectComputedDom(graph, screenId, roots));
    } catch (captureError) {
      setError(`This import cannot replace the screen yet: ${importErrorMessage(captureError)}`);
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[var(--backdrop)] p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="web-import-title" className="grid max-h-[min(860px,94vh)] w-[min(1040px,96vw)] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-[8px] border border-[var(--line-strong)] bg-[var(--panel)] shadow-2xl">
        <header className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div><h2 id="web-import-title" className="text-sm font-semibold text-[var(--ink)]">Import HTML/CSS</h2><p className="mt-0.5 text-[10px] text-[var(--muted)]">Scripts and network requests are blocked. The browser computes layout; only supported typed properties enter the graph.</p></div>
          <button type="button" onClick={onClose} className="h-7 rounded px-2 text-[10px] text-[var(--muted)] hover:bg-[var(--hover)]">Close</button>
        </header>
        <div className="grid min-h-0 grid-cols-1 overflow-auto bg-[var(--if-panel)] lg:grid-cols-2 lg:overflow-hidden">
          <div className="grid min-h-[520px] grid-rows-2 gap-3 border-b border-[var(--line)] bg-[var(--if-panel)] p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
            <label className="grid min-h-0 grid-rows-[auto_1fr] gap-1 text-[10px] font-semibold text-[var(--muted)]">HTML · {byteCounts.html.toLocaleString()} bytes<textarea ref={htmlInput} value={html} onChange={(event) => setHtml(event.target.value)} spellCheck={false} className="min-h-0 resize-none rounded border border-[var(--line)] bg-[var(--field)] p-3 font-mono text-[11px] font-normal leading-5 text-[var(--ink)] outline-none focus:border-[var(--focus)]" /></label>
            <label className="grid min-h-0 grid-rows-[auto_1fr] gap-1 text-[10px] font-semibold text-[var(--muted)]">CSS · {byteCounts.css.toLocaleString()} bytes<textarea value={css} onChange={(event) => setCss(event.target.value)} spellCheck={false} className="min-h-0 resize-none rounded border border-[var(--line)] bg-[var(--field)] p-3 font-mono text-[11px] font-normal leading-5 text-[var(--ink)] outline-none focus:border-[var(--focus)]" /></label>
          </div>
          <div className="grid min-h-[520px] grid-rows-[minmax(260px,1fr)_auto] gap-3 overflow-y-auto bg-[var(--if-panel)] p-3 lg:min-h-0">
            <iframe ref={frame} title="Isolated HTML and CSS import preview" sandbox="allow-same-origin" srcDoc={source} onLoad={capture} className="h-full min-h-[300px] w-full rounded border border-[var(--line)] bg-white" />
            <div aria-live="polite" className="min-h-24 text-[10px] leading-5 text-[var(--muted)]" style={{ backgroundColor: "var(--if-panel)" }}>
              {error ? <p role="alert" className="rounded border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-[var(--danger)]">{error}</p> : projection ? <><p className="sr-only">Review ready</p><ImportReview projection={projection} removed={removed} /></> : analyzing ? <p className="rounded border border-[var(--line)] bg-[var(--raised)] p-3">Computing native browser styles…</p> : <p className="rounded border border-[var(--line)] bg-[var(--raised)] p-3">Analyze to render the input inside the isolated browser and review the graph diff before applying.</p>}
            </div>
          </div>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-3">
          <p className="text-[10px] text-[var(--muted)]">Applying replaces only the selected screen’s node tree. Project history remains reversible.</p>
          <div className="flex gap-2"><button type="button" onClick={analyze} disabled={analyzing} className="h-8 rounded border border-[var(--line)] px-3 text-[11px] font-semibold text-[var(--ink)] disabled:opacity-40">{analyzing ? "Analyzing…" : "Analyze"}</button><button type="button" aria-describedby={projection ? "web-import-impact" : undefined} disabled={!projection} onClick={() => { if (projection) onApply(projection); }} className="h-8 rounded bg-[var(--accent-deep)] px-3 text-[11px] font-semibold text-white disabled:opacity-40">Replace screen with reviewed import</button></div>
        </footer>
      </section>
    </div>
  );
}
