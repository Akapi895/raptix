import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createHttp } from '../../platform/http';
import { createAuthClient } from './auth';
import { createProjectsClient } from './projects';
import { createConversationsClient } from './conversations';
import { createVulnerabilitiesClient } from './vulnerabilities';
import { createAssetsClient } from './assets';
import { createChatClient } from './chat';
import { toStoredSession } from '../types/auth';
import { projectSchema } from '../types/project';
import { conversationSchema } from '../types/conversation';
import { assetSchema } from '../types/asset';

const time = '2026-10-28T12:00:00.123456789+07:00';
// Fixtures transcribed from internal/database/{project,conversation,asset}.go
// and internal/handler/auth.go; IDs intentionally are not assumed to be UUIDs.
const project = { id: 'project-1', name: 'Lab', status: 'active', pinned: false, created_at: time, updated_at: time };
const conversation = { id: 'conv-1', title: 'Review', pinned: false, createdAt: time, updatedAt: time };
const authSession = {
  token: 'session-token', expires_at: time, session_duration_hr: 12,
  user: { id: 'user-1', username: 'admin', display_name: 'Admin' },
  roles: ['admin'], permissions: ['project:read'], permission_scopes: { 'project:read': 'all' }, scope: 'all',
};
const asset = {
  id: 'asset-1', host: 'example.com', ip: '', port: 443, domain: 'example.com', protocol: 'https',
  title: '', server: '', country: '', province: '', city: '', responsible_person: '', department: '',
  business_system: '', environment: '', criticality: '', source: 'manual', source_query: '', status: 'active', tags: [],
  first_seen_at: time, last_seen_at: time, created_at: time, updated_at: time, vulnerability_count: 0, risk_level: 'info',
};

function boundary() {
  const fetcher = vi.fn<typeof fetch>();
  const clear = vi.fn();
  const transport = createHttp({ fetcher, session: { read: () => ({ token: 'private' }), clear } });
  return { transport, fetcher, clear };
}

