// The identity of a main-agent answer stream on the timeline: which stream a response belongs to, whether a new response
// continues the stream already shown, and the keys the calls and their results are filed under. Pure: the state a stream
// keeps is passed in by the caller.

export interface MainIterationState {
  iteration?: unknown;
  orchestration?: unknown;
  workflowNodeId?: unknown;
  einoAgent?: unknown;
}

export interface ResponseStreamMeta {
  einoAgent?: unknown;
  orchestration?: unknown;
  workflowNodeId?: unknown;
  streamId?: unknown;
  iteration?: unknown;
  [key: string]: unknown;
}

export interface ResponseStreamState {
  progressId: string;
  itemId: string;
  buffer: string;
  streamMeta: ResponseStreamMeta;
  streamIdentity: string;
  streamId: string;
  assistantId?: string;
}

const text = (value: unknown): string => String(value != null ? value : '').trim();

/** The key a tool call is filed under for its progress. */
export function toolCallMapKey(progressId: unknown, toolCallId: unknown): string {
  return String(progressId) + '::' + String(toolCallId);
}

/** The key a streamed tool output is filed under for its progress. */
export function toolResultStreamKey(progressId: unknown, toolCallId: unknown): string {
  return String(progressId) + '::' + String(toolCallId);
}

/** What a finished progress shows: its label, its fallback text, its icon, and the status its open calls take. */
export function progressDoneOutcome(data: { status?: unknown; workflowStatus?: unknown } | null | undefined): {
  key: string;
  fallback: string;
  icon: string;
  toolStatus: string;
} {
  const status = String(data && (data.status || data.workflowStatus) || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled') {
    return { key: 'chat.taskCancelled', fallback: 'Task cancelled', icon: '⛔', toolStatus: 'cancelled' };
  }
  if (['failed', 'timeout', 'cleanup_failed', 'cleanup_unconfirmed'].includes(status)) {
    return {
      key: status === 'timeout' ? 'tasks.statusTimeout' : 'tasks.statusFailed',
      fallback: status === 'timeout' ? 'Task timed out' : 'Task execution failed',
      icon: '❌',
      toolStatus: 'failed',
    };
  }
  return { key: 'chat.penetrationTestComplete', fallback: 'Penetration test complete', icon: '✅', toolStatus: 'failed' };
}

/** Whether two responses come from the same agent, orchestration and workflow node. Eino can send one stream's start twice. */
export function sameMainResponseStreamMeta(a: ResponseStreamMeta | null | undefined, b: ResponseStreamMeta | null | undefined): boolean {
  if (!a || !b) return false;
  const agentA = text(a.einoAgent);
  const agentB = text(b.einoAgent);
  if (!agentA || agentA !== agentB) return false;
  if (text(a.orchestration) !== text(b.orchestration)) return false;
  return text(a.workflowNodeId) === text(b.workflowNodeId);
}

/** The iteration a main response belongs to: its own, else the one the progress last showed, when the orchestration still matches. */
export function resolveMainIterationTag(responseData: ResponseStreamMeta | null | undefined, cached: MainIterationState | undefined): string {
  const d = responseData || {};
  if (d.iteration != null) return String(d.iteration);
  if (!cached || cached.iteration == null) return '';
  const cachedOrch = text(cached.orchestration);
  const streamOrch = text(d.orchestration);
  if (cachedOrch && streamOrch && cachedOrch !== streamOrch) return '';
  return String(cached.iteration);
}

/** The identity of a main response: agent, orchestration, iteration and workflow node, joined. */
export function buildMainResponseStreamIdentity(responseData: ResponseStreamMeta | null | undefined, cached: MainIterationState | undefined): string {
  const d = responseData || {};
  const agent = text(d.einoAgent);
  const orch = text(d.orchestration);
  const iterTag = resolveMainIterationTag(d, cached);
  const nodeId = text(d.workflowNodeId);
  return agent + '|' + orch + '|iter=' + iterTag + '|wfNode=' + nodeId;
}

/** The iteration part of an identity. */
export function extractIterationTagFromStreamIdentity(identity: unknown): string {
  const s = String(identity || '');
  const idx = s.lastIndexOf('|iter=');
  if (idx < 0) return '';
  return s.slice(idx + 6);
}

/** Plan-Execute runs agents of the same name in many rounds: a stream is only reused within its own round. */
export function areMainResponseStreamIterationsCompatible(prevIterTag: string, streamIterTag: string, orchestration: unknown): boolean {
  if (text(orchestration) === 'plan_execute') return prevIterTag === streamIterTag && prevIterTag !== '';
  return !prevIterTag || !streamIterTag || prevIterTag === streamIterTag;
}

/**
 * Whether a response continues the stream already on the timeline. Only a repeated start of the same message stream is
 * merged; a new round or a new workflow node starts a new item.
 */
export function shouldReuseMainResponseStream(
  prevStream: ResponseStreamState | null | undefined,
  responseData: ResponseStreamMeta | null | undefined,
  streamOrch: unknown,
  currentIdentity: string,
): boolean {
  if (!prevStream || !prevStream.itemId) return false;
  if (!sameMainResponseStreamMeta(prevStream.streamMeta, responseData)) return false;
  const streamId = responseData && responseData.streamId != null ? String(responseData.streamId).trim() : '';
  if (streamId && prevStream.streamId === streamId) return true;
  const orch = text(streamOrch);
  if (orch === 'plan_execute') return false;
  const prevIterTag = extractIterationTagFromStreamIdentity(prevStream.streamIdentity || '');
  const streamIterTag = extractIterationTagFromStreamIdentity(currentIdentity);
  return areMainResponseStreamIterationsCompatible(prevIterTag, streamIterTag, orch);
}

/** The stream a restored row of the timeline continues: its content so far, and the identity of the response. */
export function responseStreamStateFromRestoredItem(
  progressId: string,
  item: { id: string; contentText: string } | null | undefined,
  responseData: ResponseStreamMeta | null | undefined,
  identity: string,
): ResponseStreamState | null {
  if (!item) return null;
  const data = responseData || {};
  return {
    progressId,
    itemId: item.id,
    buffer: item.contentText,
    streamMeta: data,
    streamIdentity: identity,
    streamId: data.streamId != null ? String(data.streamId).trim() : '',
  };
}

/** The prefix that names the agent of an item in a multi-agent run: "[agent] ", or nothing when there is no agent. */
export function timelineAgentBracketPrefix(data: Record<string, unknown> | null | undefined): string {
  if (!data || data.einoAgent == null) return '';
  const s = String(data.einoAgent).trim();
  return s ? '[' + s + '] ' : '';
}
