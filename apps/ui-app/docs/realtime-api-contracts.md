# Realtime, streaming and terminal API contracts

Snapshot: 2026-10-31. Extracted only from ui-app. No real backend transport was contacted. HTTP handshake/stream operations also occur in openapi.yaml; the WebSocket is separate.

## Protocol inventory

| Method/path | Wire protocol | Classification/evidence |
| --- | --- | --- |
| POST /api/eino-agent/stream | Fetch response, text/event-stream | shared; src/api/clients/chat.ts, src/features/chat/client.ts, src/mock/routes/chat.ts:424 |
| POST /api/multi-agent/stream | Fetch response, text/event-stream | shared; same sources, routes/chat.ts:425 |
| GET /api/agent-loop/task-events | Fetch response, text/event-stream | shared; src/features/chat/replay/attach.ts:97; routes/chat.ts:251 |
| GET /api/c2/events/stream | Native EventSource; JSON data messages | frontend-used; src/platform/access-browser.ts:66. No HTTP mock route; generic demo EventSource intercept emits only heartbeats |
| POST /api/terminal/run/stream | Fetch SSE producer | mock-only; src/mock/routes/platform.ts:676 |
| WS /api/terminal/ws | interactive terminal text/control/binary frames | frontend-used and generic socket mock-supported; src/features/terminal/service.ts:12; src/mock/terminal.ts |

There are five HTTP streaming operations and one WebSocket connection path. Native EventSource is not used for authenticated POST chat. No additional websocket path was found in source. src/platform/ws.ts is a generic utility, not another endpoint.

## Agent request and endpoint selection

src/platform/agent-endpoint.ts reads /api/config: multi_agent.enabled selects /api/multi-agent, otherwise /api/eino-agent; stream suffix defaults true. The typed client also exposes non-streaming JSON methods with the same ChatRequest. JSON requests use Content-Type: application/json and (in typed chat client) Accept: text/event-stream. Shared HTTP adds Authorization bearer when session exists; these fetch calls can use custom injected transports. Server auth/permission enforcement UNKNOWN.

ChatRequest (all nested fields below are explicit source types; no invented enum restrictions):

```ts
export interface ChatRequest {
  message: string; conversationId?: string; projectId?: string; role?: string;
  attachments?: { fileName: string; content?: string; mimeType?: string; serverPath?: string }[];
  webshellConnectionId?: string; aiChannelId?: string;
  hitl?: { enabled: boolean; mode?: string; reviewer?: string; sensitiveTools?: string[]; timeoutSeconds?: number };
  reasoning?: { mode?: string; effort?: string };
  finalization?: { requireExecutionEvidence?: boolean | null };
}
```

Typical structural request (field names/types only, not an observed run):

```json
{"message":"","conversationId":"","projectId":"","role":"","attachments":[],"hitl":{"enabled":false},"reasoning":{"mode":"","effort":""},"finalization":{"requireExecutionEvidence":true}}
```

WebShell AI supplies webshellConnectionId and requireExecutionEvidence:true, optionally projectId/reasoning (src/features/webshell/service.ts:254–255). The mock bodies.agent decoder accepts only message, nullish conversationId, projectId and role; extra ChatRequest fields are stripped. Empty message causes 400 {error:"Message is required"}. Mock conversation creation and scripted run have no real execution side effects.

## SSE framing and decoding

Source: src/platform/sse.ts:15–98. UTF-8 decoder maintains a chunk buffer; handles CR, LF and CRLF. A blank line completes a frame. data lines join with newline; event defaults message; id persists and excludes NUL; retry accepts nonnegative digit text. Comment lines beginning colon are ignored. Default maximum event/line buffer is 8 Mi characters. EOF flushes a final event even without a blank separator. readSseFrames yields {event:string,data:string,id:string,retry?:number}. parseSse JSON.parse decodes data; [DONE] stops parsing; optional schema validates the JSON envelope. It does not itself implement reconnection/Last-Event-ID. Malformed JSON/oversize frames throw. Abort cancels reader, finally releases its lock.

Mock buildMockResponse (src/platform/mock-transport.ts:22–60) emits data: <JSON> followed by a blank line, Content-Type:text/event-stream and Cache-Control:no-cache. Event type is the JSON type field, not an SSE event header. Array producer delay defaults 120 ms; __delay is removed before sending. Signals and reader cancellation stop the stream; producer errors error the stream. Mock does not emit a required [DONE] marker.

Example frame shape (from the mock producer, not a captured backend):

```text
data: {"type":"response_delta","message":"Hi","data":{"conversationId":"conv-recon-01","delta":"Hi"}}

```

