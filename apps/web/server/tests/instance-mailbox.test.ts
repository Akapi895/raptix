import { describe, expect, it, vi } from 'vitest';
import { RuntimeUnavailableError } from '../src/integrations/runtime/read-client.js';
import { RunService } from '../src/services/runtime/run-service.js';
import { ProjectPolicyError } from '../src/security/project-policy.js';

type Options = ConstructorParameters<typeof RunService>[0];
const binding = { engagementId: 'eng', threadId: 'thread-1', assistantId: 'decepticon', kind: 'execution' as const, createdAt: '2026-10-17T00:00:00.000Z', updatedAt: '2026-10-17T00:00:00.000Z' };
const ACCEPTED_MESSAGE = { messageId: 'm-1', attempt: 1, seq: 1, body: 'Focus on the login form.', state: 'accepted', acceptedAt: '2026-10-18T00:00:00+00:00', deliveredAt: null, handledAt: null, outcome: null };

function service(exchange: (method: string, endpoint: string, body?: unknown) => Promise<{ status: number; body: unknown }>, options: { getBinding?: () => Promise<unknown>; authorize?: () => Promise<void> } = {}) {
  const instanceExchange = vi.fn(exchange);
  const run = new RunService({
    ownership: { getBinding: options.getBinding ?? (async () => binding), runs: async () => [] } as unknown as Options['ownership'],
    context: {} as Options['context'],
    runtime: {} as Options['runtime'],
    reads: { instanceExchange } as unknown as Options['reads'],
    ...(options.authorize ? { authorizeMutation: options.authorize } : {}),
  } as Options);
  return { run, instanceExchange };
}

describe('RunService operator messages to a running dispatch (P10c)', () => {
  it('forwards a valid message to the runtime instance route and returns the accepted ack', async () => {
    const { run, instanceExchange } = service(async () => ({ status: 200, body: { status: 'accepted', reason: null, attempt: 1, message: ACCEPTED_MESSAGE } }));
    const ack = await run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'm-1', body: '  Focus on the login form.  ', expectedAttempt: 1 });
    expect(instanceExchange).toHaveBeenCalledWith('POST', '/_raptix/instances/thread-1/dispatch-recon/messages', { messageId: 'm-1', body: 'Focus on the login form.', expectedAttempt: 1 });
    expect(ack).toEqual({ status: 'accepted', attempt: 1, message: ACCEPTED_MESSAGE });
  });

  it('explains a runtime refusal in the operator’s words instead of a raw code', async () => {
    const { run } = service(async () => ({ status: 409, body: { status: 'refused', reason: 'instance_not_running', attempt: null, message: null } }));
    const failure = run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'm-2', body: 'too late', expectedAttempt: 1 });
    await expect(failure).rejects.toBeInstanceOf(ProjectPolicyError);
    await expect(failure).rejects.toMatchObject({ code: 'conflict', message: 'This instance is not running, so the message was not accepted.' });
  });

  it('keeps an unknown refusal code visible rather than guessing its meaning', async () => {
    const { run } = service(async () => ({ status: 409, body: { status: 'refused', reason: 'something_new', attempt: null, message: null } }));
    await expect(run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'm-3', body: 'x', expectedAttempt: 1 })).rejects.toMatchObject({
      message: 'The runtime refused the message (something_new).',
    });
  });

  it('reports a duplicate retry as a duplicate, not as a second message', async () => {
    const { run } = service(async () => ({ status: 200, body: { status: 'duplicate', reason: null, attempt: 1, message: ACCEPTED_MESSAGE } }));
    const ack = await run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'm-1', body: 'Focus on the login form.', expectedAttempt: 1 });
    expect(ack.status).toBe('duplicate');
  });

  it('rejects a malformed message before the runtime is contacted', async () => {
    const { run, instanceExchange } = service(async () => ({ status: 200, body: null }));
    await expect(run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'bad id', body: 'x', expectedAttempt: 1 })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'm-4', body: '   ', expectedAttempt: 1 })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'm-5', body: 'x', extra: true })).rejects.toMatchObject({ code: 'bad_request' });
    expect(instanceExchange).not.toHaveBeenCalled();
  });

  it('does not reach the runtime for a thread the engagement does not own', async () => {
    const { run, instanceExchange } = service(async () => ({ status: 200, body: null }), {
      getBinding: async () => { throw new ProjectPolicyError('not_found', 'Thread not found'); },
    });
    await expect(run.sendInstanceMessage('local', 'eng', 'thread-foreign', 'dispatch-recon', { messageId: 'm-6', body: 'x', expectedAttempt: 1 })).rejects.toMatchObject({ code: 'not_found' });
    expect(instanceExchange).not.toHaveBeenCalled();
  });

  it('applies the operator gate to sending, so a read-only member cannot message an instance', async () => {
    const { run, instanceExchange } = service(async () => ({ status: 200, body: null }), {
      authorize: async () => { throw new ProjectPolicyError('conflict', 'Viewers cannot send instance messages'); },
    });
    await expect(run.sendInstanceMessage('local', 'eng', 'thread-1', 'dispatch-recon', { messageId: 'm-7', body: 'x', expectedAttempt: 1 })).rejects.toMatchObject({ code: 'conflict' });
    expect(instanceExchange).not.toHaveBeenCalled();
  });

  it('reads one dispatch mailbox, and a runtime fault is unavailable rather than an empty mailbox', async () => {
    const snapshot = { threadId: 'thread-1', dispatchId: 'dispatch-recon', instances: [{ attempt: 1, role: 'recon', state: 'running', startedAt: '2026-10-18T00:00:00+00:00', finishedAt: null }], messages: [ACCEPTED_MESSAGE] };
    const ok = service(async () => ({ status: 200, body: snapshot }));
    await expect(ok.run.instanceMailbox('local', 'eng', 'thread-1', 'dispatch-recon')).resolves.toEqual({ ...snapshot, source: 'runtime' });

    const broken = service(async () => ({ status: 500, body: null }));
    await expect(broken.run.instanceMailbox('local', 'eng', 'thread-1', 'dispatch-recon')).rejects.toBeInstanceOf(RuntimeUnavailableError);
  });
});

