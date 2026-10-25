import { ProjectApiError } from '../../services/projects-service.js';

/** A thread read returns its whole checkpoint state, which grows with every run; the cap guards a runaway response, not normal growth. */
export const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
export class RuntimeUnavailableError extends ProjectApiError {
  public constructor() { super(503, 'Runtime discovery or context verification is unavailable'); }
}
export class RuntimeCheckpointMissingError extends ProjectApiError {
  public constructor() { super(503, 'Runtime checkpoint is missing for this previously used thread. Restore runtime state or create a new chat; history and resume cannot be verified.'); }
}
export class RuntimeRejectedError extends ProjectApiError {
  public constructor(statusCode: number) { super(statusCode, 'Runtime rejected the requested operation'); }
}
export interface RuntimeReadPort {
  catalog(): Promise<readonly string[]>;
  thread(id: string): Promise<{ thread_id: string; metadata: Record<string, unknown>; status?: string }>;
  state(id: string): Promise<{ values: Record<string, unknown>; tasks?: unknown; graphId: string | null }>;
  /** True only when the runtime answers 404 for the thread. Any other failure is unavailable, never "missing". */
  threadExists(id: string): Promise<boolean>;
  /** Sub-agent events recorded on the thread (newest page first, by exclusive sequence cursor `before`). */
  transcripts(id: string, before: number | null, limit: number): Promise<{ events: { seq: number; event: unknown }[]; oldestSeq: number | null }>;
  /** P10c operator mailbox: a refusal (409) is data the caller explains, never an error. */
  instanceExchange(method: 'GET' | 'POST', endpoint: string, body?: unknown): Promise<{ status: number; body: unknown }>;
}

/**
 * Every call to the runtime carries the runtime API token, which the LangGraph server checks (interfaces/api/auth.py).
 * Sandboxes never hold it, so a command inside a project sandbox cannot read or start runs of any project.
 */