The example delta is illustrative text; event structure and conversation ID are source-grounded.

## Envelope and event payloads

Explicit envelope: {type:string,message:string,data?:unknown}; z.looseObject permits extra keys (src/api/types/chat.ts:25). Known narrowed payload schemas exist for conversation, message_saved and response; response agentMode is optional and mcpExecutionIds can be null. Event type remains open; unknown/new event kinds must not be silently treated as impossible.

The scripted mock emits the following exact payload interfaces; publish() adds conversationId to every event data object (src/mock/routes/chat.ts:193):

```ts
export interface RunEventData {
  conversation: { conversationId: string };
  message_saved: { userMessageId: string };
  progress: { stage: string; mode: string };
  iteration: { iteration: number; mode: string };
  thinking: { iteration: number };
  error: { retryable: boolean };
  done: { status: string; workflowStatus?: string };
  knowledge_retrieval: { hits: number };
  tool_calls_detected: { count: number };
  tool_call: { toolName: string; toolCallId: string; index: number; total: number; arguments: { target: string; ports: string } | { query: string } };
  hitl_interrupt: { interruptId: string; toolName: string; toolCallId: string; arguments: { endpoint: string; attempts: number }; reason: string; status: string; reviewer: string };
  cancelled: Record<string, never>;
  hitl_rejected: { interruptId: string; decision: 'reject' };
  hitl_resumed: { interruptId: string; decision: 'approve' };
  tool_result: { toolName: string; toolCallId: string; success: boolean; executionId: string; durationMs: number };
  response_start: { mode: string };
  response_delta: { delta: string };
  response: { mcpExecutionIds: string[]; messageId: string; finalized: boolean; finalizable: boolean; completionReason: string; evidenceVerified: boolean; missingChecks: string[] };
}
```

Production-specific progress/workflow/tool payloads consumed elsewhere may have additional fields. Open-ended data, finalization metadata, per-agent streams and embedded execution details are not closed enums. Source consumer evidence is supplied below so fields not in mock interfaces remain visible.

### src/api/types/chat.ts

```ts
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

```

### src/features/chat/stream.ts

```ts
import { streamEventSchema, type StreamEvent } from '../../api/types/chat';
import { BACKEND_INTERRUPT_CONTINUE_PREFIX } from '@/platform/backend-legacy-strings';
import type { LiveChatStream } from './types';

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
export function strings(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item.trim()))] : [];
}
export function parseChatEvent(value: unknown): StreamEvent { return streamEventSchema.parse(value); }
export function eventConversation(event: StreamEvent): string { return text(record(event.data).conversationId).trim(); }
export function ownsStream(stream: LiveChatStream, current: LiveChatStream | null, navigation: number): boolean {
  return current === stream && stream.active && !stream.detached && stream.navigationSeq === navigation;
}
export function mergeStreamingText(previous: string, delta: string, accumulated?: unknown): string {
  if (typeof accumulated === 'string') return accumulated;
  if (!delta || delta === previous) return previous;
  // Gateways sometimes send the complete prefix rather than an incremental delta.
  return delta.startsWith(previous) ? delta : previous + delta;
}
/** A response/done envelope alone is not evidence of a finalized answer. */
export function finalization(value: unknown): {
  finalized: boolean; finalizable: boolean; status: string; reason: string;
  pendingExecutionIds: string[]; missingChecks: string[]; evidenceRefs: string[];
} {
  const data = record(value);
  return { finalized: data.finalized === true, finalizable: data.finalizable === true,
    status: text(data.status), reason: text(data.completionReason),
    pendingExecutionIds: strings(data.pendingExecutionIds), missingChecks: strings(data.missingChecks), evidenceRefs: strings(data.evidenceRefs) };
}
export function finalizationNotice(value: unknown): string {
  const result = finalization(value);
  return ['Final answer is not verified.', result.reason || 'missing_finalization_contract',
    result.pendingExecutionIds.length ? `Pending tools: ${result.pendingExecutionIds.join(', ')}` : '',
    result.missingChecks.length ? `Missing checks: ${result.missingChecks.join(', ')}` : ''].filter(Boolean).join('\n');
}
export function isInterruptContinue(content: string): boolean {
  return content.trimStart().startsWith(BACKEND_INTERRUPT_CONTINUE_PREFIX);
}

```

### src/features/webshell/ai.ts

