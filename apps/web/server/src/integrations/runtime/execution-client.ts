import { STREAM_OPTIONS } from '@raptix/streaming';
import type { TrustedRuntimeContext } from '../../services/runtime/runtime-context.js';
import { RuntimeReadClient, RuntimeUnavailableError } from './read-client.js';

export interface RuntimeRun {
  runId: string; threadId: string; status: string; createdAt: string; updatedAt: string
  metadata: Record<string, unknown>
}
export interface RuntimeExecutionPort {
  createThread(id: string, metadata: Record<string, string>, initial: TrustedRuntimeContext['configurable']): Promise<{ threadId: string; metadata: Record<string, unknown> }>;
  createRun(threadId: string, context: TrustedRuntimeContext, requestId: string, message: string): Promise<RuntimeRun>;
  /** W11 graph-interrupt resume: a new run carrying `command.resume`, never an input message. */
  createResumeRun(threadId: string, context: TrustedRuntimeContext, requestId: string, resume: string | string[] | Record<string, string | string[]>): Promise<RuntimeRun>;
  /** P11 continue: a new run on the same thread that resumes the latest checkpoint; it carries no input message. */
  continueRun(threadId: string, context: TrustedRuntimeContext, requestId: string): Promise<RuntimeRun>;
  /** W11 pause/cancel semantics: interrupt action keeps the checkpoint resumable. */
  cancelRun(threadId: string, runId: string): Promise<void>;
  run(threadId: string, runId: string): Promise<RuntimeRun>;
  listRuns(threadId: string, offset: number, limit: number): Promise<RuntimeRun[]>;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function run(value: unknown, threadId: string): RuntimeRun {
  if (!record(value) || value.thread_id !== threadId || typeof value.run_id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value.run_id) || typeof value.status !== 'string' || value.status.length > 64 || !record(value.metadata) || typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) || typeof value.updated_at !== 'string' || !Number.isFinite(Date.parse(value.updated_at))) throw new RuntimeUnavailableError();
  return { runId: value.run_id, threadId, status: value.status, createdAt: new Date(value.created_at).toISOString(), updatedAt: new Date(value.updated_at).toISOString(), metadata: value.metadata };
}
export class RuntimeExecutionClient extends RuntimeReadClient implements RuntimeExecutionPort {
  public async createThread(id: string, metadata: Record<string, string>, initial: TrustedRuntimeContext['configurable']): Promise<{ threadId: string; metadata: Record<string, unknown> }> {
    // Routing and credentials are sent per run, never persisted into thread state.
    const values = Object.fromEntries(Object.entries(initial).filter(([key]) => key !== 'sandbox_url' && key !== 'sandbox_token'));
    const v = await this.read('/threads', { thread_id: id, if_exists: 'raise', metadata, supersteps: [{ updates: [{ values, as_node: '__start__' }] }] }, true);
    if (!record(v) || v.thread_id !== id || !record(v.metadata)) throw new RuntimeUnavailableError();
    return { threadId: id, metadata: v.metadata };
  }
  public async createRun(threadId: string, context: TrustedRuntimeContext, requestId: string, message: string): Promise<RuntimeRun> {
    return run(await this.read(`/threads/${encodeURIComponent(threadId)}/runs`, {
      assistant_id: context.assistantId, input: { messages: [{ role: 'user', content: message }] },
      config: { configurable: context.configurable }, metadata: { ...context.metadata, ui_request_id: requestId },
      multitask_strategy: 'reject', if_not_exists: 'reject', stream_mode: STREAM_OPTIONS.streamMode,
      stream_subgraphs: STREAM_OPTIONS.streamSubgraphs, stream_resumable: STREAM_OPTIONS.streamResumable,
    }, true), threadId);
  }
  public async createResumeRun(threadId: string, context: TrustedRuntimeContext, requestId: string, resume: string | string[] | Record<string, string | string[]>): Promise<RuntimeRun> {
    return run(await this.read(`/threads/${encodeURIComponent(threadId)}/runs`, {
      assistant_id: context.assistantId, command: { resume },
      config: { configurable: context.configurable }, metadata: { ...context.metadata, ui_request_id: requestId },
      multitask_strategy: 'reject', if_not_exists: 'reject', stream_mode: STREAM_OPTIONS.streamMode,
      stream_subgraphs: STREAM_OPTIONS.streamSubgraphs, stream_resumable: STREAM_OPTIONS.streamResumable,
    }, true), threadId);
  }
  public async continueRun(threadId: string, context: TrustedRuntimeContext, requestId: string): Promise<RuntimeRun> {
    return run(await this.read(`/threads/${encodeURIComponent(threadId)}/runs`, {
      assistant_id: context.assistantId, input: null,
      config: { configurable: context.configurable }, metadata: { ...context.metadata, ui_request_id: requestId },
      multitask_strategy: 'reject', if_not_exists: 'reject', stream_mode: STREAM_OPTIONS.streamMode,
      stream_subgraphs: STREAM_OPTIONS.streamSubgraphs, stream_resumable: STREAM_OPTIONS.streamResumable,
    }, true), threadId);
  }
  public async cancelRun(threadId: string, runId: string): Promise<void> {
    await this.raw(`/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/cancel?wait=1&action=interrupt`);
  }
  public async run(threadId: string, runId: string): Promise<RuntimeRun> {
    const found = run(await this.read(`/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`), threadId);
    if (found.runId !== runId) throw new RuntimeUnavailableError();
    return found;
  }
  public async listRuns(threadId: string, offset: number, limit: number): Promise<RuntimeRun[]> {
    const rows = await this.read(`/threads/${encodeURIComponent(threadId)}/runs?offset=${offset}&limit=${limit}`);
    if (!Array.isArray(rows) || rows.length > limit) throw new RuntimeUnavailableError();
    return rows.map(row => run(row, threadId));
  }
}
