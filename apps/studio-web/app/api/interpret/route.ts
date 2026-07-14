import { interpretBrief, interpretSemanticEdit } from "@intentform/intent-interpreter";
import { demoGraph } from "@intentform/proof-report/demo";
import { parseGraph } from "@intentform/semantic-schema";
import { consumeQuota, quotaIdentity } from "@/lib/quota";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { brief?: unknown; graph?: unknown; operation?: unknown; screenId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const brief = typeof body.brief === "string" ? body.brief.trim() : "";
  const operation = body.operation === "edit" ? "edit" : "create";
  if (!brief) return Response.json({ error: operation === "edit" ? "An edit instruction is required." : "A product brief is required." }, { status: 400 });
  if (brief.length > 12_000) return Response.json({ error: "The instruction is too long." }, { status: 413 });

  let currentGraph = demoGraph;
  if (operation === "edit") {
    try {
      currentGraph = parseGraph(body.graph);
    } catch {
      return Response.json({ error: "A valid current graph is required for semantic edits." }, { status: 422 });
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const quota = apiKey ? consumeQuota(quotaIdentity(request)) : { allowed: true, remaining: 0 };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    if (!quota.allowed) {
      if (operation === "edit") {
        const replay = await interpretSemanticEdit({ instruction: brief, graph: currentGraph, ...(typeof body.screenId === "string" ? { screenId: body.screenId } : {}) });
        return Response.json(
          { ...replay, note: "Live quota is exhausted. " + replay.note },
          { headers: { "x-intentform-quota-remaining": "0" } },
        );
      }
      return Response.json(
        {
          graph: demoGraph,
          mode: "replay",
          model: "deterministic-sample",
          note: "The live demo quota is exhausted. The complete reproducible sample remains available.",
          trace: { requestId: "replay.quota", requestFingerprint: "redacted", attempts: 0 },
        },
        { headers: { "x-intentform-quota-remaining": "0" } },
      );
    }

    const common = {
      ...(apiKey ? { apiKey } : {}),
      model: process.env.OPENAI_MODEL ?? "gpt-5.6",
      signal: controller.signal,
    };
    const result = operation === "edit"
      ? await interpretSemanticEdit({ instruction: brief, graph: currentGraph, ...(typeof body.screenId === "string" ? { screenId: body.screenId } : {}), ...common })
      : await interpretBrief({ brief, fallbackGraph: demoGraph, ...common });
    return Response.json(result, {
      headers: {
        "cache-control": "no-store",
        "x-intentform-quota-remaining": String(quota.remaining),
      },
    });
  } catch (error) {
    if (operation === "edit") {
      return Response.json(
        { error: error instanceof Error && error.message.startsWith("This edit needs") ? error.message : "The semantic edit could not be validated." },
        { status: 422, headers: { "cache-control": "no-store" } },
      );
    }
    return Response.json({
      graph: demoGraph,
      mode: "replay",
      model: "deterministic-sample",
      note: controller.signal.aborted
        ? "Live interpretation timed out. Showing the reproducible sample."
        : "Live interpretation was unavailable. Showing the reproducible sample.",
      trace: { requestId: "replay.fallback", requestFingerprint: "redacted", attempts: 0 },
    }, { headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timeout);
  }
}
