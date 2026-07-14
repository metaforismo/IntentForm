import { interpretBrief, interpretSemanticEdit } from "@intentform/intent-interpreter";
import { demoGraph } from "@intentform/proof-report/demo";
import { consumeQuota, quotaIdentity } from "../../../lib/quota";
import {
  inputErrorResponse,
  interpretRequestSchema,
  parseRequestBody,
} from "../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function POST(request: Request) {
  let body;
  try {
    body = await parseRequestBody(
      request,
      interpretRequestSchema,
      "The interpretation request is invalid.",
    );
  } catch (error) {
    return inputErrorResponse(error)
      ?? Response.json({ error: "The interpretation request could not be read." }, { status: 400, headers: noStoreHeaders });
  }
  if (body.operation === "edit" && body.screenId && !body.graph.screens.some((screen) => screen.id === body.screenId)) {
    return Response.json(
      { error: "The requested edit screen does not exist in the current graph." },
      { status: 422, headers: noStoreHeaders },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const quota = apiKey ? consumeQuota(quotaIdentity(request)) : { allowed: true, remaining: 0 };
  const controller = new AbortController();
  const abortForClient = () => controller.abort();
  request.signal.addEventListener("abort", abortForClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), 45_000);

  try {
    if (!quota.allowed) {
      if (body.operation === "edit") {
        const replay = await interpretSemanticEdit({
          instruction: body.brief,
          graph: body.graph,
          ...(body.screenId ? { screenId: body.screenId } : {}),
        });
        return Response.json(
          { ...replay, note: "Live quota is exhausted. " + replay.note },
          { headers: { ...noStoreHeaders, "x-intentform-quota-remaining": "0" } },
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
        { headers: { ...noStoreHeaders, "x-intentform-quota-remaining": "0" } },
      );
    }

    const common = {
      ...(apiKey ? { apiKey } : {}),
      model: process.env.OPENAI_MODEL ?? "gpt-5.6",
      signal: controller.signal,
    };
    const result = body.operation === "edit"
      ? await interpretSemanticEdit({
        instruction: body.brief,
        graph: body.graph,
        ...(body.screenId ? { screenId: body.screenId } : {}),
        ...common,
      })
      : await interpretBrief({ brief: body.brief, fallbackGraph: demoGraph, ...common });
    return Response.json(result, {
      headers: {
        ...noStoreHeaders,
        "x-intentform-quota-remaining": String(quota.remaining),
      },
    });
  } catch (error) {
    if (body.operation === "edit") {
      return Response.json(
        { error: error instanceof Error && error.message.startsWith("This edit needs") ? error.message : "The semantic edit could not be validated." },
        { status: 422, headers: noStoreHeaders },
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
    }, { headers: noStoreHeaders });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortForClient);
  }
}
