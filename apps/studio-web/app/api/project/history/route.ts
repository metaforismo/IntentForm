import {
  applyProjectHistoryOperation,
  createProjectBranch,
  deleteProjectBranch,
  mergeProjectBranch,
  previewProjectBranchMerge,
  previewProjectHistoryOperation,
  projectHistory,
  recoverProjectHistory,
} from "@intentform/mcp-server/tools";
import { HistoryConflictError, HistoryIntegrityError } from "@intentform/mcp-server/history";
import { ProjectBusyError, ProjectConflictError, resolveProjectDir } from "@intentform/mcp-server/store";
import {
  historyMutationRequestSchema,
  inputErrorResponse,
  isLocalProjectRequestAllowed,
  parseRequestBody,
} from "../../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };
const localOnlyError = () => Response.json(
  { error: "Local operation history is disabled in hosted or cross-origin contexts." },
  { status: 403, headers: noStoreHeaders },
);

export async function GET(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  try {
    return Response.json(projectHistory(resolveProjectDir()), { headers: noStoreHeaders });
  } catch {
    return Response.json({ error: "Local operation history is unavailable." }, { status: 503, headers: noStoreHeaders });
  }
}

export async function POST(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  let body;
  try {
    body = await parseRequestBody(request, historyMutationRequestSchema, "The history action is invalid.");
  } catch (error) {
    return inputErrorResponse(error)
      ?? Response.json({ error: "The history action could not be read." }, { status: 400, headers: noStoreHeaders });
  }

  const dir = resolveProjectDir();
  try {
    if (body.action === "create-branch") {
      return Response.json(createProjectBranch(dir, body.name, "human"), { headers: noStoreHeaders });
    }
    if (body.action === "preview-merge") {
      return Response.json(previewProjectBranchMerge(dir, body.name), { headers: noStoreHeaders });
    }
    if (body.action === "merge-branch") {
      return Response.json(mergeProjectBranch(dir, body.name, body.expectedFingerprint, "human"), { headers: noStoreHeaders });
    }
    if (body.action === "delete-branch") {
      return Response.json(deleteProjectBranch(dir, body.name), { headers: noStoreHeaders });
    }
    if (body.action === "preview-operation") {
      return Response.json(previewProjectHistoryOperation(dir, body.operationId, body.direction), { headers: noStoreHeaders });
    }
    if (body.action === "apply-operation") {
      return Response.json(
        applyProjectHistoryOperation(dir, body.operationId, body.direction, body.expectedFingerprint, "human"),
        { headers: noStoreHeaders },
      );
    }
    return Response.json(recoverProjectHistory(dir), { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof HistoryConflictError) {
      return Response.json({ error: error.message, conflicts: error.conflicts }, { status: 409, headers: noStoreHeaders });
    }
    if (error instanceof ProjectConflictError) {
      return Response.json(
        { error: error.message, currentFingerprint: error.currentFingerprint },
        { status: 409, headers: noStoreHeaders },
      );
    }
    if (error instanceof ProjectBusyError) {
      return Response.json({ error: error.message }, { status: 423, headers: noStoreHeaders });
    }
    if (error instanceof HistoryIntegrityError) {
      return Response.json({ error: error.message, recoveryAvailable: true }, { status: 422, headers: noStoreHeaders });
    }
    const message = error instanceof Error ? error.message : "The history action failed.";
    const status = /fingerprint conflict|unknown history branch|already exists/i.test(message) ? 409 : 422;
    return Response.json({ error: message.slice(0, 500) }, { status, headers: noStoreHeaders });
  }
}
