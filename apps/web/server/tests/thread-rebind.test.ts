import { describe, expect, it } from 'vitest';
import { RuntimeRejectedError } from '../src/integrations/runtime/read-client.js';
import { RunService } from '../src/services/runtime/run-service.js';

// ADR-0092 I07: reconciling a migrated thread with the environment that serves it. Doubles only; the live check runs
// against a copy of a real project.
const OLD = 'a'.repeat(64);
const NEW = 'b'.repeat(64);
const CONTEXT = 'c'.repeat(64);
const expectedMetadata = { engagement_id: 'eng-r', workspace_slug: 'reddish', ui_assistant_id: 'soundwave', graph_id: 'soundwave', ui_flow: 'planning', runtime_context_hash: NEW };

function fixture(options: { remote: 'missing' | 'matching' | 'different'; stateValues?: Record<string, unknown> }) {
  const stateValues = options.stateValues ?? { authorization_confirmed: true, engagement_name: 'reddish', workspace_path: '/workspace/reddish' };
  const created: { id: string; metadata: unknown }[] = [];
  const rebinds: unknown[] = [];
  let storedHash: string | null = OLD;
  const ownership = {
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
    state: async () => ({ values: stateValues, graphId: 'soundwave' }),
    thread: async () => {
      if (options.remote === 'missing') throw new RuntimeRejectedError(404);
      return { thread_id: 't-1', metadata: options.remote === 'matching' ? expectedMetadata : { ...expectedMetadata, engagement_id: 'other' } };
    },
  };
  const router = { execution: async () => runtime, reads: async () => reads };
  const service = new RunService({ ownership, context, runtime, reads, router } as unknown as ConstructorParameters<typeof RunService>[0]);
  return { service, created, rebinds, storedHash: () => storedHash };
}

describe('rebind a migrated thread to the environment (ADR-0092 I07)', () => {
  it('creates the runtime record under this environment and moves the binding, recording the old fingerprint', async () => {
    const f = fixture({ remote: 'missing' });
    const result = await f.service.rebindThread('local', 'eng-r', 't-1');
    expect(result).toEqual({ threadId: 't-1', previousRuntimeConfigHash: OLD, runtimeConfigHash: NEW, created: true });
    expect(f.created).toEqual([{ id: 't-1', metadata: expectedMetadata }]);
    expect(f.rebinds).toEqual([{ threadId: 't-1', expectedRuntimeConfigHash: OLD, contextHash: CONTEXT, runtimeConfigHash: NEW }]);
    expect(f.storedHash()).toBe(NEW);
  });

  it('keeps an existing runtime record that already carries this environment\'s metadata', async () => {
    const f = fixture({ remote: 'matching' });
    const result = await f.service.rebindThread('local', 'eng-r', 't-1');
    expect(result.created).toBe(false);
    expect(f.created).toHaveLength(0);
    expect(f.storedHash()).toBe(NEW);
  });

  it('refuses a history that disagrees with this environment, and changes no binding', async () => {
    const f = fixture({ remote: 'missing', stateValues: { engagement_name: 'other-project' } });
    await expect(f.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.rebinds).toHaveLength(0);
    expect(f.storedHash()).toBe(OLD);
  });

  it('refuses a runtime record that belongs to other metadata, and changes no binding', async () => {
    const f = fixture({ remote: 'different' });
    await expect(f.service.rebindThread('local', 'eng-r', 't-1')).rejects.toMatchObject({ code: 'conflict' });
    expect(f.created).toHaveLength(0);
    expect(f.rebinds).toHaveLength(0);
    expect(f.storedHash()).toBe(OLD);
  });
});
