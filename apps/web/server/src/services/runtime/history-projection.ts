import { normalizedEventKey } from '@raptix/streaming';
import type { ThreadHistoryEvent } from '@raptix/web-contracts';
import type { StreamScope } from '@raptix/web-contracts';
import { projectCustomPayload, projectStreamFrame } from './stream-projection.js';

/**
 * Durable checkpoint transcript history (W09).
 *
 * `values.subagent_transcripts` accumulates opaque events across every run on
 * the thread; the producer records no run identity, so every entry stays
 * thread-level (`runId: null`) and is never attributed to an active run.
 * Identity uses the shared normalizer's provenance key: tool/question ids
 * first, then the emitter `created_at` stamp; entries without either keep
 * `key: null` and merge by occurrence order only. Producer-capped results end
 * with the `…[truncated]` marker and surface `truncated: true` so a client
 * never mistakes a capped replay for full output.
 */
const transcriptLimit = 500;
const marker = '…[truncated]';
/**
 * `sidecar` is the newest page of the durable transcript store; `older` says events exist before that page. Without
 * it the function reads the legacy `values.subagent_transcripts` channel, which only old checkpoints still carry.
 */
export function projectThreadHistory(scope: StreamScope, values: Record<string, unknown>, sidecar?: { events: readonly unknown[]; older: boolean }): { transcripts: ThreadHistoryEvent[]; transcriptsTruncated: boolean } {
  const raw = sidecar ? sidecar.events : values.subagent_transcripts;
  const recent = Array.isArray(raw) ? raw.slice(-transcriptLimit) : [];
  const transcripts: ThreadHistoryEvent[] = [];
  const seen = new Set<string>();
  let lossy = (raw !== undefined && (!Array.isArray(raw) || raw.length > transcriptLimit)) || (sidecar?.older ?? false);
  if (Array.isArray(values.messages)) {
    lossy ||= values.messages.length > transcriptLimit;
    const events = projectStreamFrame(scope, { event: 'values', data: JSON.stringify({ messages: values.messages.slice(-transcriptLimit) }) }, 'checkpoint-history');
    for (const event of events) {
      if (event.payload.type !== 'tool_call' && event.payload.type !== 'tool_result') continue;
      transcripts.push({ key: event.eventId, runId: null, source: 'checkpoint', truncated: event.payload.truncated, payload: event.payload });
    }
  }
  for (const entry of recent) {
    const payload = projectCustomPayload(entry);
    if (!payload) { lossy = true; continue; }
    const key = normalizedEventKey(payload);
    if (key !== null && seen.has(key)) continue;
    if (key !== null) seen.add(key);
    const truncated = payload.truncated || (payload.content !== undefined && payload.content.endsWith(marker));
    transcripts.push({ key, runId: null, source: 'checkpoint', truncated, payload });
  }
  return { transcripts: transcripts.slice(-transcriptLimit), transcriptsTruncated: lossy || transcripts.length > transcriptLimit };
}
