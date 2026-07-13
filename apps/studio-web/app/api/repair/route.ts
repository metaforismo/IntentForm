import { planDeterministicRepair } from "@intentform/repair-planner";
import { planRepairWithOpenAI } from "@intentform/repair-planner/openai";
import { parseGraph } from "@intentform/semantic-schema";
import type { VerificationFinding } from "@intentform/verifier";
import { consumeQuota } from "@/lib/quota";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { graph?: unknown; finding?: VerificationFinding };
  if (!body.finding) return Response.json({ error: "A verification finding is required." }, { status: 400 });

  const graph = parseGraph(body.graph);
  const sessionId = request.headers.get("x-intentform-session") ?? "anonymous";
  const quota = consumeQuota(sessionId);

  if (!process.env.OPENAI_API_KEY || !quota.allowed) {
    return Response.json({
      proposal: planDeterministicRepair(body.finding),
      mode: "replay",
      model: "deterministic-repair",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const proposal = await planRepairWithOpenAI({
      graph,
      finding: body.finding,
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL ?? "gpt-5.6",
      signal: controller.signal,
    });
    return Response.json({ proposal, mode: "live", model: process.env.OPENAI_MODEL ?? "gpt-5.6" });
  } catch {
    return Response.json({
      proposal: planDeterministicRepair(body.finding),
      mode: "replay",
      model: "deterministic-repair",
    });
  } finally {
    clearTimeout(timeout);
  }
}
