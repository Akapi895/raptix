import { z } from 'zod';
import { offsetFields, timestampSchema } from './common';

// internal/database/conversation.go:Message. processDetails is intentionally an
// open map in Go; nested event payloads are decoded by their eventual consumers.
export const messageSchema = z.looseObject({
  id: z.string(), conversationId: z.string(), role: z.string(), content: z.string(),
  reasoningContent: z.string().optional(), mcpExecutionIds: z.array(z.string()).optional(),
  processDetails: z.array(z.record(z.string(), z.unknown())).optional(),
  createdAt: timestampSchema, updatedAt: timestampSchema,
});
// internal/database/vulnerability_retest.go:VulnerabilityRetest.
export const vulnerabilityRetestSchema = z.looseObject({
  conversation_id: z.string(), source_conversation_id: z.string(), vulnerability_id: z.string(),
  source_project_id: z.string(), pending_prompt: z.string().optional(),
});
// internal/database/conversation.go:Conversation; internal/handler/conversation.go.
export const conversationSchema = z.looseObject({
  id: z.string(), title: z.string(), projectId: z.string().optional(), roleName: z.string().optional(),
  agentMode: z.string().optional(), pinned: z.boolean(), createdAt: timestampSchema, updatedAt: timestampSchema,
  messages: z.array(messageSchema).optional(), retest: vulnerabilityRetestSchema.optional(),
});
export const conversationListSchema = z.looseObject({ conversations: z.array(conversationSchema), ...offsetFields });
export type Message = z.infer<typeof messageSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationList = z.infer<typeof conversationListSchema>;
export type VulnerabilityRetest = z.infer<typeof vulnerabilityRetestSchema>;
export interface CreateConversationRequest { title?: string; projectId?: string }
export type ConversationQuery = {
  limit?: number; offset?: number; search?: string; sort_by?: string;
  /** Go's __none__ sentinel selects conversations without a project. */
  project_id?: string;
};
