import type { RuntimeRun, RuntimeTransport } from "../../src/adapters/runtime/client.js";
import type { RuntimeEvent } from "../../src/adapters/runtime/stream.js";
import { RuntimeRejectedError } from '../../src/adapters/runtime/errors.js';

/**
 * Scriptable RuntimeTransport fake. Tests push the run statuses `getRun`
 * should return in order (so a route's poll loop can be driven through
 * "running" -> "success" without timers), and set `stateValues` for
 * `getThreadState`.
 */
export class FakeRuntime implements RuntimeTransport {
  public specialistCatalog: unknown = { specialist_id: 'recon', builtins: { tools: [], skills: [], skill_sources: [], behavior: 'Reconnaissance' }, tools: [], skills: [], servers: [] };
  /** Optional per-specialist catalogs; consulted by `specialist_id` before the shared fallback. */
  public specialistCatalogs: Record<string, unknown> = {};
  public async specialistRequest(path: string, body?: unknown): Promise<unknown> {
    if (path.endsWith('/validate')) {
      const selection = (body as { additions: { tools: string[]; skills: string[]; mcp: string[] } }).additions;
      const catalog = this.specialistCatalog as { tools: { id: string }[]; skills: { id: string }[]; servers: { tools: { id: string }[] }[] };
      if (selection.tools.some(id => !catalog.tools.some(t => t.id === id)) || selection.skills.some(id => !catalog.skills.some(s => s.id === id)) || selection.mcp.some(id => !catalog.servers.some(s => s.tools.some(t => t.id === id)))) throw new RuntimeRejectedError(400);
      return { valid: true };
    }
    if (path.includes('/catalog?specialist_id=')) {
      const id = decodeURIComponent(path.split('specialist_id=')[1] ?? '');
      if (id in this.specialistCatalogs) return this.specialistCatalogs[id]!;
    }
    return this.specialistCatalog;
  }
  public createdThreads: string[] = [];
  public createdRuns: { threadId: string; assistantId: string; input: Record<string, unknown>; config?: Record<string, unknown> }[] = [];
  public cancelledRuns: { threadId: string; runId: string }[] = [];
  public stateValues: Record<string, unknown> = {};
  public streamEvents: RuntimeEvent[] = [];
  public streamConfigs: Record<string, unknown>[] = [];
  public joinEvents: RuntimeEvent[] = [];
  public joinedRuns: { threadId: string; runId: string }[] = [];
  private runStatusQueue: string[] = ["success"];
  private activeRuns = new Map<string, RuntimeRun>();
  public graphIds: readonly string[] = ["raptix"];
  public pingError: Error | undefined;

  public queueRunStatuses(...statuses: string[]): void {
    this.runStatusQueue = statuses;
  }

  public async ping(): Promise<{ version: string; graphIds: readonly string[] }> {
    if (this.pingError) throw this.pingError;
    return { version: "test", graphIds: this.graphIds };
  }

  public async createThread(
    threadId: string,
  ): Promise<{ threadId: string; metadata: Record<string, unknown> }> {
    this.createdThreads.push(threadId);
    return { threadId, metadata: {} };
  }

  public async getThread(
    threadId: string,
  ): Promise<{ threadId: string; metadata: Record<string, unknown>; status?: string }> {
    return { threadId, metadata: {} };
  }

  public async getThreadState(_threadId: string): Promise<{ values: Record<string, unknown>; tasks: unknown[] }> {
    return { values: this.stateValues, tasks: [] };
  }

  public async createRun(
    threadId: string,
    assistantId: string,
    input: Record<string, unknown>,
    _requestId: string,
    config?: Record<string, unknown>,
  ): Promise<RuntimeRun> {
    this.createdRuns.push({ threadId, assistantId, input, config });
    const status = this.runStatusQueue.shift() ?? "success";
    const run: RuntimeRun = {
      runId: `run-${this.createdRuns.length}`,
      threadId,
      status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };
    this.activeRuns.set(run.runId, run);
    return run;
  }

  public async getRun(threadId: string, runId: string): Promise<RuntimeRun> {
    const next = this.runStatusQueue.shift() ?? this.activeRuns.get(runId)?.status ?? "success";
    const run: RuntimeRun = {
      runId,
      threadId,
      status: next,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {},
    };
    this.activeRuns.set(runId, run);
    return run;
  }

  public async listRuns(_threadId: string): Promise<RuntimeRun[]> {
    return [...this.activeRuns.values()];
  }

  public async cancelRun(threadId: string, runId: string): Promise<void> {
    this.cancelledRuns.push({ threadId, runId });
    const run = this.activeRuns.get(runId);
    if (run) this.activeRuns.set(runId, { ...run, status: "interrupted" });
  }

  public async *streamRun(threadId: string, assistantId: string, input: Record<string, unknown>, config: Record<string, unknown>): AsyncGenerator<RuntimeEvent> {
    this.streamConfigs.push(config);
    const run = await this.createRun(threadId, assistantId, input, "stream-test");
    yield { event: "metadata", data: { run_id: run.runId } };
    yield* this.streamEvents;
  }

  public async *joinRun(threadId: string, runId: string): AsyncGenerator<RuntimeEvent> {
    this.joinedRuns.push({ threadId, runId });
    yield* this.joinEvents;
  }
}

/** Always throws RuntimeUnavailableError -- used to test the "runtime down" error path. */
export class UnavailableRuntime implements RuntimeTransport {
  public specialistRequest = () => this.fail();
  private async fail(): Promise<never> {
    const { RuntimeUnavailableError } = await import("../../src/adapters/runtime/errors.js");
    throw new RuntimeUnavailableError("test: runtime unavailable");
  }
  public ping = () => this.fail();
  public createThread = () => this.fail();
  public getThread = () => this.fail();
  public getThreadState = () => this.fail();
  public createRun = () => this.fail();
  public getRun = () => this.fail();
  public listRuns = () => this.fail();
  public cancelRun = () => this.fail();
  public async *streamRun(): AsyncGenerator<RuntimeEvent> { yield await this.fail(); }
  public async *joinRun(): AsyncGenerator<RuntimeEvent> { yield await this.fail(); }
}
