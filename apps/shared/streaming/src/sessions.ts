/** Derive execution sessions from sub-agent events. */

import type { StreamEvent } from "./types.js";

/** A sub-agent execution session derived from the event stream. */
export interface SubAgentSession {
  /** Unique session ID (from the subagent_start event). */
  id: string;
  /** Agent name (e.g. "recon", "exploit"). */
  agent: string;
  /** Human-readable description of the task. */
  description: string;
  /** ID of the subagent_start event. */
  startEventId: string;
  /** ID of the subagent_end event (undefined if still running). */
  endEventId?: string;
  /** All event IDs belonging to this session. */
  eventIds: string[];
  /** Number of tool_result + bash_result events in the session. */
  toolCount: number;
  /** Session start timestamp. */
  startTime: number;
  /** Session end timestamp (undefined if still running). */
  endTime?: number;
  /** Current session status. */
  status: "running" | "completed" | "error";
}

/** Group events between matching start and end boundaries in chronological order. */
export function deriveSubAgentSessions(events: readonly StreamEvent[]): SubAgentSession[] {
  const sessions: SubAgentSession[] = [];
  const openSessions = new Map<string, SubAgentSession>();

  // Legacy events fall back to the agent name. Concurrent runs need a session ID.
  const sessionKey = (e: StreamEvent): string =>
    (e.sessionId ?? "") + "::" + (e.subagent ?? "");

  for (const event of events) {
    if (!event.subagent) continue;
    const key = sessionKey(event);

    if (event.type === "subagent_start") {
      const session: SubAgentSession = {
        id: event.id,
        agent: event.subagent,
        description: event.content || `Starting ${event.subagent}`,
        startEventId: event.id,
        eventIds: [event.id],
        toolCount: 0,
        startTime: event.timestamp,
        status: "running",
      };
      openSessions.set(key, session);
      sessions.push(session);
    } else if (event.type === "subagent_end") {
      const session = openSessions.get(key);
      if (session) {
        session.endEventId = event.id;
        session.endTime = event.timestamp;
        // Accept both normalized status and the raw error flag.
        session.status =
          event.status === "error" || event.error === true ? "error" : "completed";
        session.eventIds.push(event.id);
        openSessions.delete(key);
      }
    } else {
      const session = openSessions.get(key);
      if (session) {
        session.eventIds.push(event.id);
        if (event.type === "tool_result" || event.type === "bash_result") {
          session.toolCount++;
        }
      }
    }
  }

  return sessions;
}
