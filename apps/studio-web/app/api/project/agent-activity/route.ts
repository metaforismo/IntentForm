import { readAgentActivity } from "@intentform/mcp-server/activity";
import {
  commitTransactionReview,
  readTransactionReviews,
  rejectTransactionReview,
  TransactionReviewBusyError,
} from "@intentform/mcp-server/transaction-reviews";
import { ProjectBusyError, ProjectConflictError, resolveProjectDir } from "@intentform/mcp-server/store";
import {
  inputErrorResponse,
  isLocalProjectRequestAllowed,
  parseRequestBody,
  transactionReviewMutationSchema,
} from "../../../../lib/api-contracts";

export const runtime = "nodejs";

const noStoreHeaders = { "cache-control": "no-store" };

function snapshot(dir: string) {
  return { ...readAgentActivity(dir), ...readTransactionReviews(dir) };
}

export async function GET(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) {
    return Response.json(
      { error: "Local agent activity is disabled in hosted or cross-origin contexts." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  const dir = resolveProjectDir();
  if (new URL(request.url).searchParams.get("stream") === "1") {
    const encoder = new TextEncoder();
    let interval: ReturnType<typeof setInterval> | null = null;
    let lifetime: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let previous = "";
        const publish = () => {
          if (closed) return;
          const next = JSON.stringify(snapshot(dir));
          if (next === previous) return;
          previous = next;
          controller.enqueue(encoder.encode(`data: ${next}\n\n`));
        };
        publish();
        interval = setInterval(publish, 750);
        lifetime = setTimeout(() => {
          if (closed) return;
          closed = true;
          if (interval) clearInterval(interval);
          controller.close();
        }, 25_000);
        request.signal.addEventListener("abort", () => {
          if (closed) return;
          closed = true;
          if (interval) clearInterval(interval);
          if (lifetime) clearTimeout(lifetime);
          try { controller.close(); } catch { /* The consumer already closed the stream. */ }
        }, { once: true });
      },
      cancel() {
        closed = true;
        if (interval) clearInterval(interval);
        if (lifetime) clearTimeout(lifetime);
      },
    });
    return new Response(stream, {
      headers: {
        ...noStoreHeaders,
        "content-type": "text/event-stream; charset=utf-8",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }
  return Response.json(snapshot(dir), { headers: noStoreHeaders });
}

export async function POST(request: Request) {
  if (!isLocalProjectRequestAllowed(request)) {
    return Response.json(
      { error: "Local agent transaction review is disabled in hosted or cross-origin contexts." },
      { status: 403, headers: noStoreHeaders },
    );
  }
  let body;
  try {
    body = await parseRequestBody(request, transactionReviewMutationSchema, "The transaction review action is invalid.");
  } catch (error) {
    return inputErrorResponse(error)
      ?? Response.json({ error: "The transaction review action could not be read." }, { status: 400, headers: noStoreHeaders });
  }
  try {
    const dir = resolveProjectDir();
    const result = body.action === "commit"
      ? commitTransactionReview(dir, body.transactionId, body.expectedPreviewFingerprint)
      : { review: rejectTransactionReview(dir, body.transactionId, body.expectedPreviewFingerprint), projectChanged: false };
    return Response.json(result, { headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ProjectConflictError) {
      return Response.json({ error: error.message, currentFingerprint: error.currentFingerprint }, { status: 409, headers: noStoreHeaders });
    }
    if (error instanceof ProjectBusyError || error instanceof TransactionReviewBusyError) {
      return Response.json({ error: error.message }, { status: 423, headers: noStoreHeaders });
    }
    const message = error instanceof Error ? error.message : "The transaction review action failed.";
    const status = /unknown|expired|already|fingerprint conflict/i.test(message) ? 409 : 422;
    return Response.json({ error: message.slice(0, 500) }, { status, headers: noStoreHeaders });
  }
}
