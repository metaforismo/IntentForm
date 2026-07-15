import { readAgentActivity } from "@intentform/mcp-server/activity";
import { resolveProjectDir } from "@intentform/mcp-server/store";
import { isLocalProjectRequestAllowed } from "../../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) {
    return Response.json(
      { error: "Local agent activity is disabled in hosted or cross-origin contexts." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  return Response.json(readAgentActivity(resolveProjectDir()), { headers: noStoreHeaders });
}
