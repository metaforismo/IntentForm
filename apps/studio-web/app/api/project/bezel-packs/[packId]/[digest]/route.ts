import { readLocalBezelAsset } from "@intentform/device-bezels";
import { resolveProjectDir } from "@intentform/mcp-server/store";
import { isLocalProjectRequestAllowed } from "../../../../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function GET(
  request: Request,
  context: { params: Promise<{ packId: string; digest: string }> },
) {
  if (!isLocalProjectRequestAllowed(request) || process.env.INTENTFORM_ENABLE_LOCAL_BEZELS !== "1") {
    return Response.json({ error: "Local bezel rendering is disabled." }, { status: 403, headers: noStoreHeaders });
  }
  const { packId, digest } = await context.params;
  const url = new URL(request.url);
  const deviceProfileId = url.searchParams.get("profile") ?? "";
  const packVersion = url.searchParams.get("version") ?? "";
  const manifestChecksum = url.searchParams.get("manifest") ?? "";
  if (url.searchParams.get("ack") !== "1") {
    return Response.json({ error: "Local license acknowledgement is required." }, { status: 428, headers: noStoreHeaders });
  }
  try {
    const asset = readLocalBezelAsset(resolveProjectDir(), {
      packId,
      packVersion,
      manifestChecksum,
      deviceProfileId,
      assetDigest: digest,
      acknowledgedLocalLicense: true,
    }, deviceProfileId);
    if (!asset) return Response.json({ error: "Bezel pack is missing, revoked, changed or incompatible." }, { status: 404, headers: noStoreHeaders });
    const body = Uint8Array.from(asset.bytes).buffer;
    return new Response(body, {
      headers: {
        "content-type": asset.mediaType,
        "content-length": String(asset.bytes.byteLength),
        "cache-control": "private, no-store",
        "content-security-policy": "default-src 'none'; style-src 'none'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "The local bezel reference is invalid." }, { status: 400, headers: noStoreHeaders });
  }
}
