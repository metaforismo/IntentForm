import type { AssetDefinition, SemanticInterfaceGraph } from "@intentform/semantic-schema";

export function allocateAssetId(assets: readonly Pick<AssetDefinition, "id">[], fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "asset";
  const existing = new Set(assets.map((asset) => asset.id));
  let id = `asset.${stem}`;
  let suffix = 2;
  while (existing.has(id)) { id = `asset.${stem}-${suffix}`; suffix += 1; }
  return id;
}

export async function importLocalAsset(options: {
  file: File;
  graph: Pick<SemanticInterfaceGraph, "assets">;
  expectedFingerprint: string;
  replacingId?: string;
  signal?: AbortSignal;
}): Promise<{ asset: AssetDefinition; graph: SemanticInterfaceGraph; fingerprint: string }> {
  const replaced = options.replacingId
    ? options.graph.assets.find((asset) => asset.id === options.replacingId)
    : undefined;
  const id = replaced?.id ?? allocateAssetId(options.graph.assets, options.file.name);
  const name = replaced?.name ?? (options.file.name.replace(/\.[^.]+$/, "") || "Untitled asset");
  const form = new FormData();
  form.set("file", options.file);
  form.set("id", id);
  form.set("name", name);
  form.set("expectedFingerprint", options.expectedFingerprint);
  form.set("licenseName", replaced?.license.name ?? "User-provided asset");
  form.set("redistribution", replaced?.license.redistribution ?? "unknown");
  form.set("exportPolicy", replaced?.exportPolicy ?? "reference");
  if (replaced?.license.spdx) form.set("spdx", replaced.license.spdx);
  if (replaced?.license.sourceUrl) form.set("sourceUrl", replaced.license.sourceUrl);
  if (replaced?.license.attribution) form.set("attribution", replaced.license.attribution);
  if (options.replacingId) form.set("replacingId", options.replacingId);
  const response = await fetch("/api/project/assets", {
    method: "POST",
    body: form,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const result = await response.json() as { error?: string; asset?: AssetDefinition; graph?: SemanticInterfaceGraph; fingerprint?: string };
  if (!response.ok || !result.asset || !result.graph || !result.fingerprint) throw new Error(result.error ?? "Asset import failed.");
  return { asset: result.asset, graph: result.graph, fingerprint: result.fingerprint };
}
