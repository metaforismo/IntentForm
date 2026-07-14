import { planDeterministicRepair } from "@intentform/repair-planner";
import { planRepairWithOpenAI } from "@intentform/repair-planner/openai";
import { verifyGraph } from "@intentform/verifier";
import { consumeQuota, quotaIdentity } from "../../../lib/quota";
import {
  inputErrorResponse,
  parseRequestBody,
  repairRequestSchema,
} from "../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

export async function POST(request: Request) {
  let body;
  try {
    body = await parseRequestBody(
      request,
      repairRequestSchema,
      "The repair request is invalid.",
    );
  } catch (error) {
    return inputErrorResponse(error)
      ?? Response.json({ error: "The repair request could not be read." }, { status: 400, headers: noStoreHeaders });
  }

  const verifiedFindings = verifyGraph(body.graph, {
    ...body.scenario,
    buildStatus: "not-run",
  }).findings;
  const finding = verifiedFindings.find((candidate) => candidate.id === body.finding.id);
  if (!finding || finding.target !== body.finding.target || finding.screenId !== body.finding.screenId) {
    return Response.json(
      { error: "That finding is not present in a fresh server-side verification of this graph." },
      { status: 422, headers: noStoreHeaders },
    );
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const quota = apiKey ? consumeQuota(quotaIdentity(request)) : { allowed: true, remaining: 0 };
  const replay = () => ({
    proposal: planDeterministicRepair(finding),
    mode: "replay" as const,
    model: "deterministic-repair",
    trace: { requestId: "replay.repair", requestFingerprint: "redacted", attempts: 0 },
  });

  if (!apiKey || !quota.allowed) {
    try {
      return Response.json(replay(), {
        headers: { ...noStoreHeaders, "x-intentform-quota-remaining": String(quota.remaining) },
      });
    } catch {
      return Response.json({ error: "No safe deterministic repair exists for this finding." }, { status: 422, headers: noStoreHeaders });
    }
  }

  const controller = new AbortController();
  const abortForClient = () => controller.abort();
  request.signal.addEventListener("abort", abortForClient, { once: true });
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    // Browser-supplied evidence is shape-checked for forward compatibility but
    // cannot become proof. Until trusted evidence ingestion exists, planning
    // relies only on the finding recomputed above.
    const result = await planRepairWithOpenAI({
      graph: body.graph,
      finding,
      apiKey,
      model: process.env.OPENAI_MODEL ?? "gpt-5.6",
      signal: controller.signal,
    });
    return Response.json(
      { ...result, mode: "live", model: process.env.OPENAI_MODEL ?? "gpt-5.6" },
      { headers: { ...noStoreHeaders, "x-intentform-quota-remaining": String(quota.remaining) } },
    );
  } catch {
    try {
      return Response.json(replay(), { headers: noStoreHeaders });
    } catch {
      return Response.json(
        { error: controller.signal.aborted ? "Repair planning timed out." : "No safe repair could be validated." },
        { status: 422, headers: noStoreHeaders },
      );
    }
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abortForClient);
  }
}