```ts
import type { AiEvent, AiMessage, ProcessDetail } from './service';

export function simplifyWebshellAiError(raw: string): string {
  const message = raw.trim();
  if (/(401|unauthorized)/i.test(message) && /(api key|apikey)/i.test(message)) return 'Authentication failed: API key missing or invalid (401)';
  if (/(timeout|timed out)/i.test(message)) return 'Request timed out; try again later';
  if (/(network|failed to fetch)/i.test(message)) return 'Network error; check service connectivity'
  return message || 'Request failed';
}
export function isLikelyWebshellAiErrorMessage(message: AiMessage): boolean {
  return /^(\u6267\u884c\u5931\u8d25|\u8bf7\u6c42\u5931\u8d25|\u8bf7\u6c42\u5f02\u5e38|error)\s*[:\uff1a]/i.test(message.content.trim()) || /(status code\s*:\s*4\d{2}|unauthorized|forbidden|apikey|api key|invalid api key|noderunerror|tool[-_ ]?error|agent[-_ ]?error|\u6267\u884c\u5931\u8d25)/i.test(message.content) || message.processDetails?.some(detail => detail.eventType.toLowerCase() === 'error') === true;
}
export function coalesceWebshellProcessDetails(details: ProcessDetail[], reasoning?: string): ProcessDetail[] {
  const result: ProcessDetail[] = [];
  const calls = new Map<string, ProcessDetail>();
  const streams = new Map<string, ProcessDetail>();
  for (const detail of details) {
    if (['conversation', 'response_start', 'response_delta', 'response', 'done'].includes(detail.eventType)) continue;
    const data = { ...detail.data };
    const streamId = typeof data.streamId === 'string' ? data.streamId : '';
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : '';
    if (streamId && /_stream_(?:start|delta|end)$/.test(detail.eventType)) {
      const type = detail.eventType.replace(/_stream_(?:start|delta|end)$/, '');
      const key = type + ':' + streamId;
      let item = streams.get(key);
      if (!item) { item = { eventType: type, message: '', data }; streams.set(key, item); result.push(item); }
      if (detail.eventType.endsWith('_start')) item.message = '';
      else if (typeof data.accumulated === 'string') item.message = data.accumulated;
      else if (detail.eventType.endsWith('_end')) item.message = detail.message || item.message;
      else item.message += detail.message;
      continue;
    }
    if (detail.eventType === 'tool_result' && toolCallId && calls.has(toolCallId)) {
      const call = calls.get(toolCallId)!; call.data = { ...call.data, _mergedResult: data }; continue;
    }
    const item = { ...detail, data }; result.push(item);
    if (detail.eventType === 'tool_call' && toolCallId) calls.set(toolCallId, item);
  }
  if (reasoning && !result.some(detail => detail.eventType === 'reasoning_chain' && detail.message === reasoning)) result.unshift({ eventType: 'reasoning_chain', message: reasoning });
  return result;
}
export function webshellUsageMessage(data: Record<string, unknown>, t: (key: string, fallback: string) => string): string {
  const fields = [['modelCalls', 'chat.einoUsageModelCalls', 'Model calls'], ['promptTokens', 'chat.einoUsagePromptTokens', 'Prompt tokens'], ['completionTokens', 'chat.einoUsageCompletionTokens', 'Completion tokens'], ['totalTokens', 'chat.einoUsageTotalTokens', 'Total tokens'], ['cachedTokens', 'chat.einoUsageCachedTokens', 'Cached tokens'], ['cacheWriteTokens', 'chat.einoUsageCacheWriteTokens', 'Cache-write tokens'], ['reasoningTokens', 'chat.einoUsageReasoningTokens', 'Reasoning tokens']];
  return fields.filter(([key], index) => index < 4 || Number(data[key!]) > 0).map(([key, label, fallback]) => `${t(label!, fallback!)}: ${Math.max(0, Math.trunc(Number(data[key!]) || 0)).toLocaleString()}`).join('\n');
}
/** Keeps retry/failover context visible instead of losing structured fields. */
export function webshellEventMessage(event: AiEvent): string {
  const data = event.data;
  if (event.type === 'eino_model_retry') return (event.message || 'The model call hit a temporary problem; Eino is retrying natively…') + (data.reason ? '\nReason: ' + String(data.reason) : '') + (data.error ? '\nError detail: ' + String(data.error) : '');
  if (event.type === 'eino_model_failover') return (event.message || 'Primary model retries exhausted; switching to the fallback model.') + (data.channel ? '\nChannel: ' + String(data.channel) : '') + (data.model ? '\nModel: ' + String(data.model) : '');
  return event.message;
}

```

## Completion, cancellation and reattachment

