import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeConversationStore } from "../support/fake-conversation-store.js";
import { FakeHiddenExecutionStore } from "../support/fake-hidden-execution-store.js";
import { FakeRuntime } from "../support/fake-runtime.js";

async function seedExecutions(conversationStore: FakeConversationStore, runtime: FakeRuntime) {
  await conversationStore.create({ title: "Recon", runtimeThreadId: "thread-1" });
  runtime.stateValues = {
    messages: [
      { type: "ai", content: "", created_at: "2026-10-31T10:00:00.000Z", tool_calls: [{ id: "call-1", name: "nmap_scan", args: { target: "10.0.0.5" } }] },
      { type: "tool", tool_call_id: "call-1", content: "22/tcp open ssh", created_at: "2026-10-31T10:00:05.000Z" },
      { type: "ai", content: "", created_at: "2026-10-31T10:01:00.000Z", tool_calls: [{ id: "call-2", name: "nmap_scan", args: { target: "10.0.0.6" } }] },
    ],
  };
}

describe("monitor routes", () => {
  let app: FastifyInstance;
  let token: string;
  let conversationStore: FakeConversationStore;
  let runtime: FakeRuntime;
  let hiddenExecutionStore: FakeHiddenExecutionStore;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));
    const response = await app.inject({ method: "GET", url: "/api/monitor" });
    expect(response.statusCode).toBe(401);
  });

  it("derives executions from real thread state: one completed (has a ToolMessage), one pending (no result yet)", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    await seedExecutions(conversationStore, runtime);
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));

    const response = await app.inject({ method: "GET", url: "/api/monitor?page=1&page_size=20", headers: auth() });
    const body = response.json();
    expect(body.total).toBe(2);
    const completed = body.executions.find((e: { id: string }) => e.id === "call-1");
    const pending = body.executions.find((e: { id: string }) => e.id === "call-2");
    expect(completed).toMatchObject({ toolName: "nmap_scan", status: "completed", result: "22/tcp open ssh" });
    expect(pending).toMatchObject({ toolName: "nmap_scan", status: "pending", result: null });
    expect(body.summary).toMatchObject({ totalCalls: 2, successCalls: 1, toolCount: 1 });
  });

  it("status and tool query params filter the derived list", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    await seedExecutions(conversationStore, runtime);
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));

    const response = await app.inject({ method: "GET", url: "/api/monitor?status=completed", headers: auth() });
    expect(response.json().total).toBe(1);
    expect(response.json().executions[0].id).toBe("call-1");
  });

  it("calls-timeline buckets executions by the requested range", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    await conversationStore.create({ title: "Recon", runtimeThreadId: "thread-1" });
    runtime.stateValues = {
      messages: [{ type: "ai", content: "", created_at: new Date().toISOString(), tool_calls: [{ id: "call-1", name: "nmap_scan", args: {} }] }],
    };
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));

    const response = await app.inject({ method: "GET", url: "/api/monitor/calls-timeline?range=24h", headers: auth() });
    const body = response.json();
    expect(body.points).toHaveLength(24);
    expect(body.points.reduce((sum: number, p: { total: number }) => sum + p.total, 0)).toBe(1);
  });

  it("deleting one execution hides it from later listings without touching the thread", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    await seedExecutions(conversationStore, runtime);
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));

    const deleted = await app.inject({ method: "DELETE", url: "/api/monitor/execution/call-1", headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
    const after = await app.inject({ method: "GET", url: "/api/monitor", headers: auth() });
    expect(after.json().total).toBe(1);
    expect(after.json().executions[0].id).toBe("call-2");
  });

  it("batch-deletes executions and reports the real count", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    await seedExecutions(conversationStore, runtime);
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));

    const deleted = await app.inject({ method: "DELETE", url: "/api/monitor/executions", headers: auth(), payload: { ids: ["call-1", "call-2"] } });
    expect(deleted.json()).toEqual({ deleted: 2 });
    const after = await app.inject({ method: "GET", url: "/api/monitor", headers: auth() });
    expect(after.json().total).toBe(0);
  });

  it("rejects a batch-delete with no ids array", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));
    const response = await app.inject({ method: "DELETE", url: "/api/monitor/executions", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("stats mirrors summary/topTools for the dashboard", async () => {
    conversationStore = new FakeConversationStore();
    runtime = new FakeRuntime();
    hiddenExecutionStore = new FakeHiddenExecutionStore();
    await seedExecutions(conversationStore, runtime);
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime, hiddenExecutionStore }));

    const response = await app.inject({ method: "GET", url: "/api/monitor/stats?top=5", headers: auth() });
    expect(response.json()).toMatchObject({ summary: { totalCalls: 2, successCalls: 1 }, topTools: [{ toolName: "nmap_scan", totalCalls: 2 }] });
  });
});
