import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  assetDefinitionSchema,
  type AssetDefinition,
} from "@intentform/semantic-schema";

export const ASSET_IMPORT_LIMITS = {
  maxBytes: 100_000_000,
  maxSvgBytes: 2_000_000,
} as const;

const formats = {
  ".png": { mediaType: "image/png", kind: "raster" },
  ".jpg": { mediaType: "image/jpeg", kind: "raster" },
  ".jpeg": { mediaType: "image/jpeg", kind: "raster" },
  ".gif": { mediaType: "image/gif", kind: "raster" },
  ".webp": { mediaType: "image/webp", kind: "raster" },
  ".svg": { mediaType: "image/svg+xml", kind: "svg" },
  ".mp4": { mediaType: "video/mp4", kind: "video" },
  ".webm": { mediaType: "video/webm", kind: "video" },
  ".mp3": { mediaType: "audio/mpeg", kind: "audio" },
  ".ogg": { mediaType: "audio/ogg", kind: "audio" },
  ".wav": { mediaType: "audio/wav", kind: "audio" },
  ".woff": { mediaType: "font/woff", kind: "font" },
  ".woff2": { mediaType: "font/woff2", kind: "font" },
  ".ttf": { mediaType: "font/ttf", kind: "font" },
  ".otf": { mediaType: "font/otf", kind: "font" },
} as const;

type SupportedExtension = keyof typeof formats;

export interface ImportProjectAssetInput {
  importName: string;
  id: string;
  name: string;
  kind?: AssetDefinition["kind"];
  license: AssetDefinition["license"];
  exportPolicy: AssetDefinition["exportPolicy"];
  metadata?: Record<string, unknown>;
}

export interface AssetStoreDiagnostic {
  assetId: string;
  variantId?: string;
  severity: "warning" | "error";
  code: "asset.missing" | "asset.symlink" | "asset.digest-mismatch" | "asset.policy-blocked" | "asset.license-restricted";
  message: string;
}

export interface AssetExportResult {
  copied: string[];
  diagnostics: AssetStoreDiagnostic[];
}

function inside(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate));
  return path === "" || (!path.startsWith(`..${sep}`) && path !== "..");
}

function assertDirectoryBoundary(path: string, label: string): void {
  if (!existsSync(path)) return;
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`${label} must be a regular non-symlink directory`);
  }
}

