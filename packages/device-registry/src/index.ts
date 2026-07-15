import { z } from "zod";

export const DEVICE_REGISTRY_VERSION = "1.0.0" as const;
export const DEVICE_PROFILE_CAPABILITIES = [
  "safe-area",
  "cutout",
  "touch",
  "pointer",
  "hardware-keyboard",
  "hover",
  "text-scale",
  "split-window",
  "multi-window",
  "resizable",
] as const;

const profileIdSchema = z.string().min(1).max(96).regex(/^[a-z][a-z0-9.-]*$/);
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const checksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const dimensionSchema = z.number().int().positive().max(10_000);
const insetSchema = z.number().int().nonnegative().max(2_000);

export const deviceProfileSchema = z.strictObject({
  id: profileIdSchema,
  version: versionSchema,
  label: z.string().min(1).max(120),
  platform: z.enum(["neutral", "ios", "android"]),
  family: z.enum(["phone", "tablet", "window", "custom"]),
  orientation: z.enum(["portrait", "landscape"]),
  viewport: z.strictObject({
    width: dimensionSchema,
    height: dimensionSchema,
    scale: z.number().finite().positive().min(0.5).max(4),
  }),
  safeArea: z.strictObject({
    top: insetSchema,
    right: insetSchema,
    bottom: insetSchema,
    left: insetSchema,
  }),
  corners: z.strictObject({ radius: insetSchema }),
  cutouts: z.array(z.strictObject({
    id: profileIdSchema,
    shape: z.enum(["rectangle", "circle", "capsule"]),
    x: insetSchema,
    y: insetSchema,
    width: dimensionSchema,
    height: dimensionSchema,
  })).max(4),
  input: z.strictObject({
    touch: z.boolean(),
    pointer: z.boolean(),
    keyboard: z.boolean(),
  }),
  capabilities: z.array(z.enum(DEVICE_PROFILE_CAPABILITIES)).max(DEVICE_PROFILE_CAPABILITIES.length),
  textScale: z.number().finite().min(0.5).max(3).default(1),
  window: z.strictObject({
    mode: z.enum(["full", "split", "floating"]),
    resizable: z.boolean(),
  }),
}).superRefine((profile, context) => {
  const portrait = profile.viewport.height >= profile.viewport.width;
  if ((profile.orientation === "portrait") !== portrait) {
    context.addIssue({ code: "custom", path: ["orientation"], message: "Device orientation must match viewport geometry" });
  }
  if (profile.safeArea.left + profile.safeArea.right >= profile.viewport.width) {
    context.addIssue({ code: "custom", path: ["safeArea"], message: "Horizontal safe areas must leave usable viewport width" });
  }
  if (profile.safeArea.top + profile.safeArea.bottom >= profile.viewport.height) {
    context.addIssue({ code: "custom", path: ["safeArea"], message: "Vertical safe areas must leave usable viewport height" });
  }
  if (profile.corners.radius > Math.min(profile.viewport.width, profile.viewport.height) / 2) {
    context.addIssue({ code: "custom", path: ["corners", "radius"], message: "Corner radius cannot exceed half the shortest viewport side" });
  }
  const cutoutIds = new Set<string>();
  profile.cutouts.forEach((cutout, index) => {
    if (cutoutIds.has(cutout.id)) context.addIssue({ code: "custom", path: ["cutouts", index, "id"], message: `Duplicate cutout id: ${cutout.id}` });
    cutoutIds.add(cutout.id);
    if (cutout.x + cutout.width > profile.viewport.width || cutout.y + cutout.height > profile.viewport.height) {
      context.addIssue({ code: "custom", path: ["cutouts", index], message: "Cutout must stay inside the logical viewport" });
    }
  });
  if (new Set(profile.capabilities).size !== profile.capabilities.length) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "Device capabilities must be unique" });
  }
  if (profile.cutouts.length > 0 && !profile.capabilities.includes("cutout")) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "Profiles with cutouts must declare the cutout capability" });
  }
  if (profile.window.mode !== "full" && !profile.capabilities.includes("split-window") && !profile.capabilities.includes("multi-window")) {
    context.addIssue({ code: "custom", path: ["capabilities"], message: "Non-full windows must declare a windowing capability" });
  }
});

export type DeviceProfile = z.infer<typeof deviceProfileSchema>;

export const deviceProfileReferenceSchema = z.strictObject({
  source: z.literal("registry"),
  id: profileIdSchema,
  version: versionSchema,
  checksum: checksumSchema,
});

