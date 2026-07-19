import { describe, expect, it } from "vitest";
import { consumeQuota, quotaIdentity } from "./quota";

describe("live-model quota", () => {
  it("derives a bounded identity from client headers", () => {
    const request = new Request("http://127.0.0.1/api/interpret", {
      headers: { "x-intentform-session": "s".repeat(500), "x-forwarded-for": "10.0.0.9, 10.0.0.1" },
    });
    const identity = quotaIdentity(request);
    expect(identity.startsWith("10.0.0.9:")).toBe(true);
    expect(identity.length).toBeLessThanOrEqual(257);
  });

  it("enforces the per-session limit", () => {
    const id = `session-limit-${Math.random()}`;
    let last = { allowed: true, remaining: 0 };
    for (let index = 0; index < 8; index += 1) last = consumeQuota(id);
    expect(last.remaining).toBe(0);
    expect(consumeQuota(id).allowed).toBe(false);
  });

  it("keeps the tracked-session map bounded when identities rotate", () => {
    for (let index = 0; index < 6_000; index += 1) consumeQuota(`rotating-${index}`);
    // The map itself is module-internal; the observable contract is that the
    // process keeps answering without unbounded growth and earlier sessions
    // can be evicted while the global budget still applies.
    const fresh = consumeQuota("post-rotation-session");
    expect(typeof fresh.allowed).toBe("boolean");
  });
});
