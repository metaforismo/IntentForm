import { describe, expect, it } from "vitest";
import { extractSvgPaints, normalizeSvgHexColor, replaceSvgPaint } from "./svg-paints.ts";

describe("SVG paint editing", () => {
  it("normalizes supported hexadecimal colors without accepting paint servers or keywords", () => {
    expect(normalizeSvgHexColor(" #AbC ")).toBe("#aabbcc");
    expect(normalizeSvgHexColor("#abcd")).toBe("#aabbccdd");
    expect(normalizeSvgHexColor("#A1B2C3D4")).toBe("#a1b2c3d4");
    expect(normalizeSvgHexColor("none")).toBeNull();
    expect(normalizeSvgHexColor("url(#gradient)")).toBeNull();
  });

  it("extracts distinct fills and strokes in source order with usage metadata", () => {
    const paints = extractSvgPaints('<svg><path fill="#ABC" stroke="#112233"/><circle fill="#aabbcc"/><path fill="none" stroke="url(#g)"/></svg>');
    expect(paints).toEqual([
      { value: "#ABC", normalized: "#aabbcc", usages: 2, properties: ["fill"] },
      { value: "#112233", normalized: "#112233", usages: 1, properties: ["stroke"] },
    ]);
  });

  it("recolors only the selected paint while preserving geometry, other paints, and quotes", () => {
    const source = '<svg viewBox="0 0 40 20"><path fill="#112233" stroke="#445566" d="M0 0h40v20H0z"/><circle fill=\'#112233\' cx="4" cy="5" r="3"/></svg>\n';
    const result = replaceSvgPaint(source, "#112233", "#4F8FF7");
    expect(result.replacements).toBe(2);
    expect(result.source).toBe('<svg viewBox="0 0 40 20"><path fill="#4f8ff7" stroke="#445566" d="M0 0h40v20H0z"/><circle fill=\'#4f8ff7\' cx="4" cy="5" r="3"/></svg>\n');
  });

  it("preserves the selected paint alpha channel when changing its RGB color", () => {
    expect(replaceSvgPaint('<svg fill="#11223380"/>', "#11223380", "#aabbcc"))
      .toEqual({ source: '<svg fill="#aabbcc80"/>', replacements: 1 });
  });

  it("rejects invalid replacements and reports a missing selected paint without mutation", () => {
    expect(() => replaceSvgPaint('<svg fill="#112233"/>', "none", "#ffffff")).toThrow(/target/i);
    expect(() => replaceSvgPaint('<svg fill="#112233"/>', "#112233", "#ffffff80")).toThrow(/opaque/i);
    expect(replaceSvgPaint('<svg fill="#112233"/>', "#445566", "#ffffff"))
      .toEqual({ source: '<svg fill="#112233"/>', replacements: 0 });
  });
});
