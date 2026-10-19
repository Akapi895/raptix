import { describe, expect, it } from 'vitest';
import { RuntimeUnavailableError } from '../src/integrations/runtime/read-client.js';
import { RunService } from '../src/services/runtime/run-service.js';

// ADR-0092 I07: reconciling a migrated thread with the environment that serves it. Doubles only; the live check runs
// against a copy of a real project.
const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const CONTEXT = 'c'.repeat(64);
const expectedMetadata = { engagement_id: 'eng-r', workspace_slug: 'reddish', ui_assistant_id: 'soundwave', graph_id: 'soundwave', ui_flow: 'planning', runtime_context_hash: NEW };
const GOOD_STATE = { authorization_confirmed: true, engagement_name: 'reddish', workspace_path: '/workspace/reddish', messages: [{ role: 'human' }, { role: 'ai' }] };

interface Options {
  operator?: boolean;
  managed?: boolean;
  exists?: boolean | 'unavailable';
  remote?: 'matching' | 'different';
  state?: Record<string, unknown>;
  /** The manifest count an operator already imported for this thread; null means none was imported. */
  verifiedMessageCount?: number | null;
  auditFails?: boolean;
}

function fixture(options: Options = {}) {
  const created: { id: string; metadata: unknown }[] = [];
  const rebinds: unknown[] = [];
  const audits: string[] = [];
  const auditFailures: unknown[] = [];
  let storedHash: string | null = OLD;
  const ownership = {
    requireOperator: async () => { if (options.operator === false) throw new Error('operator access required'); },
    verifiedMessageCount: async () => (options.verifiedMessageCount === undefined ? 2 : options.verifiedMessageCount),
    getBinding: async () => ({ threadId: 't-1', assistantId: 'soundwave', kind: 'planning' }),
    runtimeConfigHashOf: async () => storedHash,
    rebindThreadConfig: async (_user: string, _engagement: string, input: { expectedRuntimeConfigHash: string | null; contextHash: string; runtimeConfigHash: string }) => {
      if (input.expectedRuntimeConfigHash !== storedHash) throw new Error('compare-and-set mismatch');
      rebinds.push(input);
      storedHash = input.runtimeConfigHash;
      return { threadId: 't-1' };
    },
  };
  const context = {
    resolve: async () => ({ configurable: { authorization_confirmed: true, engagement_name: 'reddish', workspace_path: '/workspace/reddish' }, metadata: expectedMetadata, bindingHash: CONTEXT, runtimeConfigHash: NEW }),
  };
  const runtime = { createThread: async (id: string, metadata: unknown) => { created.push({ id, metadata }); return { threadId: id, metadata }; } };
  const reads = {
    threadExists: async () => {
      if (options.exists === 'unavailable') throw new RuntimeUnavailableError();
      return options.exists ?? false;
    },
    thread: async () => ({ thread_id: 't-1', metadata: options.remote === 'different' ? { ...expectedMetadata, engagement_id: 'other' } : expectedMetadata }),
    state: async () => ({ values: options.state ?? GOOD_STATE, graphId: 'soundwave' }),
  };
  const router = {
    endpoint: async () => ({ apiUrl: 'http://env', environmentId: options.managed === false ? null : 'env-r', generation: 1 }),
    execution: async () => runtime,
    reads: async () => reads,
  };
  const audit = async (_actor: string, _engagement: string, action: string) => {
    if (options.auditFails) throw new Error('audit write failed');
    audits.push(action);
  };
  const onAuditFailure = (error: unknown) => { auditFailures.push(error); };
  const service = new RunService({ ownership, context, runtime, reads, router, audit, onAuditFailure } as unknown as ConstructorParameters<typeof RunService>[0]);
  return { service, created, rebinds, audits, auditFailures, storedHash: () => storedHash };
}

describe('rebind a migrated thread to the environment (ADR-0092 I07)', () => {
  it('creates the runtime record under this environment, checks the history, moves the binding and audits it', async () => {
    const f = fixture();
    const result = await f.service.rebindThread('local', 'eng-r', 't-1');
    expect(result).toEqual({ threadId: 't-1', previousRuntimeConfigHash: OLD, runtimeConfigHash: NEW, created: true });
    expect(f.created).toEqual([{ id: 't-1', metadata: expectedMetadata }]);
    expect(f.rebinds).toEqual([{ threadId: 't-1', expectedRuntimeConfigHash: OLD, contextHash: CONTEXT, runtimeConfigHash: NEW }]);
    expect(f.audits).toEqual(['thread.rebound']);
    expect(f.storedHash()).toBe(NEW);
  });

  it('refuses a viewer before anything reaches the runtime', async () => {
    const f = fixture({ operator: false });
    await expect(f.service.rebindThread('viewer', 'eng-r', 't-1')).rejects.toThrow('operator access required');
    expect(f.created).toHaveLength(0);
    expect(f.rebinds).toHaveLength(0);
  });

  it('refuses a thread with no imported verified message count, before anything reaches the runtime', async () => {
    const f = fixture({ verifiedMessageCount: null });
    await expect(f.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.created).toHaveLength(0);
    expect(f.rebinds).toHaveLength(0);
  });

  it('refuses a project without an environment record, so it never rebinds inside the legacy runtime', async () => {
    const f = fixture({ managed: false });
    await expect(f.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.created).toHaveLength(0);
    expect(f.rebinds).toHaveLength(0);
  });

  it('treats a transient read failure as unavailable, never as a missing thread', async () => {
    const f = fixture({ exists: 'unavailable' });
    await expect(f.service.rebindThread('local', 'eng-r', 't-1')).rejects.toBeInstanceOf(RuntimeUnavailableError);
    expect(f.created).toHaveLength(0);
    expect(f.rebinds).toHaveLength(0);
  });

  it('refuses an empty history, and a history whose message count differs from the imported one', async () => {
    const empty = fixture({ exists: true, state: {} });
    await expect(empty.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(empty.rebinds).toHaveLength(0);
    const mismatch = fixture({ exists: true, verifiedMessageCount: 3 });
    await expect(mismatch.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(mismatch.rebinds).toHaveLength(0);
  });

  it('refuses a history that disagrees with this environment, and changes no binding', async () => {
    const f = fixture({ state: { ...GOOD_STATE, engagement_name: 'other-project' } });
    await expect(f.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.rebinds).toHaveLength(0);
    expect(f.storedHash()).toBe(OLD);
  });

  it('refuses an existing runtime record that belongs to other metadata, and changes no binding', async () => {
    const f = fixture({ exists: true, remote: 'different' });
    await expect(f.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.created).toHaveLength(0);
    expect(f.rebinds).toHaveLength(0);
  });

  it('keeps an existing runtime record that already carries this environment\'s metadata', async () => {
    const f = fixture({ exists: true, remote: 'matching' });
    const result = await f.service.rebindThread('local', 'eng-r', 't-1');
    expect(result.created).toBe(false);
    expect(f.created).toHaveLength(0);
    expect(f.storedHash()).toBe(NEW);
  });

  it('reports success when the binding already moved, even if the audit write then fails', async () => {
    const f = fixture({ auditFails: true });
    const result = await f.service.rebindThread('local', 'eng-r', 't-1');
    expect(result.created).toBe(true);
    expect(f.rebinds).toHaveLength(1);
    expect(f.storedHash()).toBe(NEW);
    expect(f.auditFailures).toHaveLength(1);
  });
});
