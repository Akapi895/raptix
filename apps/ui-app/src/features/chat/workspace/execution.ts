/** Execution topology comes from delegation calls, never from configured agent roles. */
import { BACKEND_PROCESSING_PLACEHOLDER } from '@/platform/backend-legacy-strings';

export interface ExecutionEvent { eventType?: string; data?: unknown }
export interface ExecutionMessage { id?: string; role?: string; content?: string; updatedAt?: string; processDetails?: ExecutionEvent[] }
export type AgentStatus = 'completed' | 'running' | 'failed' | 'pending' | 'unknown';
export interface ExecutionAgent {
  id: string;
  name: string;
  status: AgentStatus;
  parentId?: string;
  /** The orchestrator's own task() tool_call id for this delegation -- unset for the main
   *  agent. Matches child_* events' parentToolCallId (see childTranscript()), so a click can
   *  show exactly this invocation's own activity even when several share the same name. */
  callId?: string;
}

export type ChildTranscriptEntry =
  | { type: 'start'; prompt: string }
  | { type: 'message'; text: string }
  | { type: 'tool_call'; toolName: string; toolCallId: string; argumentsObj: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; toolCallId: string; content: string; isError: boolean }
  | { type: 'end'; cancelled: boolean; error: boolean };

function record(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return record(JSON.parse(value)); } catch { return {}; }
  }
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }

export function executionAgents(messages: ExecutionMessage[], active: boolean | null): ExecutionAgent[] {
  const agents: ExecutionAgent[] = [];
  let lastAssistant = -1;
  messages.forEach((message, index) => { if (message.role === 'assistant') lastAssistant = index; });
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return;
    const prefix = message.id || String(index);
    const byName = new Map<string, ExecutionAgent[]>();
    const delegations = new Map<string, ExecutionAgent>();
    const main = new Set<ExecutionAgent>();
    const turn: ExecutionAgent[] = [];
    let cancelled = false;
    const ensure = (name: string): ExecutionAgent | undefined => {
      const named = byName.get(name) || [];
      const unfinished = named.filter(agent => agent.status !== 'completed' && agent.status !== 'failed');
      if (unfinished.length > 1) {
        // Name-only events cannot identify concurrent invocations of the same agent.
        unfinished.forEach(agent => { agent.status = 'unknown'; });
        return undefined;
      }
      let agent = unfinished[0] || named[named.length - 1];
      if (!agent) {
        agent = { id: prefix + ':agent:' + name, name, status: 'unknown' };
        byName.set(name, [agent]);
        turn.push(agent);
      }
      return agent;
    };
    for (const event of message.processDetails || []) {
      const data = record(event.data);
      const name = text(data.einoAgent);
      const type = event.eventType || '';
      if (type === 'cancelled') cancelled = true;
      const agent = name ? ensure(name) : undefined;
      if (agent) {
        if (data.einoRole === 'orchestrator' || data.einoScope === 'main') main.add(agent);
        // A tool failure is not an agent failure; a stream ending is not a run ending.
        if (type === 'cancelled') agent.status = 'unknown';
        else if (type === 'error' || type === 'timeout') agent.status = 'failed';
        else if (type === 'eino_agent_reply' || type === 'eino_agent_reply_stream_end') agent.status = 'completed';
        else if (['progress', 'iteration', 'planning', 'thinking', 'reasoning_chain', 'tool_call', 'tool_calls_detected', 'response_start', 'response_delta', 'eino_agent_reply_stream_start'].includes(type)) agent.status = 'running';
      }
      if (agent && type === 'tool_call' && data.toolName === 'task') {
        const args = record(data.argumentsObj || data.arguments);
        const childName = text(args.subagent_type);
        const callId = text(data.toolCallId);
        if (childName && callId && !delegations.has(callId)) {
          // Each task call is an invocation, even when the same agent is used again.
          const child: ExecutionAgent = { id: prefix + ':task:' + callId, name: childName, status: 'pending', parentId: agent.id, callId };
          turn.push(child);
          byName.set(childName, [...(byName.get(childName) || []), child]);
          delegations.set(callId, child);
        }
      }
      if (type === 'tool_result') {
        const child = delegations.get(text(data.toolCallId));
        if (child) child.status = data.isError === true || data.success === false ? 'failed' : 'completed';
      }
      if (type === 'response' || type === 'complete' || type === 'done') {
        // A terminal main response confirms main-agent completion only.
        main.forEach(item => { if (item.status !== 'failed') item.status = 'completed'; });
      }
      if (!name && (type === 'error' || type === 'timeout' || type === 'cancelled')) {
        turn.forEach(item => { if (item.status === 'running' || item.status === 'pending') item.status = type === 'cancelled' ? 'unknown' : 'failed'; });
      }
    }
    // Historical activity without a terminal event cannot truthfully be called running.
    const isLatestTurn = index === lastAssistant;
    const content = message.content?.trim();
    const finalOutput = content && ![BACKEND_PROCESSING_PLACEHOLDER, 'Processing...'].includes(content);
    if (finalOutput && !cancelled && (!isLatestTurn || active === false)) {
      main.forEach(agent => { if (agent.status !== 'failed') agent.status = 'completed'; });
    }
    turn.forEach(agent => {
      if ((agent.status === 'running' || agent.status === 'pending') && (!isLatestTurn || active !== true)) agent.status = 'unknown';
    });
    agents.push(...turn);
  });
  return agents;
}

/**
 * One dispatched specialist's own activity -- its subagent_start/message/
 * tool_call/tool_result/end events (see execution-events.ts's captureChildEvents) --
 * filtered out of every message's processDetails by the orchestrator task()
 * call that spawned it (`callId`, an ExecutionAgent's own field above).
 * Ordered as received, across every assistant turn (a delegation's events
 * can outlive the turn that started it only in theory; in practice they
 * land in the same turn, but scanning every turn costs nothing and never
 * requires the caller to guess which one).
 */
export function childTranscript(messages: ExecutionMessage[], callId: string): ChildTranscriptEntry[] {
  if (!callId) return [];
  const entries: ChildTranscriptEntry[] = [];
  for (const message of messages) {
    for (const event of message.processDetails || []) {
      const data = record(event.data);
      if (text(data.parentToolCallId) !== callId) continue;
      switch (event.eventType) {
        case 'child_start':
          entries.push({ type: 'start', prompt: text(data.prompt) });
          break;
        case 'child_message':
          entries.push({ type: 'message', text: text(data.text) });
          break;
        case 'child_tool_call':
          entries.push({ type: 'tool_call', toolName: text(data.toolName), toolCallId: text(data.toolCallId), argumentsObj: record(data.argumentsObj) });
          break;
        case 'child_tool_result':
          entries.push({ type: 'tool_result', toolName: text(data.toolName), toolCallId: text(data.toolCallId), content: text(data.content), isError: data.isError === true });
          break;
        case 'child_end':
          entries.push({ type: 'end', cancelled: data.cancelled === true, error: data.error === true });
          break;
        default:
          break;
      }
    }
  }
  return entries;
}
