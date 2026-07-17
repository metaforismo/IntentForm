import { flattenSemanticNodes, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import type { OutputTarget } from "../studio";

export type SourceTokenKind = "plain" | "comment" | "string" | "number" | "keyword" | "type" | "punctuation";

export interface SourceToken {
  kind: SourceTokenKind;
  value: string;
}

export interface SourceNodeReference {
  nodeId: string;
  line: number;
}

const keywords = new Set([
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "default", "do", "else",
  "enum", "export", "extends", "false", "for", "from", "func", "function", "guard", "if", "import", "in", "interface",
  "let", "new", "nil", "null", "private", "protocol", "public", "return", "some", "static", "struct", "switch", "throw",
  "throws", "true", "try", "type", "undefined", "var", "where", "while",
]);
const types = new Set(["Array", "Boolean", "CSSProperties", "Dictionary", "Int", "Number", "Record", "String", "View", "Void"]);

function append(tokens: SourceToken[], kind: SourceTokenKind, value: string) {
  const previous = tokens.at(-1);
  if (previous?.kind === kind) previous.value += value;
  else tokens.push({ kind, value });
}

export function tokenizeSourceLine(line: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  let index = 0;
  while (index < line.length) {
    const character = line[index]!;
    if (character === "/" && line[index + 1] === "/") {
      append(tokens, "comment", line.slice(index));
      break;
    }
    if (character === "\"" || character === "'" || character === "`") {
      const quote = character;
      let end = index + 1;
      while (end < line.length) {
        if (line[end] === "\\") { end += 2; continue; }
        if (line[end] === quote) { end += 1; break; }
        end += 1;
      }
      append(tokens, "string", line.slice(index, end));
      index = end;
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let end = index + 1;
      while (end < line.length && /[A-Za-z0-9_$]/.test(line[end]!)) end += 1;
      const word = line.slice(index, end);
      append(tokens, keywords.has(word) ? "keyword" : types.has(word) || /^[A-Z]/.test(word) ? "type" : "plain", word);
      index = end;
      continue;
    }
    if (/\d/.test(character)) {
      let end = index + 1;
      while (end < line.length && /[\d._]/.test(line[end]!)) end += 1;
      append(tokens, "number", line.slice(index, end));
      index = end;
      continue;
    }
    append(tokens, /[{}()[\];,.<>:=+\-*?!|&]/.test(character) ? "punctuation" : "plain", character);
    index += 1;
  }
  return tokens;
}

export function sourceLanguage(path: string, target: OutputTarget): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "tsx" || extension === "ts") return "TypeScript";
  if (extension === "swift") return "Swift";
  if (extension === "css") return "CSS";
  if (extension === "html") return "HTML";
  if (extension === "json") return "JSON";
  return target === "swiftui" ? "Swift" : target === "expo" || target === "react" ? "TypeScript" : "Text";
}

export function sourceNodeReferences(graph: SemanticInterfaceGraph, content: string): SourceNodeReference[] {
  const known = new Set(graph.screens.flatMap((screen) => flattenSemanticNodes(screen.nodes).map((node) => node.id)));
  const references = new Map<string, number>();
  const patterns = [
    /data-node-id="([A-Za-z0-9._:-]+)"/g,
    /accessibilityIdentifier\("intentform\.([A-Za-z0-9._:-]+)"\)/g,
    /testID="(?:node|action)-([A-Za-z0-9._:-]+)"/g,
    /"nodeId"\s*:\s*"([A-Za-z0-9._:-]+)"/g,
  ];
  content.split("\n").forEach((line, index) => {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
        const nodeId = match[1]!;
        if (known.has(nodeId) && !references.has(nodeId)) references.set(nodeId, index);
      }
    }
  });
  return [...references].map(([nodeId, line]) => ({ nodeId, line }));
}

export function sourceWindow(
  lineCount: number,
  scrollTop: number,
  viewportHeight: number,
  lineHeight = 20,
  overscan = 12,
) {
  const start = Math.max(0, Math.floor(scrollTop / lineHeight) - overscan);
  const end = Math.min(lineCount, Math.ceil((scrollTop + viewportHeight) / lineHeight) + overscan);
  return {
    start,
    end,
    top: start * lineHeight,
    bottom: Math.max(0, (lineCount - end) * lineHeight),
  };
}
