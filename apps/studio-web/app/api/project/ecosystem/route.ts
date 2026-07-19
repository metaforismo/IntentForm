import { projectEcosystemResource } from "@intentform/mcp-server/tools";
import { resolveProjectDir } from "@intentform/mcp-server/store";
import { isLocalProjectRequestAllowed } from "../../../../lib/api-contracts";
import { logServerFailure } from "../../../../lib/server-log";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function GET(request: Request) {
  const available = isLocalProjectRequestAllowed(request);
  if (new URL(request.url).searchParams.get("capability") === "1") {
    return Response.json({ available }, { headers: noStoreHeaders });
  }
  if (!available) {
    return Response.json(
      { error: "Local ecosystem access is disabled in hosted or cross-origin contexts." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  try {
    return Response.json(projectEcosystemResource(resolveProjectDir()), { headers: noStoreHeaders });
  } catch (error) {
    logServerFailure("ecosystem inspection", error);
    return Response.json(
      { error: "The local ecosystem state is unavailable." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
