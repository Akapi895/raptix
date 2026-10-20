import { describe, expect, it, vi } from 'vitest';
import { RunService, type RunOperationPort } from '../src/services/runtime/run-service.js';
import { ProjectPolicyError } from '../src/security/project-policy.js';

type Options = ConstructorParameters<typeof RunService>[0];
const binding = { engagementId: 'eng', threadId: 'thread-1', assistantId: 'decepticon', kind: 'execution' as const, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
const row = { dispatchAssistantId: 'decepticon', dispatchKind: 'execution', dispatchConfigHash: 'a'.repeat(64), requestId: 'req-run-0001' };

interface Scenario {
  operation: string
  runStatus: string
  latestStatus: string
  instances?: { state: string }[]
}

/** An in-memory operation port: `transition` succeeds only from one of the expected states, like the database CAS. */
function operations(initial: string, uncertain = 0) {
  let current = initial;
  const port: RunOperationPort = {
    status: async () => current,
    transition: vi.fn(async (_engagement, _thread, from, to) => {
      if (!from.includes(current)) return false;
      current = to;
      return true;
    }),
    uncertainRequests: async () => uncertain,
  };
  return { port, state: () => current };
}

function service(s: Scenario, audit = vi.fn(async () => undefined)) {
  const ops = operations(s.operation);
  const runtime = {
    run: async () => ({ runId: 'run-1', threadId: 'thread-1', status: s.runStatus, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', metadata: { engagement_id: 'eng', ui_request_id: row.requestId, ui_assistant_id: 'decepticon', graph_id: 'decepticon', ui_flow: 'execution', runtime_context_hash: row.dispatchConfigHash } }),
    listRuns: async () => [{ runId: 'run-1', threadId: 'thread-1', status: s.latestStatus, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z', metadata: {} }],
    cancelRun: vi.fn(async () => undefined),
    continueRun: vi.fn(async () => { throw new Error('unused in these cases'); }),
  };
  const reads = {
    instanceExchange: async () => ({ status: 200, body: { instances: s.instances ?? [] } }),
    state: async () => ({ values: {}, tasks: [] }),
  };
  const ownership = {
    getBinding: async () => binding,
    runOwner: async () => row,
    releaseCompletedRun: vi.fn(async () => undefined),
    runs: async () => [],
    replay: async () => null,
    listBindings: async () => [binding],
    active: async () => null,
  };
  const run = new RunService({
    ownership, runtime, reads, operations: ops.port, audit,
    context: { resolve: async () => ({ kind: 'execution', assistantId: 'decepticon', configurable: { authorization_confirmed: true }, publicView: { executionReady: true }, metadata: {} }) },
  } as unknown as Options);
  return { run, runtime, ops, audit };
}

describe('RunService operation lifecycle (P11)', () => {
  it('keeps a paused legacy operation non-quiescent after its ledger active marker was released', async () => {
    const { run } = service({ operation: 'paused', runStatus: 'interrupted', latestStatus: 'interrupted' });
    await expect(run.isQuiescent('local', 'eng')).resolves.toBe(false);
  });

  it('refuses to pause a run that has already finished', async () => {
    const { run, runtime } = service({ operation: 'running', runStatus: 'success', latestStatus: 'success' });
    await expect(run.pauseRun('local', 'eng', 'thread-1', 'run-1')).rejects.toMatchObject({ code: 'conflict', message: 'Only a running run can be paused.' });
    expect(runtime.cancelRun).not.toHaveBeenCalled();
  });

  it('records pause_requested before the runtime stops, and reports it as requested until the runtime shows interrupted', async () => {
    const { run, runtime, ops } = service({ operation: 'running', runStatus: 'running', latestStatus: 'running' });
    const view = await run.pauseRun('local', 'eng', 'thread-1', 'run-1');
    expect(ops.port.transition).toHaveBeenNthCalledWith(1, 'eng', 'thread-1', ['bound', 'running'], 'pause_requested');
    expect(runtime.cancelRun).toHaveBeenCalledWith('thread-1', 'run-1');
    expect(view.state).toBe('pause_requested');
  });

  it('confirms the pause only when the runtime reports the run interrupted', async () => {
    const { run, ops } = service({ operation: 'pause_requested', runStatus: 'interrupted', latestStatus: 'interrupted' });
    const view = await run.operation('local', 'eng', 'thread-1');
    expect(view.state).toBe('paused');
    expect(ops.state()).toBe('paused');
  });

  it('refuses to complete while a dispatched instance still runs', async () => {
    const { run, audit } = service({ operation: 'bound', runStatus: 'success', latestStatus: 'success', instances: [{ state: 'running' }] });
    await expect(run.completeOperation('local', 'eng', 'thread-1')).rejects.toBeInstanceOf(ProjectPolicyError);
    expect(audit).not.toHaveBeenCalled();
  });

  it('completes after the run ended and every instance is terminal, and writes an audit entry', async () => {
    const { run, audit, ops } = service({ operation: 'bound', runStatus: 'error', latestStatus: 'error', instances: [{ state: 'finished' }, { state: 'failed' }] });
    const view = await run.completeOperation('local', 'eng', 'thread-1');
    expect(view.state).toBe('completed');
    expect(ops.state()).toBe('completed');
    expect(audit).toHaveBeenCalledWith('local', 'eng', 'operation.completed', 'thread-1', 'latest run error');
  });

  it('refuses to resume unless the operation is paused', async () => {
    const { run, runtime } = service({ operation: 'bound', runStatus: 'interrupted', latestStatus: 'interrupted' });
    await expect(run.resumeRun('local', 'eng', 'thread-1', { requestId: 'resume-req-0001' })).rejects.toMatchObject({ code: 'conflict' });
    expect(runtime.continueRun).not.toHaveBeenCalled();
  });

  it('refuses a new message while the operation is paused, so no run starts beside the checkpoint', async () => {
    const { run } = service({ operation: 'paused', runStatus: 'interrupted', latestStatus: 'interrupted' });
    await expect(run.submit('local', 'eng', 'thread-1', { requestId: 'msg-req-00001', message: 'hello' })).rejects.toMatchObject({ code: 'conflict' });
  });
});
