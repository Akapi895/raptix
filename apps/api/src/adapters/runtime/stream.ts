import { RuntimeRejectedError, RuntimeUnavailableError } from "./errors.js";

export interface RuntimeEvent { event: string; data: unknown }

/** LangGraph uses SSE event names, unlike the UI's JSON `type` envelope. */
export async function* readRuntimeEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<RuntimeEvent> {
  const reader = body.getReader();
  const utf8 = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let event = "message";
  let lines: string[] = [];
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += chunk.done ? utf8.decode() : utf8.decode(chunk.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r(?!$)|\n/.exec(buffer))) {
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        size += line.length;
        if (size > 2 * 1024 * 1024) throw new RuntimeUnavailableError("Runtime stream frame too large");
        if (!line) {
          if (lines.length) yield { event, data: JSON.parse(lines.join("\n")) as unknown };
          event = "message"; lines = []; size = 0;
        } else if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) lines.push(line.slice(5).replace(/^ /, ""));
      }
      if (buffer.length + size > 2 * 1024 * 1024) throw new RuntimeUnavailableError("Runtime stream frame too large");
      if (chunk.done) {
        if (buffer.trim() || lines.length) throw new RuntimeUnavailableError("Runtime stream ended mid-frame");
        return;
      }
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function* streamRuntimeRun(url: string, token: string | undefined, body: unknown, signal: AbortSignal): AsyncGenerator<RuntimeEvent> {
  try {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal,
      headers: { "content-type": "application/json", accept: "text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    });
    if ([400, 404, 409, 422].includes(response.status)) throw new RuntimeRejectedError(response.status === 422 ? 400 : response.status);
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new RuntimeUnavailableError("Runtime stream unavailable");
    }
    yield* readRuntimeEvents(response.body);
  } catch (error) {
    if (error instanceof RuntimeRejectedError || error instanceof RuntimeUnavailableError) throw error;
    throw new RuntimeUnavailableError("Runtime stream disconnected or malformed");
  }
}
