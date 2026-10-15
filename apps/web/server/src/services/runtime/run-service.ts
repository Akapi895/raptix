import { randomUUID } from 'node:crypto';
import type { RequestRecoveryView, ScopedRunView, ScopedThreadView, ThreadBindingView } from '@raptix/web-contracts';
import type { RuntimeExecutionPort, RuntimeRun } from '../../integrations/runtime/execution-client.js';
import type { RuntimeReadPort } from '../../integrations/runtime/read-client.js';
import { RuntimeCheckpointMissingError, RuntimeRejectedError, RuntimeUnavailableError } from '../../integrations/runtime/read-client.js';
import { ProjectPolicyError } from '../../security/project-policy.js';
import { parseResumeCreate, parseRunCreate, parseRunPage, parseThreadCreate } from '../../security/run-policy.js';
import type { RuntimeOwnershipService } from '../runtime-ownership.js';
import type { RuntimeContextService, TrustedRuntimeContext } from './runtime-context.js';
import { projectThreadHistory } from './history-projection.js';
import { assertResumeValue, findPendingQuestions } from './interrupt-projection.js';

const conflict = (): ProjectPolicyError => new ProjectPolicyError('conflict', 'Runtime context, readiness or active-run policy prevents this operation');
const terminal = (status: string): boolean => ['success', 'error', 'timeout', 'interrupted'].includes(status);
function metadata(actual: Record<string, unknown>, expected: Record<string, string>): void {
  if (Object.entries(expected).some(([k, v]) => actual[k] !== v)) throw conflict();
}
export class RunService {
  public constructor(private readonly options: { ownership: RuntimeOwnershipService; context: RuntimeContextService; runtime: RuntimeExecutionPort; reads: RuntimeReadPort; authorizeMutation?: (user: string, engagement: string, kind: 'planning' | 'execution', threadId: string | null) => Promise<void> }) {}
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
  public async submit(user: string, engagement: string, thread: string, raw: unknown): Promise<RequestRecoveryView> {
    const { requestId, message, intent } = parseRunCreate(raw);
    const { ownership, context, runtime } = this.options;
    const replay = await ownership.replay(user, engagement, requestId, 'create_run', intent, thread);
    if (replay) return replay;
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
        if (runs.some(r => !terminal(r.status))) throw conflict();
        if (runs.length < 100) break;
        if (offset === 900) throw new RuntimeUnavailableError();
      }
    } catch (error) {
      const winner = await ownership.replay(user, engagement, requestId, 'create_run', intent, thread);
      if (winner) return winner;
      throw error;
    }
    const reservation = await ownership.reserve(user, engagement, requestId, 'create_run', intent, thread);
    if (!reservation.reserved) return reservation.request;
    await ownership.recordDispatch(user, engagement, requestId, reservation.token, trusted);
    return this.dispatch(user, engagement, requestId, reservation.token, async () => {
      const remote = await runtime.createRun(thread, trusted, requestId, message);
      metadata(remote.metadata, { ...trusted.metadata, ui_request_id: requestId });
      return ownership.accept(user, engagement, requestId, reservation.token, thread, remote.runId);
    });
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
