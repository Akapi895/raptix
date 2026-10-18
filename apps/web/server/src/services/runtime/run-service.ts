import { randomUUID } from 'node:crypto';
import type {
  InstanceAttemptState, InstanceCancelAck, InstanceMailboxView, InstanceMessageAck, InstanceMessageView, RequestRecoveryView,
  RuntimeInstanceView, RuntimeRosterView, ScopedRunView, ScopedThreadView, ThreadBindingView,
} from '@raptix/web-contracts';
import type { RuntimeExecutionPort, RuntimeRun } from '../../integrations/runtime/execution-client.js';
import type { RuntimeReadPort } from '../../integrations/runtime/read-client.js';
import { RuntimeCheckpointMissingError, RuntimeRejectedError, RuntimeUnavailableError } from '../../integrations/runtime/read-client.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { parseInstanceCancel, parseInstanceCommand, parseInstanceForward, parseInstanceMessage, parseOperationRequest, parseResumeCreate, parseRunCreate, parseRunPage, parseThreadCreate } from '../../security/run-policy.js';
import type { RuntimeOwnershipService } from '../runtime-ownership.js';
import type { RuntimeContextService, TrustedRuntimeContext } from './runtime-context.js';
import { projectThreadHistory } from './history-projection.js';
import { assertResumeValue, findPendingQuestions } from './interrupt-projection.js';

const conflict = (): ProjectPolicyError => new ProjectPolicyError('conflict', 'Runtime context, readiness or active-run policy prevents this operation');
/** A runtime 409 on an instance control: its reason in the operator's words; an unknown reason keeps its code. */
const refusal = (payload: { reason?: unknown } | null, fallback: string): ProjectPolicyError => {
  const reason = typeof payload?.reason === 'string' ? payload.reason : null;
  if (reason !== null && REFUSAL_TEXT[reason] !== undefined) return new ProjectPolicyError('conflict', REFUSAL_TEXT[reason]);
  return new ProjectPolicyError('conflict', reason === null ? `${fallback}.` : `${fallback} (${reason}).`);
};
const terminal = (status: string): boolean => ['success', 'error', 'timeout', 'interrupted'].includes(status);
function metadata(actual: Record<string, unknown>, expected: Record<string, string>): void {
  if (Object.entries(expected).some(([k, v]) => actual[k] !== v)) throw conflict();
}
/** The operator grant the runtime recorded for a retry or reassign of one ended attempt. */
interface RuntimeGrantView { commandId: string; kind: 'retry' | 'reassign'; sourceDispatchId: string; sourceAttempt: number; targetDispatchId: string; targetRole: string; state: string }

/** P10d: a retry or reassign request and the orchestrator run that performs the admission. */
export interface InstanceCommandView {
  commandId: string;
  kind: 'retry' | 'reassign';
  threadId: string;
  sourceDispatchId: string;
  sourceAttempt: number;
  /** The dispatch the replacement runs under: the same one for a retry, a new one for a reassign. */
  dispatchId: string;
  role: string;
  run: RequestRecoveryView;
}

/** Why the runtime refused a message or control, in the words the operator sees. Unknown codes keep the runtime's code. */
const REFUSAL_TEXT: Readonly<Record<string, string>> = {
  instance_not_running: 'This instance is not running, so the message was not accepted.',
  stale_attempt: 'The instance changed since you looked at it. Refresh the roster and try again.',
  unknown_attempt: 'The runtime has no such attempt for this dispatch.',
  mailbox_full: 'This instance already has the maximum number of messages waiting for its next step.',
  message_too_large: 'The message is longer than the instance accepts.',
  empty_message: 'The message is empty.',
  invalid_message_id: 'The message id is not valid.',
  message_id_conflict: 'This message id was already used for another instance or with different content.',
  attempt_not_ended: 'The attempt must end before it can be retried or reassigned.',
  already_replaced: 'This attempt was already retried or reassigned.',
  intent_not_recorded: 'This attempt was recorded before its intent was kept, so it cannot be re-issued.',
  replacement_pending: 'A replacement for this dispatch is already waiting to start.',
  command_id_conflict: 'This command id was already used for a different request.',
  invalid_command: 'The retry or reassignment request is not valid for this attempt.',
};

const instancePath = (thread: string, dispatch: string): string => `/_raptix/instances/${encodeURIComponent(thread)}/${encodeURIComponent(dispatch)}`;

/** The attempt rows the runtime holds for one dispatch, including the internal intent that a retry re-issues. */
interface RuntimeAttemptRow { attempt: number; role: string | null; state: InstanceAttemptState; startedAt: string; finishedAt: string | null; intent: string | null; objectiveId: string | null }

