import { randomUUID } from "node:crypto";
import {
  discardProjectAssetImport,
  garbageCollectProjectAssets,
  importProjectAsset,
  inspectProjectAssets,
  stageProjectAssetImport,
} from "@intentform/token-assets/assets";
import { loadProject, resolveProjectDir, saveProject } from "@intentform/mcp-server/store";
import { isLocalProjectRequestAllowed } from "../../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };
const localOnlyError = () => Response.json(
  { error: "Local asset import is disabled in hosted or cross-origin contexts." },
  { status: 403, headers: noStoreHeaders },
);

function textField(form: FormData, key: string, maximum: number, required = true): string | undefined {
  const value = form.get(key);
  if (value === null && !required) return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be text`);
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maximum || normalized.includes("\0")) {
    throw new Error(`${key} is invalid`);
  }
  return normalized || undefined;
}

function enumField<const T extends readonly string[]>(values: T, value: string, label: string): T[number] {
  if (!(values as readonly string[]).includes(value)) throw new Error(`${label} is invalid`);
  return value as T[number];
}

export async function GET(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  try {
    const projectDir = resolveProjectDir();
    const project = loadProject(projectDir);
    return Response.json({
      fingerprint: project.fingerprint,
      diagnostics: inspectProjectAssets(projectDir, project.graph.assets),
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json(
      { error: "The local asset store could not be inspected." },
      { status: 409, headers: noStoreHeaders },
    );
  }
}

export async function POST(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 101_000_000) {
    return Response.json({ error: "Asset upload exceeds 100 MB." }, { status: 413, headers: noStoreHeaders });
  }

  let stagedName: string | undefined;
  let projectDir: string | undefined;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0 || file.size > 100_000_000) {
      return Response.json({ error: "Choose a supported file between 1 byte and 100 MB." }, { status: 400, headers: noStoreHeaders });
    }
    const id = textField(form, "id", 120)!;
    const name = textField(form, "name", 160)!;
    const expectedFingerprint = textField(form, "expectedFingerprint", 128)!;
    const licenseName = textField(form, "licenseName", 160)!;
    const spdx = textField(form, "spdx", 80, false);
    const sourceUrl = textField(form, "sourceUrl", 2_000, false);
    const attribution = textField(form, "attribution", 1_000, false);
    const redistribution = enumField(["allowed", "restricted", "unknown"] as const, textField(form, "redistribution", 20)!, "redistribution");
    const exportPolicy = enumField(["copy", "reference", "blocked"] as const, textField(form, "exportPolicy", 20)!, "exportPolicy");

    projectDir = resolveProjectDir();
    const project = loadProject(projectDir);
    if (project.fingerprint !== expectedFingerprint) {
      return Response.json(
        { error: "The local project changed before the asset was imported.", currentFingerprint: project.fingerprint },
        { status: 409, headers: noStoreHeaders },
      );
    }
    const replacingId = textField(form, "replacingId", 120, false);
    if (project.graph.assets.some((asset) => asset.id === id && asset.id !== replacingId)) {
      return Response.json({ error: `Asset id already exists: ${id}` }, { status: 409, headers: noStoreHeaders });
    }

    stagedName = stageProjectAssetImport(projectDir, file.name, new Uint8Array(await file.arrayBuffer()), randomUUID());
    const asset = importProjectAsset(projectDir, {
      importName: stagedName,
      id,
      name,
      license: {
        name: licenseName,
        ...(spdx ? { spdx } : {}),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(attribution ? { attribution } : {}),
        redistribution,
      },
      exportPolicy,
      metadata: { importedBy: "studio" },
    });
    const graph = structuredClone(project.graph);
    if (replacingId) {
      const index = graph.assets.findIndex((candidate) => candidate.id === replacingId);
      if (index < 0) throw new Error(`Asset to replace was not found: ${replacingId}`);
      graph.assets[index] = asset;
    } else {
      graph.assets.push(asset);
    }
    const saved = saveProject(
      projectDir,
      graph,
      `${replacingId ? "replace" : "import"} Studio asset ${asset.id}`,
      project.fingerprint,
      { author: "human", kind: "save" },
    );
    return Response.json({
      asset,
      graph,
      fingerprint: saved.fingerprint,
      diagnostics: inspectProjectAssets(projectDir, graph.assets).filter((item) => item.assetId === asset.id),
    }, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "The asset could not be imported." },
      { status: 400, headers: noStoreHeaders },
    );
  } finally {
    if (projectDir && stagedName) {
      try { discardProjectAssetImport(projectDir, stagedName); } catch { /* best-effort inbox cleanup */ }
    }
  }
}

export async function DELETE(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  try {
    const url = new URL(request.url);
    const expectedFingerprint = url.searchParams.get("expectedFingerprint") ?? "";
    if (!/^[a-f0-9]{8}$/.test(expectedFingerprint)) {
      return Response.json({ error: "A valid saved-project fingerprint is required." }, { status: 400, headers: noStoreHeaders });
    }
    const projectDir = resolveProjectDir();
    const project = loadProject(projectDir);
    if (project.fingerprint !== expectedFingerprint) {
      return Response.json(
        { error: "The local project changed before asset cleanup.", currentFingerprint: project.fingerprint },
        { status: 409, headers: noStoreHeaders },
      );
    }
    return Response.json(
      garbageCollectProjectAssets(projectDir, project.graph.assets, true),
      { headers: noStoreHeaders },
    );
  } catch {
    return Response.json({ error: "The local asset store could not be cleaned." }, { status: 409, headers: noStoreHeaders });
  }
}
