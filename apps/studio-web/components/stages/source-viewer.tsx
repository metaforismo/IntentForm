"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sourceWindow, tokenizeSourceLine } from "./source-viewer-model";

const LINE_HEIGHT = 20;
const tokenTone = {
  plain: "text-[#d8dee9]",
  comment: "text-[#73808c] italic",
  string: "text-[#a8cc8c]",
  number: "text-[#d19a66]",
  keyword: "text-[#c792ea]",
  type: "text-[#82aaff]",
  punctuation: "text-[#89a4b8]",
} as const;

interface SourceViewerProps {
  filePath: string;
  lines: readonly string[];
  matchingLines: ReadonlySet<number>;
  activeMatchLine: number | null;
  nodeLines: ReadonlyMap<number, readonly string[]>;
  onInspectNode(nodeId: string): void;
}

export function SourceViewer({
  filePath,
  lines,
  matchingLines,
  activeMatchLine,
  nodeLines,
  onInspectNode,
}: SourceViewerProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const window = useMemo(
    () => sourceWindow(lines.length, scrollTop, viewportHeight, LINE_HEIGHT),
    [lines.length, scrollTop, viewportHeight],
  );

  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const next = positions.current.get(filePath) ?? 0;
    element.scrollTop = next;
    setScrollTop(next);
    setSelectedLine(null);
  }, [filePath]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = viewport.current;
    if (!element || activeMatchLine === null) return;
    const top = activeMatchLine * LINE_HEIGHT;
    const bottom = top + LINE_HEIGHT;
    if (top >= element.scrollTop && bottom <= element.scrollTop + element.clientHeight) return;
    element.scrollTo({ top: Math.max(0, top - element.clientHeight / 2), behavior: "smooth" });
  }, [activeMatchLine]);

  const selectRelativeLine = (offset: number) => {
    const next = Math.max(0, Math.min(lines.length - 1, (selectedLine ?? 0) + offset));
    setSelectedLine(next);
    viewport.current?.scrollTo({ top: Math.max(0, next * LINE_HEIGHT - viewportHeight / 2) });
  };

  return (
    <div
      ref={viewport}
      role="listbox"
      aria-label={`Read-only generated source: ${filePath}`}
      aria-readonly="true"
      aria-activedescendant={selectedLine === null ? undefined : `source-line-${selectedLine + 1}`}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        selectRelativeLine(event.key === "ArrowDown" ? 1 : -1);
      }}
      onScroll={(event) => {
        const next = event.currentTarget.scrollTop;
        positions.current.set(filePath, next);
        setScrollTop(next);
      }}
      className="code-scroll h-[calc(100%_-_36px)] overflow-auto py-3 font-mono text-[10px] leading-5 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#82aaff]"
    >
      <div aria-hidden="true" style={{ height: window.top }} />
      {lines.slice(window.start, window.end).map((line, relativeIndex) => {
        const index = window.start + relativeIndex;
        const nodes = nodeLines.get(index) ?? [];
        const active = activeMatchLine === index;
        const selected = selectedLine === index;
        return (
          <div
            id={`source-line-${index + 1}`}
            key={index}
            role="option"
            aria-selected={selected}
            data-source-line={index + 1}
            onClick={() => setSelectedLine(index)}
            className={`group grid min-w-max grid-cols-[48px_minmax(0,1fr)_auto] pr-3 ${selected ? "bg-[#82aaff]/16" : active ? "bg-amber-300/15" : matchingLines.has(index) ? "bg-amber-300/8" : ""}`}
            style={{ height: LINE_HEIGHT }}
          >
            <span className="select-none border-r border-white/8 pr-3 text-right text-white/25">{index + 1}</span>
            <code className="whitespace-pre pl-4">{line ? tokenizeSourceLine(line).map((token, tokenIndex) => <span key={tokenIndex} className={tokenTone[token.kind]}>{token.value}</span>) : " "}</code>
            {nodes.length ? <span className="sticky right-1 ml-4 flex items-center gap-1 bg-[#1d1f21]/95 pl-2 opacity-55 group-hover:opacity-100">
              <button type="button" aria-label={`Show ${nodes[0]} on canvas`} title={nodes[0]} onClick={(event) => { event.stopPropagation(); onInspectNode(nodes[0]!); }} className="my-0.5 max-w-36 truncate rounded-[4px] border border-[#82aaff]/30 px-1.5 text-[8px] leading-4 text-[#82aaff] hover:bg-[#82aaff]/10">{nodes[0]!.split(".").at(-1)}</button>
              {nodes.length > 1 ? <span title={nodes.slice(1).join(", ")} className="text-[8px] leading-4 text-white/30">+{nodes.length - 1}</span> : null}
            </span> : null}
          </div>
        );
      })}
      <div aria-hidden="true" style={{ height: window.bottom }} />
    </div>
  );
}
