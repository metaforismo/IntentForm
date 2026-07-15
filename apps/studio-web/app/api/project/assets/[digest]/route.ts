import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { loadProject, resolveProjectDir } from "@intentform/mcp-server/store";
import { isLocalProjectRequestAllowed } from "../../../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function GET(
  request: Request,
  context: { params: Promise<{ digest: string }> },
) {
  if (!isLocalProjectRequestAllowed(request)) {
    return Response.json({ error: "Local asset access is disabled." }, { status: 403, headers: noStoreHeaders });
  }
  const { digest } = await context.params;
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    return Response.json({ error: "Invalid asset digest." }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const projectDir = resolveProjectDir();
    const { graph } = loadProject(projectDir);
    const files = graph.assets.flatMap((asset) => [
      { asset, file: asset },
      ...asset.variants.map((variant) => ({ asset, file: variant })),
    ]);
    const match = files.find(({ asset, file }) =>
      file.digest === digest && asset.kind !== "font");
    if (!match) return Response.json({ error: "Asset not found." }, { status: 404, headers: noStoreHeaders });
    const root = resolve(projectDir, "assets");
    const rootStat = lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Asset store is not a regular directory");
    const path = resolve(projectDir, match.file.storageKey);
    const pathFromRoot = relative(root, path);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`)) throw new Error("Asset path escaped the project store");
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Asset is not a regular file");
    const bytes = readFileSync(path);
    if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error("Asset digest mismatch");
    return new Response(bytes, {
      headers: {
        "content-type": match.file.mediaType,
        "content-length": String(bytes.byteLength),
        "cache-control": "private, max-age=31536000, immutable",
        "content-security-policy": "default-src 'none'; style-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "The local asset is unavailable or invalid." }, { status: 409, headers: noStoreHeaders });
  }
}
