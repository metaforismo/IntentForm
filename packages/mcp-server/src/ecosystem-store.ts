import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import {
  packageArtifactSchema,
  pluginGrantSchema,
  previewPackageUpdate,
  sha256,
  syncConfigurationSchema,
  trustStoreSchema,
  type PluginGrant,
  type SyncConfiguration,
  type TrustStore,
} from "@intentform/ecosystem";
import { stableSerialize, type SemanticInterfaceGraph } from "@intentform/semantic-schema";
import { z } from "zod";

const MAX_ECOSYSTEM_FILE_BYTES = 24_000_000;
const grantsFileSchema = z.strictObject({
  version: z.literal("1.0.0"),
  grants: z.array(pluginGrantSchema).max(256),
});
const replayFileSchema = z.strictObject({
  version: z.literal("1.0.0"),
  actors: z.record(z.string().min(1).max(160), z.number().int().positive().max(Number.MAX_SAFE_INTEGER)),
});

const ecosystemDir = (projectDir: string) => join(projectDir, "ecosystem");
const trustPath = (projectDir: string) => join(ecosystemDir(projectDir), "trust.json");
const grantsPath = (projectDir: string) => join(ecosystemDir(projectDir), "plugin-grants.json");
const syncPath = (projectDir: string) => join(ecosystemDir(projectDir), "sync.json");
const replayPath = (projectDir: string) => join(ecosystemDir(projectDir), "review-replay.json");
const packagesDir = (projectDir: string) => join(ecosystemDir(projectDir), "packages");
const packagePath = (projectDir: string, digest: string) => join(packagesDir(projectDir), `${digest}.json`);

function assertContained(base: string, candidate: string): void {
  const path = relative(resolve(base), resolve(candidate));
  if (path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !path.startsWith(sep))) return;
  throw new Error("Ecosystem path escapes the local project directory.");
}

function ensureRegularDirectory(path: string): void {
  const parent = dirname(path);
  if (parent !== path && !existsSync(parent)) ensureRegularDirectory(parent);
  if (!existsSync(path)) mkdirSync(path, { mode: 0o700 });
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Ecosystem storage directories must be regular local directories.");
}

function fsyncDirectory(path: string): void {
  if (process.platform === "win32") return;
  const descriptor = openSync(path, "r");
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function writeAtomic(projectDir: string, path: string, source: string): void {
  assertContained(projectDir, path);
  if (Buffer.byteLength(source) > MAX_ECOSYSTEM_FILE_BYTES) throw new Error("Ecosystem file exceeds the size limit.");
  const parent = dirname(path);
  ensureRegularDirectory(parent);
  if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("Refusing to replace a symlinked ecosystem file.");
  const temporary = join(parent, `.${process.pid}-${randomUUID()}-${basename(path)}.tmp`);
  assertContained(projectDir, temporary);
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, source, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporary, path);
    fsyncDirectory(parent);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporary)) rmSync(temporary, { force: true });
  }
}

function readBounded(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Ecosystem data must be a regular local file.");
  if (stat.size > MAX_ECOSYSTEM_FILE_BYTES) throw new Error("Ecosystem file exceeds the size limit.");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readEcosystemTrust(projectDir: string): TrustStore {
  if (!existsSync(trustPath(projectDir))) return { version: "1.0.0", keys: [] };
  return trustStoreSchema.parse(readBounded(trustPath(projectDir)));
}

export function readPluginGrants(projectDir: string): PluginGrant[] {
  if (!existsSync(grantsPath(projectDir))) return [];
  return grantsFileSchema.parse(readBounded(grantsPath(projectDir))).grants;
}

export function writePluginGrant(projectDir: string, grantInput: unknown): PluginGrant {
  const grant = pluginGrantSchema.parse(grantInput);
  const grants = readPluginGrants(projectDir).filter((entry) => entry.pluginId !== grant.pluginId);
  grants.push(grant);
  grants.sort((left, right) => left.pluginId.localeCompare(right.pluginId));
  writeAtomic(projectDir, grantsPath(projectDir), stableSerialize({ version: "1.0.0", grants }));
  return grant;
}

export function readSyncConfiguration(projectDir: string): SyncConfiguration {
  if (!existsSync(syncPath(projectDir))) {
    return { mode: "disabled", endpoint: null, tenantId: "local.default", region: "eu", retentionDays: 30, keyOwnership: "client-managed" };
  }
  return syncConfigurationSchema.parse(readBounded(syncPath(projectDir)));
}

export function writePackageArtifact(projectDir: string, digest: string, canonical: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest) || sha256(canonical) !== digest) throw new Error("Package cache digest does not match its canonical bytes.");
  const path = packagePath(projectDir, digest);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Package cache entries must be regular local files.");
    if (stat.size > MAX_ECOSYSTEM_FILE_BYTES) throw new Error("Package cache entry exceeds the size limit.");
    const existing = readFileSync(path, "utf8");
    if (sha256(existing) !== digest || existing !== canonical) throw new Error("Existing package cache entry failed integrity validation.");
    return path;
  }
  writeAtomic(projectDir, path, canonical);
  return path;
}

