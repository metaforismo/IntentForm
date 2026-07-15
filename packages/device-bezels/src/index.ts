import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { DEVICE_REGISTRY, deviceBezelReferenceSchema, type DeviceBezelReference } from "@intentform/device-registry";
import { z } from "zod";

export const DEVICE_BEZEL_PACK_FORMAT = "intentform-device-bezel-pack" as const;
export const DEVICE_BEZEL_PACK_VERSION = "1.0.0" as const;
export const MAX_BEZEL_PACKS = 16;
export const MAX_BEZEL_ASSET_BYTES = 25 * 1024 * 1024;
export const MAX_BEZEL_PACK_BYTES = 64 * 1024 * 1024;
export const MAX_BEZEL_MANIFEST_BYTES = 256 * 1024;

const idSchema = z.string().min(1).max(96).regex(/^[a-z][a-z0-9.-]*$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const fileNameSchema = z.string().min(1).max(180).refine(
  (value) => basename(value) === value && !value.includes("/") && !value.includes("\\") && !value.startsWith("."),
  "Bezel asset names must be plain visible basenames",
);
const dimensionSchema = z.number().int().positive().max(20_000);

export const deviceBezelPackManifestSchema = z.strictObject({
  format: z.literal(DEVICE_BEZEL_PACK_FORMAT),
  version: z.literal(DEVICE_BEZEL_PACK_VERSION),
  packId: idSchema,
  name: z.string().min(1).max(160),
  publisher: z.string().min(1).max(160),
  revoked: z.boolean().default(false),
  license: z.strictObject({
    name: z.string().min(1).max(200),
    sourceUrl: z.url().max(500).refine((value) => new URL(value).protocol === "https:", "Bezel license URLs must use HTTPS"),
    termsAcknowledgement: z.string().min(20).max(1_000),
    redistribution: z.literal("local-reference-only"),
  }),
  profiles: z.array(z.strictObject({
    deviceProfileId: idSchema,
    asset: z.strictObject({
      fileName: fileNameSchema,
      digest: digestSchema,
      mediaType: z.enum(["image/png", "image/webp"]),
      byteLength: z.number().int().positive().max(MAX_BEZEL_ASSET_BYTES),
      width: dimensionSchema,
      height: dimensionSchema,
    }),
    viewport: z.strictObject({
      x: z.number().int().nonnegative().max(10_000),
      y: z.number().int().nonnegative().max(10_000),
      width: dimensionSchema,
      height: dimensionSchema,
    }),
  })).min(1).max(16),
}).superRefine((manifest, context) => {
  const ids = new Set<string>();
  manifest.profiles.forEach((profile, index) => {
    if (ids.has(profile.deviceProfileId)) {
      context.addIssue({ code: "custom", path: ["profiles", index, "deviceProfileId"], message: `Duplicate bezel profile: ${profile.deviceProfileId}` });
    }
    ids.add(profile.deviceProfileId);
    if (profile.viewport.x + profile.viewport.width > profile.asset.width
      || profile.viewport.y + profile.viewport.height > profile.asset.height) {
      context.addIssue({ code: "custom", path: ["profiles", index, "viewport"], message: "Logical viewport must stay inside the bezel image" });
    }
  });
});

export type DeviceBezelPackManifest = z.infer<typeof deviceBezelPackManifestSchema>;
export type DeviceBezelProfile = DeviceBezelPackManifest["profiles"][number];

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]));
  }
  return value;
}

export function bezelManifestChecksum(manifest: DeviceBezelPackManifest): string {
  const parsed = deviceBezelPackManifestSchema.parse(manifest);
  return createHash("sha256").update(JSON.stringify(canonicalValue(parsed))).digest("hex");
}

export interface InspectedBezelPack {
  manifest: DeviceBezelPackManifest;
  manifestChecksum: string;
}

export interface BezelPackInspection {
  enabled: boolean;
  packs: InspectedBezelPack[];
  diagnostics: string[];
}

function regularDirectory(path: string): boolean {
  const stat = lstatSync(path);
  return stat.isDirectory() && !stat.isSymbolicLink();
}

function readBoundedRegularFile(path: string, maximumBytes: number, expectedBytes?: number): Buffer {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > maximumBytes || (expectedBytes !== undefined && stat.size !== expectedBytes)) {
      throw new Error("File metadata does not match its declared bounds");
    }
    const bytes = readFileSync(descriptor);
    if (bytes.byteLength !== stat.size) throw new Error("File changed while it was being inspected");
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function containedPath(root: string, name: string): string {
  if (basename(name) !== name) throw new Error("Bezel asset path must be a basename");
  const path = resolve(root, name);
  const fromRoot = relative(root, path);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) throw new Error("Bezel asset escaped its pack directory");
  return path;
}

