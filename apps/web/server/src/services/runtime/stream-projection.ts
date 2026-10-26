import { createHash } from 'node:crypto';
import { normalizeSubagentEvent, normalizedEventKey, type SseFrame } from '@raptix/streaming';
import type { CustomPayload, PublicStreamEvent, PublicStreamPayload, StreamScope } from '@raptix/web-contracts';
import { RuntimeUnavailableError } from '../../integrations/runtime/read-client.js';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const id = (v: unknown): string | null => typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : null;
const secretKey = /authorization|password|secret|token|credential|cookie|api[_-]?key/i;
function preview(value: unknown, max = 16000): { text: string; truncated: boolean } {
  const text = typeof value === 'string' ? value : '';
  const clean = text.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/\bsk-[a-z0-9_-]{8,}/gi, '[redacted]').replace(/\b(password|api[_-]?key|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]').replace(/(--(?:password|token|api-key)\s+)\S+/gi, '$1[redacted]').replace(/authorization\s*:\s*[^\r\n,]+/gi, 'authorization: [redacted]');
  return { text: clean.slice(0, max), truncated: clean.length > max || text.endsWith('…[truncated]') };
}
function args(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[bounded]';
  if (Array.isArray(value)) return value.slice(0, 32).map(v => args(v, depth + 1));
  if (record(value)) return Object.fromEntries(Object.entries(value).slice(0, 32).map(([k, v]) => [k, secretKey.test(k) ? '[redacted]' : args(v, depth + 1)]));
  return typeof value === 'string' ? preview(value, 1000).text : value;
}
function custom(raw: unknown): CustomPayload | null {
  const event = normalizeSubagentEvent(raw);
  if (!event) return null;
  const { args: rawArgs, ...known } = event;
  const result: CustomPayload = { ...known, truncated: false };
  for (const key of ['content', 'text', 'prompt', 'question', 'command', 'header'] as const) if (result[key] !== undefined) {
    const p = preview(result[key]); result[key] = p.text; result.truncated ||= p.truncated;
  }
  if (rawArgs) { const p = preview(JSON.stringify(args(rawArgs)), 8000); result.argsPreview = p.text; result.truncated ||= p.truncated; }
  if (result.options) result.options = result.options.slice(0, 6).map(o => ({ label: preview(o.label, 256).text, description: preview(o.description, 1000).text }));
  return result;
}
/** Public custom projection for durable checkpoint transcripts (W09); same redaction/bounds as live frames. */
export function projectCustomPayload(raw: unknown): CustomPayload | null {
  return custom(raw);
}
function message(raw: unknown, mode: 'delta' | 'snapshot'): PublicStreamPayload[] {
  if (!record(raw)) return [];
  let m = raw;
  if (raw.type === 'constructor' && record(raw.kwargs) && Array.isArray(raw.id)) {
    const type = String(raw.id.at(-1));
    const tag = type.startsWith('AIMessage') ? 'ai' : type.startsWith('HumanMessage') ? 'human' : type.startsWith('ToolMessage') ? 'tool' : null;
    if (!tag) return [];
    m = { ...raw.kwargs, type: tag };
  }
  const rawRole = m.role ?? m.type;
  const role = typeof rawRole === 'string' ? ({ AIMessageChunk: 'ai', AIMessage: 'ai', HumanMessage: 'human', HumanMessageChunk: 'human', ToolMessage: 'tool', ToolMessageChunk: 'tool' } as Record<string, string>)[rawRole] ?? rawRole : rawRole;
  if (typeof role !== 'string' || !['ai', 'assistant', 'human', 'user', 'tool'].includes(role)) return [];
  const text = typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.filter(c => record(c) && c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('') : '';
  const thinking = reasoningOf(m);
  const p = preview(text);
  if (role === 'tool') return [{ type: 'tool_result', toolCallId: id(m.tool_call_id), name: id(m.name) ?? 'tool', content: p.text, delegation: m.name === 'task', truncated: p.truncated, ...(typeof m.status === 'string' ? { status: m.status.slice(0, 64) } : {}), ...(typeof m.error === 'boolean' ? { error: m.error } : {}), ...(typeof m.cancelled === 'boolean' ? { cancelled: m.cancelled } : {}) }];
  const output: PublicStreamPayload[] = [{ type: 'message', messageId: id(m.id), role: ['human', 'user'].includes(role) ? 'user' : 'assistant', content: p.text, ...(thinking.text ? { reasoning: thinking.text } : {}), mode, truncated: p.truncated || thinking.truncated }];
  if (Array.isArray(m.tool_calls)) for (const call of m.tool_calls.slice(0, 50)) if (record(call) && typeof call.name === 'string') {
    const a = preview(JSON.stringify(args(call.args ?? {})), 8000);
    output.push({ type: 'tool_call', toolCallId: id(call.id), name: call.name.slice(0, 128), argsPreview: a.text, delegation: call.name === 'task', truncated: a.truncated });
  }
  return output;
}

/**
 * Thinking-trace extraction: thinking models stow the trace in
 * `additional_kwargs.reasoning_content` or in `thinking` content blocks.
 * Never executes content — extraction + redaction + bounds only.
 */
function reasoningOf(m: Record<string, unknown>): { text: string; truncated: boolean } {
  const parts: string[] = [];
  if (Array.isArray(m.content)) {
    for (const block of m.content) {
      if (record(block) && (block.type === 'thinking' || block.type === 'reasoning_content')) {
        const text = typeof block.thinking === 'string' ? block.thinking : typeof block.reasoning_content === 'string' ? block.reasoning_content : typeof block.text === 'string' ? block.text : '';
        if (text) parts.push(text);
      }
    }
  }
  const kwargs = record(m.additional_kwargs) ? m.additional_kwargs : {};
  const stowed = [kwargs.reasoning_content, kwargs.reasoning].filter((v): v is string => typeof v === 'string' && v.length > 0);
  parts.push(...stowed);
  if (parts.length === 0) return { text: '', truncated: false };
  const p = preview(parts.join('\n\n'));
  return p;
}
export function projectStreamFrame(scope: StreamScope, frame: SseFrame, occurrence: string): PublicStreamEvent[] {
  if (!frame.data) return [];
  const [channel, ...namespace] = frame.event.split('|');
  if (namespace.length > 16 || namespace.some(n => n.length > 256 || /[\x00-\x1f]/.test(n))) throw new RuntimeUnavailableError();
  if (!['metadata', 'custom', 'messages', 'messages-tuple', 'messages/partial', 'messages/complete', 'values', 'updates', 'error'].includes(channel!)) return [];
  let raw: unknown;
  try { raw = JSON.parse(frame.data); } catch { throw new RuntimeUnavailableError(); }
  if (channel === 'error') throw new RuntimeUnavailableError();
  if (channel === 'metadata') {
    if (record(raw) && (raw.run_id !== undefined && raw.run_id !== scope.runId || raw.thread_id !== undefined && raw.thread_id !== scope.threadId)) throw new RuntimeUnavailableError();
    return [];
  }
  const output: { payload: PublicStreamPayload; source: 'runtime' | 'checkpoint' }[] = [];
  if (channel === 'custom') { const payload = custom(raw); if (payload) output.push({ payload, source: 'runtime' }); }
  else if (channel?.startsWith('messages')) {
    const parts = Array.isArray(raw) ? raw : [];
    const tuple = parts.length === 2 && record(parts[1]) && parts[1].type === undefined && parts[1].role === undefined;
    if (!namespace.length && tuple) {
      const meta = parts[1] as Record<string, unknown>; const ns = meta.langgraph_checkpoint_ns ?? meta.checkpoint_ns;
      if (typeof ns === 'string' && ns) namespace.push(...ns.split('|').slice(0, 16).map(n => n.slice(0, 256)));
    }
    const messages = tuple ? [parts[0]] : Array.isArray(raw) ? raw : [raw];
    for (const m of messages.slice(-500)) for (const payload of message(m, channel === 'messages/complete' || channel === 'messages/partial' ? 'snapshot' : 'delta')) output.push({ payload, source: 'runtime' });
  } else {
    const nodes = channel === 'values' ? [raw] : record(raw) ? [raw, ...Object.values(raw).filter(record)] : [];
    for (const node of nodes) if (record(node)) {
      if (Array.isArray(node.messages)) for (const m of node.messages.slice(-500)) for (const payload of message(m, 'snapshot')) output.push({ payload, source: channel === 'values' ? 'checkpoint' : 'runtime' });
      if (channel === 'values' && Array.isArray(node.subagent_transcripts)) for (const event of node.subagent_transcripts.slice(-2000)) { const payload = custom(event); if (payload) output.push({ payload, source: 'checkpoint' }); }
      if (Array.isArray(node.__interrupt__)) for (const interrupt of node.__interrupt__.slice(0, 20)) {
        const payload = record(interrupt) ? custom(interrupt.value) ?? { type: 'interrupt' as const, interruptId: id(interrupt.id) } : { type: 'interrupt' as const, interruptId: null };
        output.push({ payload, source: 'runtime' });
      }
    }
  }
  if (namespace.length > 16 || namespace.some(n => n.length > 256 || /[\x00-\x1f]/.test(n))) throw new RuntimeUnavailableError();
  const projected = output.slice(-2000);
  return projected.map(({ payload, source }, position) => {
    const domain = payload.type === 'message' ? payload.messageId : 'toolCallId' in payload ? payload.toolCallId : payload.type === 'interrupt' ? payload.interruptId : normalizedEventKey(payload);
    // A tool call keeps one identity in every frame that repeats it (a message chunk or a values snapshot), so the UI shows it once.
    const identity = 'toolCallId' in payload && domain ? 'call' : frame.id ? 'upstream' : domain && !(payload.type === 'message' && payload.mode === 'delta') ? 'domain' : 'occurrence';
    const key = identity === 'upstream' ? [frame.id, position] : identity === 'domain' ? [domain, payload] : identity === 'call' ? [domain, payload.type] : [occurrence, position];
    const eventId = createHash('sha256').update(JSON.stringify([scope.engagementId, scope.threadId, identity === 'upstream' || source === 'runtime' ? scope.runId : null, namespace, payload.type, key])).digest('hex');
    const at = 'createdAt' in payload && typeof payload.createdAt === 'string' && Number.isFinite(Date.parse(payload.createdAt)) ? new Date(payload.createdAt).toISOString() : null;
    return { version: 1, eventId, ...scope, streamRunId: scope.runId, runId: source === 'checkpoint' ? null : scope.runId, source, namespace, ...(frame.id && position === projected.length - 1 ? { upstreamCursor: frame.id } : {}), occurredAt: at, observedAt: new Date().toISOString(), identity: identity === 'call' ? 'domain' : identity, payload };
  });
}
