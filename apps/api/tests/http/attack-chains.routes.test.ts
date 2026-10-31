import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LlmBadResponseError, LlmUnavailableError } from "../../src/adapters/llm/client.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeConversationStore } from "../support/fake-conversation-store.js";
import { FakeLlm } from "../support/fake-llm.js";
import { FakeRuntime } from "../support/fake-runtime.js";

const CHAIN_JSON = JSON.stringify({
  nodes: [
    { id: "n1", type: "target", label: "Web app at 198.51.100.10", risk_score: 0, tool_call_id: "call-1", metadata: {} },
    { id: "n2", type: "vulnerability", label: "Admin login without rate limiting", risk_score: 78, tool_call_id: "", metadata: { severity: "high" } },
    { id: "n3", type: "action", label: "Validate lockout behaviour", risk_score: 40, tool_call_id: "call-2", metadata: {} },
  ],
  edges: [
    { source: "n1", target: "n2" },
    { source: "n2", target: "n3" },
  ],
});

function transcript() {
  return {
    messages: [
      { type: "ai", content: "Starting recon of the web app.", tool_calls: [{ id: "call-1", name: "nmap", args: { target: "198.51.100.10" } }] },
      { type: "tool", tool_call_id: "call-1", content: "80/tcp open http nginx 1.24" },
      { type: "ai", content: "Found a login form without lockout.", tool_calls: [{ id: "call-2", name: "http_probe", args: { path: "/admin" } }] },
      { type: "tool", tool_call_id: "call-2", content: "200 OK, form present" },
    ],
  };
}

describe("attack-chain routes", () => {
  let app: FastifyInstance;
  let token: string;
  let conversationId: string;
  let llm: FakeLlm;
  let runtime: FakeRuntime;

  beforeEach(async () => {
    llm = new FakeLlm();
    llm.response = CHAIN_JSON;
    runtime = new FakeRuntime();
    runtime.stateValues = transcript();
    const conversationStore = new FakeConversationStore();
    const conversation = await conversationStore.create({ title: "Recon", runtimeThreadId: "thread-1" });
    conversationId = conversation.id;
    ({ app, token } = await buildAuthedTestApp({ llm, runtime, conversationStore }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("derives a chain from the thread transcript with one LLM call", async () => {
    const response = await app.inject({ method: "GET", url: `/api/attack-chain/${conversationId}`, headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      nodes: [
        { id: "n1", type: "target", label: "Web app at 198.51.100.10", risk_score: 0, tool_call_id: "call-1", metadata: {} },
        { id: "n2", type: "vulnerability", label: "Admin login without rate limiting", risk_score: 78, tool_call_id: "", metadata: { severity: "high" } },
        { id: "n3", type: "action", label: "Validate lockout behaviour", risk_score: 40, tool_call_id: "call-2", metadata: {} },
      ],
      edges: [
        { id: "e1", source: "n1", target: "n2" },
        { id: "e2", source: "n2", target: "n3" },
      ],
    });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0].user).toContain("nmap");
    expect(llm.calls[0].user).toContain("80/tcp open http");

    const again = await app.inject({ method: "GET", url: `/api/attack-chain/${conversationId}`, headers: auth() });
    expect(again.statusCode).toBe(200);
    expect(llm.calls).toHaveLength(1);
  });

  it("regenerate forces a fresh derivation and returns the new chain", async () => {
    await app.inject({ method: "GET", url: `/api/attack-chain/${conversationId}`, headers: auth() });
    llm.response = JSON.stringify({ nodes: [{ id: "x1", type: "target", label: "Fresh", risk_score: 5 }], edges: [] });
    const response = await app.inject({ method: "POST", url: `/api/attack-chain/${conversationId}/regenerate`, headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json().nodes).toHaveLength(1);
    expect(llm.calls).toHaveLength(2);
  });

  it("an unknown conversation is a 404, not a derivation", async () => {
    const response = await app.inject({ method: "GET", url: "/api/attack-chain/nope", headers: auth() });
    expect(response.statusCode).toBe(404);
    expect(llm.calls).toHaveLength(0);
  });

  it("a conversation with no transcript is an honest empty chain, no LLM call", async () => {
    runtime.stateValues = {};
    const response = await app.inject({ method: "GET", url: `/api/attack-chain/${conversationId}`, headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ nodes: [], edges: [] });
    expect(llm.calls).toHaveLength(0);
  });

  it("an unreachable model is a 503 and unusable output a 502, never a fabricated chain", async () => {
    llm.failure = new LlmUnavailableError("down");
    const unavailable = await app.inject({ method: "GET", url: `/api/attack-chain/${conversationId}`, headers: auth() });
    expect(unavailable.statusCode).toBe(503);

    llm.failure = new LlmBadResponseError("not json");
    const bad = await app.inject({ method: "GET", url: `/api/attack-chain/${conversationId}`, headers: auth() });
    expect(bad.statusCode).toBe(502);
  });

  it("the conversations alias serves the same chain", async () => {
    const response = await app.inject({ method: "GET", url: `/api/conversations/${conversationId}/attack-chain`, headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json().nodes).toHaveLength(3);
  });

  it("unauthenticated requests are rejected", async () => {
    const response = await app.inject({ method: "GET", url: `/api/attack-chain/${conversationId}` });
    expect(response.statusCode).toBe(401);
  });
});
