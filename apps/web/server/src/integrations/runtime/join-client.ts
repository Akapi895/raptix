import { decodeSse, type SseFrame } from '@raptix/streaming';
import { RuntimeUnavailableError } from './read-client.js';
export interface JoinSubscription { frames: AsyncIterable<SseFrame>; close(): void }
export interface RuntimeJoinPort { open(threadId: string, runId: string, cursor: string, signal: AbortSignal): Promise<JoinSubscription> }
export class RuntimeJoinClient implements RuntimeJoinPort {
  public constructor(private readonly baseUrl: string, private readonly headerTimeoutMs = 5000) {}
  public async open(threadId: string, runId: string, cursor: string, signal: AbortSignal): Promise<JoinSubscription> {
    const controller = new AbortController();
    const abort = (): void => { controller.abort(); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, this.headerTimeoutMs);
    const close = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.abort(); };
    try {
      const response = await fetch(`${this.baseUrl}/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}/stream?cancel_on_disconnect=0`, { method: 'GET', headers: { accept: 'text/event-stream', 'Last-Event-ID': cursor }, signal: controller.signal, redirect: 'error' });
      clearTimeout(timer);
      if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) { await response.body?.cancel(); throw new RuntimeUnavailableError(); }
      return { frames: decodeSse(response.body), close };
    } catch { close(); throw new RuntimeUnavailableError(); }
  }
}
