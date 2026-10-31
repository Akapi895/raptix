import type { RuntimeRun, RuntimeTransport } from "../../src/adapters/runtime/client.js";

/**
 * Scriptable RuntimeTransport fake. Tests push the run statuses `getRun`
 * should return in order (so a route's poll loop can be driven through
 * "running" -> "success" without timers), and set `stateValues` for
 * `getThreadState`.
 */
export class FakeRuntime implements RuntimeTransport {
  public createdThreads: string[] = [];
  public createdRuns: { threadId: string; assistantId: string; input: Record<string, unknown> }[] = [];
  public cancelledRuns: { threadId: string; runId: string }[] = [];
  public stateValues: Record<string, unknown> = {};
  private runStatusQueue: string[] = ["success"];
  private activeRuns = new Map<string, RuntimeRun>();

  public queueRunStatuses(...statuses: string[]): void {
    this.runStatusQueue = statuses;
  }

  public async ping(): Promise<{ version: string; graphIds: readonly string[] }> {
    return { version: "test", graphIds: ["raptix"] };
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
  ): Promise<RuntimeRun> {
    this.createdRuns.push({ threadId, assistantId, input });
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
}

/** Always throws RuntimeUnavailableError -- used to test the "runtime down" error path. */
export class UnavailableRuntime implements RuntimeTransport {
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
}
