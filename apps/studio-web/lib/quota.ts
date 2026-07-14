interface QuotaEntry {
  date: string;
  count: number;
}

const sessions = new Map<string, QuotaEntry>();
let globalEntry: QuotaEntry = { date: "", count: 0 };

const today = () => new Date().toISOString().slice(0, 10);

const limitFromEnv = (name: string, fallback: number) => {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
};

export function quotaIdentity(request: Request): string {
  const session = (request.headers.get("x-intentform-session") ?? "anonymous").slice(0, 128);
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const client = (forwarded || request.headers.get("x-real-ip") || "local").slice(0, 128);
  return `${client}:${session}`;
}

export function consumeQuota(sessionId: string): { allowed: boolean; remaining: number } {
  const date = today();
  const sessionLimit = limitFromEnv("INTENTFORM_SESSION_LIMIT", 8);
  const globalLimit = limitFromEnv("INTENTFORM_DAILY_BUDGET", 120);

  if (globalEntry.date !== date) globalEntry = { date, count: 0 };
  const current = sessions.get(sessionId);
  const session = current?.date === date ? current : { date, count: 0 };

  if (session.count >= sessionLimit || globalEntry.count >= globalLimit) {
    return { allowed: false, remaining: Math.max(0, sessionLimit - session.count) };
  }

  session.count += 1;
  globalEntry.count += 1;
  sessions.set(sessionId, session);
  return { allowed: true, remaining: sessionLimit - session.count };
}
