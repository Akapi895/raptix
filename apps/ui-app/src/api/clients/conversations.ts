import { http } from '../../platform/http';
import { messageResultSchema, type ApiOptions } from '../types/common';
import { conversationSchema, conversationListSchema, type CreateConversationRequest, type ConversationQuery } from '../types/conversation';

// internal/app/app.go routes; internal/handler/conversation.go contracts.
export function createConversationsClient(transport = http) {
  const path = (id: string) => `/api/conversations/${encodeURIComponent(id)}`;
  return {
    list: (query: ConversationQuery = {}, options: ApiOptions = {}) => transport.get('/api/conversations', { ...options, query, schema: conversationListSchema }),
    get: (id: string, query: { include_process_details?: boolean } = {}, options: ApiOptions = {}) => transport.get(path(id), { ...options, query, schema: conversationSchema }),
    create: (body: CreateConversationRequest = {}, options: ApiOptions = {}) => transport.post('/api/conversations', body, { ...options, schema: conversationSchema }),
    updateTitle: (id: string, title: string, options: ApiOptions = {}) => transport.put(path(id), { title }, { ...options, schema: conversationSchema }),
    delete: (id: string, options: ApiOptions = {}) => transport.delete(path(id), { ...options, schema: messageResultSchema }),
    // The legacy mock acknowledges these mutations differently from Go. Neither
    // response is consumed: callers use their input or refetch the conversation.
    async setProject(id: string, projectId: string, options: ApiOptions = {}): Promise<void> {
      await transport.put<unknown>(`${path(id)}/project`, { projectId }, options);
    },
    async setPinned(id: string, pinned: boolean, options: ApiOptions = {}): Promise<void> {
      await transport.put<unknown>(`${path(id)}/pinned`, { pinned }, options);
    },
  };
}
export const conversations = createConversationsClient();
