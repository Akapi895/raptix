/**
 * Pure normalizer from raw backend custom events to a bounded public shape.
 *
 * Maps the raw emitter fields (snake_case `session_id`/`created_at`, nullable
 * tool-call `id`, `elapsed` in SECONDS, ask_user_question and
 * background_complete payloads) onto {@link NormalizedSubagentEvent}.
 * No React, SDK or server imports — safe for browser, CLI and node tests.
 *
 * This is deliberately NOT a reducer or transport (W08 scope): it validates
 * one event at a time and never drops, dedupes or re-truncates content.
 */

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

/**
 * Bounded, public-normalized event shape. Field set is fixed; unknown raw
 * fields are dropped. Content is passed through verbatim (checkpoint replays
 * may already carry the backend's truncated preview — the normalizer never
 * re-truncates).
 */
export interface NormalizedSubagentEvent {
  type: SubagentEventType;
  agent: string;
  /** Raw `session_id` — invocation-unique grouping key (absent on some emitters). */
  sessionId?: string;
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
  /** Terminal wall-clock duration in SECONDS (raw `elapsed`; e.g. 85.125). */
  elapsedSeconds?: number;
  status?: string;
  cancelled?: boolean;
  error?: boolean;
  /**
   * Tri-state tool-call identity from raw `id` on tool events (and the
   * planning tool_call_id on engagement_ready):
   * - `undefined` — raw had no `id` key.
   * - `null`      — emitter explicitly reported no id (`"id": null`).
   * - `string`    — id shared by the paired tool_call + tool_result events.
   */
  toolId?: string | null;
  /** `"call"` or `"result"` for tool events; keeps same-id pairs distinct. */
  toolPhase?: SubagentToolPhase;
  /**
   * Tri-state raw `id` on ask_user_question — the question's tool_call_id,
   * the dedup key for the second emission fired when LangGraph re-executes
   * the tool body after Command(resume=...). Distinct meaning from
   * {@link toolId}: identifies the question, not a tool event pair.
   */
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
  /** background_complete: captured-output bash session id (NOT session_id). */
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

/**
 * Provable event-identity key, or null.
 *
 * - With a tool/question id: `scope::type#id` (type included, so a
 *   tool_call and its tool_result sharing one id never collapse).
 * - Else with a validated `createdAt` (emitter stamps are microsecond ISO):
 *   `scope::type@createdAt` — distinct for repeated same-agent messages.
 * - Else returns `null`: identity CANNOT be proven from the event alone, so
 *   callers must key it by their own occurrence index/cursor instead of
 *   treating same-type events in a session as one.
 */
export function normalizedEventKey(event: NormalizedSubagentEvent): string | null {
  const scope = event.sessionId ?? event.agent;
  const id = event.toolId ?? event.questionId;
  if (id != null) return `${scope}::${event.type}#${id}`;
  if (event.createdAt) return `${scope}::${event.type}@${event.createdAt}`;
  return null;
}

/** Session-grouping key (scope only): falls back from sessionId to agent for
 * legacy streams — mirrors deriveSubAgentSessions grouping semantics. */
export function normalizedGroupKey(event: NormalizedSubagentEvent): string {
  return `${event.sessionId ?? ""}::${event.agent}`;
}

/**
 * Validate and normalize one raw custom event.
 *
 * @returns A {@link NormalizedSubagentEvent}, or `null` when the payload is
 * not an object, has an unknown `type`, or has a missing/empty `agent`.
 * Per-field type mismatches (e.g. numeric `created_at`, string `elapsed`)
 * drop that field instead of failing the whole event.
 */
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
    // Raw emitter unit is SECONDS (W00 capture: 85.125) — never rescaled.
    event.elapsedSeconds = raw.elapsed;
  }

  // ask_user_question payload (raw snake_case -> camelCase).
  if (typeof raw.question === "string") event.question = raw.question;
  if (typeof raw.header === "string") event.header = raw.header;
  const options = asOptions(raw.options);
  if (options) event.options = options;
  if (typeof raw.multi_select === "boolean") event.multiSelect = raw.multi_select;
  if (typeof raw.allow_other === "boolean") event.allowOther = raw.allow_other;

  // background_complete payload. `session` is the bash job session id, NOT
  // the subagent invocation `session_id`.
  if (typeof raw.session === "string") event.session = raw.session;
  if (typeof raw.command === "string") event.command = raw.command;
  if (raw.exit_code === null) event.exitCode = null;
  else if (typeof raw.exit_code === "number" && Number.isFinite(raw.exit_code)) {
    event.exitCode = raw.exit_code;
  }

  // Raw `id` meaning depends on the event type: the question's tool_call_id
  // on ask_user_question, a tool-call identity on tool events and the
  // planning completion on engagement_ready. Null is preserved as explicit
  // "no id"; other types carry no canonical id in the bounded shape.
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
