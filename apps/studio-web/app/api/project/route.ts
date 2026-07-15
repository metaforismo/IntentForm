import {
  loadProject,
  migrateProject,
  ProjectBusyError,
  ProjectConflictError,
  ProjectMigrationConflictError,
  ProjectMigrationRequiredError,
  resolveProjectDir,
  saveProject,
} from "@intentform/mcp-server/store";
import { GraphMigrationError } from "@intentform/semantic-schema/migrations";
import {
  inputErrorResponse,
  isLocalProjectRequestAllowed,
  parseRequestBody,
  projectMigrationRequestSchema,
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
  if (new URL(request.url).searchParams.get("capability") === "1") {
    return Response.json(
      { available: isLocalProjectRequestAllowed(request) },
      { headers: noStoreHeaders },
    );
  }
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  try {
    const project = loadProject(resolveProjectDir());
    return Response.json(
      { graph: project.graph, fingerprint: project.fingerprint, seeded: project.seeded },
      { headers: noStoreHeaders },
    );
  } catch (error) {
    if (error instanceof ProjectMigrationRequiredError) {
      return Response.json(
        { error: error.message, migration: error.migration },
        { status: 409, headers: noStoreHeaders },
      );
    }
    if (error instanceof GraphMigrationError) {
      return Response.json(
        { error: error.message, diagnostics: error.diagnostics },
        { status: 422, headers: noStoreHeaders },
      );
    }
    return Response.json(
      { error: "No local .intentform project is available in this deployment." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}

export async function POST(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  let body;
  try {
    body = await parseRequestBody(
      request,
      projectMigrationRequestSchema,
      "The project migration request is invalid.",
    );
  } catch (error) {
    return inputErrorResponse(error)
      ?? Response.json({ error: "The migration request could not be read." }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const migrated = migrateProject(resolveProjectDir(), body.expectedSourceFingerprint, "human");
    return Response.json({
      graph: migrated.graph,
      fingerprint: migrated.fingerprint,
      migration: {
        status: migrated.status,
        fromVersion: migrated.fromVersion,
        toVersion: migrated.toVersion,
        diagnostics: migrated.diagnostics,
        checkpointCreated: migrated.checkpoint !== null,
      },
    }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ProjectMigrationConflictError) {
      return Response.json(
        { error: error.message, currentSourceFingerprint: error.currentSourceFingerprint },
        { status: 409, headers: noStoreHeaders },
      );
    }
    if (error instanceof ProjectBusyError) {
      return Response.json({ error: error.message }, { status: 423, headers: noStoreHeaders });
    }
    if (error instanceof GraphMigrationError) {
      return Response.json(
        { error: error.message, diagnostics: error.diagnostics },
        { status: 422, headers: noStoreHeaders },
      );
    }
    return Response.json(
      { error: "The local project could not be migrated." },
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
      body.expectedFingerprint,
      { author: "human", kind: "save" },
    );
    return Response.json({ fingerprint: saved.fingerprint }, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ProjectConflictError) {
      return Response.json(
        { error: error.message, currentFingerprint: error.currentFingerprint },
        { status: 409, headers: noStoreHeaders },
      );
    }
    if (error instanceof ProjectBusyError) {
      return Response.json(
        { error: error.message },
        { status: 423, headers: noStoreHeaders },
      );
    }
    return Response.json(
      { error: "The graph could not be saved to the local project." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