export const customDeviceProfileSchema = z.strictObject({
  source: z.literal("custom"),
  profile: deviceProfileSchema,
  checksum: checksumSchema,
}).superRefine((entry, context) => {
  if (!entry.profile.id.startsWith("custom.")) {
    context.addIssue({ code: "custom", path: ["profile", "id"], message: "Custom device profile ids must start with custom." });
  }
});

export const deviceProfileEntrySchema = z.discriminatedUnion("source", [
  deviceProfileReferenceSchema,
  customDeviceProfileSchema,
]);

export const deviceBezelReferenceSchema = z.strictObject({
  packId: profileIdSchema,
  packVersion: versionSchema,
  manifestChecksum: checksumSchema,
  deviceProfileId: profileIdSchema,
  assetDigest: checksumSchema,
  acknowledgedLocalLicense: z.literal(true),
});

export const deviceConfigurationSchema = z.strictObject({
  registryVersion: versionSchema,
  defaultProfile: profileIdSchema,
  profiles: z.array(deviceProfileEntrySchema).min(1).max(32),
  bezel: deviceBezelReferenceSchema.optional(),
}).superRefine((configuration, context) => {
  const ids = configuration.profiles.map((entry) => entry.source === "registry" ? entry.id : entry.profile.id);
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) context.addIssue({ code: "custom", path: ["profiles", index], message: `Duplicate device profile id: ${id}` });
    seen.add(id);
  });
  if (!seen.has(configuration.defaultProfile)) {
    context.addIssue({ code: "custom", path: ["defaultProfile"], message: `Unknown default device profile: ${configuration.defaultProfile}` });
  }
  if (configuration.bezel && !seen.has(configuration.bezel.deviceProfileId)) {
    context.addIssue({ code: "custom", path: ["bezel", "deviceProfileId"], message: `Unknown bezel device profile: ${configuration.bezel.deviceProfileId}` });
  }
});

export type DeviceProfileReference = z.infer<typeof deviceProfileReferenceSchema>;
export type DeviceBezelReference = z.infer<typeof deviceBezelReferenceSchema>;
export type DeviceConfiguration = z.infer<typeof deviceConfigurationSchema>;

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]));
  }
  return value;
}

export function sha256Hex(value: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ] as const;
  const input = new TextEncoder().encode(value);
  const byteLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(byteLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const view = new DataView(bytes.buffer);
  const bitLength = BigInt(input.length) * 8n;
  view.setUint32(byteLength - 8, Number(bitLength >> 32n), false);
  view.setUint32(byteLength - 4, Number(bitLength & 0xffffffffn), false);
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const rotate = (word: number, bits: number) => (word >>> bits) | (word << (32 - bits));
  for (let offset = 0; offset < byteLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15]!;
      const right = words[index - 2]!;
      const sigma0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const sigma1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e!, 6) ^ rotate(e!, 11) ^ rotate(e!, 25);
      const choose = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sum1 + choose + constants[index]! + words[index]!) >>> 0;
      const sum0 = rotate(a!, 2) ^ rotate(a!, 13) ^ rotate(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temporary1) >>> 0; d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a!) >>> 0;
    state[1] = (state[1]! + b!) >>> 0;
    state[2] = (state[2]! + c!) >>> 0;
    state[3] = (state[3]! + d!) >>> 0;
    state[4] = (state[4]! + e!) >>> 0;
    state[5] = (state[5]! + f!) >>> 0;
    state[6] = (state[6]! + g!) >>> 0;
    state[7] = (state[7]! + h!) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, "0")).join("");
}

export function deviceProfileChecksum(profile: DeviceProfile): string {
  return sha256Hex(JSON.stringify(canonicalValue(deviceProfileSchema.parse(profile))));
}

