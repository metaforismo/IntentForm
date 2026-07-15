import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bezelManifestChecksum,
  deviceBezelPackManifestSchema,
  inspectLocalBezelPacks,
  readLocalBezelAsset,
  resolveLocalBezel,
  type DeviceBezelPackManifest,
} from "./index";

const fixtureRoots: string[] = [];

function temporaryRoot() {
  const root = mkdtempSync(join(tmpdir(), "intentform-bezel-"));
  fixtureRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(root: string, overrides: Partial<DeviceBezelPackManifest> = {}) {
  const bytes = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fixture-only-not-a-licensed-bezel")]);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const manifest = deviceBezelPackManifestSchema.parse({
    format: "intentform-device-bezel-pack",
    version: "1.0.0",
    packId: "fixture.neutral",
    name: "Fixture neutral pack",
    publisher: "IntentForm tests",
    revoked: false,
    license: {
      name: "Fixture-only terms",
      sourceUrl: "https://example.test/fixture-terms",
      termsAcknowledgement: "I confirm these fixture bytes are safe for local tests only.",
      redistribution: "local-reference-only",
    },
    profiles: [{
      deviceProfileId: "neutral.phone.compact",
      asset: { fileName: "frame.png", digest, mediaType: "image/png", byteLength: bytes.byteLength, width: 395, height: 707 },
      viewport: { x: 10, y: 20, width: 375, height: 667 },
    }],
    ...overrides,
  });
  const packRoot = join(root, "bezel-packs", manifest.packId);
  mkdirSync(packRoot, { recursive: true });
  writeFileSync(join(packRoot, "frame.png"), bytes);
  writeFileSync(join(packRoot, "manifest.json"), JSON.stringify(manifest));
  return { manifest, digest, bytes };
}

describe("local device bezel boundary", () => {
  it("is disabled by default and validates fixture-only local packs when explicitly enabled", () => {
    const root = temporaryRoot();
    const { manifest } = fixture(root);
    expect(inspectLocalBezelPacks(root, false)).toEqual({ enabled: false, packs: [], diagnostics: [] });
    const inspected = inspectLocalBezelPacks(root, true);
    expect(inspected.diagnostics).toEqual([]);
    expect(inspected.packs[0]).toMatchObject({ manifest, manifestChecksum: bezelManifestChecksum(manifest) });
  });

  it("resolves acknowledged, checksummed references and re-verifies bytes on read", () => {
    const root = temporaryRoot();
    const { manifest, digest, bytes } = fixture(root);
    const reference = {
      packId: manifest.packId,
      packVersion: manifest.version,
      manifestChecksum: bezelManifestChecksum(manifest),
      deviceProfileId: "neutral.phone.compact",
      assetDigest: digest,
      acknowledgedLocalLicense: true as const,
    };
    expect(resolveLocalBezel(root, reference, "neutral.phone.compact", true)?.profile.viewport).toEqual({ x: 10, y: 20, width: 375, height: 667 });
    expect(readLocalBezelAsset(root, reference, "neutral.phone.compact", true)?.bytes).toEqual(bytes);
    expect(resolveLocalBezel(root, { ...reference, manifestChecksum: "0".repeat(64) }, "neutral.phone.compact", true)).toBeNull();
    expect(resolveLocalBezel(root, reference, "neutral.phone.regular", true)).toBeNull();
  });

  it("falls back neutrally for revoked, changed, missing and symlinked packs", () => {
    const revokedRoot = temporaryRoot();
    const { manifest, digest } = fixture(revokedRoot, { revoked: true });
    const reference = {
      packId: manifest.packId, packVersion: manifest.version, manifestChecksum: bezelManifestChecksum(manifest),
      deviceProfileId: "neutral.phone.compact", assetDigest: digest, acknowledgedLocalLicense: true as const,
    };
    expect(resolveLocalBezel(revokedRoot, reference, "neutral.phone.compact", true)).toBeNull();

    const changedRoot = temporaryRoot();
    fixture(changedRoot);
    writeFileSync(join(changedRoot, "bezel-packs/fixture.neutral/frame.png"), "changed");
    expect(inspectLocalBezelPacks(changedRoot, true).diagnostics.join(" ")).toMatch(/metadata mismatch|digest mismatch/i);

    const symlinkRoot = temporaryRoot();
    mkdirSync(join(symlinkRoot, "bezel-packs"));
    symlinkSync(changedRoot, join(symlinkRoot, "bezel-packs/fixture.neutral"));
    expect(inspectLocalBezelPacks(symlinkRoot, true).packs).toEqual([]);

    const magicRoot = temporaryRoot();
    const magic = fixture(magicRoot);
    magic.manifest.profiles[0]!.asset.mediaType = "image/webp";
    writeFileSync(join(magicRoot, "bezel-packs/fixture.neutral/manifest.json"), JSON.stringify(magic.manifest));
    expect(inspectLocalBezelPacks(magicRoot, true).diagnostics.join(" ")).toMatch(/media signature mismatch/i);

    const assetSymlinkRoot = temporaryRoot();
    const assetFixture = fixture(assetSymlinkRoot);
    const outsideAsset = join(assetSymlinkRoot, "outside.png");
    writeFileSync(outsideAsset, assetFixture.bytes);
    unlinkSync(join(assetSymlinkRoot, "bezel-packs/fixture.neutral/frame.png"));
    symlinkSync(outsideAsset, join(assetSymlinkRoot, "bezel-packs/fixture.neutral/frame.png"));
    const assetSymlinkInspection = inspectLocalBezelPacks(assetSymlinkRoot, true);
    expect(assetSymlinkInspection.packs).toEqual([]);
    expect(assetSymlinkInspection.diagnostics.join(" ")).toMatch(/metadata mismatch/i);
  });

  it("rejects path traversal, active media and viewport escape", () => {
    const base = {
      format: "intentform-device-bezel-pack",
      version: "1.0.0",
      packId: "fixture.invalid",
      name: "Invalid",
      publisher: "Tests",
      license: { name: "Terms", sourceUrl: "https://example.test", termsAcknowledgement: "This acknowledgement is deliberately long enough.", redistribution: "local-reference-only" },
      profiles: [{
        deviceProfileId: "neutral.phone.compact",
        asset: { fileName: "../escape.png", digest: "a".repeat(64), mediaType: "image/svg+xml", byteLength: 1, width: 100, height: 100 },
        viewport: { x: 90, y: 90, width: 20, height: 20 },
      }],
    };
    expect(() => deviceBezelPackManifestSchema.parse(base)).toThrow();
    expect(() => deviceBezelPackManifestSchema.parse({
      ...base,
      license: { ...base.license, sourceUrl: "http://example.test/terms" },
      profiles: [{
        deviceProfileId: "neutral.phone.compact",
        asset: { fileName: "frame.png", digest: "a".repeat(64), mediaType: "image/png", byteLength: 1, width: 100, height: 100 },
        viewport: { x: 0, y: 0, width: 100, height: 100 },
      }],
    })).toThrow(/HTTPS/i);
  });
});