export function readPackageArtifact(projectDir: string, digest: string) {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Package digest is invalid.");
  const path = packagePath(projectDir, digest);
  if (!existsSync(path)) throw new Error(`Package artifact ${digest} is not available in the local cache.`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Package cache entries must be regular local files.");
  if (stat.size > MAX_ECOSYSTEM_FILE_BYTES) throw new Error("Package cache entry exceeds the size limit.");
  const source = readFileSync(path, "utf8");
  if (sha256(source) !== digest) throw new Error(`Package artifact ${digest} failed integrity validation.`);
  return packageArtifactSchema.parse(JSON.parse(source));
}

export function inspectEcosystem(projectDir: string, graph: SemanticInterfaceGraph) {
  const trust = readEcosystemTrust(projectDir);
  const grants = readPluginGrants(projectDir);
  const packages = graph.dependencies.map((dependency) => {
    let cache: "verified" | "missing" | "invalid" = "missing";
    let plugin: Record<string, unknown> | null = null;
    try {
      const artifact = readPackageArtifact(projectDir, dependency.artifactDigest);
      cache = "verified";
      if (artifact.kind === "plugin") {
        const grant = grants.find((entry) => entry.pluginId === artifact.plugin.id && entry.manifestDigest === dependency.manifestDigest);
        plugin = {
          name: artifact.plugin.name,
          commands: artifact.plugin.commands,
          requestedPermissions: artifact.plugin.permissions,
          grantedPermissions: grant?.permissions ?? [],
        };
      }
    } catch (error) {
      cache = error instanceof Error && /not available/.test(error.message) ? "missing" : "invalid";
    }
    return { ...dependency, cache, plugin };
  });
  return {
    abiVersion: "1.0.0" as const,
    localFirst: true as const,
    compilersFetchPackages: false as const,
    executablePlugins: false as const,
    trust: { keyCount: trust.keys.length, activeKeyCount: trust.keys.filter((entry) => !entry.revoked).length },
    sync: readSyncConfiguration(projectDir),
    packages,
  };
}

export function previewStoredPackageUpdate(
  projectDir: string,
  graph: SemanticInterfaceGraph,
  signed: unknown,
  artifact: unknown,
) {
  return previewPackageUpdate(graph, signed, artifact, readEcosystemTrust(projectDir));
}

export function readReviewHighWaterMarks(projectDir: string): Record<string, number> {
  if (!existsSync(replayPath(projectDir))) return {};
  return replayFileSchema.parse(readBounded(replayPath(projectDir))).actors;
}

export function recordReviewSequence(projectDir: string, actorId: string, sequence: number): void {
  const actors = readReviewHighWaterMarks(projectDir);
  const prior = actors[actorId] ?? 0;
  if (sequence <= prior) throw new Error(`Review bundle sequence ${sequence} is a replay for ${actorId}.`);
  actors[actorId] = sequence;
  writeAtomic(projectDir, replayPath(projectDir), stableSerialize({ version: "1.0.0", actors }));
}
