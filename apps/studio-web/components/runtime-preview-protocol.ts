import type { SemanticInterfaceGraph } from "@intentform/semantic-schema";

export const PREVIEW_REQUEST = "intentform.active-preview.request";
export const PREVIEW_READY = "intentform.active-preview.ready";
export const PREVIEW_STATUS = "intentform.active-preview.status";

export interface ActivePreviewRequest {
  type: typeof PREVIEW_REQUEST;
  fingerprint: string;
  graph: SemanticInterfaceGraph;
  selectedScreen: string;
}

export interface ActivePreviewReady {
  type: typeof PREVIEW_READY;
}

export interface ActivePreviewStatus {
  type: typeof PREVIEW_STATUS;
  fingerprint: string;
  status: "ready" | "error";
  message?: string;
}

export function isPreviewRequest(value: unknown): value is ActivePreviewRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ActivePreviewRequest>;
  return candidate.type === PREVIEW_REQUEST
    && typeof candidate.fingerprint === "string"
    && typeof candidate.selectedScreen === "string"
    && typeof candidate.graph === "object";
}
