import { describe, expect, it } from "vitest";
import { stashBootNotice, takeBootNotice, STUDIO_BOOT_NOTICE_KEY } from "./boot-notice";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    setItem: (key: string, value: string) => void values.set(key, value),
    getItem: (key: string) => values.get(key) ?? null,
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

describe("studio boot notice", () => {
  it("stashes a restore failure and hands it to the launcher exactly once", () => {
    const storage = memoryStorage();
    stashBootNotice(storage, "The selected project could not be opened.");
    expect(takeBootNotice(storage)).toBe("The selected project could not be opened.");
    expect(takeBootNotice(storage)).toBeNull();
    expect(storage.values.has(STUDIO_BOOT_NOTICE_KEY)).toBe(false);
  });

  it("bounds oversized messages and ignores blank ones", () => {
    const storage = memoryStorage();
    stashBootNotice(storage, "x".repeat(2_000));
    expect(takeBootNotice(storage)).toHaveLength(500);
    stashBootNotice(storage, "   ");
    expect(takeBootNotice(storage)).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const throwing = {
      setItem: () => { throw new Error("quota"); },
      getItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(() => stashBootNotice(throwing, "message")).not.toThrow();
    expect(takeBootNotice(throwing)).toBeNull();
  });
});
