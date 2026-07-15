import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  exportProjectAssets,
  garbageCollectProjectAssets,
  importProjectAsset,
  inspectProjectAssets,
  sanitizeSvg,
} from "./assets.ts";

let dir: string;

const openLicense = {
  name: "Project-owned",
  spdx: "CC0-1.0",
  redistribution: "allowed" as const,
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "intentform-assets-"));
  mkdirSync(join(dir, "imports"), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("content-addressed project assets", () => {
  it("sanitizes, hashes, inspects, and exports a project-owned SVG", () => {
    writeFileSync(join(dir, "imports", "mark.svg"), '<svg viewBox="0 0 24 12"><path d="M0 0h24v12H0z"/></svg>');
    const asset = importProjectAsset(dir, {
      importName: "mark.svg",
      id: "brand.mark",
      name: "Brand mark",
      kind: "icon",
      license: openLicense,
      exportPolicy: "copy",
      metadata: { role: "brand" },
    });
    expect(asset).toMatchObject({
      id: "brand.mark",
      kind: "icon",
      mediaType: "image/svg+xml",
      width: 24,
      height: 12,
      exportPolicy: "copy",
    });
    expect(asset.storageKey).toBe(`assets/${asset.digest}.svg`);
    expect(JSON.stringify(asset)).not.toContain("mark.svg");
    expect(inspectProjectAssets(dir, [asset])).toEqual([]);

    const output = join(dir, "output", "react");
    const exported = exportProjectAssets(dir, [asset], output);
    expect(exported.diagnostics).toEqual([]);
    expect(exported.copied).toEqual([join(output, "public", asset.storageKey)]);
    expect(readFileSync(exported.copied[0]!, "utf8")).toBe('<svg viewBox="0 0 24 12"><path d="M0 0h24v12H0z"/></svg>\n');

    const expoOutput = join(dir, "output", "expo");
    const expoExported = exportProjectAssets(dir, [asset], expoOutput, "expo");
    expect(expoExported.copied).toEqual([join(expoOutput, asset.storageKey)]);
    expect(readFileSync(expoExported.copied[0]!, "utf8")).toBe('<svg viewBox="0 0 24 12"><path d="M0 0h24v12H0z"/></svg>\n');
  });

  it("rejects executable SVG, external references, traversal, symlinks, and spoofed bytes", () => {
    expect(() => sanitizeSvg('<svg><script>alert(1)</script></svg>')).toThrow(/executable or external/i);
    expect(() => sanitizeSvg('<svg><image href="https://example.com/a.png"/></svg>')).toThrow(/executable or external/i);
    writeFileSync(join(dir, "imports", "fake.png"), "not a png");
    expect(() => importProjectAsset(dir, {
      importName: "fake.png",
      id: "fake.image",
      name: "Fake",
      license: openLicense,
      exportPolicy: "copy",
    })).toThrow(/do not match/i);
    expect(() => importProjectAsset(dir, {
      importName: "../fake.png",
      id: "fake.path",
      name: "Fake",
      license: openLicense,
      exportPolicy: "copy",
    })).toThrow(/directly inside/i);
    writeFileSync(join(dir, "outside.svg"), "<svg/>");
    symlinkSync(join(dir, "outside.svg"), join(dir, "imports", "linked.svg"));
    expect(() => importProjectAsset(dir, {
      importName: "linked.svg",
      id: "fake.link",
      name: "Fake",
      license: openLicense,
      exportPolicy: "copy",
    })).toThrow(/symbolic links/i);
  });

  it("validates license policy before creating content-addressed bytes", () => {
    writeFileSync(join(dir, "imports", "restricted.svg"), '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>');
    expect(() => importProjectAsset(dir, {
      importName: "restricted.svg",
      id: "restricted.mark",
      name: "Restricted mark",
      license: { name: "Restricted", redistribution: "restricted" },
      exportPolicy: "copy",
    })).toThrow(/license that allows redistribution/i);
    expect(existsSync(join(dir, "assets"))).toBe(false);
  });

  it("rejects symlinked import, store, and output directories", () => {
    const outside = join(dir, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "mark.svg"), '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>');
    rmSync(join(dir, "imports"), { recursive: true });
    symlinkSync(outside, join(dir, "imports"));
    expect(() => importProjectAsset(dir, {
      importName: "mark.svg",
      id: "brand.mark",
      name: "Brand mark",
      license: openLicense,
      exportPolicy: "copy",
    })).toThrow(/imports directory.*non-symlink/i);

    rmSync(join(dir, "imports"));
    mkdirSync(join(dir, "imports"));
    writeFileSync(join(dir, "imports", "mark.svg"), '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>');
    symlinkSync(outside, join(dir, "assets"));
    expect(() => importProjectAsset(dir, {
      importName: "mark.svg",
      id: "brand.mark",
      name: "Brand mark",
      license: openLicense,
      exportPolicy: "copy",
    })).toThrow(/asset store.*non-symlink/i);
    expect(() => garbageCollectProjectAssets(dir, [], true)).toThrow(/asset store.*non-symlink/i);
    expect(readFileSync(join(outside, "mark.svg"), "utf8")).toContain("<svg");
  });

  it("refuses to copy through a symlinked generated asset directory", () => {
    writeFileSync(join(dir, "imports", "mark.svg"), '<svg viewBox="0 0 8 8"><path d="M0 0h8v8H0z"/></svg>');
    const asset = importProjectAsset(dir, {
      importName: "mark.svg",
      id: "brand.mark",
      name: "Brand mark",
      license: openLicense,
      exportPolicy: "copy",
    });
    const outside = join(dir, "outside-output");
    const output = join(dir, "output", "react");
    mkdirSync(join(output, "public"), { recursive: true });
    mkdirSync(outside);
    symlinkSync(outside, join(output, "public", "assets"));

    expect(() => exportProjectAssets(dir, [asset], output)).toThrow(/output directory.*non-symlink/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("reports missing and modified bytes and garbage-collects only unused regular files", () => {
    writeFileSync(join(dir, "imports", "mark.svg"), "<svg width=\"8\" height=\"8\"><path d=\"M0 0h8v8H0z\"/></svg>");
    const asset = importProjectAsset(dir, {
      importName: "mark.svg",
      id: "brand.mark",
      name: "Brand mark",
      license: openLicense,
      exportPolicy: "copy",
    });
    const stored = join(dir, asset.storageKey);
    writeFileSync(stored, "changed");
    expect(inspectProjectAssets(dir, [asset])).toEqual([expect.objectContaining({ code: "asset.digest-mismatch" })]);
    rmSync(stored);
    expect(inspectProjectAssets(dir, [asset])).toEqual([expect.objectContaining({ code: "asset.missing" })]);

    const unused = join(dir, "assets", `${"a".repeat(64)}.svg`);
    writeFileSync(unused, "unused");
    expect(garbageCollectProjectAssets(dir, [asset])).toEqual({ unused: [`assets/${"a".repeat(64)}.svg`], removed: [] });
    expect(garbageCollectProjectAssets(dir, [asset], true)).toEqual({
      unused: [`assets/${"a".repeat(64)}.svg`],
      removed: [`assets/${"a".repeat(64)}.svg`],
    });
    expect(existsSync(unused)).toBe(false);
  });

  it("stores font bytes without leaking the original local filename", () => {
    writeFileSync(join(dir, "imports", "Client Confidential.woff2"), Buffer.concat([Buffer.from("wOF2"), Buffer.alloc(24)]));
    const asset = importProjectAsset(dir, {
      importName: "Client Confidential.woff2",
      id: "font.brand-body",
      name: "Brand body",
      license: { name: "Internal font license", redistribution: "restricted" },
      exportPolicy: "blocked",
    });
    expect(asset.kind).toBe("font");
    expect(asset.storageKey).toBe(`assets/${asset.digest}.woff2`);
    expect(JSON.stringify(asset)).not.toContain("Client Confidential");
    expect(inspectProjectAssets(dir, [asset])).toEqual([expect.objectContaining({
      code: "asset.policy-blocked",
      severity: "warning",
    })]);
  });
});
