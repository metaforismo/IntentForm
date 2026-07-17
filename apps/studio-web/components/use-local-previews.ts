"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildEvidenceState, PriorValidPreviewEvidence } from "@intentform/preview-daemon";

export const LOCAL_PREVIEW_TARGETS = ["browser", "expo-ios", "expo-android", "swiftui"] as const;
export type LocalPreviewTarget = typeof LOCAL_PREVIEW_TARGETS[number];
export type LocalPreviewAction = "start" | "restart" | "cancel";

export interface LocalPreviewManifest {
  runId: string;
  phase: "idle" | "queued" | "generating" | "building" | "ready" | "failed" | "cancelled" | "toolchain-missing";
  evidence: "not-run" | "generated" | "validated" | "built" | "render-verified" | "failed";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastVerifiedRevision: string | null;
  failure: { code: string; message: string } | null;
  logs: Array<{ at: string; stream: "system" | "stdout" | "stderr"; text: string }>;
  artifacts: Array<{ kind: string; path: string }>;
}

export interface LocalPreviewStatus {
  target: LocalPreviewTarget;
  phase: LocalPreviewManifest["phase"];
  evidence: LocalPreviewManifest["evidence"];
  freshness: "fresh" | "stale" | "not-run";
  buildStatus: "passed" | "failed" | "not-run";
  buildState: BuildEvidenceState;
  expectedBinding: {
    revisionFingerprint: string;
    graphDigest: string;
    compilerTarget: "react" | "web" | "expo" | "swiftui";
    compilerFingerprint: string;
    target: LocalPreviewTarget;
    profileId: string;
    profileChecksum: string;
    bindingKey: string;
  };
  manifest: LocalPreviewManifest | null;
  priorValidEvidence: PriorValidPreviewEvidence | null;
}

export interface UnavailableLocalPreview {
  target: LocalPreviewTarget;
  unavailable: true;
  message: string;
}

export type LocalPreviewEntry = LocalPreviewStatus | UnavailableLocalPreview;

interface PreviewResponse {
  fingerprint: string;
  targets: LocalPreviewEntry[];
}

function isPreviewResponse(input: unknown): input is PreviewResponse {
  if (!input || typeof input !== "object") return false;
  const value = input as { fingerprint?: unknown; targets?: unknown };
  return typeof value.fingerprint === "string" && Array.isArray(value.targets);
}

export function useLocalPreviews(input: {
  enabled: boolean;
  currentGraphFingerprint: string;
  profileId: string;
}) {
  const [response, setResponse] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<LocalPreviewTarget | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const responseRef = useRef<PreviewResponse | null>(null);

  const refresh = useCallback(async () => {
    if (!input.enabled) return;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    try {
      const query = new URLSearchParams({ profile: input.profileId });
      const result = await fetch(`/api/project/previews?${query.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await result.json();
      if (!result.ok || !isPreviewResponse(payload)) {
        const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
          ? payload.error
          : "Local preview evidence is unavailable.";
        throw new Error(message);
      }
      responseRef.current = payload;
      setResponse(payload);
      setError(null);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof Error ? caught.message : "Local preview evidence is unavailable.");
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null;
    }
  }, [input.enabled, input.profileId]);

  useEffect(() => {
    if (!input.enabled) {
      activeRequest.current?.abort();
      setResponse(null);
      responseRef.current = null;
      setError(null);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      await refresh();
      if (disposed) return;
      const active = responseRef.current?.targets.some((entry) => (
        !("unavailable" in entry)
        && ["queued", "generating", "building"].includes(entry.phase)
      ));
      timer = setTimeout(poll, active ? 1_000 : 5_000);
    };
    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      activeRequest.current?.abort();
    };
  }, [input.enabled, refresh]);

  const mutate = useCallback(async (action: LocalPreviewAction, target: LocalPreviewTarget) => {
    if (!input.enabled) return;
    setPendingTarget(target);
    setError(null);
    try {
      const result = await fetch("/api/project/previews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          target,
          expectedGraphFingerprint: input.currentGraphFingerprint,
          profileId: input.profileId,
        }),
      });
      const payload = await result.json() as { error?: unknown };
      if (!result.ok) throw new Error(typeof payload.error === "string" ? payload.error : "The local preview request failed.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The local preview request failed.");
    } finally {
      setPendingTarget(null);
    }
  }, [input.currentGraphFingerprint, input.enabled, input.profileId, refresh]);

  const byTarget = useMemo(() => Object.fromEntries(
    (response?.targets ?? []).map((entry) => [entry.target, entry]),
  ) as Partial<Record<LocalPreviewTarget, LocalPreviewEntry>>, [response]);
  const graphIsSaved = input.enabled
    && response?.fingerprint === input.currentGraphFingerprint;

  return {
    enabled: input.enabled,
    response,
    byTarget,
    error,
    pendingTarget,
    graphIsSaved,
    refresh,
    mutate,
  };
}

export type LocalPreviewsController = ReturnType<typeof useLocalPreviews>;
