import { semanticInterfaceGraphSchema } from "@intentform/semantic-schema";
import { z } from "zod";

export const API_BODY_LIMIT_BYTES = 512_000;

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const interpretRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("create"),
    brief: boundedText(12_000),
  }).strict(),
  z.object({
    operation: z.literal("edit"),
    brief: boundedText(12_000),
    graph: semanticInterfaceGraphSchema,
    screenId: identifier.optional(),
  }).strict(),
]);

const verificationEvidenceSchema = z.object({
  kind: z.enum(["viewport", "node", "build", "rule", "screenshot", "bounds", "accessibility"]),
  label: boundedText(160),
  value: z.union([z.string().max(500), z.number().finite(), z.boolean()]),
}).strict();

export const verificationFindingSchema = z.object({
  id: identifier,
  target: z.enum(["react", "swiftui"]),
  screenId: identifier,
  severity: z.enum(["info", "warning", "error"]),
  violatedIntent: boundedText(1_000),
  evidence: z.array(verificationEvidenceSchema).max(32),
  responsibleLayer: z.enum(["graph", "tokens", "compiler"]),
  status: z.enum(["open", "repaired", "verified"]),
}).strict();

const repairEvidenceSchema = z.object({
  screenshotPath: z.string().max(300).optional(),
  bounds: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().nonnegative(),
    height: z.number().finite().nonnegative(),
  }).strict().optional(),
  build: z.object({
    passed: z.boolean(),
    diagnostics: z.array(z.string().max(500)).max(20),
  }).strict().optional(),
}).strict();

export const repairRequestSchema = z.object({
  graph: semanticInterfaceGraphSchema,
  finding: verificationFindingSchema,
  scenario: z.object({
    target: z.enum(["react", "swiftui"]),
    viewport: z.object({
      width: z.number().int().positive().max(10_000),
      height: z.number().int().positive().max(10_000),
    }).strict(),
  }).strict(),
  evidence: repairEvidenceSchema.optional(),
}).strict();

export const projectSaveRequestSchema = z.object({
  graph: semanticInterfaceGraphSchema,
  reason: boundedText(160).optional(),
  expectedFingerprint: z.string().regex(/^[a-f0-9]{8}$/),
}).strict();

export class ApiInputError extends Error {
  constructor(
    readonly status: 400 | 413 | 422,
    message: string,
  ) {
    super(message);
    this.name = "ApiInputError";
  }
}

export async function parseRequestBody<T>(
  request: Request,
  schema: z.ZodType<T>,
  invalidMessage: string,
): Promise<T> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > API_BODY_LIMIT_BYTES) {
    throw new ApiInputError(413, "The request body is too large.");
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let source = "";
  let bytesRead = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > API_BODY_LIMIT_BYTES) {
        await reader.cancel();
        throw new ApiInputError(413, "The request body is too large.");
      }
      source += decoder.decode(value, { stream: true });
    }
    source += decoder.decode();
  }

  let input: unknown;
  try {
    input = JSON.parse(source);
  } catch {
    throw new ApiInputError(400, "The request body must be valid JSON.");
  }

  const result = schema.safeParse(input);
  if (!result.success) throw new ApiInputError(422, invalidMessage);
  return result.data;
}

export function inputErrorResponse(error: unknown): Response | null {
  if (!(error instanceof ApiInputError)) return null;
  return Response.json(
    { error: error.message },
    { status: error.status, headers: { "cache-control": "no-store" } },
  );
}

export function isLocalProjectRequestAllowed(request: Request): boolean {
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) return false;
  if (process.env.NODE_ENV === "production" && process.env.INTENTFORM_ENABLE_LOCAL_PROJECT_API !== "1") return false;

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      if (new URL(origin).origin !== new URL(request.url).origin) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
