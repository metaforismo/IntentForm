import { describe, expect, it } from "vitest";
import {
  DEVICE_REGISTRY,
  customDeviceEntry,
  defaultDeviceConfiguration,
  deviceConfigurationSchema,
  deviceProfileChecksum,
  deviceProfileSchema,
  resolveDeviceConfiguration,
  sha256Hex,
} from "./index";

describe("device registry", () => {
  it("implements SHA-256 and stable profile checksums without a Node-only runtime", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(DEVICE_REGISTRY.every((entry) => entry.checksum === deviceProfileChecksum(entry.profile))).toBe(true);
  });

  it("resolves the versioned default registry with geometry and capabilities", () => {
    const resolved = resolveDeviceConfiguration(defaultDeviceConfiguration());
    expect(resolved.defaultProfile.id).toBe("neutral.phone.compact");
    expect(resolved.profiles).toHaveLength(12);
    expect(resolved.profiles.find((profile) => profile.id === "neutral.phone.regular")).toEqual(expect.objectContaining({
      safeArea: { top: 59, right: 0, bottom: 34, left: 0 },
      cutouts: [expect.objectContaining({ shape: "capsule" })],
    }));
    expect(resolved.profiles.find((profile) => profile.id === "neutral.tablet.split")?.capabilities).toContain("split-window");
    expect(resolved.profiles.find((profile) => profile.id === "precision.iphone-15-pro")).toEqual(expect.objectContaining({
      viewport: { width: 390, height: 844, scale: 3 },
      cutouts: [expect.objectContaining({ id: "dynamic-island" })],
    }));
    expect(resolved.profiles.find((profile) => profile.id === "precision.ipad.landscape")?.orientation).toBe("landscape");
    expect(resolved.profiles.find((profile) => profile.id === "precision.browser.desktop")?.viewport.width).toBe(1440);
  });

  it("accepts checksummed custom viewports and rejects tampering", () => {
    const entry = customDeviceEntry({
      id: "custom.review-window", version: "1.0.0", label: "Review window", platform: "neutral", family: "custom", orientation: "landscape",
      viewport: { width: 900, height: 600, scale: 1 }, safeArea: { top: 12, right: 12, bottom: 12, left: 12 }, corners: { radius: 12 }, cutouts: [],
      input: { touch: false, pointer: true, keyboard: true }, capabilities: ["pointer", "hardware-keyboard", "hover", "multi-window", "resizable"], textScale: 1.25,
      window: { mode: "floating", resizable: true },
    });
    const configuration = defaultDeviceConfiguration();
    configuration.profiles.push(entry);
    expect(resolveDeviceConfiguration(configuration).profiles.at(-1)?.id).toBe("custom.review-window");
    entry.profile.viewport.width = 901;
    expect(() => resolveDeviceConfiguration(configuration)).toThrow(/checksum mismatch/i);
  });

  it.each([
    [{ orientation: "landscape" }, /orientation/i],
    [{ safeArea: { top: 400, right: 0, bottom: 400, left: 0 } }, /usable viewport height/i],
    [{ cutouts: [{ id: "camera", shape: "circle", x: 370, y: 0, width: 20, height: 20 }] }, /inside the logical viewport/i],
  ])("rejects invalid geometry %o", (change, expected) => {
    const base = structuredClone(DEVICE_REGISTRY[0]!.profile) as Record<string, unknown>;
    Object.assign(base, change);
    expect(() => deviceProfileSchema.parse(base)).toThrow(expected);
  });

  it("fails closed for unknown versions, references, and checksums", () => {
    const version = defaultDeviceConfiguration();
    version.registryVersion = "2.0.0";
    expect(() => resolveDeviceConfiguration(version)).toThrow(/unsupported device registry version/i);
    const unknown = defaultDeviceConfiguration();
    const second = unknown.profiles[1]!;
    if (second.source === "registry") second.id = "neutral.missing";
    expect(() => resolveDeviceConfiguration(unknown)).toThrow(/unknown registry device profile/i);
    const checksum = defaultDeviceConfiguration();
    checksum.profiles[0]!.checksum = "0".repeat(64);
    expect(() => resolveDeviceConfiguration(checksum)).toThrow(/checksum mismatch/i);
  });

  it("accepts only explicit, checksummed and acknowledged local bezel references", () => {
    const configuration = defaultDeviceConfiguration();
    configuration.bezel = {
      packId: "local.official-pack",
      packVersion: "1.0.0",
      manifestChecksum: "a".repeat(64),
      deviceProfileId: "neutral.phone.compact",
      assetDigest: "b".repeat(64),
      acknowledgedLocalLicense: true,
    };
    expect(deviceConfigurationSchema.parse(configuration).bezel?.packId).toBe("local.official-pack");
    expect(() => deviceConfigurationSchema.parse({
      ...configuration,
      bezel: { ...configuration.bezel, acknowledgedLocalLicense: false },
    })).toThrow();
    expect(() => deviceConfigurationSchema.parse({
      ...configuration,
      bezel: { ...configuration.bezel, deviceProfileId: "neutral.missing" },
    })).toThrow(/unknown bezel device profile/i);
  });
});
