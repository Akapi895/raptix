import { ProjectApiError } from '../../services/projects-service.js';

export class RuntimeUnavailableError extends ProjectApiError {
  public constructor() { super(503, 'Runtime discovery or context verification is unavailable'); }
}
export interface RuntimeReadPort {
  catalog(): Promise<readonly string[]>;
  thread(id: string): Promise<{ thread_id: string; metadata: Record<string, unknown> }>;
  state(id: string): Promise<{ values: Record<string, unknown>; graphId: string | null }>;
}
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export class RuntimeReadClient implements RuntimeReadPort {
  public constructor(private readonly apiUrl: string, private readonly timeoutMs = 5000) {}
  private async read(endpoint: string, body?: unknown): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, { method: body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), signal: controller.signal, redirect: 'error' });
      if (!response.ok || !response.body) throw new RuntimeUnavailableError();
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
    } catch { throw new RuntimeUnavailableError(); }
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
  public async thread(id: string): Promise<{ thread_id: string; metadata: Record<string, unknown> }> {
    const value = await this.read(`/threads/${encodeURIComponent(id)}`);
    if (!record(value) || value.thread_id !== id || !record(value.metadata)) throw new RuntimeUnavailableError();
    return { thread_id: id, metadata: value.metadata };
  }
  public async state(id: string): Promise<{ values: Record<string, unknown>; graphId: string | null }> {
    const value = await this.read(`/threads/${encodeURIComponent(id)}/state`);
    if (!record(value) || !record(value.values)) throw new RuntimeUnavailableError();
    return { values: value.values, graphId: record(value.metadata) && typeof value.metadata.graph_id === 'string' ? value.metadata.graph_id : null };
  }
}
