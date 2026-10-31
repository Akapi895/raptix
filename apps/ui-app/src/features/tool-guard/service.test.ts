import { describe, expect, it, vi } from 'vitest';
import { createToolGuardService, type GuardTransport } from './service';

const serverConfig = { enabled: true, rules: [{ id: 'r1', name: 'Block', enabled: true, pattern: 'rm', message: 'No' }] };

function response(body: unknown, init: { status?: number; etag?: string } = {}): Response {
  const headers = new Headers();
  if (init.etag) headers.set('ETag', init.etag);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

function service(transport: GuardTransport) {
  return createToolGuardService({ transport, t: key => key, now: () => 1, random: () => 0.5 });
}

describe('tool-guard service', () => {
  it('loads the config with its ETag and keeps a pristine copy for dirty checks', async () => {
    const transport = { raw: vi.fn(async () => response(serverConfig, { etag: '"v1"' })) };
    const guard = service(transport);
    await guard.load();
    expect(guard.state.config?.rules[0]?.name).toBe('Block');
    expect(guard.state.etag).toBe('"v1"');
    expect(guard.isDirty()).toBe(false);
    guard.setEnabled(false);
    expect(guard.isDirty()).toBe(true);
    guard.reset();
    expect(guard.isDirty()).toBe(false);
  });

  it('sends If-Match with the loaded ETag when saving', async () => {
    const transport = {
      raw: vi.fn(async (_path: string, init?: RequestInit) => (init?.method === 'PUT'
        ? response(serverConfig, { etag: '"v2"' })
        : response(serverConfig, { etag: '"v1"' }))),
    };
    const guard = service(transport);
    await guard.load();
    guard.setEnabled(false);
    await guard.save();
    const put = transport.raw.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect((put?.[1]?.headers as Record<string, string>)['If-Match']).toBe('"v1"');
    expect(guard.state.etag).toBe('"v2"');
  });

  it('turns a version conflict into the conflict message', async () => {
    const transport = { raw: vi.fn(async () => response({ code: 'tool_guard_conflict' }, { status: 409 })) };
    const guard = service(transport);
    await expect(guard.load()).rejects.toThrow('loadFailed: saveConflict');
  });

  it('commits a valid draft only after the backend accepts it', async () => {
    const transport = {
      raw: vi.fn(async (path: string) => (path === '/api/tool-guard/test'
        ? response({ blocked: false })
        : response(serverConfig, { etag: '"v1"' }))),
    };
    const guard = service(transport);
    await guard.load();
    const draft = guard.startAdd('default');
    draft.rule.name = 'New';
    draft.rule.pattern = 'curl';
    await guard.commitAdd(draft);
    expect(guard.state.config?.rules).toHaveLength(2);
    expect(guard.state.addDraft).toBeNull();
  });
});
