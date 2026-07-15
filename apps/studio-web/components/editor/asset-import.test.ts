import { describe, expect, it } from "vitest";
import { allocateAssetId } from "./asset-import";

describe("asset import client", () => {
  it("allocates stable safe ids without colliding", () => {
    const assets = [
      { id: "asset.client-logo" },
      { id: "asset.client-logo-2" },
    ];
    expect(allocateAssetId(assets, " Client Logo.PNG")).toBe("asset.client-logo-3");
    expect(allocateAssetId([], "🔥.svg")).toBe("asset.asset");
  });
});
