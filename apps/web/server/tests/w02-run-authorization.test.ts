import { describe, expect, it } from 'vitest';
import { RunService } from '../src/services/runtime/run-service.js';
import { RuntimeOwnershipService } from '../src/services/runtime-ownership.js';

/**
 * W02 regression: widening runtime reads to members must not widen mutations.
 * A cancel is a mutation and must run the operator authorization gate; a
 * read-only member reading a terminal run (which releases its own slot) must
 * still succeed.
 */

const META = { engagement_id: 'eng-1', ui_request_id: 'req-1', ui_assistant_id: 'raptix', graph_id: 'raptix', ui_flow: 'execution', runtime_context_hash: 'h' };

function harness(runStatus: string) {
  const calls = { authorize: 0, providerCancel: 0, release: 0 };
  const ownership = {
    runOwner: async () => ({ requestId: 'req-1', dispatchAssistantId: 'raptix', dispatchKind: 'execution', dispatchConfigHash: 'h' }),
    getBinding: async () => ({ kind: 'execution', assistantId: 'raptix', threadId: 'th-1', engagementId: 'eng-1', createdAt: '', updatedAt: '' }),
    releaseCompletedRun: async () => { calls.release += 1; },
  };
  const runtime = {
    run: async () => ({ status: runStatus, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', metadata: META }),
    cancelRun: async () => { calls.providerCancel += 1; },
  };
  const service = new RunService({
    ownership: ownership as never,
    context: {} as never,
    runtime: runtime as never,
    reads: { state: async () => ({ values: {}, graphId: null }) } as never,
    authorizeMutation: async () => { calls.authorize += 1; },
  });
  return { service, calls };
}

describe('W02 run mutation authorization', () => {
  it('runs the operator authorization gate before cancelling a run', async () => {
    const { service, calls } = harness('running');
    await service.cancelRun('viewer-9', 'eng-1', 'th-1', 'run-1');
    expect(calls.authorize).toBeGreaterThan(0);
    expect(calls.providerCancel).toBe(1);
  });

  it('does not consult the mutation gate for a read of a terminal run', async () => {
    const { service, calls } = harness('success');
    const view = await service.getRun('viewer-9', 'eng-1', 'th-1', 'run-1');
    expect(view.rawStatus).toBe('success');
    expect(calls.authorize).toBe(0);
    expect(calls.release).toBe(1);
  });
});

function ownershipDb(role: string) {
  const tx = {
    $queryRaw: async () => [{ id: 'eng-1' }],
    engagement: { findUniqueOrThrow: async () => ({ id: 'eng-1', userId: 'owner-1', name: 'slug', workspaceSlug: 'slug', targetType: 'web_url', targetValue: 'https://t.invalid', authorizationConfirmed: true }) },
    webMembership: { findFirst: async () => ({ engagementId: 'eng-1', userId: 'viewer-9', role }) },
    webRequestLedger: { updateMany: async () => ({ count: 1 }), findUnique: async () => null },
    engagementThread: { findFirst: async () => ({ threadId: 'th-1', engagementId: 'eng-1', assistantId: 'raptix', kind: 'execution', contextHash: 'x' }) },
  };
  return { $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx) };
}

describe('W02 runtime ownership role gates', () => {
  it('lets a viewer read a finite-state thread and release its own terminal slot', async () => {
    const ownership = new RuntimeOwnershipService(ownershipDb('viewer') as never);
    await expect(ownership.releaseCompletedRun('viewer-9', 'eng-1', 'request-0001', 'run-0001')).resolves.toBeUndefined();
    await expect(ownership.prepareBinding('viewer-9', 'eng-1', 'raptix', 'execution')).resolves.toBeTypeOf('string');
    await expect(ownership.replay('viewer-9', 'eng-1', 'request-0001', 'create_thread', {})).resolves.toBeNull();
  });

  it('still refuses a viewer mutation reservation', async () => {
    const ownership = new RuntimeOwnershipService(ownershipDb('viewer') as never);
    await expect(ownership.reserve('viewer-9', 'eng-1', 'request-0001', 'create_run', {}, 'th-1')).rejects.toMatchObject({ statusCode: 404 });
  });
});