describe('Go API contracts', () => {
  it('validates auth before mapping API expiry to persisted browser expiry', async () => {
    const { transport, fetcher, clear } = boundary();
    const auth = createAuthClient(transport);
    fetcher.mockResolvedValueOnce(Response.json(authSession));
    const result = await auth.login({ username: 'admin', password: 'secret' });
    expect(toStoredSession(result)).toEqual({
      token: 'session-token', expiresAt: time, user: authSession.user,
      roles: ['admin'], permissions: ['project:read'], scope: 'all',
    });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/auth/login');
    expect(new Headers(init?.headers).get('Authorization')).toBeNull();
    fetcher.mockResolvedValueOnce(Response.json({ ...authSession, expires_at: 'yesterday' }));
    await expect(auth.validate()).rejects.toBeInstanceOf(z.ZodError);
    fetcher.mockResolvedValueOnce(Response.json({ error: 'wrong password' }, { status: 401 }));
    await expect(auth.login({ username: 'admin', password: 'wrong' })).rejects.toMatchObject({ status: 401 });
    expect(clear).not.toHaveBeenCalled();
  });

  it('keeps snake_case project DTOs distinct from camelCase conversations and validates nested messages', () => {
    expect(projectSchema.parse(project)).toMatchObject(project);
    expect(projectSchema.safeParse({ ...project, created_at: undefined, createdAt: time }).success).toBe(false);
    expect(conversationSchema.parse({ ...conversation, projectId: 'p', messages: [] })).toMatchObject({ projectId: 'p', messages: [] });
    expect(conversationSchema.safeParse({ ...conversation, createdAt: undefined, created_at: time }).success).toBe(false);
    expect(conversationSchema.safeParse({ ...conversation, messages: [{ role: 'assistant', content: 123 }] }).success).toBe(false);
  });

  it('uses project offset envelopes, URL-encodes IDs and preserves partial update semantics', async () => {
    const { transport, fetcher } = boundary();
    const projects = createProjectsClient(transport);
    fetcher.mockResolvedValueOnce(Response.json({ projects: [project], total: 1, limit: 50, offset: 0 }));
    expect((await projects.list({ search: 'a & b', offset: 0 })).projects[0]).toMatchObject(project);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/projects?search=a+%26+b&offset=0');
    fetcher.mockResolvedValueOnce(Response.json(project));
    await projects.update('p/a b', { pinned: false, description: '' });
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/projects/p%2Fa%20b');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('PUT');
    expect(fetcher.mock.calls[1]?.[1]?.body).toBe('{"pinned":false,"description":""}');
    fetcher.mockResolvedValueOnce(Response.json({ projects: [project], total: 1, page: 1, page_size: 20 }));
    await expect(projects.list()).rejects.toBeInstanceOf(z.ZodError);
  });

  it('fetches facts as a bare array and separates project_id filters from projectId bodies', async () => {
    const { transport, fetcher } = boundary();
    const projects = createProjectsClient(transport);
    const conversations = createConversationsClient(transport);
    fetcher.mockResolvedValueOnce(Response.json([]));
    expect(await projects.facts('p')).toEqual([]);
    fetcher.mockResolvedValueOnce(Response.json({ conversations: [conversation], total: 1, limit: 50, offset: 0 }));
    await conversations.list({ project_id: '__none__' });
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/conversations?project_id=__none__');
    fetcher.mockResolvedValueOnce(Response.json({ success: true, projectId: '' }));
    await conversations.setProject('conv/1', '');
    expect(fetcher.mock.calls[2]?.[0]).toBe('/api/conversations/conv%2F1/project');
    expect(fetcher.mock.calls[2]?.[1]?.body).toBe('{"projectId":""}');
    fetcher.mockResolvedValueOnce(Response.json({ success: true }));
    await expect(conversations.setPinned('conv-1', false)).resolves.toBeUndefined();
  });

  it('keeps vulnerability limit queries and page responses, including the legacy mock omission', async () => {
    const { transport, fetcher } = boundary();
    const vulnerabilities = createVulnerabilitiesClient(transport);
    const page = { vulnerabilities: [], total: 42, page: 2, page_size: 20, total_pages: 3 };
    fetcher.mockResolvedValueOnce(Response.json(page));
    expect(await vulnerabilities.list({ limit: 20, page: 2, project_id: 'p' })).toMatchObject(page);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/vulnerabilities?limit=20&page=2&project_id=p');
    const legacyPage = { vulnerabilities: [], total: 42, page: 2, page_size: 20 };
    fetcher.mockResolvedValueOnce(Response.json(legacyPage));
    expect((await vulnerabilities.list()).total_pages).toBe(3);
    fetcher.mockResolvedValueOnce(Response.json({ ...page, page_size: '20' }));
    await expect(vulnerabilities.list()).rejects.toBeInstanceOf(z.ZodError);
  });

  it('uses asset import rather than an invented create route and normalizes only null scan timestamps', async () => {
    const { transport, fetcher } = boundary();
    const assets = createAssetsClient(transport);
    fetcher.mockResolvedValueOnce(Response.json({ assets: [{ ...asset, last_scan_at: null }], total: 1, page: 1, page_size: 20, total_pages: 1 }));
    const result = await assets.list({ page_size: 20, min_vulnerabilities: 0, scan_state: 'never' });
    expect(result.assets[0]?.last_scan_at).toBeUndefined();
    expect(assetSchema.safeParse({ ...asset, last_scan_at: null }).success).toBe(false);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/assets?page_size=20&min_vulnerabilities=0&scan_state=never');
    fetcher.mockResolvedValueOnce(Response.json({ created: 1, updated: 0, skipped: 0 }));
    await assets.import([{ host: 'example.com', port: 443, protocol: 'https' }], 'manual');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/assets/import');
    expect(fetcher.mock.calls[1]?.[1]?.method).toBe('POST');
    fetcher.mockResolvedValueOnce(Response.json({ imported: 2, skipped: 0 }));
    expect(await assets.import([{ ip: '192.0.2.1' }, { domain: 'example.com' }])).toMatchObject({ created: 2, updated: 0, skipped: 0 });
    fetcher.mockResolvedValueOnce(Response.json({ assets: [{ ...asset, last_scan_at: 'invalid' }], total: 1, page: 1, page_size: 20, total_pages: 1 }));
    await expect(assets.list()).rejects.toBeInstanceOf(z.ZodError);
  });
});

