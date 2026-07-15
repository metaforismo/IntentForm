import { inspectLocalBezelPacks } from "@intentform/device-bezels";
import { resolveProjectDir } from "@intentform/mcp-server/store";
import { isLocalProjectRequestAllowed } from "../../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) {
    return Response.json({ error: "Local bezel-pack access is disabled." }, { status: 403, headers: noStoreHeaders });
  }
  const inspection = inspectLocalBezelPacks(resolveProjectDir());
  return Response.json({
    enabled: inspection.enabled,
    diagnostics: inspection.diagnostics,
    packs: inspection.packs.map(({ manifest, manifestChecksum }) => ({
      packId: manifest.packId,
      version: manifest.version,
      name: manifest.name,
      publisher: manifest.publisher,
      revoked: manifest.revoked,
      manifestChecksum,
      license: manifest.license,
      profiles: manifest.profiles.map((profile) => ({
        deviceProfileId: profile.deviceProfileId,
        asset: {
          digest: profile.asset.digest,
          mediaType: profile.asset.mediaType,
          width: profile.asset.width,
          height: profile.asset.height,
        },
        viewport: profile.viewport,
      })),
    })),
  }, { headers: noStoreHeaders });
}
