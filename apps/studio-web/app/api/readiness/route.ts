const repositoryApi = "https://api.github.com/repos/metaforismo/IntentForm";
const readmeApi = `${repositoryApi}/contents/README.md`;
const licenseApi = `${repositoryApi}/license`;

interface ReachabilityCheck {
  reachable: boolean;
  status: number | null;
  detail: string;
}

async function checkUrl(url: string, init?: RequestInit): Promise<ReachabilityCheck> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(4_000),
    });
    return {
      reachable: response.ok,
      status: response.status,
      detail: response.ok ? "Public endpoint responded successfully." : `Public endpoint returned HTTP ${response.status}.`,
    };
  } catch {
    return { reachable: false, status: null, detail: "Public endpoint did not respond within four seconds." };
  }
}

function configuredHttpsUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const publicDemoUrl = configuredHttpsUrl(process.env.NEXT_PUBLIC_SITE_URL);
  const demoVideoUrl = configuredHttpsUrl(process.env.NEXT_PUBLIC_DEMO_VIDEO_URL);
  const devpostUrl = configuredHttpsUrl(process.env.NEXT_PUBLIC_DEVPOST_URL);
  const githubRequest = {
    cache: "no-store" as const,
    headers: { accept: "application/vnd.github+json", "user-agent": "IntentForm-readiness-check" },
  };
  const [repository, readme, license, publicDemo] = await Promise.all([
    checkUrl(repositoryApi, githubRequest),
    checkUrl(readmeApi, githubRequest),
    checkUrl(licenseApi, githubRequest),
    publicDemoUrl
      ? checkUrl(publicDemoUrl, { method: "HEAD", cache: "no-store" })
      : Promise.resolve({ reachable: false, status: null, detail: "NEXT_PUBLIC_SITE_URL is not configured with an HTTPS URL." }),
  ]);

  return Response.json({
    checkedAt: new Date().toISOString(),
    repository,
    publicDemo: { ...publicDemo, url: publicDemoUrl },
    artifacts: {
      readme: readme.reachable,
      license: license.reachable,
      demoVideo: { configured: demoVideoUrl !== null, url: demoVideoUrl },
      devpost: { configured: devpostUrl !== null, url: devpostUrl },
    },
  }, {
    headers: { "cache-control": "private, max-age=60" },
  });
}
