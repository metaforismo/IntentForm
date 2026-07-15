import { GRAPH_LIMITS, semanticInterfaceGraphSchema } from "@intentform/semantic-schema";
import { z } from "zod";

export const API_BODY_LIMIT_BYTES = 512_000;
export const LOCAL_PROJECT_BODY_LIMIT_BYTES = GRAPH_LIMITS.maxSerializedBytes + 256_000;

const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const platformTarget = z.enum(["react", "swiftui", "expo", "compose", "web"]);

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
  target: platformTarget,
  screenId: identifier,
  severity: z.enum(["info", "warning", "error"]),
  violatedIntent: boundedText(1_000),
  evidence: z.array(verificationEvidenceSchema).max(32),
  responsibleLayer: z.enum(["graph", "tokens", "compiler"]),
  status: z.enum(["open", "repaired", "verified", "suppressed"]),
  rule: z.object({
    id: identifier,
    version: z.string().min(1).max(40),
    standard: boundedText(80),
    profileId: identifier,
  }).strict().optional(),
  suppressionReason: boundedText(500).optional(),
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
    target: platformTarget,
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

export const projectMigrationRequestSchema = z.object({
  expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

const historyBranchName = z.string().min(1).max(63).regex(/^[a-z][a-z0-9-]{0,62}$/).refine((name) => name !== "main");
const historyOperationId = z.string().uuid();
const historyDirection = z.enum(["cherry-pick", "revert"]);
const graphFingerprintSchema = z.string().regex(/^[a-f0-9]{8}$/);

export const historyMutationRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create-branch"), name: historyBranchName }).strict(),
  z.object({ action: z.literal("preview-merge"), name: historyBranchName }).strict(),
  z.object({ action: z.literal("merge-branch"), name: historyBranchName, expectedFingerprint: graphFingerprintSchema }).strict(),
  z.object({ action: z.literal("delete-branch"), name: historyBranchName }).strict(),
  z.object({ action: z.literal("preview-operation"), operationId: historyOperationId, direction: historyDirection }).strict(),
  z.object({ action: z.literal("apply-operation"), operationId: historyOperationId, direction: historyDirection, expectedFingerprint: graphFingerprintSchema }).strict(),
  z.object({ action: z.literal("recover-history") }).strict(),
]);

export const transactionReviewMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("commit"),
    transactionId: z.string().uuid(),
    expectedPreviewFingerprint: graphFingerprintSchema,
  }).strict(),
  z.object({
    action: z.literal("reject"),
    transactionId: z.string().uuid(),
    expectedPreviewFingerprint: graphFingerprintSchema,
  }).strict(),
]);

const previewTargetSchema = z.enum(["browser", "expo-ios", "expo-android", "swiftui"]);
const previewMutationFields = {
  target: previewTargetSchema,
  expectedGraphFingerprint: z.string().regex(/^[a-f0-9]{8}$/),
  profileId: z.string().min(1).max(160).regex(/^(?:device|web):[a-z][a-z0-9.-]*$/).optional(),
} as const;

export const previewMutationRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), ...previewMutationFields }).strict(),
  z.object({ action: z.literal("restart"), ...previewMutationFields }).strict(),
  z.object({ action: z.literal("cancel"), ...previewMutationFields }).strict(),
]);

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
  maximumBytes = API_BODY_LIMIT_BYTES,
): Promise<T> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumBytes) {
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
      if (bytesRead > maximumBytes) {
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

  try {
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host");
    const authorityUrl = host ? new URL(`${requestUrl.protocol}//${host}`) : requestUrl;
    const hostname = authorityUrl.hostname.toLowerCase().replace(/\.$/, "");
    if (hostname !== "localhost" && hostname !== "127.0.0.1" && hostname !== "[::1]" && hostname !== "::1") {
      return false;
    }

    const origin = request.headers.get("origin");
    if (origin) {
      const allowedOrigins = new Set([requestUrl.origin, authorityUrl.origin]);
      if (!allowedOrigins.has(new URL(origin).origin)) return false;
    }
  } catch {
    return false;
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}
