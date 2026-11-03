import { z } from 'zod';
import { http, HttpError } from '../../platform/http';
import { agentEndpoint } from '../../platform/agent-endpoint';
import { parseSse } from '../../platform/sse';
import { streamEventSchema, type ChatRequest } from '../../api/types/chat';
import { conversations } from '../../api/clients/conversations';

export function createChatDomainClient(transport = http, conversationClient = conversations) {
  return {
    conversations: conversationClient,
    async *stream(body: ChatRequest, signal: AbortSignal, accepted: () => void) {
      const path = agentEndpoint(await transport.get('/api/config', { signal }));
      const response = await transport.raw(path, { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, signal });
      if (!response.ok) throw new HttpError(response.status, path, await response.text());
      if (!response.body) throw new Error('Chat stream has no response body');
      accepted();
      yield* parseSse(response.body.getReader(), { signal, schema: streamEventSchema });
    },
    deleteTurn: (id: string, messageId: string) => transport.post<unknown>(`/api/conversations/${encodeURIComponent(id)}/delete-turn`, { messageId }),
    plan: (id: string, signal?: AbortSignal) => transport.get(`/api/conversations/${encodeURIComponent(id)}/plan-tasks`, {
      signal, schema: z.object({ tasks: z.array(z.unknown()).default([]), running: z.boolean().optional() }),
    }),
    config: () => transport.get('/api/config', { schema: z.record(z.string(), z.unknown()) }),
    models: (channelId: string, refresh = false) => transport.get('/api/ai/models', {
      query: { channel_id: channelId || undefined, refresh: refresh ? '1' : undefined }, schema: z.record(z.string(), z.unknown()),
    }),
    saveConfig: (config: Record<string, unknown>) => transport.post<unknown>('/api/config', config),
    tools: () => transport.get('/api/mcp/tools', { schema: z.unknown() }),
    externalTools: () => transport.get('/api/mcp/external', { schema: z.unknown() }),
    execution: (id: string) => transport.get(`/api/mcp/executions/${encodeURIComponent(id)}`, { schema: z.record(z.string(), z.unknown()) }),
    cancelExecution: (id: string, note: string) => transport.post<unknown>(`/api/mcp/executions/${encodeURIComponent(id)}/cancel`, { userNote: note }),
    processDetails: (id: string, signal?: AbortSignal) => transport.get(`/api/messages/${encodeURIComponent(id)}/process-details`, {
      signal, schema: z.unknown(),
    }),
    usage: (id: string, signal?: AbortSignal) => transport.get(`/api/conversations/${encodeURIComponent(id)}/token-usage`, { signal, schema: z.unknown() }),
    attackChain: (id: string) => transport.get(`/api/attack-chain/${encodeURIComponent(id)}`, { schema: z.unknown() }),
    regenerateAttackChain: (id: string) => transport.post<unknown>(`/api/attack-chain/${encodeURIComponent(id)}/regenerate`),
  };
}
export type ChatClient = ReturnType<typeof createChatDomainClient>;
