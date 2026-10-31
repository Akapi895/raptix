import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { hashPassword } from "../../src/security/password.js";
import { FakeAuthStore } from "../support/fake-auth-store.js";
import { FakeConversationStore } from "../support/fake-conversation-store.js";
import { FakeProjectStore } from "../support/fake-project-store.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("project routes", () => {
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

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/projects" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects create with no name", async () => {
    const response = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("creates, lists, reads, updates and deletes a project", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/projects",
      headers: auth(),
      payload: { name: "Lab Web Perimeter", description: "demo", scope_json: "{}" },
    });
    expect(create.statusCode).toBe(200);
    const created = create.json();
    expect(created).toMatchObject({
      name: "Lab Web Perimeter",
      status: "active",
      pinned: false,
      conversation_count: 0,
      vulnerability_count: 0,
      asset_count: 0,
    });

    const list = await app.inject({ method: "GET", url: "/api/projects", headers: auth() });
    expect(list.json()).toMatchObject({ projects: [expect.objectContaining({ id: created.id })], total: 1, limit: 20, offset: 0 });

    const get = await app.inject({ method: "GET", url: `/api/projects/${created.id}`, headers: auth() });
    expect(get.statusCode).toBe(200);
    expect(get.json().id).toBe(created.id);

    const update = await app.inject({
      method: "PUT",
      url: `/api/projects/${created.id}`,
      headers: auth(),
      payload: { status: "archived", pinned: true },
    });
    expect(update.json()).toMatchObject({ status: "archived", pinned: true });

    const del = await app.inject({ method: "DELETE", url: `/api/projects/${created.id}`, headers: auth() });
    expect(del.json()).toEqual({ success: true });

    const getAfterDelete = await app.inject({ method: "GET", url: `/api/projects/${created.id}`, headers: auth() });
    expect(getAfterDelete.statusCode).toBe(404);
  });

  it("stats and conversations sub-resources are real, not fabricated", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;

    const stats = await app.inject({ method: "GET", url: `/api/projects/${id}/stats`, headers: auth() });
    expect(stats.json()).toEqual({ conversations: 0, vulnerabilities: 0, assets: 0 });

    const conversations = await app.inject({ method: "GET", url: `/api/projects/${id}/conversations`, headers: auth() });
    expect(conversations.json()).toMatchObject({ conversations: [], total: 0 });
  });

  it("fact-graph sub-resources are stubbed 501, not a fabricated empty success", async () => {
    const create = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "P" } });
    const id = create.json().id;
    const response = await app.inject({ method: "GET", url: `/api/projects/${id}/fact-graph`, headers: auth() });
    expect(response.statusCode).toBe(501);
  });
});
