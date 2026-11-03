import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeWebShellStore } from "../support/fake-webshell-store.js";

describe("webshell routes", () => {
  let app: FastifyInstance;
  let token: string;
  let webshellStore: FakeWebShellStore;

  beforeEach(async () => {
    webshellStore = new FakeWebShellStore();
    ({ app, token } = await buildAuthedTestApp({ webshellStore }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/webshell/connections" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects create with no url", async () => {
    const response = await app.inject({ method: "POST", url: "/api/webshell/connections", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("creates, lists, updates and deletes a connection", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/webshell/connections",
      headers: auth(),
      payload: { url: "https://target.example.com/shell.php", password: "s3cret", type: "php" },
    });
    expect(create.statusCode).toBe(200);
    const connection = create.json();
    expect(connection).toMatchObject({ url: "https://target.example.com/shell.php", type: "php" });

    const list = await app.inject({ method: "GET", url: "/api/webshell/connections", headers: auth() });
    expect(list.json().connections).toHaveLength(1);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/webshell/connections/${connection.id}`,
      headers: auth(),
      payload: { remark: "primary foothold" },
    });
    expect(updated.json().remark).toBe("primary foothold");

    const deleted = await app.inject({ method: "DELETE", url: `/api/webshell/connections/${connection.id}`, headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
  });

  it("state round-trips an opaque UI blob", async () => {
    const create = await app.inject({ method: "POST", url: "/api/webshell/connections", headers: auth(), payload: { url: "https://t/shell.php" } });
    const id = create.json().id;

    const save = await app.inject({
      method: "PUT",
      url: `/api/webshell/connections/${id}/state`,
      headers: auth(),
      payload: { dbState: { profiles: [], activeProfileId: "", aiMemo: "" }, terminalSessions: { sessions: [], activeId: "" } },
    });
    expect(save.json()).toEqual({ success: true });

    const read = await app.inject({ method: "GET", url: `/api/webshell/connections/${id}/state`, headers: auth() });
    expect(read.json()).toMatchObject({ terminalSessions: { activeId: "" } });
  });

  it("ai-conversations and ai-history reflect real linked conversations", async () => {
    const create = await app.inject({ method: "POST", url: "/api/webshell/connections", headers: auth(), payload: { url: "https://t/shell.php" } });
    const id = create.json().id;
    webshellStore.setLinkedConversationIds(id, ["conv-1"]);

    const conversations = await app.inject({ method: "GET", url: `/api/webshell/connections/${id}/ai-conversations`, headers: auth() });
    expect(conversations.json()).toEqual({ conversations: [{ id: "conv-1" }] });
  });

  it("exec and file are stubbed 501, not a fabricated success (bypasses sandbox/RoE egress controls)", async () => {
    const exec = await app.inject({ method: "POST", url: "/api/webshell/exec", headers: auth(), payload: {} });
    expect(exec.statusCode).toBe(501);
    const file = await app.inject({ method: "POST", url: "/api/webshell/file", headers: auth(), payload: {} });
    expect(file.statusCode).toBe(501);
  });
});
