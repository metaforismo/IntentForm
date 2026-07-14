"use client";

import { CheckCircle, Copy } from "@phosphor-icons/react";
import type { compileReact } from "@intentform/compiler-react";
import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { OutputTarget } from "../studio";
import { PhonePreview } from "./phone-preview";

type GeneratedFileSet = ReturnType<typeof compileReact>;

type FileRow =
  | { kind: "header"; key: string; label: string }
  | { kind: "file"; key: string; file: GeneratedFileSet["files"][number]; label: string };

function buildFileRows(files: GeneratedFileSet["files"], target: OutputTarget): FileRow[] {
  const prefix = target === "react" ? "src/generated/" : "Generated/";
  let lastDirectory: string | null = null;
  const rows: FileRow[] = [];
  for (const file of files) {
    const stripped = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
    const slashIndex = stripped.lastIndexOf("/");
    const directory = slashIndex === -1 ? null : stripped.slice(0, slashIndex + 1);
    const name = slashIndex === -1 ? stripped : stripped.slice(slashIndex + 1);
    if (directory !== lastDirectory) {
      if (directory) rows.push({ kind: "header", key: `dir:${file.path}`, label: directory });
      lastDirectory = directory;
    }
    rows.push({ kind: "file", key: file.path, file, label: name });
  }
  return rows;
}

interface OutputsStageProps {
  outputTarget: OutputTarget;
  setOutputTarget: (target: OutputTarget) => void;
  setOutputFilePath: (path: string | null) => void;
  output: GeneratedFileSet;
  reactOutput: GeneratedFileSet;
  selectedCode: GeneratedFileSet["files"][number] | undefined;
  copyGeneratedFile: () => void;
  copied: boolean;
  previewVariant: "before" | "after";
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
}

export function OutputsStage({
  outputTarget,
  setOutputTarget,
  setOutputFilePath,
  output,
  reactOutput,
  selectedCode,
  copyGeneratedFile,
  copied,
  previewVariant,
  graph,
  selectedScreen,
}: OutputsStageProps) {
  return (
    <div className="mx-auto grid max-w-[1400px] gap-5 xl:grid-cols-[minmax(330px,.72fr)_minmax(0,1.28fr)]">
      <div>
        {outputTarget === "react" ? (
          <div className="overflow-hidden rounded-[32px] border border-[var(--line)] bg-[var(--inset)] p-4">
            <div className="mb-3 flex items-center justify-between px-1 text-[10px] text-[var(--muted)]">
              <span className="font-semibold text-[var(--accent-dark)]">Runnable golden artifact</span>
              <span className="font-mono">{previewVariant} · {reactOutput.fingerprint}</span>
            </div>
            <iframe
              key={`${previewVariant}-${selectedScreen}`}
              src={`/react-preview/index.html?variant=${previewVariant}&screen=${selectedScreen}`}
              title={`Generated React preview: ${selectedScreen}`}
              sandbox="allow-scripts allow-same-origin"
              className="h-[570px] w-full rounded-[22px] border border-[var(--line)] bg-white"
            />
          </div>
        ) : <PhonePreview graph={graph} selectedScreen={selectedScreen} />}
      </div>
      <div className="min-w-0 overflow-hidden rounded-[24px] border border-[#303a35] bg-[#1c211f] text-[#dce5df] shadow-[0_24px_50px_-34px_rgba(18,28,23,.8)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex gap-1 rounded-lg bg-white/5 p-1">
            {(["react", "swiftui"] as const).map((target) => <button key={target} type="button" onClick={() => { setOutputTarget(target); setOutputFilePath(null); }} className={`rounded-md px-3 py-1.5 text-[10px] font-semibold capitalize ${outputTarget === target ? "bg-white/12 text-white" : "text-white/45 hover:text-white/70"}`}>{target}</button>)}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={copyGeneratedFile} className="inline-flex items-center gap-1.5 rounded-md bg-white/8 px-2.5 py-1.5 text-[10px] font-medium text-white/70 hover:bg-white/12 hover:text-white">
              {copied ? <CheckCircle size={12} weight="fill" className="text-emerald-300" /> : <Copy size={12} />}
              {copied ? "Copied" : "Copy file"}
            </button>
            <span className="hidden font-mono text-[9px] text-white/40 md:inline">sha {output.fingerprint}</span>
          </div>
        </div>
        <div className="grid md:grid-cols-[210px_minmax(0,1fr)]">
          <div className="hidden max-h-[590px] overflow-auto border-r border-white/10 p-2 md:block">
            {buildFileRows(output.files, outputTarget).map((row) =>
              row.kind === "header" ? (
                <div key={row.key} className="truncate px-2 pt-2 pb-1 text-[9px] uppercase tracking-[.12em] text-white/30">
                  {row.label}
                </div>
              ) : (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => setOutputFilePath(row.file.path)}
                  className={`block min-h-7 w-full truncate rounded-md px-2 py-1.5 text-left font-mono text-[11px] ${selectedCode?.path === row.file.path ? "bg-white/10 text-white" : "text-white/45 hover:bg-white/5 hover:text-white/75"}`}
                >
                  {row.label}
                </button>
              ),
            )}
          </div>
          <div className="min-w-0">
            <div className="border-b border-white/10 px-4 py-2 font-mono text-[9px] text-[#8ea69b]">{selectedCode?.path}</div>
            <pre className="code-scroll max-h-[550px] overflow-auto p-5 text-[10.5px] leading-[1.7]"><code>{selectedCode?.content}</code></pre>
          </div>
        </div>
      </div>
    </div>
  );
}