function ledgerInstances(threadId: string, ledger: unknown): RuntimeInstanceView[] {
  if (typeof ledger !== 'object' || ledger === null || Array.isArray(ledger)) return [];
  return Object.entries(ledger as Record<string, unknown>).flatMap(([dispatchId, row]) => {
    if (typeof row !== 'object' || row === null) return [];
    const entry = row as { role?: unknown; attempt?: unknown; objective_id?: unknown; parent_dispatch_id?: unknown; outcome?: unknown };
    if (typeof entry.attempt !== 'number' || !Number.isSafeInteger(entry.attempt) || entry.attempt < 1) return [];
    const outcome = typeof entry.outcome === 'object' && entry.outcome !== null ? entry.outcome as { status?: unknown; terminal_for_this_dispatch?: unknown } : {};
    return [{
      instanceId: `${threadId}:${dispatchId}:${entry.attempt}`,
      threadId,
      dispatchId,
      attempt: entry.attempt,
      role: typeof entry.role === 'string' && entry.role.length > 0 ? entry.role : null,
      objectiveId: typeof entry.objective_id === 'string' ? entry.objective_id : null,
      parentDispatchId: typeof entry.parent_dispatch_id === 'string' ? entry.parent_dispatch_id : null,
      outcome: typeof outcome.status === 'string' ? outcome.status : 'unknown',
      terminal: outcome.terminal_for_this_dispatch === true,
      source: 'dispatch_ledger' as const,
    }];
  });
}

/** P11: the operation state of a thread, held by its binding row (OperationBinding.status). */
export interface RunOperationPort {
  status(engagement: string, thread: string): Promise<string | null>;
  transition(engagement: string, thread: string, from: readonly string[], to: string): Promise<boolean>;
  uncertainRequests(engagement: string, thread: string): Promise<number>;
}

/** P11 operation view: the durable state plus the latest run the runtime reports. */
export interface OperationView {
  engagementId: string; threadId: string; state: string
  latestRunId: string | null; latestRunStatus: string | null; source: 'runtime'
}

