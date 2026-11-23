/** Normalize one backend event and preserve its content. */

import type { AskUserOption, SubagentCustomEvent, SubagentEventType } from "./types.js";

/** Call vs result phase of a tool event sharing one tool_call id. */
export type SubagentToolPhase = "call" | "result";

/** Tool event types that carry a tool-call identity (`call`/`result`). */
const TOOL_PHASES: Readonly<Record<string, SubagentToolPhase>> = {
  subagent_tool_call: "call",
  subagent_tool_result: "result",
};

/** Every event type the backend emits (SubagentEventType as data). */
const EVENT_TYPES: ReadonlySet<string> = new Set<string>([
  "subagent_start",
  "subagent_end",
  "subagent_tool_call",
  "subagent_tool_result",
  "subagent_message",
  "ask_user_question",
  "engagement_ready",
  "background_complete",
] satisfies readonly SubagentEventType[]);

/** Public event fields. Content may already be truncated by checkpoint replay. */
export interface NormalizedSubagentEvent {
  type: SubagentEventType;
  agent: string;
  /** Raw `session_id` — invocation-unique grouping key (absent on some emitters). */
  sessionId?: string;
  /** The dispatch this invocation runs (producer `dispatch_id`); absent outside a dispatch. */
  dispatchId?: string;
  /** Raw `created_at` — ISO-8601 UTC timestamp, preserved verbatim. */
  createdAt?: string;
  /** Tool name, when the event carries one. */
  tool?: string;
  /** Tool arguments, when the event carries them. */
  args?: Record<string, unknown>;
  /** Tool result content (may be backend-truncated in checkpoint replays). */
  content?: string;
  /** AI message text (subagent_message). */
  text?: string;
  /** Task prompt (subagent_start). */
  prompt?: string;
  /** Elapsed time in seconds. */
  elapsedSeconds?: number;
  status?: string;
  cancelled?: boolean;
  error?: boolean;
  /** Tool-call ID. Absent means the field was omitted. Null means the emitter reported no ID. */
  toolId?: string | null;
  /** `"call"` or `"result"` for tool events; keeps same-id pairs distinct. */
  toolPhase?: SubagentToolPhase;
  /** Optional question ID for deduplicating resumed events. Explicit null is preserved. */
  questionId?: string | null;
  /** ask_user_question payload. */
  question?: string;
  /** ask_user_question payload. */
  header?: string;
  /** ask_user_question choices, entries without string label+description dropped. */
  options?: AskUserOption[];
  /** Raw `multi_select`. */
  multiSelect?: boolean;
  /** Raw `allow_other`. */
  allowOther?: boolean;
  /** Background job session ID. */
  session?: string;
  /** background_complete: command line. */
  command?: string;
  /** Raw `exit_code`; null means the producer reported no exit code. */
  exitCode?: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptions(value: unknown): AskUserOption[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const options: AskUserOption[] = [];
  for (const entry of value) {
    if (isRecord(entry) && typeof entry.label === "string" && typeof entry.description === "string") {
      options.push({ label: entry.label, description: entry.description });
    }
  }
  return options;
}

/** Key by scope, type and ID or timestamp. Use a caller-owned occurrence key when this returns null. */
export function normalizedEventKey(event: NormalizedSubagentEvent): string | null {
  const scope = event.sessionId ?? event.agent;
  const id = event.toolId ?? event.questionId;
  if (id != null) return `${scope}::${event.type}#${id}`;
  if (event.createdAt) return `${scope}::${event.type}@${event.createdAt}`;
  return null;
}

/** Group by session ID, with the agent name as a fallback for legacy events. */
export function normalizedGroupKey(event: NormalizedSubagentEvent): string {
  return `${event.sessionId ?? ""}::${event.agent}`;
}

/** Reject invalid event types and agent names. Skip optional fields with invalid values. */
export function normalizeSubagentEvent(
  raw: SubagentCustomEvent | unknown,
): NormalizedSubagentEvent | null {
  if (!isRecord(raw)) return null;

  const type = raw.type;
  if (typeof type !== "string" || !EVENT_TYPES.has(type)) return null;

  const agent = raw.agent;
  if (typeof agent !== "string" || agent.length === 0) return null;

  const eventType = type as SubagentEventType;
  const event: NormalizedSubagentEvent = { type: eventType, agent };

  if (typeof raw.session_id === "string") event.sessionId = raw.session_id;
  if (typeof raw.dispatch_id === "string") event.dispatchId = raw.dispatch_id;
  if (typeof raw.created_at === "string") event.createdAt = raw.created_at;
  if (typeof raw.tool === "string") event.tool = raw.tool;
  if (isRecord(raw.args)) event.args = raw.args;
  if (typeof raw.content === "string") event.content = raw.content;
  if (typeof raw.text === "string") event.text = raw.text;
  if (typeof raw.prompt === "string") event.prompt = raw.prompt;
  if (typeof raw.status === "string") event.status = raw.status;
  if (typeof raw.cancelled === "boolean") event.cancelled = raw.cancelled;
  if (typeof raw.error === "boolean") event.error = raw.error;
  if (typeof raw.elapsed === "number" && Number.isFinite(raw.elapsed)) {
    // Elapsed is already in seconds.
    event.elapsedSeconds = raw.elapsed;
  }

  // Map question fields to camelCase.
  if (typeof raw.question === "string") event.question = raw.question;
  if (typeof raw.header === "string") event.header = raw.header;
  const options = asOptions(raw.options);
  if (options) event.options = options;
  if (typeof raw.multi_select === "boolean") event.multiSelect = raw.multi_select;
  if (typeof raw.allow_other === "boolean") event.allowOther = raw.allow_other;

  // Use the background job session ID.
  if (typeof raw.session === "string") event.session = raw.session;
  if (typeof raw.command === "string") event.command = raw.command;
  if (raw.exit_code === null) event.exitCode = null;
  else if (typeof raw.exit_code === "number" && Number.isFinite(raw.exit_code)) {
    event.exitCode = raw.exit_code;
  }

  // Interpret IDs by event type and preserve explicit null values.
  if ("id" in raw) {
    const id = raw.id;
    if (eventType === "ask_user_question") {
      if (id === null) event.questionId = null;
      else if (typeof id === "string") event.questionId = id;
    } else if (TOOL_PHASES[eventType] || eventType === "engagement_ready") {
      if (id === null) event.toolId = null;
      else if (typeof id === "string") event.toolId = id;
    }
  }

  const phase = TOOL_PHASES[eventType];
  if (phase) event.toolPhase = phase;

  return event;
}
