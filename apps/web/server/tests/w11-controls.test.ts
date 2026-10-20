import { describe, expect, it } from 'vitest';
import { RuntimeRejectedError, RuntimeUnavailableError } from '../src/integrations/runtime/read-client.js';
import { assertResumeValue, findPendingQuestion, findPendingQuestions } from '../src/services/runtime/interrupt-projection.js';
import { RunService } from '../src/services/runtime/run-service.js';

const time = '2026-10-02T00:00:00.000Z';
const binding = { engagementId: 'eng', threadId: 'thread', assistantId: 'soundwave', kind: 'planning' as const, createdAt: time, updatedAt: time };
const question = { type: 'ask_user_question', agent: 'soundwave', id: 'call-1', question: 'Proceed with the authorized scan?', header: 'Confirm', options: [{ label: 'Yes (Recommended)', description: 'go' }, { label: 'No', description: 'stop' }], multi_select: false, allow_other: true };

type Ports = ConstructorParameters<typeof RunService>[0];
const ports = (overrides: Partial<Ports>): Ports => ({
  ownership: {
    getBinding: async () => binding,
    runs: async () => [],
    replay: async () => null,
    reserve: async () => ({ reserved: true as const, token: 'token', request: { engagementId: 'eng', requestId: 'request-0001', operation: 'resume' as const, state: 'creating' as const, threadId: 'thread', runId: null, createdAt: time, updatedAt: time } }),
    recordDispatch: async () => undefined,
    accept: async (_user: string, _engagement: string, requestId: string, _token: string, threadId: string, runId: string | null) => ({ engagementId: 'eng', requestId, operation: 'resume' as const, state: 'accepted' as const, threadId, runId, createdAt: time, updatedAt: time }),
  } as unknown as Ports['ownership'],
  context: { resolve: async () => ({ configurable: { authorization_confirmed: true }, assistantId: 'soundwave', kind: 'planning', metadata: {}, bindingHash: 'hash', runtimeConfigHash: 'cfg' }) } as unknown as Ports['context'],
  runtime: {} as Ports['runtime'],
  reads: { transcripts: async () => ({ events: [], oldestSeq: null }), state: async () => ({ values: { __interrupt__: [{ value: question, id: 'i1', ns: [] }] }, graphId: 'soundwave' }) } as unknown as Ports['reads'],
  ...overrides,
});

describe('pending interrupt projection', () => {
  it('restores the question from __interrupt__ envelopes and nested task values', () => {
    expect(findPendingQuestion({ __interrupt__: [{ value: question }] })).toMatchObject({ questionId: 'call-1', multiSelect: false, allowOther: true, options: [{ label: 'Yes (Recommended)', description: 'go' }, { label: 'No', description: 'stop' }] });
    expect(findPendingQuestion({ __interrupt__: [{ value: { __interrupt__: [{ value: question }] } }] })).toMatchObject({ questionId: 'call-1' });
    expect(findPendingQuestion({})).toBeNull();
    expect(findPendingQuestion({ __interrupt__: [{ value: { type: 'unknown' } }] })).toBeNull();
    expect(findPendingQuestion({ __interrupt__: [{ value: { ...question, id: 42 } }] })).toBeNull();
    expect(findPendingQuestion({}, [{ id: 'task-1', interrupts: [{ id: 'interrupt-1', value: question }] }])).toMatchObject({ questionId: 'call-1', question: question.question });
    expect(findPendingQuestion({}, [{ interrupts: [{ value: { ...question, id: 42 } }] }])).toBeNull();
  });
  it('collects every pending interrupt with its LangGraph id for parallel questions', () => {
    const q2 = { ...question, id: 'call-2', question: 'Reporting language?' };
    const all = findPendingQuestions({}, [{ interrupts: [{ id: 'ig-1', value: question }] }, { interrupts: [{ id: 'ig-2', value: q2 }] }]);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ questionId: 'call-1', interruptId: 'ig-1' });
    expect(all[1]).toMatchObject({ questionId: 'call-2', interruptId: 'ig-2' });
    // Bare question envelopes (no interrupt id) still restore, without an id.
    expect(findPendingQuestions({ __interrupt__: [{ value: question }] })).toEqual([expect.objectContaining({ questionId: 'call-1' })]);
    expect(findPendingQuestions({ __interrupt__: [{ value: question }] })[0]!.interruptId).toBeUndefined();
    expect(findPendingQuestions({})).toEqual([]);
  });
  it('validates answers against option labels, allow_other and multi-select semantics', () => {
    const pending = findPendingQuestion({ __interrupt__: [{ value: question }] })!;
    assertResumeValue('Yes (Recommended)', pending);
    assertResumeValue('Custom operator answer', pending);
    expect(() => assertResumeValue('', pending)).toThrow();
    expect(() => assertResumeValue('Not offered', { ...pending, allowOther: false })).toThrow();
    expect(() => assertResumeValue(['Yes (Recommended)'], pending)).toThrow();
    const multi = findPendingQuestion({ __interrupt__: [{ value: { ...question, multi_select: true } }] })!;
    assertResumeValue(['Yes (Recommended)', 'Custom'], multi);
    expect(() => assertResumeValue('Yes (Recommended)', multi)).toThrow();
    expect(() => assertResumeValue([], multi)).toThrow();
    expect(() => assertResumeValue(['nope'], { ...multi, allowOther: false })).toThrow();
  });
});

