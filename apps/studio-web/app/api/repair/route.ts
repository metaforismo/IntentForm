import { planDeterministicRepair } from "@intentform/repair-planner";
import { planRepairWithOpenAI, type RepairEvidencePacket } from "@intentform/repair-planner/openai";
import { parseGraph } from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { consumeQuota, quotaIdentity } from "@/lib/quota";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { graph?: unknown; finding?: VerificationFinding; evidence?: RepairEvidencePacket };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }
  if (!body.finding) return Response.json({ error: "A verification finding is required." }, { status: 400 });

  let graph;
  try {
    graph = parseGraph(body.graph);
  } catch {
    return Response.json({ error: "A valid graph is required." }, { status: 422 });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const quota = apiKey ? consumeQuota(quotaIdentity(request)) : { allowed: true, remaining: 0 };
  const replay = () => ({
    proposal: planDeterministicRepair(body.finding!),
    mode: "replay" as const,
    model: "deterministic-repair",
    trace: { requestId: "replay.repair", requestFingerprint: "redacted", attempts: 0 },
  });

  if (!apiKey || !quota.allowed) {
    try {
      return Response.json(replay(), {
        headers: { "cache-control": "no-store", "x-intentform-quota-remaining": String(quota.remaining) },
      });
    } catch {
      return Response.json({ error: "No safe deterministic repair exists for this finding." }, { status: 422 });
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const result = await planRepairWithOpenAI({
      graph,
      finding: body.finding,
      ...(body.evidence ? { evidence: body.evidence } : {}),
      apiKey,
      model: process.env.OPENAI_MODEL ?? "gpt-5.6",
      signal: controller.signal,
    });
    return Response.json(
      { ...result, mode: "live", model: process.env.OPENAI_MODEL ?? "gpt-5.6" },
      { headers: { "cache-control": "no-store", "x-intentform-quota-remaining": String(quota.remaining) } },
    );
  } catch {
    try {
      return Response.json(replay(), { headers: { "cache-control": "no-store" } });
    } catch {
      return Response.json(
        { error: controller.signal.aborted ? "Repair planning timed out." : "No safe repair could be validated." },
        { status: 422, headers: { "cache-control": "no-store" } },
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}
