import { describe, expect, it } from "vitest";
import {
  advanceJudgeSession,
  createJudgeSession,
  judgeDeepLink,
  judgeStep,
  parseJudgeDeepLink,
  parseJudgeSession,
  selectJudgeStep,
  totalJudgeDurationSeconds,
} from "./judge-mode";

describe("Judge Mode", () => {
  it("only enables on an explicit deep link and validates the requested step", () => {
    expect(parseJudgeDeepLink("?judge=1&step=verify")).toEqual({ enabled: true, step: "verify" });
    expect(parseJudgeDeepLink("?judge=false&step=code")).toEqual({ enabled: false, step: "code" });
    expect(parseJudgeDeepLink("?judge=yes&step=unknown")).toEqual({ enabled: true, step: "design" });
  });

  it("restores only bounded session data while honoring the deep-linked step", () => {
    const restored = parseJudgeSession(JSON.stringify({
      version: 1,
      activeStep: "code",
      completed: ["design", "design", "unknown", 42],
    }), "verify");
    expect(restored).toEqual({ version: 1, activeStep: "verify", completed: ["design"] });
    expect(parseJudgeSession("not-json", "proof")).toEqual(createJudgeSession("proof"));
  });

  it("advances deterministically without duplicating completion", () => {
    let session = createJudgeSession();
    session = advanceJudgeSession(session);
    expect(session).toEqual({ version: 1, activeStep: "code", completed: ["design"] });
    session = selectJudgeStep(session, "design");
    session = advanceJudgeSession(session);
    expect(session.completed).toEqual(["design"]);
    expect(judgeStep(session.activeStep).stage).toBe("outputs");
  });

  it("keeps the complete guided journey below five minutes", () => {
    expect(totalJudgeDurationSeconds()).toBeLessThan(300);
    expect(judgeDeepLink("proof")).toBe("/studio?judge=1&step=proof");
  });
});

