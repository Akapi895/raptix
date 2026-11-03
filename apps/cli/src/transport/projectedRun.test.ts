import { describe, expect, it } from "vitest";
import { type ProjectedFrame, runChunks, snapshotState } from "./projectedRun.js";

async function collect(frames: ProjectedFrame[]) {
  async function* source(): AsyncGenerator<ProjectedFrame> {
    for (const frame of frames) yield frame;
  }
  const out: { event: string; data: unknown }[] = [];
  for await (const chunk of runChunks("run-1", "thread-1", source())) out.push(chunk);
  return out;
}

const run = (eventId: string, payload: Record<string, unknown>): ProjectedFrame => ({ event: "run-event", data: { eventId, payload } });

describe("runChunks", () => {
  it("starts with the run id, so the hook can interrupt and cancel it", async () => {
    const chunks = await collect([]);
    expect(chunks[0]).toEqual({ event: "metadata", data: { run_id: "run-1", thread_id: "thread-1" } });
  });

  it("emits one complete assistant message per finished message, not its deltas", async () => {
    const chunks = await collect([
      run("e1", { type: "message", role: "assistant", messageId: "m1", mode: "delta", content: "Hel", truncated: false }),
      run("e2", { type: "message", role: "assistant", messageId: "m1", mode: "delta", content: "lo", truncated: false }),
      run("e3", { type: "tool_call", toolCallId: "t1", name: "bash", delegation: false, argsPreview: '{"cmd":"ls"}', truncated: false }),
    ]);
    const values = chunks.filter(c => c.event === "values");
    expect(values[0]?.data).toEqual({ messages: [{ type: "ai", content: "Hello" }] });
    expect(values[1]?.data).toEqual({ messages: [{ type: "ai", content: "Hello" }, { type: "ai", content: "", tool_calls: [{ id: "t1", name: "bash", args: { cmd: "ls" } }] }] });
  });

  it("uses a snapshot as the whole message, not an addition to what came before", async () => {
    const chunks = await collect([
      run("e1", { type: "message", role: "assistant", messageId: "m1", mode: "snapshot", content: "Done.", truncated: false }),
      run("e2", { type: "message", role: "assistant", messageId: "m2", mode: "snapshot", content: "Next", truncated: false }),
    ]);
    const values = chunks.filter(c => c.event === "values");
    expect(values.at(-1)?.data).toEqual({ messages: [{ type: "ai", content: "Done." }, { type: "ai", content: "Next" }] });
  });

  it("records each user message once, and pairs a tool result with its call", async () => {
    const chunks = await collect([
      run("e1", { type: "message", role: "user", messageId: "u1", mode: "snapshot", content: "scan", truncated: false }),
      run("e2", { type: "message", role: "user", messageId: "u1", mode: "snapshot", content: "scan", truncated: false }),
      run("e3", { type: "tool_result", toolCallId: "t1", name: "bash", delegation: false, content: "ok", truncated: false }),
    ]);
    const last = chunks.filter(c => c.event === "values").at(-1)?.data as { messages: unknown[] };
    expect(last.messages).toEqual([{ type: "human", content: "scan" }, { type: "tool", content: "ok", name: "bash", tool_call_id: "t1" }]);
  });

  it("passes sub-agent custom events through unchanged for the hook's reducer", async () => {
    const payload = { type: "subagent_start", agent: "recon", truncated: false, description: "map the host" };
    const chunks = await collect([run("e1", payload)]);
    expect(chunks.find(c => c.event === "custom")?.data).toEqual(payload);
  });

  it("keeps the buffered text when the stream closes, and reports a stream error without losing it", async () => {
    const chunks = await collect([
      run("e1", { type: "message", role: "assistant", messageId: "m1", mode: "delta", content: "partial", truncated: false }),
      { event: "control", data: { type: "stream_error", recoveryRequired: true } },
    ]);
    expect(chunks.some(c => c.event === "error")).toBe(true);
    expect(chunks.filter(c => c.event === "values").at(-1)?.data).toEqual({ messages: [{ type: "ai", content: "partial" }] });
  });
});

describe("snapshotState", () => {
  it("restores a thread's root messages in the shape the hook already reads", () => {
    expect(snapshotState({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] })).toEqual({
      values: { messages: [{ type: "human", content: "hi" }, { type: "ai", content: "hello" }] },
    });
  });
});
