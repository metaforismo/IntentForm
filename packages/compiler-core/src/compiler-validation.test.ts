import { describe, expect, it } from "vitest";
import {
  CompilerValidationError,
  validateGeneratedOutput,
  type CompilerBackend,
  type CompilerDiagnostic,
  type GeneratedFileSet,
} from "./index";

const output: GeneratedFileSet = {
  target: "react",
  files: [{ path: "generated.tsx", content: "export const generated = true;" }],
  fingerprint: "12345678",
};

function backendWith(diagnostics: CompilerDiagnostic[]): CompilerBackend {
  return {
    id: "react",
    capabilities: () => ({ target: "react", nativeSafeArea: true, adaptivePlacement: true, accessibility: true }),
    lower: () => { throw new Error("not used"); },
    generate: () => output,
    validate: () => diagnostics,
  };
}

describe("compiler output validation", () => {
  it("returns output when validation has no blocking diagnostic", () => {
    const compiler = backendWith([{ severity: "warning", path: "generated.tsx", message: "Review this file" }]);
    expect(validateGeneratedOutput(compiler, output)).toBe(output);
  });

  it("blocks generated output carrying an error diagnostic", () => {
    const compiler = backendWith([{ severity: "error", path: "generated.tsx", message: "Unsafe output" }]);
    expect(() => validateGeneratedOutput(compiler, output)).toThrow(CompilerValidationError);
    expect(() => validateGeneratedOutput(compiler, output)).toThrow(/generated\.tsx: Unsafe output/);
  });

  it("blocks target mismatches, path traversal and duplicate output files", () => {
    const compiler = backendWith([]);
    expect(() => validateGeneratedOutput(compiler, {
      target: "swiftui",
      files: [
        { path: "../outside.swift", content: "" },
        { path: "../outside.swift", content: "" },
      ],
      fingerprint: "12345678",
    })).toThrow(/Expected react output|inside the output root|duplicated/);
  });
});