function hasExpectedRasterMagic(bytes: Buffer, mediaType: "image/png" | "image/webp"): boolean {
  if (mediaType === "image/png") return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function inspectPack(packRoot: string, directoryName: string): InspectedBezelPack {
  if (!regularDirectory(packRoot)) throw new Error("Pack directory must be regular and must not be a symlink");
  const manifestPath = containedPath(packRoot, "manifest.json");
  const manifestBytes = readBoundedRegularFile(manifestPath, MAX_BEZEL_MANIFEST_BYTES);
  const manifest = deviceBezelPackManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  if (manifest.packId !== directoryName) throw new Error("Pack directory must match manifest packId");
  const checkedFiles = new Map<string, { digest: string; byteLength: number; mediaType: "image/png" | "image/webp" }>();
  let totalBytes = 0;
  for (const profile of manifest.profiles) {
    const prior = checkedFiles.get(profile.asset.fileName);
    if (prior) {
      if (prior.digest !== profile.asset.digest || prior.byteLength !== profile.asset.byteLength || prior.mediaType !== profile.asset.mediaType) {
        throw new Error(`Conflicting metadata for bezel asset: ${profile.asset.fileName}`);
      }
      continue;
    }
    totalBytes += profile.asset.byteLength;
    if (totalBytes > MAX_BEZEL_PACK_BYTES) throw new Error("Bezel pack exceeds its total byte budget");
    const assetPath = containedPath(packRoot, profile.asset.fileName);
    let bytes: Buffer;
    try {
      bytes = readBoundedRegularFile(assetPath, MAX_BEZEL_ASSET_BYTES, profile.asset.byteLength);
    } catch {
      throw new Error(`Bezel asset metadata mismatch: ${profile.asset.fileName}`);
    }
    if (!hasExpectedRasterMagic(bytes, profile.asset.mediaType)) throw new Error(`Bezel asset media signature mismatch: ${profile.asset.fileName}`);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== profile.asset.digest) throw new Error(`Bezel asset digest mismatch: ${profile.asset.fileName}`);
    checkedFiles.set(profile.asset.fileName, {
      digest: profile.asset.digest,
      byteLength: profile.asset.byteLength,
      mediaType: profile.asset.mediaType,
    });
  }
  return { manifest, manifestChecksum: bezelManifestChecksum(manifest) };
}

export function inspectLocalBezelPacks(projectDir: string, enabled = process.env.INTENTFORM_ENABLE_LOCAL_BEZELS === "1"): BezelPackInspection {
  if (!enabled) return { enabled: false, packs: [], diagnostics: [] };
  const root = resolve(projectDir, "bezel-packs");
  try {
    if (!regularDirectory(root)) return { enabled: true, packs: [], diagnostics: ["The bezel-pack root is not a regular directory."] };
  } catch {
    return { enabled: true, packs: [], diagnostics: [] };
  }
  const diagnostics: string[] = [];
  const packs = readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .slice(0, MAX_BEZEL_PACKS)
    .flatMap((entry) => {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        diagnostics.push(`${entry.name}: ignored non-directory or symlink entry.`);
        return [];
      }
      try {
        return [inspectPack(join(root, entry.name), entry.name)];
      } catch (error) {
        diagnostics.push(`${entry.name}: ${error instanceof Error ? error.message : "invalid pack"}`);
        return [];
      }
    });
  return { enabled: true, packs, diagnostics };
}

export function resolveLocalBezel(
  projectDir: string,
  referenceInput: unknown,
  activeDeviceProfileId: string,
  enabled = process.env.INTENTFORM_ENABLE_LOCAL_BEZELS === "1",
): { pack: InspectedBezelPack; profile: DeviceBezelProfile; reference: DeviceBezelReference } | null {
  if (!enabled) return null;
  const reference = deviceBezelReferenceSchema.parse(referenceInput);
  if (reference.deviceProfileId !== activeDeviceProfileId) return null;
  const inspection = inspectLocalBezelPacks(projectDir, enabled);
  const pack = inspection.packs.find((candidate) => candidate.manifest.packId === reference.packId);
  if (!pack || pack.manifest.revoked || pack.manifest.version !== reference.packVersion || pack.manifestChecksum !== reference.manifestChecksum) return null;
  const profile = pack.manifest.profiles.find((candidate) =>
    candidate.deviceProfileId === reference.deviceProfileId && candidate.asset.digest === reference.assetDigest);
  const logical = DEVICE_REGISTRY.find((candidate) => candidate.profile.id === activeDeviceProfileId)?.profile;
  if (!profile || !logical || profile.viewport.width !== logical.viewport.width || profile.viewport.height !== logical.viewport.height) return null;
  return { pack, profile, reference };
}

export function readLocalBezelAsset(
  projectDir: string,
  referenceInput: unknown,
  activeDeviceProfileId: string,
  enabled = process.env.INTENTFORM_ENABLE_LOCAL_BEZELS === "1",
): { bytes: Buffer; mediaType: "image/png" | "image/webp"; profile: DeviceBezelProfile } | null {
  const resolved = resolveLocalBezel(projectDir, referenceInput, activeDeviceProfileId, enabled);
  if (!resolved) return null;
  const packRoot = resolve(projectDir, "bezel-packs", resolved.pack.manifest.packId);
  const path = containedPath(packRoot, resolved.profile.asset.fileName);
  let bytes: Buffer;
  try {
    bytes = readBoundedRegularFile(path, MAX_BEZEL_ASSET_BYTES, resolved.profile.asset.byteLength);
  } catch {
    return null;
  }
  if (!hasExpectedRasterMagic(bytes, resolved.profile.asset.mediaType)) return null;
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== resolved.reference.assetDigest) return null;
  return { bytes, mediaType: resolved.profile.asset.mediaType, profile: resolved.profile };
}
