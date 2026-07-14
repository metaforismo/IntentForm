import { loadProject, resolveProjectDir, saveProject } from "@intentform/mcp-server/store";
import { parseGraph } from "@intentform/semantic-schema";

export const runtime = "nodejs";

/* Bridges the Studio to the on-disk `.intentform/` project that the MCP
   server exposes to coding agents. Only available where the filesystem is
   writable (local-first); hosted deployments answer with a clear error. */

export async function GET() {
  try {
    const project = loadProject(resolveProjectDir());
    return Response.json({ graph: project.graph, fingerprint: project.fingerprint, seeded: project.seeded });
  } catch {
    return Response.json(
      { error: "No local .intentform project is available in this deployment." },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { graph?: unknown; reason?: unknown };
    const graph = parseGraph(body.graph);
    const saved = saveProject(
      resolveProjectDir(),
      graph,
      typeof body.reason === "string" && body.reason ? body.reason : "studio save",
    );
    return Response.json({ fingerprint: saved.fingerprint });
  } catch {
    return Response.json(
      { error: "The graph could not be validated and saved to the local project." },
      { status: 400 },
    );
  }
}
