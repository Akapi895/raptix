import { http, HttpError } from '../../platform/http';
import { agentEndpoint } from '../../platform/agent-endpoint';
import { parseSse } from '../../platform/sse';
import { chatResponseSchema, streamEventSchema, type ChatRequest, type StreamEvent } from '../types/chat';
import type { ApiOptions } from '../types/common';

// internal/app/app.go routes; internal/handler/eino_single_agent.go and
// internal/handler/multi_agent.go share ChatRequest, ChatResponse, StreamEvent.
export function createChatClient(transport = http) {
  return {
    send: async (body: ChatRequest, options: ApiOptions = {}) => transport.post(agentEndpoint(await transport.get('/api/config', options), false), body, { ...options, schema: chatResponseSchema }),
    async *stream(body: ChatRequest, options: ApiOptions = {}): AsyncGenerator<StreamEvent> {
      const address = agentEndpoint(await transport.get('/api/config', options));
      const response = await transport.raw(address, {
        ...options, method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text();
        let detail: unknown = text;
        try { detail = JSON.parse(text); } catch { /* Keep non-JSON gateway errors. */ }
        throw new HttpError(response.status, address, detail);
      }
      if (!response.body) throw new Error('Chat stream has no response body');
      // Aborting/returning stops this reader, not the background agent run.
      yield* parseSse(response.body.getReader(), { ...options, schema: streamEventSchema });
    },
  };
}
export const chat = createChatClient();
