import { normalizedEventKey } from '@raptix/streaming';
import type { ThreadHistoryEvent } from '@raptix/web-contracts';
import type { StreamScope } from '@raptix/web-contracts';
import { projectCustomPayload } from './stream-projection.js';

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
export function projectThreadHistory(scope: StreamScope, values: Record<string, unknown>): { transcripts: ThreadHistoryEvent[]; transcriptsTruncated: boolean } {
  const raw = values.subagent_transcripts;
  if (raw === undefined) return { transcripts: [], transcriptsTruncated: false };
  if (!Array.isArray(raw)) return { transcripts: [], transcriptsTruncated: true };
  const recent = raw.slice(-transcriptLimit);
  const transcripts: ThreadHistoryEvent[] = [];
  const seen = new Set<string>();
  let lossy = raw.length > transcriptLimit;
  for (const entry of recent) {
    const payload = projectCustomPayload(entry);
    if (!payload) { lossy = true; continue; }
    const key = normalizedEventKey(payload);
    if (key !== null && seen.has(key)) continue;
    if (key !== null) seen.add(key);
    const truncated = payload.truncated || (payload.content !== undefined && payload.content.endsWith(marker));
    transcripts.push({ key, runId: null, source: 'checkpoint', truncated, payload });
  }
  return { transcripts, transcriptsTruncated: lossy };
}