describe('RunService.resume', () => {
  it('acknowledges a new run identity for a validated pending question', async () => {
    const dispatched: unknown[] = [];
    const service = new RunService(ports({ runtime: { createResumeRun: async (_t: string, _c: unknown, requestId: string, resume: string | string[] | Record<string, string | string[]>) => { dispatched.push({ requestId, resume }); return { runId: 'run-new', threadId: 'thread', status: 'pending', createdAt: time, updatedAt: time, metadata: { ui_request_id: requestId } }; } } as unknown as Ports['runtime'] }));
    const ack = await service.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: 'Yes (Recommended)' });
    expect(ack).toMatchObject({ state: 'accepted', runId: 'run-new', operation: 'resume' });
    // The interrupt envelope carries the LangGraph id, so the resume payload is keyed by it.
    expect(dispatched).toEqual([{ requestId: 'request-0001', resume: { i1: 'Yes (Recommended)' } }]);
  });
  it('resumes a question exposed only by LangGraph task interrupts', async () => {
    const service = new RunService(ports({
      reads: { transcripts: async () => ({ events: [], oldestSeq: null }), state: async () => ({ values: {}, tasks: [{ interrupts: [{ value: question }] }], graphId: 'soundwave' }) } as unknown as Ports['reads'],
      runtime: { createResumeRun: async (_t: string, _c: unknown, requestId: string) => ({ runId: 'run-new', threadId: 'thread', status: 'pending', createdAt: time, updatedAt: time, metadata: { ui_request_id: requestId } }) } as unknown as Ports['runtime'],
    }));
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0001', questionId: 'call-1', value: 'Yes (Recommended)' })).resolves.toMatchObject({ operation: 'resume', runId: 'run-new' });
  });
  it('replays the same requestId without a second runtime attempt', async () => {
    let attempts = 0;
    const service = new RunService(ports({
      runtime: { createResumeRun: async () => { attempts++; return { runId: 'run-new', threadId: 'thread', status: 'pending', createdAt: time, updatedAt: time, metadata: {} }; } } as unknown as Ports['runtime'],
      ownership: { replay: async () => ({ engagementId: 'eng', requestId: 'request-0001', operation: 'resume', state: 'accepted', threadId: 'thread', runId: 'run-original', createdAt: time, updatedAt: time }) } as unknown as Ports['ownership'],
    }));
    const ack = await service.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: 'Yes (Recommended)' });
    expect(ack.runId).toBe('run-original');
    expect(attempts).toBe(0);
  });
  it('conflicts without a pending interrupt or a mismatched question target and rejects wrong answers', async () => {
    const dispatched: unknown[] = [];
    const runtime = { createResumeRun: async (_t: string, _c: unknown, requestId: string, resume: string | string[] | Record<string, string | string[]>) => { dispatched.push({ requestId, resume }); return { runId: 'run-new', threadId: 'thread', status: 'pending', createdAt: time, updatedAt: time, metadata: { ui_request_id: requestId } }; } } as unknown as Ports['runtime'];
    const noInterrupt = new RunService(ports({ reads: { transcripts: async () => ({ events: [], oldestSeq: null }), state: async () => ({ values: {}, graphId: null }) } as unknown as Ports['reads'] }));
    await expect(noInterrupt.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: 'Yes (Recommended)' })).rejects.toMatchObject({ code: 'conflict' });
    const service = new RunService(ports({ runtime }));
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: 'Yes (Recommended)', questionId: 'other-call' })).rejects.toMatchObject({ code: 'conflict' });
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: ['Yes (Recommended)'] })).rejects.toMatchObject({ code: 'bad_request' });
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: 'Yes (Recommended)', questionId: 'call-1' })).resolves.toMatchObject({ state: 'accepted' });
    expect(dispatched).toHaveLength(1);
  });
  it('resumes every pending interrupt in one interrupt-id-keyed map when parallel questions are pending', async () => {
    const q2 = { type: 'ask_user_question', agent: 'soundwave', id: 'call-2', question: 'Reporting language?', header: 'Language', options: [{ label: 'Tiếng Việt', description: 'vn' }], multi_select: false, allow_other: false };
    const dispatched: unknown[] = [];
    const service = new RunService(ports({
      reads: { transcripts: async () => ({ events: [], oldestSeq: null }), state: async () => ({ values: {}, tasks: [{ interrupts: [{ id: 'ig-1', value: question }] }, { interrupts: [{ id: 'ig-2', value: q2 }] }], graphId: 'soundwave' }) } as unknown as Ports['reads'],
      runtime: { createResumeRun: async (_t: string, _c: unknown, requestId: string, resume: string | string[] | Record<string, string | string[]>) => { dispatched.push({ requestId, resume }); return { runId: 'run-new', threadId: 'thread', status: 'pending', createdAt: time, updatedAt: time, metadata: { ui_request_id: requestId } }; } } as unknown as Ports['runtime'],
    }));
    // Single-value resume against multiple pending interrupts is rejected.
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: 'Yes (Recommended)' })).rejects.toMatchObject({ code: 'bad_request' });
    // Partial coverage is rejected.
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0002', answers: [{ questionId: 'call-1', value: 'Yes (Recommended)' }] })).rejects.toMatchObject({ code: 'bad_request' });
    // A wrong answer fails validation.
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0003', answers: [{ questionId: 'call-1', value: 'Yes (Recommended)' }, { questionId: 'call-2', value: 'English' }] })).rejects.toMatchObject({ code: 'bad_request' });
    // Full coverage resumes every interrupt in one keyed map.
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0004', answers: [{ questionId: 'call-1', value: 'Yes (Recommended)' }, { questionId: 'call-2', value: 'Tiếng Việt' }] })).resolves.toMatchObject({ state: 'accepted' });
    expect(dispatched).toEqual([{ requestId: 'request-0004', resume: { 'ig-1': 'Yes (Recommended)', 'ig-2': 'Tiếng Việt' } }]);
  });
  it('marks the ledger uncertain when the runtime disappears after reservation', async () => {
    const marks: string[] = [];
    const service = new RunService(ports({
      runtime: { createResumeRun: async () => { throw new RuntimeUnavailableError(); } } as unknown as Ports['runtime'],
      ownership: {
        getBinding: async () => binding,
        replay: async () => null,
        reserve: async () => ({ reserved: true as const, token: 'token', request: { engagementId: 'eng', requestId: 'request-0001', operation: 'resume', state: 'creating', threadId: 'thread', runId: null, createdAt: time, updatedAt: time } }),
        recordDispatch: async () => marks.push('dispatch'),
        markUncertain: async () => marks.push('uncertain'),
      } as unknown as Ports['ownership'],
    }));
    await expect(service.resume('local', 'eng', 'thread', { requestId: 'request-0001', value: 'Yes (Recommended)' })).rejects.toBeInstanceOf(RuntimeUnavailableError);
    expect(marks).toEqual(['dispatch', 'uncertain']);
  });
});

