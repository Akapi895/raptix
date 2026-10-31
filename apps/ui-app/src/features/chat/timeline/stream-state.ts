// The state the timeline keeps between events: which item shows which stream, which tool call is on which item, and which
// progress is running. One store per page, so that every part of the timeline reads the same record.

import type { MainIterationState, ResponseStreamState } from './response-stream';

export interface StreamItemState {
  itemId: string;
  buffer: string;
}

export interface ToolCallEntry {
  toolCallId: string;
  itemId: string;
  timeline: HTMLElement | null;
  progressId: string;
  terminalStatus?: string;
}

export interface TimelineStreamState {
  /** The answer stream of the main agent, per progress. */
  responseStreams: Map<string, ResponseStreamState>;
  /** The iteration the main agent is in, per progress. */
  mainIterations: Map<string, MainIterationState>;
  /** The thinking streams of a progress, by stream id. */
  thinkingStreams: Map<string, Map<string, StreamItemState>>;
  /** The reply streams of the sub-agents of a progress, by stream id. */
  einoReplyStreams: Map<string, Map<string, StreamItemState>>;
  /** The streamed output of a tool, by progress and tool call. */
  toolResultStreams: Map<string, StreamItemState>;
  /** The item of every tool call, by progress and tool call. */
  toolCalls: Map<string, ToolCallEntry>;
  /** The item of every tool call that waits for a human decision, by interrupt id. */
  hitlInterruptToolItems: Map<string, string>;
  /** The tasks the page shows as running, by progress. */
  progressTasks: Map<string, ProgressTaskState>;
}

export function createTimelineStreamState(): TimelineStreamState {
  return {
    responseStreams: new Map(),
    mainIterations: new Map(),
    thinkingStreams: new Map(),
    einoReplyStreams: new Map(),
    toolResultStreams: new Map(),
    toolCalls: new Map(),
    hitlInterruptToolItems: new Map(),
    progressTasks: new Map(),
  };
}

/** A progress the page shows: the conversation it belongs to, and whether its stop was asked for. */
export interface ProgressTaskState {
  conversationId?: string | null;
  cancelling?: boolean;
}
