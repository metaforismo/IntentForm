import { homedir } from "node:os";

/**
 * Local API routes deliberately return generic client messages, but a
 * swallowed failure with no server trace is undiagnosable. This logs a
 * bounded, path-scrubbed line to the server console only.
 */
export function logServerFailure(scope: string, error: unknown): void {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  const scrubbed = raw
    .replaceAll(homedir(), "~")
    .replaceAll(process.cwd(), ".")
    .slice(0, 300);
  console.error(`[intentform] ${scope} failed — ${scrubbed}`);
}
