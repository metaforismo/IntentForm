import type { DesktopServiceId } from "./protocol.ts";
import { sanitizeDesktopText } from "./security.ts";

export interface DesktopManagedProcess {
  readonly pid: number | null;
  terminate(): Promise<void> | void;
  onExit(listener: (code: number | null) => void): void;
  onLog(listener: (text: string) => void): void;
}

export interface DesktopProcessLauncher {
  launch(service: DesktopServiceId): Promise<DesktopManagedProcess>;
}

export interface DesktopServiceSnapshot {
  id: DesktopServiceId;
  phase: "stopped" | "starting" | "ready" | "stopping" | "crashed";
  pid: number | null;
  restarts: number;
  message: string;
}

interface ServiceRecord extends DesktopServiceSnapshot {
  process: DesktopManagedProcess | null;
  generation: number;
  requested: boolean;
}

export class DesktopServiceSupervisor {
  readonly #records = new Map<DesktopServiceId, ServiceRecord>();
  readonly #listeners = new Set<() => void>();

  constructor(readonly launcher: DesktopProcessLauncher, readonly maxAutomaticRestarts = 1) {
    if (!Number.isSafeInteger(maxAutomaticRestarts) || maxAutomaticRestarts < 0 || maxAutomaticRestarts > 3) {
      throw new RangeError("Desktop services support zero to three automatic restarts.");
    }
    for (const id of ["studio", "mcp"] as const) {
      this.#records.set(id, { id, phase: "stopped", pid: null, restarts: 0, message: "Stopped", process: null, generation: 0, requested: false });
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  snapshots(): DesktopServiceSnapshot[] {
    return (["studio", "mcp"] as const).map((id) => {
      const { process: _process, generation: _generation, requested: _requested, ...snapshot } = this.#records.get(id)!;
      return snapshot;
    });
  }

  async start(id: DesktopServiceId): Promise<DesktopServiceSnapshot> {
    const record = this.#records.get(id)!;
    record.requested = true;
    if (["starting", "ready"].includes(record.phase)) return this.#snapshot(record);
    record.phase = "starting";
    record.message = "Starting";
    record.generation += 1;
    const generation = record.generation;
    this.#emit();
    try {
      const process = await this.launcher.launch(id);
      if (record.generation !== generation || !record.requested) {
        await process.terminate();
        return this.#snapshot(record);
      }
      record.process = process;
      record.pid = process.pid;
      record.phase = "ready";
      record.message = "Running";
      process.onLog((text) => {
        if (record.generation !== generation) return;
        const message = sanitizeDesktopText(text);
        if (message) { record.message = message; this.#emit(); }
      });
      process.onExit((code) => void this.#exited(record, generation, code));
      this.#emit();
      return this.#snapshot(record);
    } catch (error) {
      record.phase = "crashed";
      record.pid = null;
      record.message = sanitizeDesktopText(error instanceof Error ? error.message : "Service failed to start.");
      this.#emit();
      return this.#snapshot(record);
    }
  }

  async stop(id: DesktopServiceId): Promise<DesktopServiceSnapshot> {
    const record = this.#records.get(id)!;
    record.requested = false;
    record.generation += 1;
    const process = record.process;
    record.process = null;
    record.pid = null;
    if (!process) {
      record.phase = "stopped";
      record.message = "Stopped";
      this.#emit();
      return this.#snapshot(record);
    }
    record.phase = "stopping";
    record.message = "Stopping";
    this.#emit();
    try { await process.terminate(); } finally {
      record.phase = "stopped";
      record.message = "Stopped";
      this.#emit();
    }
    return this.#snapshot(record);
  }

  async restart(id: DesktopServiceId): Promise<DesktopServiceSnapshot> {
    await this.stop(id);
    const record = this.#records.get(id)!;
    record.restarts = 0;
    return this.start(id);
  }

  async stopAll(): Promise<void> {
    await Promise.all((["studio", "mcp"] as const).map((id) => this.stop(id)));
  }

  async #exited(record: ServiceRecord, generation: number, code: number | null): Promise<void> {
    if (record.generation !== generation) return;
    record.process = null;
    record.pid = null;
    if (!record.requested) {
      record.phase = "stopped";
      record.message = "Stopped";
      this.#emit();
      return;
    }
    if (record.restarts < this.maxAutomaticRestarts) {
      record.restarts += 1;
      record.phase = "crashed";
      record.message = `Exited with code ${code ?? "unknown"}; restarting ${record.restarts}/${this.maxAutomaticRestarts}.`;
      this.#emit();
      await this.start(record.id);
      return;
    }
    record.phase = "crashed";
    record.message = `Exited with code ${code ?? "unknown"}; automatic restart limit reached.`;
    this.#emit();
  }

  #snapshot(record: ServiceRecord): DesktopServiceSnapshot {
    const { process: _process, generation: _generation, requested: _requested, ...snapshot } = record;
    return snapshot;
  }

  #emit(): void { for (const listener of this.#listeners) listener(); }
}
