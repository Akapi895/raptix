import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeReadNotificationStore } from "../support/fake-read-notification-store.js";
import { FakeVulnerabilityStore } from "../support/fake-vulnerability-store.js";

describe("notifications routes", () => {
  let app: FastifyInstance;
  let token: string;
  let vulnerabilityStore: FakeVulnerabilityStore;
  let readNotificationStore: FakeReadNotificationStore;

  beforeEach(async () => {
    vulnerabilityStore = new FakeVulnerabilityStore();
    readNotificationStore = new FakeReadNotificationStore();
    ({ app, token } = await buildAuthedTestApp({ vulnerabilityStore, readNotificationStore }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/notifications/summary?since=0&limit=20&lang=en" });
    expect(response.statusCode).toBe(401);
  });

  it("derives one notification per real vulnerability, unread by default", async () => {
    await vulnerabilityStore.create({ title: "SQLi in login", severity: "critical" });
    const response = await app.inject({ method: "GET", url: "/api/notifications/summary?since=0&limit=20&lang=en", headers: auth() });
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ type: "vulnerability", title: "SQLi in login", level: "critical", read: false });
    expect(body.unreadCount).toBe(1);
  });

  it("since filters out notifications created before the cursor", async () => {
    const vuln = await vulnerabilityStore.create({ title: "Old finding", severity: "low" });
    const future = vuln.createdAt.getTime() + 1000;
    const response = await app.inject({ method: "GET", url: `/api/notifications/summary?since=${future}&limit=20&lang=en`, headers: auth() });
    expect(response.json().items).toHaveLength(0);
  });

  it("marking read updates unreadCount on the next summary call", async () => {
    const vuln = await vulnerabilityStore.create({ title: "XSS", severity: "medium" });
    const id = `vuln-${vuln.id}`;
    const marked = await app.inject({ method: "POST", url: "/api/notifications/read", headers: auth(), payload: { eventIds: [id] } });
    expect(marked.json()).toEqual({ success: true });

    const response = await app.inject({ method: "GET", url: "/api/notifications/summary?since=0&limit=20&lang=en", headers: auth() });
    expect(response.json().items[0]).toMatchObject({ id, read: true });
    expect(response.json().unreadCount).toBe(0);
  });

  it("rejects marking read with no eventIds array", async () => {
    const response = await app.inject({ method: "POST", url: "/api/notifications/read", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(400);
  });
});
