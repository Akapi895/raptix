import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

async function buildAuthedApp(runtime: FakeRuntime, agentSyncWaitMs = 600) {
  return buildAuthedTestApp({ runtime, agentSyncWaitMs, sandboxKey: "k".repeat(64) });
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

  it("eino-agent routes a project's run to its own sandbox when a project is given", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("success");
    runtime.stateValues = { messages: [{ type: "ai", content: "ok" }] };
    ({ app, token } = await buildAuthedApp(runtime));

    const project = await app.inject({ method: "POST", url: "/api/projects", headers: headers(), payload: { name: "Reddish" } });
    const projectId = project.json().id as string;

    const response = await app.inject({
      method: "POST",
      url: "/api/eino-agent",
      headers: headers(),
      payload: { message: "hi", projectId },
    });
    expect(response.statusCode).toBe(200);
    expect(runtime.createdRuns).toHaveLength(1);
    expect(runtime.createdRuns[0]!.config).toMatchObject({ engagement_name: expect.any(String), sandbox_url: expect.any(String), sandbox_token: expect.any(String) });
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

  it("multi-agent dispatch stays explicit rather than a silent no-op", async () => {
    ({ app, token } = await buildAuthedApp(new FakeRuntime()));
    const response = await app.inject({ method: "POST", url: "/api/multi-agent", headers: headers(), payload: {} });
    expect(response.statusCode).toBe(501);
  });

  it("streams a real turn in the UI envelope and persists the answer for reload and follow-up", async () => {
    runtime = new FakeRuntime();
    runtime.stateValues = { messages: [{ type: "ai", content: "hello back" }] };
    runtime.streamEvents = [
      { event: "messages/partial", data: [{ type: "ai", id: "answer", content: "hello", additional_kwargs: { reasoning_content: "private reasoning" } }] },
      { event: "messages/partial", data: [{ type: "ai", id: "answer", content: "hello back" }] },
    ];
    ({ app, token } = await buildAuthedApp(runtime));
    const project = await app.inject({ method: "POST", url: "/api/projects", headers: headers(), payload: { name: "chat workspace" } });
    const response = await app.inject({ method: "POST", url: "/api/eino-agent/stream", headers: headers(), payload: { message: "hi", projectId: project.json().id } });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    const events = response.body.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(events.map(event => event.type)).toEqual(expect.arrayContaining(["conversation", "message_saved", "response", "done"]));
    const final = events.find(event => event.type === "response");
    expect(final).toMatchObject({ message: "hello back", data: { finalized: true, evidenceVerified: false } });
    const conversationId = final.data.conversationId;
    const history = await app.inject({ url: `/api/conversations/${conversationId}`, headers: headers() });
    expect(history.json().messages.map((message: { content: string }) => message.content)).toEqual(["hi", "hello back"]);
    const followUp = await app.inject({ method: "POST", url: "/api/eino-agent/stream", headers: headers(), payload: { message: "again", conversationId } });
    expect(followUp.statusCode).toBe(200);
    expect(runtime.createdThreads).toHaveLength(1);
    const configurable = runtime.streamConfigs[0].configurable as Record<string, string>;
    expect(configurable.workspace_path).toBe("/workspace");
    expect(configurable.sandbox_url).toBe("http://sbx-test-slug-1:9999");
    expect(configurable.sandbox_token).toHaveLength(64);
    expect(response.body).not.toContain(configurable.sandbox_token);
    expect(response.body).not.toContain("private reasoning");
    expect(events.filter(event => event.type === "response_start")).toHaveLength(1);
    expect(events.filter(event => event.type === "response_delta").map(event => event.data.accumulated)).toEqual(["hello", "hello back"]);
  });

  it("rejects missing sessions, empty messages and unknown conversations before dispatch", async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedApp(runtime));
    expect((await app.inject({ method: "POST", url: "/api/eino-agent/stream", payload: { message: "hi" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/eino-agent/stream", headers: headers(), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/eino-agent/stream", headers: headers(), payload: { message: "hi", conversationId: "missing" } })).statusCode).toBe(404);
    expect(runtime.createdRuns).toHaveLength(0);
  });

  it("does not turn a failed run or an unfinished stream into a successful answer", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("error");
    runtime.stateValues = { messages: [{ type: "ai", content: "stale answer" }] };
    ({ app, token } = await buildAuthedApp(runtime));
    const project = await app.inject({ method: "POST", url: "/api/projects", headers: headers(), payload: { name: "failed chat" } });
    const response = await app.inject({ method: "POST", url: "/api/eino-agent/stream", headers: headers(), payload: { message: "hi", projectId: project.json().id } });
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('"type":"error"');
    expect(response.body).not.toContain('"type":"response"');
    expect(response.body).not.toContain("stale answer");
  });

  it("does not claim completion when native SSE closes while the run is still running", async () => {
    runtime = new FakeRuntime();
    runtime.queueRunStatuses("running", "running");
    ({ app, token } = await buildAuthedApp(runtime));
    const project = await app.inject({ method: "POST", url: "/api/projects", headers: headers(), payload: { name: "incomplete chat" } });
    const response = await app.inject({ method: "POST", url: "/api/eino-agent/stream", headers: headers(), payload: { message: "hi", projectId: project.json().id } });
    expect(response.body).toContain('"type":"error"');
    expect(response.body).not.toContain('"type":"response"');
    expect(response.body).not.toContain('"status":"success"');
  });
});
