export const JUDGE_SESSION_KEY = "intentform-judge-session-v1";

export type JudgeStepId = "design" | "code" | "verify" | "proof";
export type JudgeStage = "canvas" | "outputs" | "verify" | "report";

export interface JudgeStep {
  id: JudgeStepId;
  stage: JudgeStage;
  title: string;
  summary: string;
  proof: string;
  durationSeconds: number;
}

export const judgeSteps: readonly JudgeStep[] = [
  {
    id: "design",
    stage: "canvas",
    title: "Inspect intent",
    summary: "Explore the responsive semantic canvas and select the payment action.",
    proof: "Typed intent, layout, tokens, and device behavior share one graph.",
    durationSeconds: 55,
  },
  {
    id: "code",
    stage: "outputs",
    title: "Read native output",
    summary: "Open generated React, Web, Expo, and SwiftUI source linked back to nodes.",
    proof: "Outputs are deterministic compiler artifacts, not screenshots or pasted templates.",
    durationSeconds: 60,
  },
  {
    id: "verify",
    stage: "verify",
    title: "Verify and repair",
    summary: "Review device-aware findings, preview a repair, and keep mutation explicit.",
    proof: "Evidence stays bound to graph, target, device, state, and fingerprint.",
    durationSeconds: 70,
  },
  {
    id: "proof",
    stage: "report",
    title: "Review proof",
    summary: "Finish with the reproducible report and native build evidence.",
    proof: "Replay is clearly labeled and the whole journey works without a key or account.",
    durationSeconds: 45,
  },
] as const;

export interface JudgeSession {
  version: 1;
  activeStep: JudgeStepId;
  completed: JudgeStepId[];
}

export function isJudgeStepId(value: string | null): value is JudgeStepId {
  return judgeSteps.some((step) => step.id === value);
}

export function parseJudgeDeepLink(search: string): { enabled: boolean; step: JudgeStepId } {
  const params = new URLSearchParams(search);
  const mode = params.get("judge")?.toLowerCase();
  const requestedStep = params.get("step");
  return {
    enabled: mode === "1" || mode === "true" || mode === "yes",
    step: isJudgeStepId(requestedStep) ? requestedStep : "design",
  };
}

export function judgeStep(id: JudgeStepId): JudgeStep {
  return judgeSteps.find((step) => step.id === id) ?? judgeSteps[0]!;
}

export function createJudgeSession(activeStep: JudgeStepId = "design"): JudgeSession {
  return { version: 1, activeStep, completed: [] };
}

export function parseJudgeSession(value: string | null, fallbackStep: JudgeStepId): JudgeSession {
  if (!value) return createJudgeSession(fallbackStep);
  try {
    const candidate = JSON.parse(value) as Partial<JudgeSession>;
    if (candidate.version !== 1 || !isJudgeStepId(candidate.activeStep ?? null)) return createJudgeSession(fallbackStep);
    const completed = Array.isArray(candidate.completed)
      ? [...new Set(candidate.completed.filter((item): item is JudgeStepId => typeof item === "string" && isJudgeStepId(item)))]
      : [];
    return { version: 1, activeStep: fallbackStep, completed };
  } catch {
    return createJudgeSession(fallbackStep);
  }
}

export function selectJudgeStep(session: JudgeSession, next: JudgeStepId): JudgeSession {
  return { ...session, activeStep: next };
}

export function advanceJudgeSession(session: JudgeSession): JudgeSession {
  const index = judgeSteps.findIndex((step) => step.id === session.activeStep);
  const completed = session.completed.includes(session.activeStep)
    ? session.completed
    : [...session.completed, session.activeStep];
  const next = judgeSteps[Math.min(index + 1, judgeSteps.length - 1)] ?? judgeSteps[0]!;
  return { ...session, activeStep: next.id, completed };
}

export function judgeDeepLink(step: JudgeStepId): string {
  return `/studio?judge=1&step=${encodeURIComponent(step)}`;
}

export function totalJudgeDurationSeconds(): number {
  return judgeSteps.reduce((total, step) => total + step.durationSeconds, 0);
}
