import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

async function buildAuthedApp(runtime: FakeRuntime, agentSyncWaitMs = 600) {
  return buildAuthedTestApp({ runtime, agentSyncWaitMs });
}

describe("agent-loop routes", () => {
  let app: FastifyInstance;
  let token: string;
  let runtime: FakeRuntime;

  afterEach(async () => {
    await app.close();
  });

  const headers = () => ({ authorization: `Bearer ${token}` });

  it("eino-agent runs to completion and extracts the assistant's reply", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("success");
    runtime.stateValues = { messages: [{ type: "human", content: "hi" }, { type: "ai", content: "hello back" }] };
    ({ app, token } = await buildAuthedApp(runtime));

    const response = await app.inject({
      method: "POST",
      url: "/api/eino-agent",
      headers: headers(),
      payload: { message: "hi" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ response: "hello back", finalized: true, finalizable: false, status: "success" });
    expect(typeof body.conversationId).toBe("string");
    expect(runtime.createdRuns).toHaveLength(1);
  });

  it("rejects an empty message with 400", async () => {
    ({ app, token } = await buildAuthedApp(new FakeRuntime()));
    const response = await app.inject({ method: "POST", url: "/api/eino-agent", headers: headers(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("reports still-running honestly instead of fabricating a reply when the run doesn't finish in time", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("running", "running", "running", "running");
    ({ app, token } = await buildAuthedApp(runtime, 600));

    const response = await app.inject({
      method: "POST",
      url: "/api/eino-agent",
      headers: headers(),
      payload: { message: "hi" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.finalized).toBe(false);
    expect(body.status).toBe("running");
  }, 10_000);

  it("cancel finds and cancels the conversation's active run", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("running");
    ({ app, token } = await buildAuthedApp(runtime, 600));

    const created = await app.inject({ method: "POST", url: "/api/conversations", headers: headers(), payload: {} });
    const conversationId = created.json().id;
    // Seed one active run on this conversation's thread by sending a message (status stays "running").
    runtime.queueRunStatuses("running", "running", "running");
    await app.inject({ method: "POST", url: "/api/eino-agent", headers: headers(), payload: { message: "go", conversationId } });

    const cancel = await app.inject({
      method: "POST",
      url: "/api/agent-loop/cancel",
      headers: headers(),
      payload: { conversationId },
    });
    expect(cancel.json()).toEqual({ success: true });
    expect(runtime.cancelledRuns.length).toBeGreaterThan(0);
  }, 10_000);

  it("rejects cancel with no conversationId", async () => {
    ({ app, token } = await buildAuthedApp(new FakeRuntime()));
    const response = await app.inject({ method: "POST", url: "/api/agent-loop/cancel", headers: headers(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("tasks and tasks/completed split by terminal status", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("success");
    ({ app, token } = await buildAuthedApp(runtime));
    await app.inject({ method: "POST", url: "/api/eino-agent", headers: headers(), payload: { message: "hi" } });

    const completed = await app.inject({ method: "GET", url: "/api/agent-loop/tasks/completed", headers: headers() });
    expect(completed.json().tasks).toHaveLength(1);

    const active = await app.inject({ method: "GET", url: "/api/agent-loop/tasks", headers: headers() });
    expect(active.json().tasks).toHaveLength(0);
  });

  it("streaming and multi-agent routes are stubbed 501, not a silent no-op", async () => {
    ({ app, token } = await buildAuthedApp(new FakeRuntime()));
    const response = await app.inject({ method: "POST", url: "/api/multi-agent", headers: headers(), payload: {} });
    expect(response.statusCode).toBe(501);
  });
});
