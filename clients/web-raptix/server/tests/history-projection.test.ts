import { describe, expect, it } from 'vitest';
import { projectThreadHistory } from '../src/services/runtime/history-projection.js';
import { RunService } from '../src/services/runtime/run-service.js';
import type { ThreadHistoryEvent } from '@raptix/web-contracts';

const scope = { engagementId: 'eng', threadId: 'thread', runId: 'run' };
const transcript = (event: Record<string, unknown>): { values: Record<string, unknown> } => ({ values: { subagent_transcripts: [event] } });

describe('projectThreadHistory', () => {
  it('keeps checkpoint history thread-level with stable provenance keys and full-vs-capped truth', () => {
    const { transcripts } = projectThreadHistory(scope, transcript({ type: 'subagent_tool_result', agent: 'recon', session_id: 's1', id: 'call-1', tool: 'nmap', created_at: '2026-10-02T00:00:00.000000+00:00', content: 'x'.repeat(8000) + '…[truncated]' }).values);
    expect(transcripts).toHaveLength(1);
    const entry = transcripts[0] as ThreadHistoryEvent;
    expect(entry.runId).toBeNull(); expect(entry.source).toBe('checkpoint'); expect(entry.truncated).toBe(true);
    expect(entry.key).toBe('s1::subagent_tool_result#call-1');
    expect(entry.payload.content).toHaveLength(8000 + '…[truncated]'.length);
  });
  it('deduplicates parallel branch duplicates by provenance key and keeps distinct identities', () => {
    const values = { subagent_transcripts: [
      { type: 'subagent_tool_result', agent: 'recon', session_id: 's1', id: 'call-1', tool: 'nmap', content: 'full output' },
      { type: 'subagent_tool_result', agent: 'recon', session_id: 's1', id: 'call-1', tool: 'nmap', content: 'full output' },
      { type: 'subagent_tool_result', agent: 'recon', session_id: 's1', id: 'call-2', tool: 'nmap', content: 'other output' },
    ] };
    const { transcripts } = projectThreadHistory(scope, values);
    expect(transcripts).toHaveLength(2);
    expect(new Set(transcripts.map(t => t.key))).toEqual(new Set(['s1::subagent_tool_result#call-1', 's1::subagent_tool_result#call-2']));
  });
  it('marks unprovable identity as null instead of inventing attribution', () => {
    const { transcripts } = projectThreadHistory(scope, transcript({ type: 'subagent_message', agent: 'recon', text: 'note' }).values);
    expect(transcripts[0]!.key).toBeNull(); expect(transcripts[0]!.runId).toBeNull();
  });
  it('bounds the window and flags lossy or malformed history', () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ type: 'subagent_message', agent: 'a', session_id: `s${i}`, created_at: `2026-10-02T00:00:0${i % 10}.${i}+00:00`, text: `m${i}` }));
    const boundedWindow = projectThreadHistory(scope, { subagent_transcripts: many });
    expect(boundedWindow.transcripts).toHaveLength(500);
    expect(boundedWindow.transcriptsTruncated).toBe(true);
    const malformed = projectThreadHistory(scope, { subagent_transcripts: [{ type: 'unknown' }, 42] });
    expect(malformed.transcripts).toHaveLength(0); expect(malformed.transcriptsTruncated).toBe(true);
    const clean = projectThreadHistory(scope, { subagent_transcripts: [] });
    expect(clean.transcripts).toHaveLength(0); expect(clean.transcriptsTruncated).toBe(false);
  });
  it('redacts credential-shaped content and argument keys in history payloads', () => {
    const { transcripts } = projectThreadHistory(scope, transcript({ type: 'subagent_tool_call', agent: 'recon', session_id: 's1', id: 'call-1', tool: 'curl', args: { api_key: 'SECRET-KEY', url: 'https://x' } }).values);
    expect(JSON.stringify(transcripts)).not.toContain('SECRET-KEY');
    expect(JSON.stringify(transcripts)).toContain('[redacted]');
  });
  it('treats a non-array channel as lossy rather than fabricating history', () => {
    const { transcripts, transcriptsTruncated } = projectThreadHistory(scope, { subagent_transcripts: { corrupted: true } });
    expect(transcripts).toHaveLength(0); expect(transcriptsTruncated).toBe(true);
  });
});

describe('RunService.listThreads selector feed', () => {
  const binding = { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning' as const, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
  const service = new RunService({
    ownership: { listBindings: async (user: string, engagement: string) => user === 'local' && engagement === 'eng' ? [binding] : [] } as unknown as ConstructorParameters<typeof RunService>[0]['ownership'],
    context: {} as ConstructorParameters<typeof RunService>[0]['context'],
    runtime: {} as ConstructorParameters<typeof RunService>[0]['runtime'],
    reads: {} as ConstructorParameters<typeof RunService>[0]['reads'],
  });
  it('returns only owner-scoped bindings in the scoped thread list view', async () => {
    const view = await service.listThreads('local', 'eng');
    expect(view).toEqual({ engagementId: 'eng', threads: [binding], source: 'runtime' });
    const foreign = await service.listThreads('intruder', 'eng');
    expect(foreign.threads).toEqual([]);
  });
});

describe('RunService.snapshot history attachment', () => {
  const binding = { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning' as const, createdAt: '2026-10-02T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' };
  const service = new RunService({
    ownership: { getBinding: async () => binding } as unknown as ConstructorParameters<typeof RunService>[0]['ownership'],
    context: { resolve: async () => ({}) } as unknown as ConstructorParameters<typeof RunService>[0]['context'],
    runtime: {} as ConstructorParameters<typeof RunService>[0]['runtime'],
    reads: {
      catalog: async () => [],
      thread: async () => ({ thread_id: 'thread', metadata: {}, status: 'success' }),
      state: async () => ({ values: {
        messages: [{ type: 'human', id: 'm1', content: 'Question' }, { type: 'ai', id: 'm2', content: 'Answer' }],
        subagent_transcripts: [{ type: 'subagent_end', agent: 'recon', session_id: 's1', created_at: '2026-10-02T00:00:01.000000+00:00', elapsed: 1.5, status: 'success' }],
      }, graphId: 'soundwave' }),
    },
  });
  it('attaches owned transcript history and provable message ids to the scoped thread view', async () => {
    const view = await service.snapshot('local', 'eng', 'thread');
    expect(view.transcripts).toHaveLength(1);
    expect(view.transcripts![0]).toMatchObject({ key: 's1::subagent_end@2026-10-02T00:00:01.000000+00:00', runId: null, source: 'checkpoint' });
    expect(view.messages.map(m => m.messageId)).toEqual(['m1', 'm2']);
    expect(view.transcriptsTruncated).toBe(false);
  });
});
