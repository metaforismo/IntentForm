import { describe, expect, it } from "vitest";
import {
  advanceJudgeSession,
  createJudgeSession,
  judgeDeepLink,
  judgeStep,
  judgeSteps,
  parseJudgeDeepLink,
  parseJudgeSession,
  selectJudgePath,
  selectJudgeStep,
  totalJudgeDurationSeconds,
} from "./judge-mode";

describe("Judge Mode", () => {
  it("defaults explicit Judge links to the bounded overview and validates path-specific steps", () => {
    expect(parseJudgeDeepLink("?judge=1&step=parity")).toEqual({ enabled: true, path: "overview", step: "parity" });
    expect(parseJudgeDeepLink("?judge=true&path=hands-on&step=verify")).toEqual({ enabled: true, path: "hands-on", step: "verify" });
    expect(parseJudgeDeepLink("?judge=false&path=hands-on&step=code")).toEqual({ enabled: false, path: "hands-on", step: "code" });
    expect(parseJudgeDeepLink("?judge=yes&path=unknown&step=verify")).toEqual({ enabled: true, path: "overview", step: "design" });
  });

  it("restores only bounded session data while honoring the deep-linked path and step", () => {
    const restored = parseJudgeSession(JSON.stringify({
      version: 2,
      path: "overview",
      activeStep: "code",
      completed: ["design", "design", "unknown", 42],
    }), "overview", "parity");
    expect(restored).toEqual({ version: 2, path: "overview", activeStep: "parity", completed: ["design"] });
    expect(parseJudgeSession("not-json", "hands-on", "proof")).toEqual(createJudgeSession("hands-on", "proof"));
  });

  it("clears completion when switching paths and advances deterministically", () => {
    let session = createJudgeSession();
    session = advanceJudgeSession(session);
    expect(session).toEqual({ version: 2, path: "overview", activeStep: "agent", completed: ["design"] });
    session = selectJudgeStep(session, "design");
    session = advanceJudgeSession(session);
    expect(session.completed).toEqual(["design"]);
    expect(judgeStep(session.path, session.activeStep).stage).toBe("canvas");
    expect(selectJudgePath("hands-on")).toEqual(createJudgeSession("hands-on"));
  });

  it("keeps the overview below 90 seconds and hands-on path below five minutes", () => {
    expect(totalJudgeDurationSeconds("overview")).toBeLessThanOrEqual(90);
    expect(totalJudgeDurationSeconds("hands-on")).toBeLessThan(300);
    expect(judgeSteps("overview").map((step) => step.id)).toEqual(["design", "agent", "code", "parity", "proof"]);
    expect(judgeDeepLink("overview", "proof")).toBe("/studio?judge=1&path=overview&step=proof");
  });
});