describe('RunService.cancelRun', () => {
  const base = (runtime: Ports['runtime']): RunService => new RunService(ports({
    runtime,
    ownership: {
      getBinding: async () => binding,
      runOwner: async () => ({ requestId: 'request-0001', dispatchAssistantId: 'soundwave', dispatchKind: 'planning', dispatchConfigHash: 'cfg' }),
      releaseCompletedRun: async () => undefined,
    } as unknown as Ports['ownership'],
    context: { resolve: async () => ({}) } as unknown as Ports['context'],
    reads: {} as Ports['reads'],
  }));
  const runtimeWith = (start: string, settled: string, cancelCalls: string[] = []): Ports['runtime'] => {
    let reads = 0;
    return {
      run: async () => ({ runId: 'run-1', threadId: 'thread', status: reads++ === 0 || settled === start ? start : settled, createdAt: time, updatedAt: time, metadata: { engagement_id: 'eng', ui_request_id: 'request-0001', ui_assistant_id: 'soundwave', graph_id: 'soundwave', ui_flow: 'planning', runtime_context_hash: 'cfg' } }),
      cancelRun: async () => { cancelCalls.push('cancel'); },
    } as unknown as Ports['runtime'];
  };
  it('interrupts only non-terminal owned runs and returns the settled runtime state', async () => {
    const calls: string[] = [];
    const service = base(runtimeWith('running', 'interrupted', calls));
    const view = await service.cancelRun('local', 'eng', 'thread', 'run-1');
    expect(view.rawStatus).toBe('interrupted');
    expect(calls).toEqual(['cancel']);
  });
  it('releases ownership of an interrupted run so the bound thread can receive a follow-up', async () => {
    let released = 0;
    const service = new RunService(ports({
      ownership: {
        getBinding: async () => binding,
        runOwner: async () => ({ requestId: 'request-0001', dispatchAssistantId: 'soundwave', dispatchKind: 'planning', dispatchConfigHash: 'cfg' }),
        releaseCompletedRun: async () => { released++; },
      } as unknown as Ports['ownership'],
      context: { resolve: async () => ({}) } as unknown as Ports['context'],
      runtime: runtimeWith('interrupted', 'interrupted'),
    }));
    expect((await service.getRun('local', 'eng', 'thread', 'run-1')).rawStatus).toBe('interrupted');
    expect(released).toBe(1);
  });
  it('is truthfully idempotent for already-terminal runs', async () => {
    const calls: string[] = [];
    const service = base(runtimeWith('success', 'success', calls));
    expect((await service.cancelRun('local', 'eng', 'thread', 'run-1')).rawStatus).toBe('success');
    expect(calls).toEqual([]);
  });
  it('surfaces a runtime rejection when the run never settles', async () => {
    const fullMeta = { engagement_id: 'eng', ui_request_id: 'request-0001', ui_assistant_id: 'soundwave', graph_id: 'soundwave', ui_flow: 'planning', runtime_context_hash: 'cfg' };
    const failing = {
      run: async () => ({ runId: 'run-1', threadId: 'thread', status: 'running', createdAt: time, updatedAt: time, metadata: fullMeta }),
      cancelRun: async () => { throw new RuntimeRejectedError(409); },
    } as unknown as Ports['runtime'];
    await expect(base(failing).cancelRun('local', 'eng', 'thread', 'run-1')).rejects.toBeInstanceOf(RuntimeRejectedError);
  });
});

