import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeConversationStore } from "../support/fake-conversation-store.js";
import { FakeExternalMcpStore } from "../support/fake-external-mcp-store.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("mcp routes", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/mcp/external" });
    expect(response.statusCode).toBe(401);
  });

  it("tools is stubbed 501 -- no HTTP introspection of Raptix's real tool catalog", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/mcp/tools", headers: auth() });
    expect(response.statusCode).toBe(501);
  });

  it("external reuses the real external-mcp config store", async () => {
    const externalMcpStore = new FakeExternalMcpStore();
    await externalMcpStore.upsert("kali", { command: "uvx" });
    ({ app, token } = await buildAuthedTestApp({ externalMcpStore }));
    const response = await app.inject({ method: "GET", url: "/api/mcp/external", headers: auth() });
    expect(response.json()).toEqual({ servers: [{ name: "kali", enabled: true, config: { command: "uvx" } }] });
  });

  it("executions/:id finds a real tool call by scanning known conversations' thread state", async () => {
    const conversationStore = new FakeConversationStore();
    const runtime = new FakeRuntime();
    await conversationStore.create({ title: "Recon", runtimeThreadId: "thread-1" });
    runtime.stateValues = {
      messages: [
        { type: "ai", content: "", tool_calls: [{ id: "call-1", name: "nmap_scan", args: { target: "10.0.0.5" } }] },
        { type: "tool", tool_call_id: "call-1", content: "22/tcp open" },
      ],
    };
    ({ app, token } = await buildAuthedTestApp({ conversationStore, runtime }));

    const found = await app.inject({ method: "GET", url: "/api/mcp/executions/call-1", headers: auth() });
    expect(found.json()).toMatchObject({ toolName: "nmap_scan", status: "completed", result: "22/tcp open" });

    const missing = await app.inject({ method: "GET", url: "/api/mcp/executions/does-not-exist", headers: auth() });
    expect(missing.statusCode).toBe(404);
  });

  it("cancel is stubbed 501 -- no per-tool-call cancel primitive exists, only whole-run cancel", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "POST", url: "/api/mcp/executions/call-1/cancel", headers: auth(), payload: { userNote: "stop" } });
    expect(response.statusCode).toBe(501);
  });
});