describe('RunService.listInstances with running attempts (P10 roster)', () => {
  const ledgerRow = { fingerprint: 'f1', role: 'recon', objective_id: 'OBJ-001', attempt: 1, outcome: { status: 'success', terminal_for_this_dispatch: false } };
  const rosterService = (mailbox: () => Promise<{ status: number; body: unknown }>) => new RunService({
    ownership: { listBindings: async () => [binding], runs: async () => [] } as unknown as Options['ownership'],
    context: {} as Options['context'],
    runtime: {} as Options['runtime'],
    reads: {
      state: async () => ({ values: { dispatch_ledger: { 'dispatch-recon': ledgerRow } }, tasks: [], graphId: 'decepticon' }),
      instanceExchange: vi.fn(mailbox),
    } as unknown as Options['reads'],
  } as Options);

  it('shows a running attempt that the ledger does not hold yet, and does not repeat a finished attempt the ledger already holds', async () => {
    const service = rosterService(async () => ({
      status: 200,
      body: {
        threadId: 'thread-1',
        instances: [
          { dispatchId: 'dispatch-recon', attempt: 1, role: 'recon', state: 'finished', startedAt: 'a', finishedAt: 'b' },
          { dispatchId: 'dispatch-exploit', attempt: 1, role: 'exploit', state: 'running', startedAt: 'c', finishedAt: null },
        ],
      },
    }));
    const roster = await service.listInstances('local', 'eng');
    expect(roster.instances.map((i) => [i.dispatchId, i.attempt, i.source])).toEqual([
      ['dispatch-exploit', 1, 'mailbox'],
      ['dispatch-recon', 1, 'dispatch_ledger'],
    ]);
    expect(roster.instances[0]).toMatchObject({ role: 'exploit', outcome: 'running', terminal: false });
    expect(roster.threads).toEqual([{ threadId: 'thread-1', read: 'read', reason: null }]);
  });

  it('keeps the finished rows and says the running ones are missing when the mailbox cannot be read', async () => {
    const service = rosterService(async () => ({ status: 500, body: null }));
    const roster = await service.listInstances('local', 'eng');
    expect(roster.instances.map((i) => i.dispatchId)).toEqual(['dispatch-recon']);
    expect(roster.threads[0]).toMatchObject({ read: 'read', reason: expect.stringContaining('Running instances could not be read') });
  });
});