export class RunService {
  public constructor(private readonly options: {
    ownership: RuntimeOwnershipService; context: RuntimeContextService; runtime: RuntimeExecutionPort; reads: RuntimeReadPort
    authorizeMutation?: (user: string, engagement: string, kind: 'planning' | 'execution', threadId: string | null) => Promise<void>
    operations?: RunOperationPort
    audit?: (actorId: string, engagementId: string, action: string, targetId: string, reason: string) => Promise<void>
  }) {}
  private requireOperations(): RunOperationPort {
    if (!this.options.operations) throw new ProjectPolicyError('conflict', 'Operation lifecycle is not available in this deployment');
    return this.options.operations;
  }
  private async threadState(user: string, engagement: string, thread: string): ReturnType<RuntimeReadPort['state']> {
    const state = await this.options.reads.state(thread);
    if (!Object.keys(state.values).length && !findPendingQuestions(state.values, state.tasks).length) {
      const previous = (await this.options.ownership.runs(user, engagement, thread, 0, 1))[0];
      if (previous?.runId && terminal((await this.options.runtime.run(thread, previous.runId)).status)) throw new RuntimeCheckpointMissingError();
    }
    return state;
  }
  private async dispatch(user: string, engagement: string, request: string, token: string, action: () => Promise<RequestRecoveryView>): Promise<RequestRecoveryView> {
    try { return await action(); }
    catch (error) {
      if (error instanceof RuntimeRejectedError) { await this.options.ownership.rejectBeforeDispatch(user, engagement, request, token); throw error; }
      await this.options.ownership.markUncertain(user, engagement, request, token);
      throw new RuntimeUnavailableError();
    }
  }
  public async createThread(user: string, engagement: string, raw: unknown): Promise<RequestRecoveryView> {
    const { requestId, intent, selection } = parseThreadCreate(raw);
    const { ownership, context, runtime } = this.options;
    const replay = await ownership.replay(user, engagement, requestId, 'create_thread', intent);
    if (replay) return replay;
    let trusted: TrustedRuntimeContext;
    try {
      trusted = await context.resolve(user, engagement, selection);
      await this.options.authorizeMutation?.(user, engagement, trusted.kind, null);
      if (!trusted.configurable.authorization_confirmed) throw conflict();
    } catch (error) {
      const winner = await ownership.replay(user, engagement, requestId, 'create_thread', intent);
      if (winner) return winner;
      throw error;
    }
    const reservation = await ownership.reserve(user, engagement, requestId, 'create_thread', intent);
    if (!reservation.reserved) return reservation.request;
    const candidate = randomUUID();
    await ownership.recordDispatch(user, engagement, requestId, reservation.token, trusted, candidate);
    return this.dispatch(user, engagement, requestId, reservation.token, async () => {
      const expected = { ...trusted.metadata, ui_request_id: requestId };
      const remote = await runtime.createThread(candidate, expected, trusted.configurable);
      metadata(remote.metadata, expected);
      await ownership.bindThread(user, engagement, { threadId: remote.threadId, assistantId: trusted.assistantId, kind: trusted.kind, contextHash: trusted.bindingHash, runtimeConfigHash: trusted.runtimeConfigHash });
      return ownership.accept(user, engagement, requestId, reservation.token, remote.threadId, null);
    });
  }
  /**
   * A run that ended without anyone observing it still holds its thread's active slot, and that blocks every
   * run of the other kind on the engagement. Observing each run releases its slot when the runtime reports it terminal.
   */
  private async settleEndedRuns(user: string, engagement: string): Promise<void> {
    const { ownership } = this.options;
    for (const binding of await ownership.listBindings(user, engagement)) {
      for (const row of await ownership.runs(user, engagement, binding.threadId, 0, 25)) {
        if (row.runId === null) continue;
        try { await this.getRun(user, engagement, binding.threadId, row.runId); }
        catch (error) { if (!(error instanceof RuntimeUnavailableError || error instanceof RuntimeRejectedError)) throw error; }
      }
    }
  }
  public async submit(user: string, engagement: string, thread: string, raw: unknown): Promise<RequestRecoveryView> {
    const { requestId, message, intent } = parseRunCreate(raw);
    // A new message would start a fresh run beside a paused checkpoint; resume the operation or start a new plan binding instead.
    const operation = await this.options.operations?.status(engagement, thread);
    if (operation === 'pause_requested' || operation === 'paused' || operation === 'completed') throw new ProjectPolicyError('conflict', `This operation is ${operation}; resume it or start a new operation before sending a message.`);
    return this.startRun(user, engagement, thread, requestId, intent, (trusted) => this.options.runtime.createRun(thread, trusted, requestId, message));
  }
  /**
   * Admit one runtime run on a thread: the same ownership, gate and dispatch path for a new message and for a
   * continuation of a paused checkpoint. `precheck` runs inside the gate; `afterAccept` runs once the runtime accepted it.
   */
  private async startRun(
    user: string,
    engagement: string,
    thread: string,
    requestId: string,
    intent: unknown,
    launch: (trusted: TrustedRuntimeContext) => Promise<RuntimeRun>,
    hooks: { precheck?: () => Promise<void>; afterAccept?: () => Promise<void> } = {},
  ): Promise<RequestRecoveryView> {
    const { ownership, context, runtime } = this.options;
    const replay = await ownership.replay(user, engagement, requestId, 'create_run', intent, thread);
    if (replay) return replay;
    await this.settleEndedRuns(user, engagement);
    let trusted: TrustedRuntimeContext;
    try {
      const binding = await ownership.getBinding(user, engagement, thread);
      trusted = await context.resolve(user, engagement, { kind: binding.kind, threadId: thread });
      await this.options.authorizeMutation?.(user, engagement, trusted.kind, thread);
      if (!trusted.configurable.authorization_confirmed || binding.kind === 'execution' && !trusted.publicView.executionReady) throw conflict();
      await this.threadState(user, engagement, thread);
      const active = await ownership.active(user, engagement, thread);
      if (active?.state === 'accepted' && active.runId) await this.getRun(user, engagement, thread, active.runId);
      if (await ownership.active(user, engagement, thread)) throw conflict();
      for (let offset = 0; offset < 1000; offset += 100) {
        const runs = await runtime.listRuns(thread, offset, 100);
        if (runs.some(r => !terminal(r.status) && r.status !== 'interrupted')) throw conflict();
        if (runs.length < 100) break;
        if (offset === 900) throw new RuntimeUnavailableError();
      }
      await hooks.precheck?.();
    } catch (error) {
      const winner = await ownership.replay(user, engagement, requestId, 'create_run', intent, thread);
      if (winner) return winner;
      throw error;
    }
    const reservation = await ownership.reserve(user, engagement, requestId, 'create_run', intent, thread);
    if (!reservation.reserved) return reservation.request;
    await ownership.recordDispatch(user, engagement, requestId, reservation.token, trusted);
    return this.dispatch(user, engagement, requestId, reservation.token, async () => {
      const remote = await launch(trusted);
      metadata(remote.metadata, { ...trusted.metadata, ui_request_id: requestId });
      const accepted = await ownership.accept(user, engagement, requestId, reservation.token, thread, remote.runId);
      await hooks.afterAccept?.();
      return accepted;
    });
  }
  /** P11 pause: the request is durable as `pause_requested` before the runtime is asked to stop at its safe point. */
  public async pauseRun(user: string, engagement: string, thread: string, runId: string): Promise<OperationView> {
    const ops = this.requireOperations();
    const current = await this.getRun(user, engagement, thread, runId);
    if (!['pending', 'running'].includes(current.rawStatus)) throw new ProjectPolicyError('conflict', 'Only a running run can be paused.');
    const binding = await this.options.ownership.getBinding(user, engagement, thread);
    await this.options.authorizeMutation?.(user, engagement, binding.kind, thread);
    if (!(await ops.transition(engagement, thread, ['bound', 'running'], 'pause_requested'))) throw new ProjectPolicyError('conflict', 'This operation cannot be paused in its current state.');
    try { await this.options.runtime.cancelRun(thread, runId); }
    catch (error) { await ops.transition(engagement, thread, ['pause_requested'], 'running'); throw error; }
    return this.operation(user, engagement, thread);
  }
  /** P11 resume: continues the paused checkpoint as a new runtime run; the original prompt is never sent again. */
  public async resumeRun(user: string, engagement: string, thread: string, raw: unknown): Promise<RequestRecoveryView> {
    const { requestId } = parseOperationRequest(raw);
    const ops = this.requireOperations();
    return this.startRun(user, engagement, thread, requestId, { continueThread: thread }, (trusted) => this.options.runtime.continueRun(thread, trusted, requestId), {
      precheck: async () => {
        if ((await ops.status(engagement, thread)) !== 'paused') throw new ProjectPolicyError('conflict', 'Only a paused operation can be resumed.');
        const [latest] = await this.options.runtime.listRuns(thread, 0, 1);
        if (!latest || latest.status !== 'interrupted') throw new ProjectPolicyError('conflict', 'The paused run is not interrupted in the runtime yet.');
        const state = await this.threadState(user, engagement, thread);
        if (findPendingQuestions(state.values, state.tasks).length) throw new ProjectPolicyError('conflict', 'Answer the pending question before resuming this operation.');
      },
      afterAccept: async () => { await ops.transition(engagement, thread, ['paused'], 'running'); },
    });
  }
  /**
   * P11 complete: audited bookkeeping, only after the runtime run is terminal and every recorded attempt has ended.
   * It never changes the status of a failed run and never terminates sessions.
   */
  public async completeOperation(user: string, engagement: string, thread: string): Promise<OperationView> {
    const ops = this.requireOperations();
    const binding = await this.options.ownership.getBinding(user, engagement, thread);
    await this.options.authorizeMutation?.(user, engagement, binding.kind, thread);
    const view = await this.operation(user, engagement, thread);
    if (view.state === 'completed') return view;
    if (view.state === 'pause_requested') throw new ProjectPolicyError('conflict', 'The pause is not confirmed by the runtime yet.');
    if (view.latestRunStatus === null || ['pending', 'running'].includes(view.latestRunStatus)) throw new ProjectPolicyError('conflict', 'The runtime run is still active.');
    if (view.latestRunStatus === 'interrupted') throw new ProjectPolicyError('conflict', 'The operation is paused; resume it or let its run finish before completing.');
    const state = await this.threadState(user, engagement, thread);
    if (findPendingQuestions(state.values, state.tasks).length) throw new ProjectPolicyError('conflict', 'Answer the pending questions before completing this operation.');
    const reply = await this.options.reads.instanceExchange('GET', `/_raptix/threads/${encodeURIComponent(thread)}/instances`);
    const payload = reply.body as { instances?: { state?: unknown }[] } | null;
    if (reply.status !== 200 || !payload || !Array.isArray(payload.instances)) throw new RuntimeUnavailableError();
    if (payload.instances.some(row => row.state === 'running' || row.state === 'cancel_requested')) throw new ProjectPolicyError('conflict', 'A dispatched instance is still running; wait for it to end before completing.');
    if (await ops.uncertainRequests(engagement, thread) > 0) throw new ProjectPolicyError('conflict', 'Uncertain requests on this thread must be reconciled before completing.');
    if (!(await ops.transition(engagement, thread, ['bound', 'running', 'paused'], 'completed'))) throw new ProjectPolicyError('conflict', 'This operation cannot be completed in its current state.');
    await this.options.audit?.(user, engagement, 'operation.completed', thread, `latest run ${view.latestRunStatus}`);
    return this.operation(user, engagement, thread);
  }
  /** P11 operation state, reconciled with the latest run the runtime reports (the pause is confirmed only here). */
  public async operation(user: string, engagement: string, thread: string): Promise<OperationView> {
    const ops = this.requireOperations();
    await this.options.ownership.getBinding(user, engagement, thread);
    const [latest] = await this.options.runtime.listRuns(thread, 0, 1);
    let state = (await ops.status(engagement, thread)) ?? 'bound';
    if (latest && state !== 'completed') {
      const interrupted = latest.status === 'interrupted';
      if (state === 'pause_requested' && interrupted) state = (await ops.transition(engagement, thread, ['pause_requested'], 'paused')) ? 'paused' : state;
      else if (state === 'running' && interrupted) state = (await ops.transition(engagement, thread, ['running'], 'paused')) ? 'paused' : state;
      else if (state === 'pause_requested' && terminal(latest.status)) state = (await ops.transition(engagement, thread, ['pause_requested'], 'bound')) ? 'bound' : state;
      else if (state === 'paused' && ['pending', 'running'].includes(latest.status)) state = (await ops.transition(engagement, thread, ['paused'], 'running')) ? 'running' : state;
      else if (state === 'running' && terminal(latest.status)) state = (await ops.transition(engagement, thread, ['running'], 'bound')) ? 'bound' : state;
    }
    return { engagementId: engagement, threadId: thread, state, latestRunId: latest?.runId ?? null, latestRunStatus: latest?.status ?? null, source: 'runtime' };
  }
  public async getRun(user: string, engagement: string, thread: string, runId: string): Promise<ScopedRunView> {
    const { ownership, runtime } = this.options;
    const row = await ownership.runOwner(user, engagement, thread, runId);
    if (!row.dispatchAssistantId || !row.dispatchKind || !row.dispatchConfigHash) throw conflict();
    await ownership.getBinding(user, engagement, thread, { assistantId: row.dispatchAssistantId, kind: row.dispatchKind, runtimeConfigHash: row.dispatchConfigHash });
    const remote = await runtime.run(thread, runId);
    metadata(remote.metadata, { engagement_id: engagement, ui_request_id: row.requestId, ui_assistant_id: row.dispatchAssistantId, graph_id: row.dispatchAssistantId, ui_flow: row.dispatchKind, runtime_context_hash: row.dispatchConfigHash });
    if (terminal(remote.status)) await ownership.releaseCompletedRun(user, engagement, row.requestId, runId);
    return { engagementId: engagement, threadId: thread, runId, requestId: row.requestId, rawStatus: remote.status, createdAt: remote.createdAt, updatedAt: remote.updatedAt, source: 'runtime' };
  }
  public async listRuns(user: string, engagement: string, thread: string, raw: unknown): Promise<{ runs: ScopedRunView[]; offset: number; nextOffset: number | null }> {
    const page = parseRunPage(raw);
    const rows = await this.options.ownership.runs(user, engagement, thread, page.offset, page.limit + 1);
    return { runs: await Promise.all(rows.slice(0, page.limit).map(row => this.getRun(user, engagement, thread, row.runId!))), offset: page.offset, nextOffset: rows.length > page.limit ? page.offset + page.limit : null };
  }
  public async listThreads(user: string, engagement: string): Promise<{ engagementId: string; threads: ThreadBindingView[]; source: 'runtime' }> {
    const threads = await this.options.ownership.listBindings(user, engagement);
    return { engagementId: engagement, threads, source: 'runtime' };
  }
  /**
   * P10b roster: the dispatch instances of every thread bound to the engagement,
   * read from each thread's dispatch ledger. A thread the runtime cannot read is
   * named as unavailable, never shown as an empty roster.
   */
  public async listInstances(user: string, engagement: string): Promise<RuntimeRosterView> {
    const bindings = await this.options.ownership.listBindings(user, engagement);
    const instances: RuntimeInstanceView[] = [];
    const threads: RuntimeRosterView['threads'] = [];
    for (const binding of bindings) {
      try {
        const { values } = await this.threadState(user, engagement, binding.threadId);
        const ledger = ledgerInstances(binding.threadId, values.dispatch_ledger);
        instances.push(...ledger);
        const recorded = new Set(ledger.map(row => `${row.dispatchId}:${row.attempt}`));
        // P10: a running attempt is not in the ledger until it finishes; the mailbox is where it is visible now.
        try {
          instances.push(...await this.mailboxInstances(binding.threadId, recorded));
          threads.push({ threadId: binding.threadId, read: 'read', reason: null });
        } catch (error) {
          if (!(error instanceof RuntimeUnavailableError)) throw error;
          threads.push({ threadId: binding.threadId, read: 'read', reason: 'Running instances could not be read; only finished attempts are shown.' });
        }
      } catch (error) {
        if (!(error instanceof RuntimeUnavailableError || error instanceof RuntimeCheckpointMissingError)) throw error;
        threads.push({ threadId: binding.threadId, read: 'unavailable', reason: error.message });
      }
    }
    instances.sort((a, b) => a.threadId.localeCompare(b.threadId) || a.dispatchId.localeCompare(b.dispatchId) || a.attempt - b.attempt);
    return { engagementId: engagement, instances, threads, source: 'runtime' };
  }
  /**
   * P10c: send an operator message to one running dispatch instance. The thread must belong to the
   * engagement, and sending is a mutation, so the operator gate runs here. The runtime decides whether
   * the instance can take the message; a refusal reaches the operator as its reason.
   */
  public async sendInstanceMessage(user: string, engagement: string, thread: string, dispatch: string, raw: unknown): Promise<InstanceMessageAck> {
    const { messageId, body, expectedAttempt } = parseInstanceMessage(raw);
    await this.authorizeInstanceMutation(user, engagement, thread);
    return this.deliverInstanceMessage(thread, dispatch, { messageId, body, expectedAttempt, sourceMessageId: null });
  }
  /**
   * P10d: the operator asks for cooperative cancel of one attempt. The runtime records the request and
   * refuses messages from then on; the attempt is only observed stopped when its dispatch finishes.
   */
  public async cancelInstance(user: string, engagement: string, thread: string, dispatch: string, raw: unknown): Promise<InstanceCancelAck> {
    const expectedAttempt = parseInstanceCancel(raw);
    await this.authorizeInstanceMutation(user, engagement, thread);
    const reply = await this.options.reads.instanceExchange('POST', `${instancePath(thread, dispatch)}/cancel`, { expectedAttempt });
    const payload = reply.body as { state?: unknown; reason?: unknown } | null;
    if (reply.status === 409) throw refusal(payload, 'The runtime refused the cancel');
    if (reply.status !== 200 || payload?.state !== 'cancel_requested') throw new RuntimeUnavailableError();
    return { threadId: thread, dispatchId: dispatch, attempt: expectedAttempt, state: 'cancel_requested', source: 'runtime' };
  }
  /**
   * P10c forward: the operator repeats one message from this thread's dispatch to a running attempt. The
   * source must be a message the runtime holds for that dispatch on the same thread; the new message names it.
   */
  public async forwardInstanceMessage(user: string, engagement: string, thread: string, targetDispatch: string, raw: unknown): Promise<InstanceMessageAck> {
    const { messageId, sourceDispatchId, sourceMessageId, expectedAttempt } = parseInstanceForward(raw);
    await this.authorizeInstanceMutation(user, engagement, thread);
    const source = (await this.instanceView(thread, sourceDispatchId)).messages.find(m => m.messageId === sourceMessageId);
    if (!source) throw new ProjectPolicyError('not_found', 'The source message is not recorded for that dispatch on this thread.');
    const body = `Forwarded from dispatch ${sourceDispatchId}, attempt ${source.attempt} (message ${sourceMessageId}):\n${source.body}`;
    return this.deliverInstanceMessage(thread, targetDispatch, { messageId, body, expectedAttempt, sourceMessageId });
  }
  /**
   * P10d retry or reassign. The runtime records an operator grant only for an ended attempt, with that attempt's
   * persisted intent, and refuses a second replacement of it. The orchestrator run only names the dispatch to
   * admit; the runtime supplies the description, role and objective. The run uses the command id as its request id,
   * so a lost ack replays. A refusal before admission withdraws the grant; an uncertain run is left for reconcile.
   */
  public async commandInstance(user: string, engagement: string, thread: string, dispatch: string, raw: unknown): Promise<InstanceCommandView> {
    const { commandId, kind, expectedAttempt, role } = parseInstanceCommand(raw);
    await this.authorizeInstanceMutation(user, engagement, thread);
    const reply = await this.options.reads.instanceExchange('POST', `${instancePath(thread, dispatch)}/grants`, {
      commandId, kind, expectedAttempt, ...(kind === 'reassign' ? { reassignRole: role } : {}),
    });
    const payload = reply.body as { status?: unknown; reason?: unknown; grant?: RuntimeGrantView | null } | null;
    if (reply.status === 409) throw refusal(payload, 'The runtime refused the retry or reassignment');
    if (!payload || (payload.status !== 'opened' && payload.status !== 'duplicate') || !payload.grant) throw new RuntimeUnavailableError();
    const grant = payload.grant;
    const message = [
      `Operator ${grant.kind} request ${commandId}: call the dispatch task once with dispatch_id "${grant.targetDispatchId}" and subagent_type "${grant.targetRole}".`,
      'The runtime supplies the exact description and objective of this dispatch from the persisted attempt; do not write a new description.',
    ].join('\n');
    let run: RequestRecoveryView;
    try {
      run = await this.submit(user, engagement, thread, { requestId: commandId, message });
    } catch (error) {
      if (!(error instanceof RuntimeUnavailableError)) {
        await this.options.reads.instanceExchange('POST', `${instancePath(thread, dispatch)}/grants/${encodeURIComponent(commandId)}/revoke`).catch(() => undefined);
      }
      throw error;
    }
    return { commandId, kind, threadId: thread, sourceDispatchId: dispatch, sourceAttempt: grant.sourceAttempt, dispatchId: grant.targetDispatchId, role: grant.targetRole, run };
  }
  private async authorizeInstanceMutation(user: string, engagement: string, thread: string): Promise<void> {
    const binding = await this.options.ownership.getBinding(user, engagement, thread);
    await this.options.authorizeMutation?.(user, engagement, binding.kind, thread);
  }
  private async deliverInstanceMessage(thread: string, dispatch: string, message: { messageId: string; body: string; expectedAttempt: number; sourceMessageId: string | null }): Promise<InstanceMessageAck> {
    const reply = await this.options.reads.instanceExchange('POST', `${instancePath(thread, dispatch)}/messages`, {
      messageId: message.messageId, body: message.body, expectedAttempt: message.expectedAttempt,
      ...(message.sourceMessageId ? { sourceMessageId: message.sourceMessageId } : {}),
    });
    const payload = reply.body as { status?: unknown; reason?: unknown; attempt?: unknown; message?: InstanceMessageView | null } | null;
    if (reply.status === 409) throw refusal(payload, 'The runtime refused the message');
    if (!payload || (payload.status !== 'accepted' && payload.status !== 'duplicate') || typeof payload.attempt !== 'number' || !payload.message) {
      throw new RuntimeUnavailableError();
    }
    return { status: payload.status, attempt: payload.attempt, message: payload.message };
  }
  /** P10: attempts the mailbox records on a thread that the ledger does not hold yet (running, or ended before the ledger write). */
  private async mailboxInstances(thread: string, recorded: Set<string>): Promise<RuntimeInstanceView[]> {
    const reply = await this.options.reads.instanceExchange('GET', `/_raptix/threads/${encodeURIComponent(thread)}/instances`);
    const payload = reply.body as { instances?: unknown } | null;
    if (reply.status !== 200 || !payload || !Array.isArray(payload.instances)) throw new RuntimeUnavailableError();
    const rows: RuntimeInstanceView[] = [];
    for (const raw of payload.instances as { dispatchId?: unknown; attempt?: unknown; role?: unknown; state?: unknown; parentDispatchId?: unknown }[]) {
      if (typeof raw.dispatchId !== 'string' || typeof raw.attempt !== 'number' || typeof raw.state !== 'string') throw new RuntimeUnavailableError();
      if (recorded.has(`${raw.dispatchId}:${raw.attempt}`)) continue;
      rows.push({
        instanceId: `${thread}:${raw.dispatchId}:${raw.attempt}`,
        threadId: thread,
        dispatchId: raw.dispatchId,
        attempt: raw.attempt,
        role: typeof raw.role === 'string' && raw.role.length > 0 ? raw.role : null,
        objectiveId: null,
        parentDispatchId: typeof raw.parentDispatchId === 'string' ? raw.parentDispatchId : null,
        outcome: raw.state,
        terminal: raw.state !== 'running',
        source: 'mailbox',
      });
    }
    return rows;
  }
  /** P10c: the attempts and messages of one dispatch on a thread the engagement owns. */
  public async instanceMailbox(user: string, engagement: string, thread: string, dispatch: string): Promise<InstanceMailboxView> {
    await this.options.ownership.getBinding(user, engagement, thread);
    const view = await this.instanceView(thread, dispatch);
    // The intent is the replacement's source of truth on the server; the browser sees the attempt facts only.
    return {
      threadId: thread,
      dispatchId: dispatch,
      instances: view.attempts.map(({ attempt, role, state, startedAt, finishedAt }) => ({ attempt, role, state, startedAt, finishedAt })),
      messages: view.messages,
      source: 'runtime',
    };
  }
  private async instanceView(thread: string, dispatch: string): Promise<{ attempts: RuntimeAttemptRow[]; messages: InstanceMessageView[] }> {
    const reply = await this.options.reads.instanceExchange('GET', instancePath(thread, dispatch));
    const payload = reply.body as { instances?: unknown; messages?: unknown } | null;
    if (reply.status !== 200 || !payload || !Array.isArray(payload.instances) || !Array.isArray(payload.messages)) throw new RuntimeUnavailableError();
    const attempts = (payload.instances as { attempt: number; role: string | null; state: InstanceAttemptState; startedAt: string; finishedAt: string | null; intent: string | null; objectiveId: string | null }[])
      .map((row) => ({ attempt: row.attempt, role: row.role, state: row.state, startedAt: row.startedAt, finishedAt: row.finishedAt, intent: row.intent, objectiveId: row.objectiveId }));
    return { attempts, messages: payload.messages as InstanceMessageView[] };
  }
  /** W11: resume a pending graph interrupt on the bound thread; ack returns the NEW run identity. */
  public async resume(user: string, engagement: string, thread: string, raw: unknown): Promise<RequestRecoveryView> {
    const { requestId, value, questionId, answers, intent } = parseResumeCreate(raw);
    const { ownership, context, runtime } = this.options;
    const replay = await ownership.replay(user, engagement, requestId, 'resume', intent, thread);
    if (replay) return replay;
    let trusted: TrustedRuntimeContext;
    let resumePayload: string | string[] | Record<string, string | string[]>;
    try {
      const binding = await ownership.getBinding(user, engagement, thread);
      trusted = await context.resolve(user, engagement, { kind: binding.kind, threadId: thread });
      await this.options.authorizeMutation?.(user, engagement, trusted.kind, thread);
      if (!trusted.configurable.authorization_confirmed) throw conflict();
      const state = await this.threadState(user, engagement, thread);
      const pending = findPendingQuestions(state.values, state.tasks);
      if (!pending.length) throw conflict();
      if (questionId !== null && !answers && pending.length === 1 && pending[0]!.questionId !== questionId) throw conflict();
      // Parallel ask_user_question tool calls raise several interrupts at
      // once; LangGraph requires an interrupt-id-keyed resume map covering
      // every pending interrupt in one invocation.
      const byQuestion = new Map(pending.map(question => [question.questionId, question]));
      const resolved = answers ?? [{ questionId: questionId ?? pending[0]!.questionId, value }];
      if (pending.length > 1 && !answers) throw new ProjectPolicyError('bad_request', 'Multiple interrupts are pending — resume must answer every pending question');
      const cover = new Set(resolved.map(answer => answer.questionId));
      if (cover.size !== resolved.length || !pending.every(question => cover.has(question.questionId))) throw new ProjectPolicyError('bad_request', 'Resume must answer every pending question exactly once');
      // Legacy shape: a single pending interrupt without a LangGraph id keeps
      // resuming with the bare value.
      const legacy = pending.length === 1 && !pending[0]!.interruptId;
      const resumeMap: Record<string, string | string[]> = {};
      for (const answer of resolved) {
        const question = byQuestion.get(answer.questionId);
        if (!question) throw conflict();
        try { assertResumeValue(answer.value, question); }
        catch { throw new ProjectPolicyError('bad_request', `Resume answer does not match the pending question options (${answer.questionId})`); }
        if (!question.interruptId) {
          if (!legacy) throw conflict();
          continue;
        }
        resumeMap[question.interruptId] = answer.value;
      }
      resumePayload = legacy ? resolved[0]!.value : resumeMap;
    } catch (error) {
      const winner = await ownership.replay(user, engagement, requestId, 'resume', intent, thread);
      if (winner) return winner;
      throw error;
    }
    const reservation = await ownership.reserve(user, engagement, requestId, 'resume', intent, thread);
    if (!reservation.reserved) return reservation.request;
    await ownership.recordDispatch(user, engagement, requestId, reservation.token, trusted);
    return this.dispatch(user, engagement, requestId, reservation.token, async () => {
      const remote = await runtime.createResumeRun(thread, trusted, requestId, resumePayload);
      metadata(remote.metadata, { ...trusted.metadata, ui_request_id: requestId });
      return ownership.accept(user, engagement, requestId, reservation.token, thread, remote.runId);
    });
  }
  /** W11 pause/cancel: interrupt keeps the checkpoint resumable; terminal runs return truthfully unchanged. */
  public async cancelRun(user: string, engagement: string, thread: string, runId: string): Promise<ScopedRunView> {
    const { runtime } = this.options;
    const current = await this.getRun(user, engagement, thread, runId);
    if (['pending', 'running'].includes(current.rawStatus)) {
      // W02: cancel is a mutation. getRun is a read, so the operator gate must
      // run here explicitly — widening reads to members must not widen cancels.
      if (this.options.authorizeMutation !== undefined) {
        const binding = await this.options.ownership.getBinding(user, engagement, thread);
        await this.options.authorizeMutation(user, engagement, binding.kind, thread);
      }
      try { await runtime.cancelRun(thread, runId); }
      catch (error) {
        if (error instanceof RuntimeRejectedError) {
          const settled = await this.getRun(user, engagement, thread, runId);
          if (!['pending', 'running'].includes(settled.rawStatus)) return settled;
        }
        throw error;
      }
      return this.getRun(user, engagement, thread, runId);
    }
    return current;
  }
  public async snapshot(user: string, engagement: string, thread: string): Promise<ScopedThreadView> {
    const { ownership, context, reads } = this.options;
    const binding = await ownership.getBinding(user, engagement, thread);
    await context.resolve(user, engagement, { kind: binding.kind, threadId: thread });
    const remote = await reads.thread(thread);
    const { values, tasks } = await this.threadState(user, engagement, thread);
    const messages: ScopedThreadView['messages'] = [];
    const history = Array.isArray(values.messages) ? values.messages : [];
    let truncated = history.length > 50;
    for (const value of history.slice(-50)) {
      if (typeof value !== 'object' || value === null) continue;
      const { type, role, content, id, additional_kwargs } = value as Record<string, unknown>;
      const tag = role ?? type;
      if (typeof tag !== 'string' || !['user', 'human', 'assistant', 'ai'].includes(tag)) continue;
      if (typeof content !== 'string') { truncated = true; continue; }
      if (content.length > 8000) truncated = true;
      const messageId = typeof id === 'string' && id.length > 0 && id.length <= 256 ? id : null;
      const kwargs = typeof additional_kwargs === 'object' && additional_kwargs !== null ? additional_kwargs as Record<string, unknown> : {};
      const reasoning = typeof kwargs.reasoning_content === 'string' && kwargs.reasoning_content ? kwargs.reasoning_content.slice(0, 16000) : undefined;
      messages.push({ role: ['user', 'human'].includes(String(tag)) ? 'user' : 'assistant', content: content.slice(0, 8000), messageId, ...(reasoning ? { reasoning } : {}) });
    }
    const scope = { engagementId: engagement, threadId: thread, runId: '' };
    const transcripts = projectThreadHistory(scope, values);
    const pendingQuestions = findPendingQuestions(values, tasks);
    const pendingQuestion = pendingQuestions[0];
    return { binding, rawStatus: remote.status ?? null, messages, messagesTruncated: truncated, historyScope: 'root_messages_only', source: 'runtime', transcripts: transcripts.transcripts, transcriptsTruncated: transcripts.transcriptsTruncated, ...(pendingQuestion ? { pendingQuestion } : {}), ...(pendingQuestions.length > 0 ? { pendingQuestions } : {}) };
  }
  public async reconcile(user: string, engagement: string, requestId: string): Promise<RequestRecoveryView> {
    const { ownership, context, runtime, reads } = this.options;
    const row = await ownership.inspect(user, engagement, requestId);
    if (!['creating', 'uncertain'].includes(row.state) || !row.dispatchConfigHash || !row.dispatchAssistantId || !row.dispatchKind) return ownership.recover(user, engagement, requestId);
    const trusted = await context.resolve(user, engagement, { kind: row.dispatchKind, assistantId: row.dispatchAssistantId, ...(row.threadId ? { threadId: row.threadId } : {}) });
    if (trusted.runtimeConfigHash !== row.dispatchConfigHash) throw conflict();
    const expected = { ...trusted.metadata, ui_request_id: requestId };
    if (row.operation === 'create_thread' && row.candidateThreadId) {
      const remote = await reads.thread(row.candidateThreadId); metadata(remote.metadata, expected);
      await ownership.bindThread(user, engagement, { threadId: remote.thread_id, assistantId: trusted.assistantId, kind: trusted.kind, contextHash: trusted.bindingHash, runtimeConfigHash: trusted.runtimeConfigHash });
      return ownership.accept(user, engagement, requestId, row.reservationToken, remote.thread_id, null);
    }
    if (!row.threadId) throw conflict();
    const matches: RuntimeRun[] = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const page = await runtime.listRuns(row.threadId, offset, 100);
      matches.push(...page.filter(r => r.metadata.ui_request_id === requestId));
      if (page.length < 100) break;
      if (offset === 900) throw new RuntimeUnavailableError();
    }
    if (!matches.length) return ownership.recover(user, engagement, requestId);
    if (matches.length !== 1) throw conflict();
    metadata(matches[0]!.metadata, expected);
    const accepted = await ownership.accept(user, engagement, requestId, row.reservationToken, row.threadId, matches[0]!.runId);
    await this.getRun(user, engagement, row.threadId, matches[0]!.runId);
    return accepted;
  }
  public async reconcileStale(): Promise<void> {
    const outcomes = await Promise.allSettled((await this.options.ownership.staleDispatches()).map(row => this.reconcile(row.userId, row.engagementId, row.requestId)));
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new RuntimeUnavailableError();
  }
}
