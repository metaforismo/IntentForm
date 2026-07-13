interface QuotaEntry {
  date: string;
  count: number;
}

const sessions = new Map<string, QuotaEntry>();
let globalEntry: QuotaEntry = { date: "", count: 0 };

const today = () => new Date().toISOString().slice(0, 10);

export function consumeQuota(sessionId: string): { allowed: boolean; remaining: number } {
  const date = today();
  const sessionLimit = Number(process.env.INTENTFORM_SESSION_LIMIT ?? 8);
  const globalLimit = Number(process.env.INTENTFORM_DAILY_BUDGET ?? 120);

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
