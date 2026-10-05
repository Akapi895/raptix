/** A bounded typed HTTP boundary to the private Sliver gRPC bridge. */
import { ProjectApiError } from '../../services/projects-service.js';
export interface SliverConfig { apiUrl: string; apiKey: string }
export class SliverClient {
  public constructor(private readonly config: SliverConfig) {}
  public async call(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const signal = AbortSignal.timeout(body.op === 'sessions.execute' ? 100_000 : 25_000);
    try {
      const response = await fetch(new URL('/v1/c2', this.config.apiUrl), { method: 'POST', redirect: 'manual', signal,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!response.ok) { await response.body?.cancel(); throw new ProjectApiError([400,404,409].includes(response.status) ? response.status : 503, 'Sliver operation was not confirmed'); }
      if (!response.body) throw new ProjectApiError(503, 'Empty Sliver response');
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength;
        if (bytes > 524288) { await reader.cancel(); throw new ProjectApiError(503, 'Sliver response exceeded its limit'); } chunks.push(chunk.value); }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ProjectApiError(503, 'Invalid Sliver response');
      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof ProjectApiError) throw error;
      if (error instanceof TypeError || error instanceof SyntaxError || error instanceof DOMException) throw new ProjectApiError(503, 'Sliver provider is unreachable or returned an invalid response');
      throw error;
    }
  }
}
