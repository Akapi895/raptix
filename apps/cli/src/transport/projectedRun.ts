/**
 * Adapts the web's projected run events into the chunk stream the agent hook already reduces. Only the transport
 * changes. The hook keeps its reducer, its handoff and its question flow.
 *
 * The projection carries message deltas, tool calls and results, interrupts and sub-agent custom events. The hook
 * reads whole messages from `values` snapshots, so this adapter buffers an assistant message until it is complete
 * (a tool call, a new message, an interrupt, or the end of the stream) and then emits one snapshot.
 */

export interface ChunkMessage {
  type: "human" | "ai" | "tool";
  content: string;
  name?: string;
  tool_calls?: { id: string; name: string; args: Record<string, unknown> }[];
  tool_call_id?: string;
}

export interface RunChunk {
  event: string;
  data: unknown;
  id?: string;
}

interface Pending { id: string; text: string }

/** A projected frame as the facade client yields it. */
export interface ProjectedFrame {
  event: string;
  data: unknown;
  id?: string;
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

function argsOf(preview: unknown): Record<string, unknown> {
  if (typeof preview !== "string" || preview.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(preview);
    return record(parsed) ? parsed : { preview };
  } catch {
    return { preview };
  }
}

/**
 * Turns one run's projected frames into the chunks the hook consumes. A metadata chunk comes first, so the hook
 * learns the run id that interrupt and cancel need.
 */
export async function* runChunks(
  runId: string,
  threadId: string,
  frames: AsyncIterable<ProjectedFrame>,
): AsyncGenerator<RunChunk> {
  yield { event: "metadata", data: { run_id: runId, thread_id: threadId } };
  const messages: ChunkMessage[] = [];
  const seenHuman = new Set<string>();
  let pending: Pending | null = null;

  const values = (): RunChunk => ({ event: "values", data: { messages: [...messages] } });
  const flush = (): RunChunk[] => {
    if (pending === null) return [];
    const done = pending;
    pending = null;
    if (done.text.trim().length === 0) return [];
    messages.push({ type: "ai", content: done.text });
    return [values()];
  };

  for await (const frame of frames) {
    if (frame.event === "control") {
      const control = record(frame.data) ? frame.data : {};
      if (control.type === "stream_error") yield { event: "error", data: { message: "The run stream was interrupted." } };
      if (control.type === "stream_closed" || control.type === "stream_error") {
        for (const chunk of flush()) yield chunk;
        return;
      }
      continue;
    }
    if (frame.event !== "run-event" || !record(frame.data) || !record(frame.data.payload)) continue;
    const payload = frame.data.payload;
    const id = typeof frame.data.eventId === "string" ? frame.data.eventId : null;

    if (payload.type === "message") {
      if (payload.role === "user") {
        for (const chunk of flush()) yield chunk;
        const key = typeof payload.messageId === "string" ? payload.messageId : (id ?? "");
        if (seenHuman.has(key)) continue;
        seenHuman.add(key);
        messages.push({ type: "human", content: text(payload.content) });
        yield values();
        continue;
      }
      const messageId = typeof payload.messageId === "string" ? payload.messageId : (id ?? "");
      if (pending !== null && pending.id !== messageId) for (const chunk of flush()) yield chunk;
      pending ??= { id: messageId, text: "" };
      pending.text = payload.mode === "snapshot" ? text(payload.content) : pending.text + text(payload.content);
      continue;
    }

    if (payload.type === "tool_call") {
      for (const chunk of flush()) yield chunk;
      const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : (id ?? "");
      messages.push({ type: "ai", content: "", tool_calls: [{ id: toolCallId, name: text(payload.name), args: argsOf(payload.argsPreview) }] });
      yield values();
      continue;
    }

    if (payload.type === "tool_result") {
      for (const chunk of flush()) yield chunk;
      const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : (id ?? "");
      messages.push({ type: "tool", content: text(payload.content), name: text(payload.name), tool_call_id: toolCallId });
      yield values();
      continue;
    }

    if (payload.type === "interrupt") {
      for (const chunk of flush()) yield chunk;
      continue;
    }

    yield { event: "custom", data: payload };
  }
  for (const chunk of flush()) yield chunk;
}

/** Builds the state a restored thread shows, from the web's snapshot of its root messages. */
export function snapshotState(view: { messages: { role: string; content: string }[] }): { values: { messages: ChunkMessage[] } } {
  return {
    values: {
      messages: view.messages.map((message): ChunkMessage => ({ type: message.role === "user" ? "human" : "ai", content: message.content })),
    },
  };
}
