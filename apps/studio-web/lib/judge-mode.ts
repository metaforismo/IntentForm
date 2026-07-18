export const JUDGE_SESSION_KEY = "intentform-judge-session-v2";
export const LEGACY_JUDGE_SESSION_KEY = "intentform-judge-session-v1";

export type JudgePathId = "overview" | "hands-on";
export type JudgeStepId = "design" | "agent" | "code" | "parity" | "verify" | "proof";
export type JudgeStage = "canvas" | "outputs" | "verify" | "report";

export interface JudgeStep {
  id: JudgeStepId;
  stage: JudgeStage;
  title: string;
  summary: string;
  proof: string;
  concept: string;
  durationSeconds: number;
}

export interface JudgePath {
  id: JudgePathId;
  title: string;
  summary: string;
  steps: readonly JudgeStep[];
}

const overviewSteps: readonly JudgeStep[] = [
  { id: "design", stage: "canvas", title: "See one intent", summary: "Compare Aster Sound across desktop, tablet, and phone from one semantic page.", proof: "Responsive projections share one canonical graph while preserving device behavior.", concept: "Intent is canonical.", durationSeconds: 20 },
  { id: "agent", stage: "canvas", title: "Preview an agent transaction", summary: "Open a bounded playback change linked to its review comment without mutating the graph.", proof: "Agent work remains a reviewable transaction with exact scope and fingerprints.", concept: "The agent proposes a transaction.", durationSeconds: 15 },
  { id: "code", stage: "outputs", title: "Open generated code", summary: "Read generated Web output and follow stable node IDs back to the design.", proof: "Compiler artifacts are deterministic and linked to semantic source.", concept: "The compiler generates code.", durationSeconds: 15 },
  { id: "parity", stage: "outputs", title: "Verify runtime parity", summary: "Collect current Web runtime evidence for visibility, accessible names, order, bounds, and placement.", proof: "Runtime evidence is bound to graph, compiler, target, device, and state fingerprints.", concept: "Runtime evidence verifies the result.", durationSeconds: 20 },
  { id: "proof", stage: "report", title: "Review reproducible proof", summary: "Finish with the evidence boundary and reproducible report.", proof: "No account, API key, or persistent user project is required or modified.", concept: "Proof stays reproducible and bounded.", durationSeconds: 15 },
];

const handsOnSteps: readonly JudgeStep[] = [
  { id: "design", stage: "canvas", title: "Make a semantic edit", summary: "Inspect the verified payment flow and change intent through the typed editor.", proof: "Typed intent, layout, tokens, and device behavior share one graph.", concept: "Intent is canonical.", durationSeconds: 55 },
  { id: "agent", stage: "canvas", title: "Review an agent transaction", summary: "Preview, commit or reject, and revert a bounded proposed change.", proof: "Agent mutations never bypass semantic review or revision history.", concept: "The agent proposes a transaction.", durationSeconds: 45 },
  { id: "code", stage: "outputs", title: "Compile target output", summary: "Open generated React, Web, Expo, and SwiftUI source linked back to nodes.", proof: "Outputs are deterministic compiler artifacts, not screenshots or pasted templates.", concept: "The compiler generates code.", durationSeconds: 50 },
  { id: "verify", stage: "verify", title: "Verify and repair", summary: "Review device-aware findings, preview a repair, and keep mutation explicit.", proof: "Evidence stays bound to graph, target, device, state, and fingerprint.", concept: "Runtime evidence verifies the result.", durationSeconds: 65 },
  { id: "proof", stage: "report", title: "Review proof and reset", summary: "Inspect the report, revert the walkthrough, and leave user projects untouched.", proof: "Replay is clearly labeled and the whole journey works without a key or account.", concept: "Proof stays reproducible and bounded.", durationSeconds: 35 },
];

export const judgePaths: readonly JudgePath[] = [
  { id: "overview", title: "90-second overview", summary: "A guided product story using the original Aster Sound example.", steps: overviewSteps },
  { id: "hands-on", title: "4-minute hands-on", summary: "A complete edit, agent, compile, verify, repair, and reset workflow.", steps: handsOnSteps },
] as const;

