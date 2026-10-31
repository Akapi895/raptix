// The process details of a turn, before they are drawn: the internal rows that the user does not need to see, the
// consecutive duplicates that the server may still send, and the workflow rows that repeat a node's start.

export interface ProcessDetail {
  eventType?: string;
  message?: unknown;
  data?: unknown;
  [key: string]: unknown;
}

function dataOf(detail: ProcessDetail): Record<string, unknown> {
  return detail.data && typeof detail.data === 'object' ? detail.data as Record<string, unknown> : {};
}

/** The "[Eino] ..." heartbeat that the agent emits while it works; the timeline shows the real steps instead. */
export function isEinoAgentHeartbeatProgress(detail: ProcessDetail | null | undefined): boolean {
  if (!detail || detail.eventType !== 'progress') return false;
  const message = String(detail.message != null ? detail.message : '').trim();
  return /^\[Eino\]\s+\S/.test(message);
}

/** Whether a value is the marker the server puts on a model output it had to recover. */
export function hasModelOutputRecoveryMarker(value: unknown): boolean {
  if (!value) return false;
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    if (!text || text.indexOf('_raptix_model_output_recovery') === -1) return false;
    try {
      parsed = JSON.parse(text);
    } catch {
      return false;
    }
  }
  return !!(parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>)._raptix_model_output_recovery);
}

export function isModelOutputRecoveryToolCallDetail(detail: ProcessDetail | null | undefined): boolean {
  if (!detail || detail.eventType !== 'tool_call') return false;
  const data = dataOf(detail);
  return hasModelOutputRecoveryMarker(data.argumentsObj) || hasModelOutputRecoveryMarker(data.arguments);
}

/**
 * A "task" call whose arguments are not an object: the model wrote text where the tool expects a JSON object, and
 * the row would show only the fragment.
 */
export function isAnonymousTaskFragmentToolCallDetail(detail: ProcessDetail | null | undefined): boolean {
  if (!detail || detail.eventType !== 'tool_call') return false;
  const data = dataOf(detail);
  const toolName = String(data.toolName || '').trim().toLowerCase();
  if (toolName && toolName !== 'task' && toolName !== 'unknown') return false;

  let raw: string | null = null;
  const argsObject = data.argumentsObj && typeof data.argumentsObj === 'object' ? data.argumentsObj as Record<string, unknown> : null;
  if (argsObject) {
    const keys = Object.keys(argsObject);
    if (keys.length === 1 && keys[0] === '_raw') raw = String(argsObject._raw != null ? argsObject._raw : '').trim();
  }
  if (raw == null && typeof data.arguments === 'string') raw = data.arguments.trim();
  if (raw == null) return false;
  if (!raw) return true;
  return !(raw.startsWith('{') && raw.endsWith('}'));
}

const TURN_LOOP_MESSAGES = new Set([
  'The Eino TurnLoop resident multi-turn runtime has taken over this conversation.',
  'The Eino TurnLoop switched to the next round (after the user follow-up) at a safe point.',
  'The user follow-up was pushed into the Eino TurnLoop; waiting for a safe point to switch…',
]);

/** Rows about the agent runtime's own bookkeeping (a rejected output, a turn-loop hand-over). */
export function isInternalEinoDiagnosticDetail(detail: ProcessDetail | null | undefined): boolean {
  if (!detail) return false;
  if (detail.eventType === 'model_output_rejected') return true;
  if (detail.eventType !== 'progress') return false;
  const message = String(detail.message != null ? detail.message : '').trim();
  if (TURN_LOOP_MESSAGES.has(message)) return true;
  const kind = String(dataOf(detail).kind || '').trim();
  return kind === 'turn_loop_takeover' || kind === 'turn_loop_preempted';
}

export function filterNoiseProcessDetails<T extends ProcessDetail>(details: T[]): T[];
export function filterNoiseProcessDetails<T>(details: T): T;
export function filterNoiseProcessDetails(details: unknown): unknown {
  if (!Array.isArray(details)) return details;
  return details.filter((detail: ProcessDetail | null) => {
    if (isEinoAgentHeartbeatProgress(detail)) return false;
    if (isModelOutputRecoveryToolCallDetail(detail)) return false;
    if (isAnonymousTaskFragmentToolCallDetail(detail)) return false;
    if (isInternalEinoDiagnosticDetail(detail)) return false;
    return !(detail && detail.eventType === 'tool_calls_detected');
  });
}

/** The identity of a row: its type, its text and its data. Two rows with one fingerprint are the same row. */
export function processDetailRowFingerprint(detail: ProcessDetail | null | undefined): string {
  if (!detail || typeof detail !== 'object') return '';
  const type = String(detail.eventType || '');
  const message = String(detail.message != null ? detail.message : '').trim();
  let dataKey = '';
  try {
    if (detail.data != null) dataKey = JSON.stringify(detail.data);
  } catch {
    dataKey = String(detail.data);
  }
  return type + '\0' + message + '\0' + dataKey;
}

/** Keeps one of each run of identical rows that follow each other. */
export function dedupeConsecutiveProcessDetailRows<T extends ProcessDetail>(details: T[]): T[] {
  if (!Array.isArray(details) || details.length < 2) return details;
  const out: T[] = [details[0] as T];
  for (let i = 1; i < details.length; i++) {
    const current = details[i] as T;
    if (processDetailRowFingerprint(out[out.length - 1]) === processDetailRowFingerprint(current)) continue;
    out.push(current);
  }
  return out;
}

/** The workflow's "agent start" rows repeat what the node start already says, so they are left out. */
export function compactWorkflowProcessDetails<T extends ProcessDetail>(details: T[] | null | undefined): T[] {
  if (!Array.isArray(details) || details.length === 0) return (details || []) as T[];
  return details.filter(detail => String(detail?.eventType || '') !== 'workflow_agent_start');
}