The mock starts an independent background run, publishes conversation/message_saved, planning/iteration/thinking, optional knowledge/tool/HITL, response deltas, final response and done. Error scenario emits error then done(status:error). Rejection emits hitl_rejected and done; cancellation emits cancelled. Final response carries finalized/finalizable/evidenceVerified, completionReason, missingChecks and execution IDs (routes/chat.ts:315–421). A model-looking response alone is not proof of completion: WebShell checks finalization/evidence fields (service.ts:34–42, 248 onward).

Aborting a fetch reader does not cancel the background agent. UI cancellation calls POST /api/agent-loop/cancel. Reattach first checks active tasks, then GET task-events?conversationId=<id>, loads process details/inline approvals and consumes replay. The mock replays from index 0 then follows live events; after run completion the run is retained up to 30 seconds. No active run produces heartbeat every 15 seconds and stays open until cancelled. No cursor, delivery ordering across reconnects, exactly-once delivery, or Last-Event-ID resumption contract is defined. Replay consumer reconciles stored conversation on EOF/no done (src/features/chat/replay/attach.ts:73–180). Stream parser failure and non-OK handshake are client errors; exact production HTTP error schemas remain UNKNOWN.

## C2 native EventSource

Connection: same-origin /api/c2/events/stream?token=<URL-encoded stored token>; absent token omits query. No custom Authorization header, credentials option or subprotocol is supplied by openAccessEventStream. Listener processes default message events, JSON.parse payload, ignores malformed JSON and returns close() that calls source.close(). Native EventSource owns reconnect/retry; no explicit reconnect/backoff or event ID logic in this wrapper.

C2Event source type (not proof every property appears in an event):

```ts
export interface C2Event {
  id: string; level: string; category: string; sessionId?: string; taskId?: string;
  message: string; data?: Record<string, JsonValue | undefined>; createdAt: string;
}
```

src/features/c2/service.ts:240–263 reacts to session/task category, level, message and sessionId/data.session_id, refreshes affected views and closes stream when leaving C2/disposal. In demo, src/platform/mock-transport.ts:164–197 intercepts any /api/ EventSource pathname, opens after ~80 ms, emits only {type:"heartbeat",message:"",data:{}} every 15 seconds (src/mock/index.ts:19), closes by clearing timer. This is not evidence of real C2 session/task event payloads or HTTP endpoint registration.

## Interactive PTY WebSocket

URL: ws://<current host>/api/terminal/ws or wss:// for HTTPS; optional token query URL-encoded (src/features/terminal/service.ts:12–13). No protocol/headers negotiated in the frontend. Handshake status/auth failure body, origin policy, ping/pong and real server timeouts UNKNOWN. Each tab owns a PTY connection.

Client-to-server frames: ordinary input is raw string keystrokes (not a JSON envelope). Control frame is JSON {"type":"resize","cols":80,"rows":24}. Client accepts integral dimensions 1..65535; stores default 80x24, sends current size on open, then drains pending keystrokes. Queue max 256 while connecting; overflow reports error. Closed/replacement PTY clears queue, so input is not replayed into another PTY. No automatic timer reconnect: send() can trigger connect() after closure. Disposal removes listeners and closes with code 1000 / reason Client closed.

Server-to-client: raw string, ArrayBuffer or Blob supported. Binary/Blob converts to Uint8Array; Blob conversions are serialized with subsequent frames, preventing output reorder. Raw bytes/text go to terminal output, no server JSON message envelope is required. Native errors/close are reported to UI; no application-level close code enum is defined. Generic src/platform/ws.ts also queues frames but is not a separate wire protocol.

Mock source src/mock/terminal.ts: fake prompt, echo/backspace/newline handling; ignores resize JSON. whoami/pwd/id/uname/ls/help/date/clear return fixed/demo output. No shell executes. Socket transport interception opens after ~120 ms, greets with empty send, stringifies sent data and emits text frames only. Binary support is client expectation, not mock-confirmed binary behavior. Any /api/ WebSocket pathname is broadly intercepted; only terminal/ws is an actual frontend path.

## Mock-only command streaming

POST /api/terminal/run/stream request {command?:string} (bodies.command), defaults empty command. HTTP 200 SSE emits {type:"output",message:"demo output for: <command>",data:{}} then {type:"done",message:"",data:{exitCode:0}}, ~200 ms array delay. No active frontend caller found. POST /api/terminal/run is a separate JSON operation returning {command:string,exitCode:number,output:string}. These are not the PTY WebSocket protocol.

## Verification boundaries

Connection paths, serialization and lifecycle are source-inspected. Runtime mock route inventory is reconciled in api-contract-gaps.md; this extraction did not run real streaming/remote execution, websocket handshakes, reconnect/failure testing against a backend, or browser packet capture. Unknown event variants/auth/server statuses must be verified later; no integration readiness claim is made.