function safeImportPath(projectDir: string, importName: string): string {
  if (importName !== basename(importName) || importName === "." || importName === ".." || importName.includes("\0")) {
    throw new Error("Asset importName must be one file directly inside .intentform/imports");
  }
  const root = join(projectDir, "imports");
  assertDirectoryBoundary(root, "Asset imports directory");
  const path = join(root, importName);
  if (!inside(root, path)) throw new Error("Asset import escaped the project imports directory");
  return path;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function atomicWrite(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function validateMagic(bytes: Uint8Array, extension: SupportedExtension): void {
  const ascii = (start: number, end: number) => Buffer.from(bytes.subarray(start, end)).toString("ascii");
  const valid = extension === ".png" ? hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    : extension === ".jpg" || extension === ".jpeg" ? hasPrefix(bytes, [0xff, 0xd8, 0xff])
      : extension === ".gif" ? ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a"
        : extension === ".webp" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP"
          : extension === ".mp4" ? ascii(4, 8) === "ftyp"
            : extension === ".webm" ? hasPrefix(bytes, [0x1a, 0x45, 0xdf, 0xa3])
              : extension === ".mp3" ? ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0)
                : extension === ".ogg" ? ascii(0, 4) === "OggS"
                  : extension === ".wav" ? ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
                    : extension === ".woff" ? ascii(0, 4) === "wOFF"
                      : extension === ".woff2" ? ascii(0, 4) === "wOF2"
                        : extension === ".otf" ? ascii(0, 4) === "OTTO"
                          : extension === ".ttf" ? hasPrefix(bytes, [0x00, 0x01, 0x00, 0x00]) || ascii(0, 4) === "true"
                            : true;
  if (!valid) throw new Error(`Asset bytes do not match the ${extension} file type`);
}

export function sanitizeSvg(source: string): string {
  if (new TextEncoder().encode(source).byteLength > ASSET_IMPORT_LIMITS.maxSvgBytes) {
    throw new Error(`SVG exceeds ${ASSET_IMPORT_LIMITS.maxSvgBytes} bytes`);
  }
  const normalized = source.replace(/\r\n?/g, "\n").trim();
  if (!/^<svg(?:\s|>)/i.test(normalized)) throw new Error("SVG must have an svg root element");
  const forbidden = [
    /<!doctype/i,
    /<!entity/i,
    /<\?/,
    /&(?:#|[a-z])/i,
    /<(?:script|style|foreignObject|iframe|object|embed|link|meta)(?:\s|>)/i,
    /\sstyle\s*=/i,
    /\son[a-z]+\s*=/i,
    /(?:href|xlink:href)\s*=\s*["'](?!#)[^"']*["']/i,
    /(?:javascript|data|file|https?):/i,
    /url\(\s*(?!#[^)]+\))/i,
  ];
  if (forbidden.some((pattern) => pattern.test(normalized))) {
    throw new Error("SVG contains executable or external content");
  }
  return `${normalized}\n`;
}

function imageDimensions(bytes: Uint8Array, extension: SupportedExtension, svgSource?: string): { width?: number; height?: number } {
  if (extension === ".png" && bytes.length >= 24) {
    return { width: Buffer.from(bytes).readUInt32BE(16), height: Buffer.from(bytes).readUInt32BE(20) };
  }
  if (extension === ".gif" && bytes.length >= 10) {
    return { width: Buffer.from(bytes).readUInt16LE(6), height: Buffer.from(bytes).readUInt16LE(8) };
  }
  if (extension === ".svg" && svgSource) {
    const root = svgSource.match(/^<svg\b([^>]*)>/i)?.[1] ?? "";
    const width = Number.parseFloat(root.match(/\bwidth=["']([0-9.]+)/i)?.[1] ?? "");
    const height = Number.parseFloat(root.match(/\bheight=["']([0-9.]+)/i)?.[1] ?? "");
    const viewBox = root.match(/\bviewBox=["']\s*[-0-9.]+\s+[-0-9.]+\s+([0-9.]+)\s+([0-9.]+)\s*["']/i);
    return {
      ...(Number.isFinite(width) && width > 0 ? { width: Math.round(width) } : viewBox ? { width: Math.round(Number(viewBox[1])) } : {}),
      ...(Number.isFinite(height) && height > 0 ? { height: Math.round(height) } : viewBox ? { height: Math.round(Number(viewBox[2])) } : {}),
    };
  }
  return {};
}

export function importProjectAsset(projectDir: string, input: ImportProjectAssetInput): AssetDefinition {
  const sourcePath = safeImportPath(projectDir, input.importName);
  if (!existsSync(sourcePath)) throw new Error(`Asset import is missing: imports/${input.importName}`);
  const sourceStat = lstatSync(sourcePath);
  if (sourceStat.isSymbolicLink()) throw new Error("Asset imports cannot be symbolic links");
  if (!sourceStat.isFile()) throw new Error("Asset import must be a regular file");
  if (sourceStat.size <= 0 || sourceStat.size > ASSET_IMPORT_LIMITS.maxBytes) {
    throw new Error(`Asset import must contain 1 through ${ASSET_IMPORT_LIMITS.maxBytes} bytes`);
  }
  const extension = extname(input.importName).toLowerCase() as SupportedExtension;
  const format = formats[extension];
  if (!format) throw new Error(`Unsupported asset extension: ${extension || "none"}`);
  let bytes = readFileSync(sourcePath);
  let svgSource: string | undefined;
  if (extension === ".svg") {
    svgSource = sanitizeSvg(bytes.toString("utf8"));
    bytes = Buffer.from(svgSource, "utf8");
  } else {
    validateMagic(bytes, extension);
  }
  const kind = input.kind ?? format.kind;
  if (kind !== format.kind && !(extension === ".svg" && kind === "icon")) {
    throw new Error(`Asset kind ${kind} does not match ${extension}`);
  }
  const digest = sha256(bytes);
  const canonicalExtension = extension === ".jpeg" ? ".jpg" : extension;
  const storageKey = `assets/${digest}${canonicalExtension}`;
  const definition = assetDefinitionSchema.parse({
    id: input.id,
    name: input.name,
    kind,
    digest,
    mediaType: format.mediaType,
    byteLength: bytes.byteLength,
    storageKey,
    ...imageDimensions(bytes, extension, svgSource),
    variants: [],
    license: input.license,
    exportPolicy: input.exportPolicy,
    metadata: input.metadata ?? {},
  });
  if (definition.exportPolicy === "copy" && definition.license.redistribution !== "allowed") {
    throw new Error("Copy export requires a license that allows redistribution");
  }
  const destination = join(projectDir, storageKey);
  const assetRoot = join(projectDir, "assets");
  assertDirectoryBoundary(assetRoot, "Asset store");
  if (!inside(assetRoot, destination)) throw new Error("Asset storage key escaped the project asset directory");
  if (existsSync(destination)) {
    const existing = lstatSync(destination);
    if (!existing.isFile() || existing.isSymbolicLink() || sha256(readFileSync(destination)) !== digest) {
      throw new Error(`Content-addressed asset collision: ${storageKey}`);
    }
  } else {
    atomicWrite(destination, bytes);
  }
  return definition;
}

function inspectFile(
  projectDir: string,
  assetId: string,
  file: Pick<AssetDefinition, "digest" | "storageKey">,
  variantId?: string,
): AssetStoreDiagnostic[] {
  const root = join(projectDir, "assets");
  if (existsSync(root)) {
    const rootStat = lstatSync(root);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      return [{ assetId, ...(variantId ? { variantId } : {}), severity: "error", code: "asset.symlink", message: "Asset store must be a regular non-symlink directory" }];
    }
  }
  const path = join(projectDir, file.storageKey);
  const context = variantId ? `${assetId}.${variantId}` : assetId;
  if (!inside(root, path) || !existsSync(path)) {
    return [{ assetId, ...(variantId ? { variantId } : {}), severity: "error", code: "asset.missing", message: `Asset bytes are missing: ${context}` }];
  }
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return [{ assetId, ...(variantId ? { variantId } : {}), severity: "error", code: "asset.symlink", message: `Asset storage must be a regular non-symlink file: ${context}` }];
  }
  if (sha256(readFileSync(path)) !== file.digest) {
    return [{ assetId, ...(variantId ? { variantId } : {}), severity: "error", code: "asset.digest-mismatch", message: `Asset digest does not match its manifest: ${context}` }];
  }
  return [];
}

export function inspectProjectAssets(projectDir: string, assets: readonly AssetDefinition[]): AssetStoreDiagnostic[] {
  return assets.flatMap((asset) => [
    ...inspectFile(projectDir, asset.id, asset),
    ...asset.variants.flatMap((variant) => inspectFile(projectDir, asset.id, variant, variant.id)),
    ...(asset.exportPolicy === "blocked" ? [{
      assetId: asset.id,
      severity: "warning" as const,
      code: "asset.policy-blocked" as const,
      message: `Asset export is blocked by project policy: ${asset.id}`,
    }] : []),
    ...(asset.exportPolicy === "copy" && asset.license.redistribution !== "allowed" ? [{
      assetId: asset.id,
      severity: "error" as const,
      code: "asset.license-restricted" as const,
      message: `Asset license does not permit copying into generated output: ${asset.id}`,
    }] : []),
  ]).sort((left, right) => `${left.assetId}.${left.variantId ?? ""}.${left.code}`.localeCompare(`${right.assetId}.${right.variantId ?? ""}.${right.code}`));
}

export function exportProjectAssets(
  projectDir: string,
  assets: readonly AssetDefinition[],
  outputRoot: string,
  target: "react" | "swiftui" | "expo" | "web" = "react",
): AssetExportResult {
  const diagnostics = inspectProjectAssets(projectDir, assets);
  const blocking = new Set(diagnostics.filter((item) => item.severity === "error").map((item) => `${item.assetId}.${item.variantId ?? ""}`));
  const copied: string[] = [];
  assertDirectoryBoundary(outputRoot, "Asset output root");
  for (const asset of assets) {
    if (asset.exportPolicy !== "copy" || blocking.has(`${asset.id}.`)) continue;
    for (const file of [asset, ...asset.variants]) {
      const variantId = "id" in file && file !== asset ? file.id : "";
      if (blocking.has(`${asset.id}.${variantId}`)) continue;
      const source = join(projectDir, file.storageKey);
      const destination = target === "expo"
        ? join(outputRoot, file.storageKey)
        : join(outputRoot, target === "swiftui" ? "Resources" : "public", file.storageKey);
      if (!inside(outputRoot, destination)) throw new Error("Asset output escaped the generated output root");
      const destinationParent = dirname(destination);
      mkdirSync(outputRoot, { recursive: true });
      const relativeParent = relative(outputRoot, destinationParent);
      let current = outputRoot;
      for (const segment of relativeParent.split(sep).filter(Boolean)) {
        current = join(current, segment);
        assertDirectoryBoundary(current, "Asset output directory");
        if (!existsSync(current)) mkdirSync(current);
      }
      if (existsSync(destination)) {
        const destinationStat = lstatSync(destination);
        if (destinationStat.isSymbolicLink() || !destinationStat.isFile()) {
          throw new Error("Asset output destination must be a regular non-symlink file");
        }
      }
      copyFileSync(source, destination);
      copied.push(destination);
    }
  }
  return { copied: copied.sort(), diagnostics };
}

export function garbageCollectProjectAssets(
  projectDir: string,
  assets: readonly AssetDefinition[],
  apply = false,
): { unused: string[]; removed: string[] } {
  const root = join(projectDir, "assets");
  if (!existsSync(root)) return { unused: [], removed: [] };
  assertDirectoryBoundary(root, "Asset store");
  const retained = new Set(assets.flatMap((asset) => [asset.storageKey, ...asset.variants.map((variant) => variant.storageKey)]));
  const unused = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink())
    .map((entry) => `assets/${entry.name}`)
    .filter((storageKey) => !retained.has(storageKey))
    .sort();
  const removed: string[] = [];
  if (apply) {
    for (const storageKey of unused) {
      const path = join(projectDir, storageKey);
      if (!inside(root, path)) continue;
      rmSync(path);
      removed.push(storageKey);
    }
  }
  return { unused, removed };
}
