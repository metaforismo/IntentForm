import { loadProject, resolveProjectDir, saveProject } from "@intentform/mcp-server/store";
import {
  inputErrorResponse,
  isLocalProjectRequestAllowed,
  parseRequestBody,
  projectSaveRequestSchema,
} from "../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };
const localOnlyError = () => Response.json(
  { error: "Local project access is disabled in hosted or cross-origin contexts." },
  { status: 403, headers: noStoreHeaders },
);

/* Bridges the Studio to the on-disk `.intentform/` project that the MCP
   server exposes to coding agents. Production builds must explicitly opt in,
   and Vercel deployments always fail closed before touching the filesystem. */

export async function GET(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  try {
    const project = loadProject(resolveProjectDir());
    return Response.json(
      { graph: project.graph, fingerprint: project.fingerprint, seeded: project.seeded },
      { headers: noStoreHeaders },
    );
  } catch {
    return Response.json(
      { error: "No local .intentform project is available in this deployment." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}

export async function PUT(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  let body;
  try {
    body = await parseRequestBody(
      request,
      projectSaveRequestSchema,
      "The local project save request is invalid.",
    );
  } catch (error) {
    return inputErrorResponse(error)
      ?? Response.json({ error: "The local project request could not be read." }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const saved = saveProject(
      resolveProjectDir(),
      body.graph,
      body.reason ?? "studio save",
    );
    return Response.json({ fingerprint: saved.fingerprint }, { headers: noStoreHeaders });
  } catch {
    return Response.json(
      { error: "The graph could not be saved to the local project." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
