import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route.ts";

const originalProjectDir = process.env.INTENTFORM_PROJECT_DIR;
const roots: string[] = [];

afterEach(() => {
  if (originalProjectDir === undefined) delete process.env.INTENTFORM_PROJECT_DIR;
  else process.env.INTENTFORM_PROJECT_DIR = originalProjectDir;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("local ecosystem API", () => {
  it("returns secret-free, disabled-by-default local ecosystem state", async () => {
    const root = mkdtempSync(join(tmpdir(), "intentform-ecosystem-route-"));
    roots.push(root);
    process.env.INTENTFORM_PROJECT_DIR = root;
    const response = await GET(new Request("http://localhost/api/project/ecosystem"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      localFirst: true,
      compilersFetchPackages: false,
      executablePlugins: false,
      sync: { mode: "disabled", endpoint: null, keyOwnership: "client-managed" },
      packages: [],
    });
    expect(JSON.stringify(body)).not.toMatch(/privateKey|keyBase64|signature/);
  });

  it("reports capability but blocks hosted access before touching local files", async () => {
    const capability = await GET(new Request("https://studio.example/api/project/ecosystem?capability=1"));
    expect(await capability.json()).toEqual({ available: false });
    const blocked = await GET(new Request("https://studio.example/api/project/ecosystem"));
    expect(blocked.status).toBe(403);
    expect(await blocked.json()).toMatchObject({ error: expect.stringMatching(/disabled/i) });
  });
});
