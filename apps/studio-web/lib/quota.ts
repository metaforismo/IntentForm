interface QuotaEntry {
  date: string;
  count: number;
}

const sessions = new Map<string, QuotaEntry>();
let globalEntry: QuotaEntry = { date: "", count: 0 };

/* The session key contains a client-supplied header, so an attacker rotating
   it must never grow this map without bound. Stale-date entries go first;
   after that the oldest tracked sessions are dropped (the global daily
   budget still caps total spend either way). */
const MAX_TRACKED_SESSIONS = 5_000;

function pruneSessions(date: string): void {
  if (sessions.size < MAX_TRACKED_SESSIONS) return;
  for (const [key, entry] of sessions) {
    if (entry.date !== date) sessions.delete(key);
  }
  while (sessions.size >= MAX_TRACKED_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
}

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
  pruneSessions(date);
  sessions.set(sessionId, session);
  return { allowed: true, remaining: sessionLimit - session.count };
}