describe('RunService instance controls (P10d) and forward (P10c)', () => {
  const ENDED = { attempt: 1, role: 'recon', state: 'cancelled', startedAt: '2026-10-18T00:00:00+00:00', finishedAt: '2026-10-18T00:05:00+00:00', intent: 'map the web target', objectiveId: 'OBJ-1' };
  const RUNNING = { ...ENDED, attempt: 2, state: 'running', finishedAt: null };

  it('records a cooperative cancel and reports it as requested, never as stopped', async () => {
    const { run, instanceExchange } = service(async () => ({ status: 200, body: { threadId: 'thread-1', dispatchId: 'dispatch-recon', attempt: 2, state: 'cancel_requested' } }));
    const ack = await run.cancelInstance('local', 'eng', 'thread-1', 'dispatch-recon', { expectedAttempt: 2 });
    expect(instanceExchange).toHaveBeenCalledWith('POST', '/_raptix/instances/thread-1/dispatch-recon/cancel', { expectedAttempt: 2 });
    expect(ack).toMatchObject({ attempt: 2, state: 'cancel_requested' });
  });

  it('refuses a retry while the attempt is still running or cancelling, as the runtime reports it', async () => {
    const { run } = service(async () => ({ status: 409, body: { status: 'refused', reason: 'attempt_not_ended', grant: null } }));
    await expect(run.commandInstance('local', 'eng', 'thread-1', 'dispatch-recon', { commandId: 'cmd-retry-1', kind: 'retry', expectedAttempt: 2 })).rejects.toMatchObject({ code: 'conflict', message: 'The attempt must end before it can be retried or reassigned.' });
  });

  it('refuses a retry against a stale attempt number, and names the grant it asked the runtime for', async () => {
    const { run, instanceExchange } = service(async () => ({ status: 409, body: { status: 'refused', reason: 'stale_attempt', grant: null } }));
    await expect(run.commandInstance('local', 'eng', 'thread-1', 'dispatch-recon', { commandId: 'cmd-retry-2', kind: 'retry', expectedAttempt: 9 })).rejects.toMatchObject({ code: 'conflict' });
    expect(instanceExchange).toHaveBeenCalledWith('POST', '/_raptix/instances/thread-1/dispatch-recon/grants', { commandId: 'cmd-retry-2', kind: 'retry', expectedAttempt: 9 });
  });

  it('forwards a source message as a new message that names it', async () => {
    const source = { ...ACCEPTED_MESSAGE, messageId: 'src-1', body: 'Check /admin.' };
    const { run, instanceExchange } = service(async (method, endpoint) => endpoint.endsWith('/dispatch-recon')
      ? { status: 200, body: { threadId: 'thread-1', dispatchId: 'dispatch-recon', instances: [ENDED], messages: [source] } }
      : { status: 200, body: { status: 'accepted', reason: null, attempt: 2, message: { ...ACCEPTED_MESSAGE, messageId: 'fwd-1', attempt: 2, sourceMessageId: 'src-1' } } });
    const ack = await run.forwardInstanceMessage('local', 'eng', 'thread-1', 'dispatch-target', { messageId: 'fwd-1', sourceDispatchId: 'dispatch-recon', sourceMessageId: 'src-1', expectedAttempt: 2 });
    expect(instanceExchange).toHaveBeenLastCalledWith('POST', '/_raptix/instances/thread-1/dispatch-target/messages', {
      messageId: 'fwd-1', body: 'Forwarded from dispatch dispatch-recon, attempt 1 (message src-1):\nCheck /admin.', expectedAttempt: 2, sourceMessageId: 'src-1',
    });
    expect(ack.status).toBe('accepted');
  });

  it('refuses to forward a message the runtime does not hold for that dispatch', async () => {
    const { run } = service(async () => ({ status: 200, body: { threadId: 'thread-1', dispatchId: 'dispatch-recon', instances: [ENDED], messages: [] } }));
    await expect(run.forwardInstanceMessage('local', 'eng', 'thread-1', 'dispatch-target', { messageId: 'fwd-2', sourceDispatchId: 'dispatch-recon', sourceMessageId: 'ghost', expectedAttempt: 2 })).rejects.toMatchObject({ code: 'not_found' });
  });
});
