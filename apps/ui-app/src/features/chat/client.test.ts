import { describe, expect, it, vi } from 'vitest';
import { createHttp } from '../../platform/http';
import { createChatDomainClient } from './client';

describe('backend-owned chat transport', () => {
  it.each([false, true])('routes from backend config (multi enabled: %s), preserving the request', async enabled => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ multi_agent: { enabled } }))
      .mockResolvedValueOnce(new Response('data: {"type":"response","message":"Recorded","data":{}}\n\n'));
    const transport = createHttp({ fetcher });
    const client = createChatDomainClient(transport);
    const body = { message: 'Review', conversationId: 'c1', projectId: 'p1', role: 'reviewer', attachments: [{ fileName: 'notes.txt', serverPath: 'uploads/notes.txt' }], reasoning: { effort: 'high' }, finalization: { requireExecutionEvidence: true } };
    const signal = new AbortController().signal;
    const accepted = vi.fn();
    const events = [];
    for await (const event of client.stream(body, signal, accepted)) events.push(event);
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/config');
    expect(fetcher.mock.calls[1]?.[0]).toBe(enabled ? '/api/multi-agent/stream' : '/api/eino-agent/stream');
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual(body);
    expect(fetcher.mock.calls[1]?.[1]?.signal).toBe(signal);
    expect(accepted).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: 'response', message: 'Recorded', data: {} }]);
  });

  it('does not start a run when backend configuration cannot be read', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ error: 'Unavailable' }, { status: 503 }));
    const client = createChatDomainClient(createHttp({ fetcher }));
    const accepted = vi.fn();
    await expect(client.stream({ message: 'Review' }, new AbortController().signal, accepted).next()).rejects.toMatchObject({ status: 503 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(accepted).not.toHaveBeenCalled();
  });
});
