import { describe, expect, it } from 'vitest';
import { RuntimeUnavailableError } from '../src/integrations/runtime/read-client.js';
import { RunService } from '../src/services/runtime/run-service.js';

const binding = (threadId: string) => ({ engagementId: 'eng', threadId, assistantId: 'decepticon', kind: 'execution' as const, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' });

const LEDGER_A = {
  'dispatch-recon': { fingerprint: 'f1', role: 'recon', objective_id: 'OBJ-001', attempt: 1, outcome: { status: 'success', terminal_for_this_dispatch: false } },
  'dispatch-legacy': { fingerprint: 'f2', objective_id: null, attempt: 2, outcome: { status: 'error', terminal_for_this_dispatch: true } },
  'dispatch-bad-attempt': { fingerprint: 'f3', role: 'recon', attempt: 0, outcome: { status: 'success' } },
};

function serviceWith(reads: Record<string, () => Promise<{ values: Record<string, unknown>; tasks: unknown; graphId: string | null }>>, bindings: ReturnType<typeof binding>[]) {
  return new RunService({
    ownership: {
      listBindings: async (user: string, engagement: string) => (user === 'local' && engagement === 'eng' ? bindings : []),
      runs: async () => [],
    } as unknown as ConstructorParameters<typeof RunService>[0]['ownership'],
    context: {} as ConstructorParameters<typeof RunService>[0]['context'],
    runtime: {} as ConstructorParameters<typeof RunService>[0]['runtime'],
    reads: {
      state: async (thread: string) => {
        const read = reads[thread];
        if (!read) throw new Error(`no state fixture for ${thread}`);
        return read();
      },
    } as unknown as ConstructorParameters<typeof RunService>[0]['reads'],
  });
}

describe('RunService.listInstances (P10b roster from the dispatch ledger)', () => {
  it('lists the instances of each bound thread, keeps legacy rows role-less, and skips rows without a valid attempt', async () => {
    const service = serviceWith({
      'thread-a': async () => ({ values: { dispatch_ledger: LEDGER_A }, tasks: [], graphId: 'decepticon' }),
      'thread-b': async () => ({ values: { dispatch_ledger: { 'dispatch-exploit': { fingerprint: 'f4', role: 'exploit', objective_id: 'OBJ-002', attempt: 1, outcome: { status: 'success', terminal_for_this_dispatch: false } } } }, tasks: [], graphId: 'decepticon' }),
    }, [binding('thread-a'), binding('thread-b')]);

    const view = await service.listInstances('local', 'eng');

    expect(view.engagementId).toBe('eng');
    expect(view.source).toBe('runtime');
    expect(view.instances.map((i) => i.instanceId)).toEqual([
      'thread-a:dispatch-legacy:2',
      'thread-a:dispatch-recon:1',
      'thread-b:dispatch-exploit:1',
    ]);
    expect(view.instances[0]).toMatchObject({ role: null, objectiveId: null, outcome: 'error', terminal: true, source: 'dispatch_ledger' });
    expect(view.instances[1]).toMatchObject({ role: 'recon', objectiveId: 'OBJ-001', outcome: 'success', terminal: false, attempt: 1 });
    expect(view.threads).toEqual([
      { threadId: 'thread-a', read: 'read', reason: null },
      { threadId: 'thread-b', read: 'read', reason: null },
    ]);
  });

  it('names a thread the runtime cannot read as unavailable instead of showing it as empty', async () => {
    const service = serviceWith({
      'thread-a': async () => ({ values: { dispatch_ledger: LEDGER_A }, tasks: [], graphId: 'decepticon' }),
      'thread-b': async () => { throw new RuntimeUnavailableError(); },
    }, [binding('thread-a'), binding('thread-b')]);

    const view = await service.listInstances('local', 'eng');

    expect(view.instances.some((i) => i.threadId === 'thread-b')).toBe(false);
    expect(view.threads.find((t) => t.threadId === 'thread-b')).toMatchObject({ read: 'unavailable' });
    expect(view.threads.find((t) => t.threadId === 'thread-a')).toMatchObject({ read: 'read' });
  });

  it('returns no instances to a caller with no binding on the engagement', async () => {
    const service = serviceWith({ 'thread-a': async () => ({ values: { dispatch_ledger: LEDGER_A }, tasks: [], graphId: 'decepticon' }) }, [binding('thread-a')]);
    expect(await service.listInstances('intruder', 'eng')).toEqual({ engagementId: 'eng', instances: [], threads: [], source: 'runtime' });
  });
});
