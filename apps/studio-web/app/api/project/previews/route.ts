import {
  PREVIEW_TARGETS,
  PreviewAlreadyRunningError,
  PreviewBindingCache,
  PreviewSupervisor,
  readPreviewEvidence,
  recoverOrphanedPreviewEvidence,
  resolvePreviewEvidence,
  runLocalPreview,
  type PreviewTarget,
} from "@intentform/preview-daemon";
import { loadProject, resolveProjectDir } from "@intentform/mcp-server/store";
import {
  inputErrorResponse,
  isLocalProjectRequestAllowed,
  parseRequestBody,
  previewMutationRequestSchema,
} from "../../../../lib/api-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStoreHeaders = { "cache-control": "no-store" };
const supervisor = new PreviewSupervisor(2, 180_000);
const bindingCache = new PreviewBindingCache();

const localOnlyError = () => Response.json(
  { error: "Local previews are disabled in hosted or cross-origin contexts." },
  { status: 403, headers: noStoreHeaders },
);

function requestedProfile(request: Request): string | undefined {
  const value = new URL(request.url).searchParams.get("profile");
  return value && /^(?:device|web):[a-z][a-z0-9.-]*$/.test(value) ? value : undefined;
}

function targetStatus(
  projectDir: string,
  graph: ReturnType<typeof loadProject>["graph"],
  fingerprint: string,
  target: PreviewTarget,
  profileId?: string,
) {
  try {
    const binding = bindingCache.resolve(graph, fingerprint, target, profileId);
    const active = supervisor.current(projectDir, target);
    const stored = active ?? recoverOrphanedPreviewEvidence(projectDir, target);
    return resolvePreviewEvidence(projectDir, binding, stored);
  } catch (error) {
    return {
      target,
      unavailable: true as const,
      message: error instanceof Error ? error.message.slice(0, 500) : "This preview target is unavailable.",
    };
  }
}

export async function GET(request: Request) {
  if (new URL(request.url).searchParams.get("capability") === "1") {
    return Response.json(
      { available: isLocalProjectRequestAllowed(request) },
      { headers: noStoreHeaders },
    );
  }
  if (!isLocalProjectRequestAllowed(request)) return localOnlyError();
  try {
    const projectDir = resolveProjectDir();
    const project = loadProject(projectDir);
    const profileId = requestedProfile(request);
    return Response.json({
      fingerprint: project.fingerprint,
      targets: PREVIEW_TARGETS.map((target) => targetStatus(
        projectDir,
        project.graph,
        project.fingerprint,
        target,
        profileId,
      )),
    }, { headers: noStoreHeaders });
  } catch {
    return Response.json(
      { error: "Local preview evidence could not be loaded." },
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
      previewMutationRequestSchema,
      "The local preview request is invalid.",
    );
  } catch (error) {
    return inputErrorResponse(error)
      ?? Response.json({ error: "The local preview request could not be read." }, { status: 400, headers: noStoreHeaders });
  }

  try {
    const projectDir = resolveProjectDir();
    const project = loadProject(projectDir);
    if (project.fingerprint !== body.expectedGraphFingerprint) {
      return Response.json({
        error: "The local graph changed before the preview request was accepted.",
        currentFingerprint: project.fingerprint,
      }, { status: 409, headers: noStoreHeaders });
    }
    const binding = bindingCache.resolve(project.graph, project.fingerprint, body.target, body.profileId);
    const manifest = body.action === "cancel"
      ? supervisor.cancel(projectDir, body.target)
      : body.action === "restart"
        ? supervisor.restart({ projectDir, graph: project.graph, binding, runner: runLocalPreview })
        : supervisor.start({ projectDir, graph: project.graph, binding, runner: runLocalPreview });
    return Response.json({
      fingerprint: project.fingerprint,
      target: resolvePreviewEvidence(
        projectDir,
        binding,
        manifest ?? readPreviewEvidence(projectDir, body.target),
      ),
    }, { status: body.action === "cancel" ? 200 : 202, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof PreviewAlreadyRunningError) {
      return Response.json({ error: error.message }, { status: 409, headers: noStoreHeaders });
    }
    return Response.json(
      { error: error instanceof Error ? error.message.slice(0, 500) : "The local preview request failed." },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