export function withRuntimeAuth(init: RequestInit, token: string | undefined): RequestInit {
  if (token === undefined) return init;
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` } };
}

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export class RuntimeReadClient implements RuntimeReadPort {
  public constructor(private readonly apiUrl: string, private readonly timeoutMs = 15000, private readonly mutationTimeoutMs = 15000, private readonly apiToken?: string) {}
  /** Identical reads in flight share one request: a page load asks for the same thread state from several places at once. */
  private readonly inflight = new Map<string, Promise<unknown>>();
  protected read(endpoint: string, body?: unknown, mutation = false): Promise<unknown> {
    if (body !== undefined || mutation) return this.fetchJson(endpoint, body, mutation);
    const pending = this.inflight.get(endpoint);
    if (pending) return pending;
    const request = this.fetchJson(endpoint, body, mutation).finally(() => this.inflight.delete(endpoint));
    this.inflight.set(endpoint, request);
    return request;
  }
  private async fetchJson(endpoint: string, body?: unknown, mutation = false): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), mutation ? this.mutationTimeoutMs : this.timeoutMs);
    try {
      const init: RequestInit = { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), signal: controller.signal, redirect: 'error' };
      const response = await fetch(`${this.apiUrl}${endpoint}`, withRuntimeAuth(init, this.apiToken));
      if (mutation && [400, 404, 409, 422].includes(response.status)) throw new RuntimeRejectedError(response.status === 422 ? 400 : response.status);
      if (!response.ok) throw new RuntimeUnavailableError();
      if (response.status === 204) return null;
      if (!response.body) throw new RuntimeUnavailableError();
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > MAX_RESPONSE_BYTES) throw new RuntimeUnavailableError();
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error instanceof RuntimeRejectedError) throw error; throw new RuntimeUnavailableError(); }
    finally { clearTimeout(timer); }
  }
  public async instanceExchange(method: 'GET' | 'POST', endpoint: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.mutationTimeoutMs);
    try {
      const init: RequestInit = {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
        signal: controller.signal,
        redirect: 'error',
      };
      const response = await fetch(`${this.apiUrl}${endpoint}`, withRuntimeAuth(init, this.apiToken));
      if (![200, 409].includes(response.status)) throw new RuntimeUnavailableError();
      const text = await response.text();
      if (text.length > 64 * 1024) throw new RuntimeUnavailableError();
      return { status: response.status, body: text.length ? JSON.parse(text) : null };
    } catch { throw new RuntimeUnavailableError(); }
    finally { clearTimeout(timer); }
  }
  /** Bounded raw mutation returning status + parsed-or-null body (W11 cancel uses 204). */
  protected async raw(endpoint: string): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.mutationTimeoutMs);
    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, withRuntimeAuth({ method: 'POST', signal: controller.signal, redirect: 'error' }, this.apiToken));
      if ([400, 404, 409, 422].includes(response.status)) throw new RuntimeRejectedError(response.status === 422 ? 400 : response.status);
      if (!response.ok) throw new RuntimeUnavailableError();
      if (response.status === 204) return { status: 204, body: null };
      const text = await response.text();
      if (text.length > MAX_RESPONSE_BYTES) throw new RuntimeUnavailableError();
      return { status: response.status, body: text.length ? JSON.parse(text) : null };
    } catch (error) { if (error instanceof RuntimeRejectedError) throw error; throw new RuntimeUnavailableError(); }
    finally { clearTimeout(timer); }
  }
  public async catalog(): Promise<readonly string[]> {
    const info = await this.read('/info');
    if (!record(info) || typeof info.version !== 'string') throw new RuntimeUnavailableError();
    const graphs = new Set<string>();
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await this.read('/assistants/search', { limit: 100, offset });
      if (!Array.isArray(page) || !page.every(a => record(a) && typeof a.graph_id === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(a.graph_id))) throw new RuntimeUnavailableError();
      for (const assistant of page) graphs.add(assistant.graph_id);
      if (page.length < 100) return [...graphs].sort();
    }
    throw new RuntimeUnavailableError();
  }
  public async threadExists(id: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.apiUrl}/threads/${encodeURIComponent(id)}`, withRuntimeAuth({ signal: controller.signal, redirect: 'error' }, this.apiToken));
      await response.body?.cancel();
      if (response.status === 404) return false;
      if (!response.ok) throw new RuntimeUnavailableError();
      return true;
    } catch { throw new RuntimeUnavailableError(); }
    finally { clearTimeout(timer); }
  }
  public async transcripts(id: string, before: number | null, limit: number): Promise<{ events: { seq: number; event: unknown }[]; oldestSeq: number | null }> {
    const query = before === null ? `limit=${limit}` : `limit=${limit}&before=${before}`;
    const value = await this.read(`/_raptix/threads/${encodeURIComponent(id)}/transcripts?${query}`);
    if (!record(value) || value.threadId !== id || !Array.isArray(value.events)) throw new RuntimeUnavailableError();
    if (value.oldestSeq !== null && !Number.isInteger(value.oldestSeq)) throw new RuntimeUnavailableError();
    const events = value.events.map((row) => {
      if (!record(row) || !Number.isInteger(row.seq) || !record(row.event)) throw new RuntimeUnavailableError();
      return { seq: row.seq as number, event: row.event };
    });
    return { events, oldestSeq: value.oldestSeq as number | null };
  }
  public async thread(id: string): Promise<{ thread_id: string; metadata: Record<string, unknown>; status?: string }> {
    const value = await this.read(`/threads/${encodeURIComponent(id)}`);
    if (!record(value) || value.thread_id !== id || !record(value.metadata)) throw new RuntimeUnavailableError();
    return { thread_id: id, metadata: value.metadata, ...(typeof value.status === 'string' && value.status.length <= 64 ? { status: value.status } : {}) };
  }
  public async state(id: string): Promise<{ values: Record<string, unknown>; tasks: unknown; graphId: string | null }> {
    const value = await this.read(`/threads/${encodeURIComponent(id)}/state`);
    if (!record(value) || !record(value.values)) throw new RuntimeUnavailableError();
    return { values: value.values, tasks: Array.isArray(value.tasks) ? value.tasks : [], graphId: record(value.metadata) && typeof value.metadata.graph_id === 'string' ? value.metadata.graph_id : null };
  }
}