const registryProfiles = [
  {
    id: "neutral.phone.compact", version: "1.0.0", label: "Neutral compact phone", platform: "neutral", family: "phone", orientation: "portrait",
    viewport: { width: 375, height: 667, scale: 2 }, safeArea: { top: 24, right: 0, bottom: 18, left: 0 }, corners: { radius: 32 },
    cutouts: [], input: { touch: true, pointer: false, keyboard: false }, capabilities: ["safe-area", "touch", "text-scale"], textScale: 1,
    window: { mode: "full", resizable: false },
  },
  {
    id: "neutral.phone.regular", version: "1.0.0", label: "Neutral regular phone", platform: "neutral", family: "phone", orientation: "portrait",
    viewport: { width: 402, height: 874, scale: 3 }, safeArea: { top: 59, right: 0, bottom: 34, left: 0 }, corners: { radius: 44 },
    cutouts: [{ id: "sensor-island", shape: "capsule", x: 138, y: 11, width: 126, height: 37 }],
    input: { touch: true, pointer: false, keyboard: false }, capabilities: ["safe-area", "cutout", "touch", "text-scale"], textScale: 1,
    window: { mode: "full", resizable: false },
  },
  {
    id: "precision.iphone-15-pro", version: "1.0.0", label: "iPhone 15 Pro precision preview", platform: "ios", family: "phone", orientation: "portrait",
    viewport: { width: 390, height: 844, scale: 3 }, safeArea: { top: 59, right: 0, bottom: 34, left: 0 }, corners: { radius: 47 },
    cutouts: [{ id: "dynamic-island", shape: "capsule", x: 132, y: 11, width: 126, height: 37 }],
    input: { touch: true, pointer: false, keyboard: false }, capabilities: ["safe-area", "cutout", "touch", "text-scale"], textScale: 1,
    window: { mode: "full", resizable: false },
  },
  {
    id: "neutral.phone.landscape", version: "1.0.0", label: "Neutral phone landscape", platform: "neutral", family: "phone", orientation: "landscape",
    viewport: { width: 874, height: 402, scale: 3 }, safeArea: { top: 0, right: 59, bottom: 21, left: 59 }, corners: { radius: 44 },
    cutouts: [{ id: "sensor-island", shape: "capsule", x: 11, y: 138, width: 37, height: 126 }],
    input: { touch: true, pointer: false, keyboard: false }, capabilities: ["safe-area", "cutout", "touch", "text-scale"], textScale: 1,
    window: { mode: "full", resizable: false },
  },
  {
    id: "neutral.android.phone", version: "1.0.0", label: "Neutral Android phone", platform: "android", family: "phone", orientation: "portrait",
    viewport: { width: 412, height: 915, scale: 2.625 }, safeArea: { top: 32, right: 0, bottom: 24, left: 0 }, corners: { radius: 36 },
    cutouts: [{ id: "camera", shape: "circle", x: 194, y: 8, width: 24, height: 24 }],
    input: { touch: true, pointer: false, keyboard: false }, capabilities: ["safe-area", "cutout", "touch", "text-scale"], textScale: 1,
    window: { mode: "full", resizable: false },
  },
  {
    id: "precision.pixel-phone", version: "1.0.0", label: "Pixel precision preview", platform: "android", family: "phone", orientation: "portrait",
    viewport: { width: 412, height: 892, scale: 2.625 }, safeArea: { top: 32, right: 0, bottom: 24, left: 0 }, corners: { radius: 38 },
    cutouts: [{ id: "punch-hole-camera", shape: "circle", x: 194, y: 8, width: 24, height: 24 }],
    input: { touch: true, pointer: false, keyboard: false }, capabilities: ["safe-area", "cutout", "touch", "text-scale"], textScale: 1,
    window: { mode: "full", resizable: false },
  },
  {
    id: "neutral.tablet.regular", version: "1.0.0", label: "Neutral tablet", platform: "neutral", family: "tablet", orientation: "portrait",
    viewport: { width: 768, height: 1024, scale: 2 }, safeArea: { top: 24, right: 0, bottom: 20, left: 0 }, corners: { radius: 28 }, cutouts: [],
    input: { touch: true, pointer: true, keyboard: true }, capabilities: ["safe-area", "touch", "pointer", "hardware-keyboard", "hover", "text-scale", "multi-window"], textScale: 1,
    window: { mode: "full", resizable: true },
  },
  {
    id: "precision.ipad.portrait", version: "1.0.0", label: "iPad portrait precision preview", platform: "ios", family: "tablet", orientation: "portrait",
    viewport: { width: 820, height: 1180, scale: 2 }, safeArea: { top: 24, right: 0, bottom: 20, left: 0 }, corners: { radius: 24 }, cutouts: [],
    input: { touch: true, pointer: true, keyboard: true }, capabilities: ["safe-area", "touch", "pointer", "hardware-keyboard", "hover", "text-scale", "multi-window", "resizable"], textScale: 1,
    window: { mode: "full", resizable: true },
  },
  {
    id: "precision.ipad.landscape", version: "1.0.0", label: "iPad landscape precision preview", platform: "ios", family: "tablet", orientation: "landscape",
    viewport: { width: 1180, height: 820, scale: 2 }, safeArea: { top: 24, right: 0, bottom: 20, left: 0 }, corners: { radius: 24 }, cutouts: [],
    input: { touch: true, pointer: true, keyboard: true }, capabilities: ["safe-area", "touch", "pointer", "hardware-keyboard", "hover", "text-scale", "multi-window", "resizable"], textScale: 1,
    window: { mode: "full", resizable: true },
  },
  {
    id: "neutral.tablet.split", version: "1.0.0", label: "Neutral tablet split window", platform: "neutral", family: "window", orientation: "portrait",
    viewport: { width: 507, height: 1024, scale: 2 }, safeArea: { top: 24, right: 0, bottom: 20, left: 0 }, corners: { radius: 20 }, cutouts: [],
    input: { touch: true, pointer: true, keyboard: true }, capabilities: ["safe-area", "touch", "pointer", "hardware-keyboard", "hover", "text-scale", "split-window", "resizable"], textScale: 1,
    window: { mode: "split", resizable: true },
  },
  {
    id: "neutral.window.custom", version: "1.0.0", label: "Neutral custom viewport", platform: "neutral", family: "custom", orientation: "landscape",
    viewport: { width: 900, height: 700, scale: 1 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, corners: { radius: 12 }, cutouts: [],
    input: { touch: false, pointer: true, keyboard: true }, capabilities: ["pointer", "hardware-keyboard", "hover", "text-scale", "multi-window", "resizable"], textScale: 1,
    window: { mode: "floating", resizable: true },
  },
  {
    id: "precision.browser.desktop", version: "1.0.0", label: "Desktop browser precision preview", platform: "neutral", family: "window", orientation: "landscape",
    viewport: { width: 1440, height: 900, scale: 1 }, safeArea: { top: 0, right: 0, bottom: 0, left: 0 }, corners: { radius: 10 }, cutouts: [],
    input: { touch: false, pointer: true, keyboard: true }, capabilities: ["pointer", "hardware-keyboard", "hover", "text-scale", "multi-window", "resizable"], textScale: 1,
    window: { mode: "floating", resizable: true },
  },
] satisfies Array<z.input<typeof deviceProfileSchema>>;

export const DEVICE_REGISTRY = registryProfiles.map((input) => {
  const profile = deviceProfileSchema.parse(input);
  return { profile, checksum: deviceProfileChecksum(profile) };
});

export function defaultDeviceConfiguration(): DeviceConfiguration {
  return deviceConfigurationSchema.parse({
    registryVersion: DEVICE_REGISTRY_VERSION,
    defaultProfile: "neutral.phone.compact",
    profiles: DEVICE_REGISTRY.map(({ profile, checksum }) => ({ source: "registry", id: profile.id, version: profile.version, checksum })),
  });
}

export function customDeviceEntry(profileInput: z.input<typeof deviceProfileSchema>) {
  const profile = deviceProfileSchema.parse(profileInput);
  if (!profile.id.startsWith("custom.")) throw new Error("Custom device profile ids must start with custom.");
  return customDeviceProfileSchema.parse({ source: "custom", profile, checksum: deviceProfileChecksum(profile) });
}

export interface ResolvedDeviceConfiguration {
  defaultProfile: DeviceProfile;
  profiles: DeviceProfile[];
}

export function resolveDeviceConfiguration(input: unknown): ResolvedDeviceConfiguration {
  const configuration = deviceConfigurationSchema.parse(input);
  if (configuration.registryVersion !== DEVICE_REGISTRY_VERSION) {
    throw new Error(`Unsupported device registry version: ${configuration.registryVersion}`);
  }
  const registry = new Map(DEVICE_REGISTRY.map((entry) => [entry.profile.id, entry]));
  const profiles = configuration.profiles.map((entry) => {
    if (entry.source === "custom") {
      const actual = deviceProfileChecksum(entry.profile);
      if (actual !== entry.checksum) throw new Error(`Custom device profile checksum mismatch: ${entry.profile.id}`);
      return entry.profile;
    }
    const registered = registry.get(entry.id);
    if (!registered) throw new Error(`Unknown registry device profile: ${entry.id}`);
    if (registered.profile.version !== entry.version) throw new Error(`Device profile version mismatch: ${entry.id}`);
    if (registered.checksum !== entry.checksum) throw new Error(`Device profile checksum mismatch: ${entry.id}`);
    return registered.profile;
  });
  const defaultProfile = profiles.find((profile) => profile.id === configuration.defaultProfile);
  if (!defaultProfile) throw new Error(`Unknown default device profile: ${configuration.defaultProfile}`);
  return { defaultProfile, profiles };
}
