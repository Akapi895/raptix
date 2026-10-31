import { z } from 'zod';
import { timestampSchema } from './common';

// internal/handler/agent.go:ChatRequest and its nested request structs. Keep Go
// strings open (e.g. reasoning effort is forwarded to different model gateways).
export interface ChatRequest {
  message: string; conversationId?: string; projectId?: string; role?: string;
  attachments?: { fileName: string; content?: string; mimeType?: string; serverPath?: string }[];
  webshellConnectionId?: string; aiChannelId?: string;
  hitl?: { enabled: boolean; mode?: string; reviewer?: string; sensitiveTools?: string[]; timeoutSeconds?: number };
  reasoning?: { mode?: string; effort?: string };
  finalization?: { requireExecutionEvidence?: boolean | null };
}
// internal/handler/agent.go:ChatResponse (JSON endpoints).
export const chatResponseSchema = z.looseObject({
  response: z.string(), mcpExecutionIds: z.array(z.string()).optional(), conversationId: z.string(), time: timestampSchema,
  finalizable: z.boolean(), finalized: z.boolean(), status: z.string().optional(), completionReason: z.string().optional(),
  evidenceVerified: z.boolean(), evidenceRefs: z.array(z.string()).optional(), pendingExecutionIds: z.array(z.string()).optional(),
  missingChecks: z.array(z.string()).optional(), autoCancelledPendingExecutionIds: z.array(z.string()).optional(),
});
export type ChatResponse = z.infer<typeof chatResponseSchema>;

// internal/handler/agent.go:StreamEvent uses interface{} data and open string type.
// Validate the envelope without dropping new progress types or tool payloads.
export const streamEventSchema = z.looseObject({ type: z.string(), message: z.string(), data: z.unknown().optional() });
export type StreamEvent = z.infer<typeof streamEventSchema>;
// Known lifecycle payloads are grounded in eino_single_agent.go, multi_agent.go,
// and workflow_integration.go. The legacy mock omits agentMode on response.
// Consumers can safeParse these after narrowing type; progress data stays unknown.
export const conversationEventSchema = streamEventSchema.extend({
  type: z.literal('conversation'), data: z.looseObject({ conversationId: z.string() }),
});
export const messageSavedEventSchema = streamEventSchema.extend({
  type: z.literal('message_saved'), data: z.looseObject({ conversationId: z.string(), userMessageId: z.string() }),
});
export const responseEventSchema = streamEventSchema.extend({
  type: z.literal('response'), data: z.looseObject({
    conversationId: z.string(), messageId: z.string(), agentMode: z.string().optional(),
    // Workflow responses omit this; Go map values can contain nil slices.
    mcpExecutionIds: z.array(z.string()).nullable().optional(),
  }),
});
export const knownLifecycleEventSchema = z.discriminatedUnion('type', [conversationEventSchema, messageSavedEventSchema, responseEventSchema]);
export type KnownLifecycleEvent = z.infer<typeof knownLifecycleEventSchema>;