export interface JudgeSession {
  version: 2;
  path: JudgePathId;
  activeStep: JudgeStepId;
  completed: JudgeStepId[];
}

export function isJudgePathId(value: string | null): value is JudgePathId {
  return judgePaths.some((path) => path.id === value);
}

export function judgeSteps(path: JudgePathId): readonly JudgeStep[] {
  return judgePaths.find((candidate) => candidate.id === path)?.steps ?? overviewSteps;
}

export function isJudgeStepId(path: JudgePathId, value: string | null): value is JudgeStepId {
  return judgeSteps(path).some((step) => step.id === value);
}

export function parseJudgeDeepLink(search: string): { enabled: boolean; path: JudgePathId; step: JudgeStepId } {
  const params = new URLSearchParams(search);
  const mode = params.get("judge")?.toLowerCase();
  const path = isJudgePathId(params.get("path")) ? params.get("path") as JudgePathId : "overview";
  const requestedStep = params.get("step");
  return {
    enabled: mode === "1" || mode === "true" || mode === "yes",
    path,
    step: isJudgeStepId(path, requestedStep) ? requestedStep : judgeSteps(path)[0]!.id,
  };
}

export function judgeStep(path: JudgePathId, id: JudgeStepId): JudgeStep {
  return judgeSteps(path).find((step) => step.id === id) ?? judgeSteps(path)[0]!;
}

export function createJudgeSession(path: JudgePathId = "overview", activeStep: JudgeStepId = judgeSteps(path)[0]!.id): JudgeSession {
  return { version: 2, path, activeStep: isJudgeStepId(path, activeStep) ? activeStep : judgeSteps(path)[0]!.id, completed: [] };
}

export function parseJudgeSession(value: string | null, fallbackPath: JudgePathId, fallbackStep: JudgeStepId): JudgeSession {
  if (!value) return createJudgeSession(fallbackPath, fallbackStep);
  try {
    const candidate = JSON.parse(value) as { version?: number; path?: unknown; activeStep?: unknown; completed?: unknown };
    const path = candidate.version === 1 ? "hands-on" : typeof candidate.path === "string" && isJudgePathId(candidate.path) ? candidate.path : fallbackPath;
    const requestedPath = fallbackPath;
    const completed = Array.isArray(candidate.completed)
      ? [...new Set(candidate.completed.filter((item): item is JudgeStepId => typeof item === "string" && isJudgeStepId(requestedPath, item)))]
      : [];
    return { version: 2, path: requestedPath, activeStep: isJudgeStepId(requestedPath, fallbackStep) ? fallbackStep : judgeSteps(requestedPath)[0]!.id, completed: path === requestedPath ? completed : [] };
  } catch {
    return createJudgeSession(fallbackPath, fallbackStep);
  }
}

export function selectJudgeStep(session: JudgeSession, next: JudgeStepId): JudgeSession {
  return isJudgeStepId(session.path, next) ? { ...session, activeStep: next } : session;
}

export function selectJudgePath(path: JudgePathId): JudgeSession {
  return createJudgeSession(path);
}

export function advanceJudgeSession(session: JudgeSession): JudgeSession {
  const steps = judgeSteps(session.path);
  const index = steps.findIndex((step) => step.id === session.activeStep);
  const completed = session.completed.includes(session.activeStep) ? session.completed : [...session.completed, session.activeStep];
  const next = steps[Math.min(index + 1, steps.length - 1)] ?? steps[0]!;
  return { ...session, activeStep: next.id, completed };
}

export function judgeDeepLink(path: JudgePathId, step: JudgeStepId): string {
  return `/studio?judge=1&path=${encodeURIComponent(path)}&step=${encodeURIComponent(step)}`;
}

export function totalJudgeDurationSeconds(path: JudgePathId): number {
  return judgeSteps(path).reduce((total, step) => total + step.durationSeconds, 0);
}
