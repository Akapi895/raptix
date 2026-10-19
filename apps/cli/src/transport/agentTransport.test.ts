import { describe, expect, it } from "vitest";
import { createAgentTransport } from "./agentTransport.js";
import type { FacadeClient, RequestAck } from "./facadeClient.js";
import type { ProjectedFrame } from "./projectedRun.js";

const ack = (overrides: Partial<RequestAck> = {}): RequestAck => ({ engagementId: "eng-a", requestId: "r", operation: "create_run", state: "accepted", threadId: "t-1", runId: "run-1", ...overrides });

function fakeFacade(calls: { name: string; args: unknown[] }[], overrides: Partial<Record<string, unknown>> = {}): FacadeClient {
  const record = (name: string, value: unknown) => async (...args: unknown[]) => {
    calls.push({ name, args });
    return value;
  };
  const base = {
    createThread: record("createThread", ack({ operation: "create_thread", runId: null })),
    submitRun: record("submitRun", ack()),
    resume: record("resume", ack({ operation: "resume" })),
    resumeRun: record("resumeRun", ack({ operation: "resume" })),
    pauseRun: record("pauseRun", {}),
    cancelRun: record("cancelRun", {}),
    snapshot: record("snapshot", { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] }),
    events: (...args: unknown[]) => {
      calls.push({ name: "events", args });
      return (async function* (): AsyncGenerator<ProjectedFrame> {
        yield { event: "run-event", data: { eventId: "e1", payload: { type: "message", role: "assistant", messageId: "m1", mode: "snapshot", content: "done", truncated: false } } };
        yield { event: "control", data: { type: "stream_closed", recoveryRequired: false } };
      })();
    },
    ...overrides,
  };
  return base as unknown as FacadeClient;
}

const project = async () => "eng-a";

async function drain<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

describe("createAgentTransport", () => {
  it("submits a new message to the session's project and streams that run's events", async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const transport = createAgentTransport(fakeFacade(calls), project, { assistantId: "decepticon" });
    const chunks = await drain(transport.runs.stream("t-1", "decepticon", { input: { messages: [{ role: "user", content: "scan the host" }] } }));
    expect(calls[0]).toMatchObject({ name: "submitRun", args: ["eng-a", "t-1", { message: "scan the host" }] });
    expect(calls[1]?.name).toBe("events");
    expect(calls[1]?.args.slice(0, 4)).toEqual(["eng-a", "t-1", "run-1", "-1"]);
    expect(chunks[0]).toEqual({ event: "metadata", data: { run_id: "run-1", thread_id: "t-1" } });
    expect(chunks.some(c => c.event === "values")).toBe(true);
  });

  it("answers a question through the resume endpoint, and continues a paused run through resume-run", async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const transport = createAgentTransport(fakeFacade(calls), project, { assistantId: "decepticon" });
    await drain(transport.runs.stream("t-1", "decepticon", { command: { resume: "yes" } }));
    expect(calls[0]).toMatchObject({ name: "resume", args: ["eng-a", "t-1", { value: "yes", questionId: null }] });
    await drain(transport.runs.stream("t-1", "decepticon", { command: { resume: true } }));
    expect(calls[2]?.name).toBe("resumeRun");
    expect(calls[2]?.args.slice(0, 2)).toEqual(["eng-a", "t-1"]);
  });

  it("maps interrupt to pause and rollback to cancel", async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const transport = createAgentTransport(fakeFacade(calls), project, { assistantId: "decepticon" });
    await transport.runs.cancel("t-1", "run-1", true, "interrupt");
    await transport.runs.cancel("t-1", "run-1", false, "rollback");
    expect(calls.map(c => c.name)).toEqual(["pauseRun", "cancelRun"]);
  });

  it("restores a thread from the snapshot of its own project", async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const transport = createAgentTransport(fakeFacade(calls), project, { assistantId: "decepticon" });
    const state = await transport.threads.getState("t-1");
    expect(calls[0]).toMatchObject({ name: "snapshot", args: ["eng-a", "t-1"] });
    expect(state.values.messages).toEqual([{ type: "human", content: "hi" }, { type: "ai", content: "hello" }]);
  });

  it("creates a conversation in the session's project and reports a pending one instead of inventing an id", async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const created = createAgentTransport(fakeFacade(calls, { createThread: async () => ack({ operation: "create_thread", threadId: "t-9", runId: null }) }), project, { assistantId: "decepticon" });
    await expect(created.threads.create()).resolves.toEqual({ thread_id: "t-9" });
    const pending = createAgentTransport(fakeFacade(calls, { createThread: async () => ack({ operation: "create_thread", threadId: null, runId: null, state: "creating" }) }), project, { assistantId: "decepticon" });
    await expect(pending.threads.create()).rejects.toThrow(/not created/);
  });

  it("refuses a message-less run request before it reaches the control plane", async () => {
    const calls: { name: string; args: unknown[] }[] = [];
    const transport = createAgentTransport(fakeFacade(calls), project, { assistantId: "decepticon" });
    await expect(drain(transport.runs.stream("t-1", "decepticon", {}))).rejects.toThrow(/message is required/);
    expect(calls).toHaveLength(0);
  });
});
