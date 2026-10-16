import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { SseFrame } from '@raptix/streaming';
import type { StreamScope } from '@raptix/web-contracts';
import type { RuntimeJoinPort, JoinSubscription } from '../../integrations/runtime/join-client.js';
import type { RunService } from './run-service.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { projectStreamFrame } from './stream-projection.js';

export function streamCursor(value: unknown): string {
  if (value === undefined) return '-1';
  if (typeof value !== 'string' || !/^(?:-1|[A-Za-z0-9][A-Za-z0-9_.:-]{0,199})$/.test(value)) throw new ProjectPolicyError('bad_request', 'Invalid stream replay cursor');
  return value;
}
const control = (type: 'stream_closed' | 'stream_error'): string => `event: control\ndata: ${JSON.stringify({ type, recoveryRequired: true })}\n\n`;
export class StreamService {
  public constructor(private readonly runs: Pick<RunService, 'getRun'>, private readonly join: RuntimeJoinPort, private readonly heartbeatMs = 15000) {}
  public async open(user: string, scope: StreamScope, cursor: unknown, signal: AbortSignal): Promise<Readable> {
    const position = streamCursor(cursor);
    await this.runs.getRun(user, scope.engagementId, scope.threadId, scope.runId);
    const subscription = await this.join.open(scope.threadId, scope.runId, position, signal);
    return Readable.from(this.publish(user, scope, subscription, signal));
  }
  /**
   * Authorization was verified once in `open()`; while the stream stays open
   * membership can be revoked, so authorization is re-attested on every
   * deadline, including during continuous traffic (heartbeat period = re-attestation period). A
   * refused re-attestation ends the stream with `stream_closed`
   * (recoveryRequired): the client reconciles from checkpoints and any
   * reconnect re-authorizes against the same policy.
   */
  private async *publish(user: string, scope: StreamScope, subscription: JoinSubscription, signal: AbortSignal): AsyncGenerator<string> {
    const iterator = subscription.frames[Symbol.asyncIterator]();
    const connection = randomUUID(); let sequence = 0;
    let pending: Promise<IteratorResult<SseFrame>> | undefined;
    let authorizeAt = Date.now() + this.heartbeatMs;
    try {
      yield ': connected\n\n';
      while (!signal.aborted) {
        pending ??= iterator.next();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const tick = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.max(0, authorizeAt - Date.now())); });
        let next: IteratorResult<SseFrame> | null;
        try { next = await Promise.race([pending, tick]); } finally { clearTimeout(timer); }
        if (!next || Date.now() >= authorizeAt) {
          try { await this.runs.getRun(user, scope.engagementId, scope.threadId, scope.runId); }
          catch { yield control('stream_closed'); return; }
          authorizeAt = Date.now() + this.heartbeatMs;
        }
        if (!next) { yield ': heartbeat\n\n'; continue; }
        pending = undefined;
        if (next.done) { yield control('stream_closed'); return; }
        const frame = next.value; sequence++;
        if (frame.id !== undefined) streamCursor(frame.id);
        const events = projectStreamFrame(scope, frame, `${connection}:${sequence}`);
        for (const event of events) yield `event: run-event\n${event.upstreamCursor === undefined ? '' : `id: ${event.upstreamCursor}\n`}data: ${JSON.stringify(event)}\n\n`;
        if (!events.length && frame.id !== undefined) yield `event: cursor\nid: ${frame.id}\ndata: ${JSON.stringify({ upstreamCursor: frame.id })}\n\n`;
      }
    } catch { if (!signal.aborted) yield control('stream_error'); }
    finally { subscription.close(); await iterator.return?.(); }
  }
}
