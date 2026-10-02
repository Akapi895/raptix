import { ProjectApiError } from '../../services/projects-service.js';

export class RuntimeUnavailableError extends ProjectApiError {
  public constructor() { super(503, 'Runtime discovery or context verification is unavailable'); }
}
export class RuntimeRejectedError extends ProjectApiError {
  public constructor(statusCode: number) { super(statusCode, 'Runtime rejected the requested operation'); }
}
export interface RuntimeReadPort {
  catalog(): Promise<readonly string[]>;
  thread(id: string): Promise<{ thread_id: string; metadata: Record<string, unknown>; status?: string }>;
  state(id: string): Promise<{ values: Record<string, unknown>; graphId: string | null }>;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export class RuntimeReadClient implements RuntimeReadPort {
  public constructor(private readonly apiUrl: string, private readonly timeoutMs = 5000, private readonly mutationTimeoutMs = 15000) {}
  protected async read(endpoint: string, body?: unknown, mutation = false): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), mutation ? this.mutationTimeoutMs : this.timeoutMs);
    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), signal: controller.signal, redirect: 'error' });
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
          if (size > 2 * 1024 * 1024) throw new RuntimeUnavailableError();
          chunks.push(part.value);
        }
      } finally { await reader.cancel(); }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) { if (error instanceof RuntimeRejectedError) throw error; throw new RuntimeUnavailableError(); }
    finally { clearTimeout(timer); }
  }
  /** Bounded raw mutation returning status + parsed-or-null body (W11 cancel uses 204). */
  protected async raw(endpoint: string): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.mutationTimeoutMs);
    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, { method: 'POST', signal: controller.signal, redirect: 'error' });
      if ([400, 404, 409, 422].includes(response.status)) throw new RuntimeRejectedError(response.status === 422 ? 400 : response.status);
      if (!response.ok) throw new RuntimeUnavailableError();
      if (response.status === 204) return { status: 204, body: null };
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new RuntimeUnavailableError();
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
  public async thread(id: string): Promise<{ thread_id: string; metadata: Record<string, unknown>; status?: string }> {
    const value = await this.read(`/threads/${encodeURIComponent(id)}`);
    if (!record(value) || value.thread_id !== id || !record(value.metadata)) throw new RuntimeUnavailableError();
    return { thread_id: id, metadata: value.metadata, ...(typeof value.status === 'string' && value.status.length <= 64 ? { status: value.status } : {}) };
  }
  public async state(id: string): Promise<{ values: Record<string, unknown>; graphId: string | null }> {
    const value = await this.read(`/threads/${encodeURIComponent(id)}/state`);
    if (!record(value) || !record(value.values)) throw new RuntimeUnavailableError();
    return { values: value.values, graphId: record(value.metadata) && typeof value.metadata.graph_id === 'string' ? value.metadata.graph_id : null };
  }
}