describe('chat streaming boundary', () => {
  it('validates JSON chat completion fields instead of confusing them with SSE payloads', async () => {
    const { transport, fetcher } = boundary();
    const chat = createChatClient(transport);
    fetcher.mockResolvedValueOnce(Response.json({ multi_agent: { enabled: false } }));
    fetcher.mockResolvedValueOnce(Response.json({ response: 'Done', conversationId: 'c', time, finalizable: true, finalized: true, evidenceVerified: false }));
    expect((await chat.send({ message: 'Review' })).response).toBe('Done');
    expect(fetcher.mock.calls[1]?.[0]).toBe('/api/eino-agent');
    fetcher.mockResolvedValueOnce(Response.json({ multi_agent: { enabled: true } }));
    fetcher.mockResolvedValueOnce(Response.json({ type: 'response', message: 'Done', data: { conversationId: 'c' } }));
    await expect(chat.send({ message: 'Review' })).rejects.toBeInstanceOf(z.ZodError);
    expect(fetcher.mock.calls[3]?.[0]).toBe('/api/multi-agent');
  });

  it('streams the Go envelope, retains extension payloads and releases on early stop', async () => {
    const { transport, fetcher } = boundary();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"type":"new_progress_type","message":"working","data":{"nested":[1,true]}}\n\n'));
      }, cancel,
    });
    fetcher.mockResolvedValueOnce(Response.json({ multi_agent: { enabled: false } }));
    fetcher.mockResolvedValueOnce(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }));
    const controller = new AbortController();
    const chat = createChatClient(transport);
    for await (const event of chat.stream({ message: 'Review', conversationId: 'c' }, { signal: controller.signal })) {
      expect(event).toEqual({ type: 'new_progress_type', message: 'working', data: { nested: [1, true] } });
      break;
    }
    const [url, init] = fetcher.mock.calls[1]!;
    expect(url).toBe('/api/eino-agent/stream');
    expect(init?.signal).toBe(controller.signal);
    expect(init?.body).toBe('{"message":"Review","conversationId":"c"}');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer private');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('rejects malformed envelopes and cancels the body', async () => {
    const { transport, fetcher } = boundary();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"type":"progress","message":42}\n\n')); }, cancel,
    });
    fetcher.mockResolvedValueOnce(Response.json({ multi_agent: { enabled: true } }));
    fetcher.mockResolvedValueOnce(new Response(body));
    const events = createChatClient(transport).stream({ message: 'Review' });
    await expect(events.next()).rejects.toBeInstanceOf(z.ZodError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('reports HTTP errors through the shared transport before attempting SSE', async () => {
    const { transport, fetcher, clear } = boundary();
    fetcher.mockResolvedValueOnce(Response.json({ multi_agent: { enabled: true } }));
    fetcher.mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 401 }));
    const events = createChatClient(transport).stream({ message: 'Review' });
    await expect(events.next()).rejects.toMatchObject({ status: 401, message: 'expired', url: '/api/multi-agent/stream' });
    expect(clear).toHaveBeenCalledOnce();
    fetcher.mockResolvedValueOnce(Response.json({ multi_agent: { enabled: false } }));
    fetcher.mockResolvedValueOnce(new Response('upstream down', { status: 502 }));
    await expect(createChatClient(transport).stream({ message: 'Review' }).next()).rejects.toMatchObject({ status: 502, body: 'upstream down' });
  });
});
