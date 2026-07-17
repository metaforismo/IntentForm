import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const envKeys = ["NEXT_PUBLIC_SITE_URL", "NEXT_PUBLIC_DEMO_VIDEO_URL", "NEXT_PUBLIC_DEVPOST_URL"] as const;
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("submission readiness route", () => {
  it("checks only the fixed repository and configured HTTPS demo", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://intentform.example/demo";
    process.env.NEXT_PUBLIC_DEMO_VIDEO_URL = "https://video.example/watch";
    process.env.NEXT_PUBLIC_DEVPOST_URL = "https://devpost.com/software/intentform";
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.github.com/repos/metaforismo/IntentForm",
      "https://api.github.com/repos/metaforismo/IntentForm/contents/README.md",
      "https://api.github.com/repos/metaforismo/IntentForm/license",
      "https://intentform.example/demo",
    ]);
    expect(body.repository.reachable).toBe(true);
    expect(body.publicDemo).toMatchObject({ reachable: true, url: "https://intentform.example/demo" });
    expect(body.artifacts).toMatchObject({
      readme: true,
      license: true,
      demoVideo: { configured: true },
      devpost: { configured: true },
    });
  });

  it("labels missing or unsafe placeholders without probing them", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "http://127.0.0.1:4319";
    process.env.NEXT_PUBLIC_DEMO_VIDEO_URL = "not-a-url";
    delete process.env.NEXT_PUBLIC_DEVPOST_URL;
    const fetchMock = vi.fn(async (_url: string | URL | Request) => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET();
    const body = await response.json();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(body.repository.reachable).toBe(false);
    expect(body.publicDemo).toMatchObject({ reachable: false, url: null });
    expect(body.artifacts.demoVideo.configured).toBe(false);
    expect(body.artifacts.devpost.configured).toBe(false);
  });
});
