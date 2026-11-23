/** Shared types for events emitted by StreamingRunnable. */

/** String literal union of all sub-agent event types. */
export type SubagentEventType =
  | "subagent_start"
  | "subagent_end"
  | "subagent_tool_call"
  | "subagent_tool_result"
  | "subagent_message"
  | "ask_user_question"
  | "engagement_ready"
  | "background_complete";

/** One choice presented in an ask_user_question picker. */
export interface AskUserOption {
  label: string;
  description: string;
}

/** Custom event payload from StreamingRunnable's get_stream_writer(). */
export interface SubagentCustomEvent {
  type: SubagentEventType;
  agent: string;
  tool?: string;
  args?: Record<string, unknown>;
  content?: string;
  text?: string;
  prompt?: string;
  elapsed?: number;
  status?: string;
  cancelled?: boolean;
  error?: boolean;
  // Invocation ID and UTC timestamp from StreamingRunnable. Other emitters may omit them.
  session_id?: string;
  created_at?: string;
  // Tool-call ID used to deduplicate resumed questions. Null explicitly marks a missing ID.
  id?: string | null;
  question?: string;
  header?: string;
  options?: AskUserOption[];
  multi_select?: boolean;
  allow_other?: boolean;
  // Background completion fields. Large output may arrive as a head-and-tail preview.
  session?: string;
  command?: string;
  exit_code?: number | null;
}

/** Minimal event shape accepted by shared utility functions. */
export interface StreamEvent {
  id: string;
  type: string;
  content?: string;
  subagent?: string;
  timestamp: number;
  /** Normalized completion status. Session grouping also accepts the raw error flag. */
  status?: string;
  /** Raw backend error flag on `subagent_end` (the SubagentCustomEvent contract). */
  error?: boolean;
  /** Invocation ID that separates concurrent runs of the same agent. */
  sessionId?: string;
}