describe('RunService.snapshot pending interrupt restore', () => {
  const service = (values: Record<string, unknown>, tasks: unknown = []) => new RunService(ports({
    ownership: { getBinding: async () => binding, runs: async () => [] } as unknown as Ports['ownership'],
    context: { resolve: async () => ({}) } as unknown as Ports['context'],
    runtime: {} as Ports['runtime'],
    reads: { transcripts: async () => ({ events: [], oldestSeq: null }), thread: async () => ({ thread_id: 'thread', metadata: {}, status: 'interrupted' }), state: async () => ({ values, tasks, graphId: 'soundwave' }) } as unknown as Ports['reads'],
  }));
  it('exposes the restoreable question additively and nothing when the thread is clean', async () => {
    const interrupted = await service({ messages: [], __interrupt__: [{ value: question }] }).snapshot('local', 'eng', 'thread');
    expect(interrupted.pendingQuestion).toMatchObject({ questionId: 'call-1', source: 'runtime' });
    expect(interrupted.pendingQuestions).toHaveLength(1);
    const clean = await service({ messages: [] }).snapshot('local', 'eng', 'thread');
    expect(clean.pendingQuestion).toBeUndefined();
    expect(clean.pendingQuestions).toBeUndefined();
    const taskInterrupt = await service({ messages: [] }, [{ interrupts: [{ value: question }] }]).snapshot('local', 'eng', 'thread');
    expect(taskInterrupt.pendingQuestion).toMatchObject({ questionId: 'call-1', source: 'runtime' });
  });
  it('reports checkpoint loss for a previously used thread instead of an empty resumable history', async () => {
    const lost = new RunService(ports({
      ownership: { getBinding: async () => binding, runs: async () => [{ runId: 'prior-run' }] } as unknown as Ports['ownership'],
      context: { resolve: async () => ({}) } as unknown as Ports['context'],
      runtime: { run: async () => ({ status: 'success' }) } as unknown as Ports['runtime'],
      reads: { transcripts: async () => ({ events: [], oldestSeq: null }), thread: async () => ({ thread_id: 'thread', metadata: {}, status: 'interrupted' }), state: async () => ({ values: {}, tasks: [], graphId: null }) } as unknown as Ports['reads'],
    }));
    await expect(lost.snapshot('local', 'eng', 'thread')).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('checkpoint is missing') });
  });
  it('does not claim checkpoint loss while the initial run is still pending', async () => {
    const starting = new RunService(ports({
      ownership: { getBinding: async () => binding, runs: async () => [{ runId: 'prior-run' }] } as unknown as Ports['ownership'],
      context: { resolve: async () => ({}) } as unknown as Ports['context'],
      runtime: { run: async () => ({ status: 'pending' }) } as unknown as Ports['runtime'],
      reads: { transcripts: async () => ({ events: [], oldestSeq: null }), thread: async () => ({ thread_id: 'thread', metadata: {}, status: 'busy' }), state: async () => ({ values: {}, tasks: [], graphId: null }) } as unknown as Ports['reads'],
    }));
    await expect(starting.snapshot('local', 'eng', 'thread')).resolves.toMatchObject({ rawStatus: 'busy', messages: [] });
  });
});
