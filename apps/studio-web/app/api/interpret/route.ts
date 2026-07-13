import { interpretBrief } from "@intentform/intent-interpreter";
import { demoGraph } from "@intentform/proof-report/demo";
import { consumeQuota } from "@/lib/quota";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const sessionId = request.headers.get("x-intentform-session") ?? "anonymous";
  const quota = consumeQuota(sessionId);
  const body = (await request.json()) as { brief?: unknown };
  const brief = typeof body.brief === "string" ? body.brief.trim() : "";

  if (!brief) return Response.json({ error: "A product brief is required." }, { status: 400 });
  if (!quota.allowed) {
    return Response.json(
      {
        graph: demoGraph,
        mode: "replay",
        model: "deterministic-sample",
        note: "The live demo quota is exhausted. The complete reproducible sample remains available.",
      },
      { headers: { "x-intentform-quota-remaining": "0" } },
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const result = await interpretBrief({
      brief,
      fallbackGraph: demoGraph,
      ...(process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : {}),
      model: process.env.OPENAI_MODEL ?? "gpt-5.6",
      signal: controller.signal,
    });
    return Response.json(result, {
      headers: { "x-intentform-quota-remaining": String(quota.remaining) },
    });
  } catch (error) {
    return Response.json({
      graph: demoGraph,
      mode: "replay",
      model: "deterministic-sample",
      note: error instanceof Error
        ? `Live interpretation was unavailable: ${error.message}. Showing the reproducible sample.`
        : "Live interpretation was unavailable. Showing the reproducible sample.",
    });
  } finally {
    clearTimeout(timeout);
  }
}
