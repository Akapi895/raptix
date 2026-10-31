import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { hashPassword } from "../../src/security/password.js";
import { FakeAuthStore } from "../support/fake-auth-store.js";
import { FakeConversationStore } from "../support/fake-conversation-store.js";
import { FakeProjectStore } from "../support/fake-project-store.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("hitl routes", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    const authStore = new FakeAuthStore();
    await authStore.createOperator({ username: "admin", displayName: "Operator", passwordHash: hashPassword("pw") });
    app = buildApp({
      authStore,
      sessionDurationHours: 12,
      projectStore: new FakeProjectStore(),
      conversationStore: new FakeConversationStore(),
      runtime: new FakeRuntime(),
    });
    await app.ready();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "pw" } });
    token = login.json().token;
  });

  afterEach(async () => {
    await app.close();
  });

  const headers = () => ({ authorization: `Bearer ${token}` });

  it.each([
    ["GET", "/api/hitl/pending"],
    ["POST", "/api/hitl/decision"],
    ["POST", "/api/hitl/dismiss"],
  ] as const)("%s %s is stubbed 501, not a fabricated empty queue", async (method, url) => {
    const response = await app.inject({ method, url, headers: headers(), payload: {} });
    expect(response.statusCode).toBe(501);
  });

  it("still requires a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/hitl/pending" });
    expect(response.statusCode).toBe(401);
  });
});
