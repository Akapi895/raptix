import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeC2 } from "../support/fake-c2.js";

describe("c2 routes", () => {
  let app: FastifyInstance;
  let token: string;
  let c2: FakeC2;

  beforeEach(async () => {
    c2 = new FakeC2();
    ({ app, token } = await buildAuthedTestApp({ c2 }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/c2/sessions" });
    expect(response.statusCode).toBe(401);
  });

  it("sessions/listeners/profiles are real reads through the bridge client", async () => {
    c2.responses.set("sessions.list", { sessions: [{ id: "s1" }] });
    c2.responses.set("listeners.list", { listeners: [{ id: "l1" }] });
    c2.responses.set("profiles.list", { profiles: [{ id: "p1" }] });

    const sessions = await app.inject({ method: "GET", url: "/api/c2/sessions", headers: auth() });
    expect(sessions.json()).toEqual({ sessions: [{ id: "s1" }] });
    expect(c2.calls[0]).toEqual({ op: "sessions.list", params: {} });

    const listeners = await app.inject({ method: "GET", url: "/api/c2/listeners", headers: auth() });
    expect(listeners.json()).toEqual({ listeners: [{ id: "l1" }] });

    const profiles = await app.inject({ method: "GET", url: "/api/c2/profiles", headers: auth() });
    expect(profiles.json()).toEqual({ profiles: [{ id: "p1" }] });
  });

  it("GET session by id calls sessions.get with the session id", async () => {
    c2.responses.set("sessions.get", { session: { id: "s1" } });
    const response = await app.inject({ method: "GET", url: "/api/c2/sessions/s1", headers: auth() });
    expect(response.json()).toEqual({ session: { id: "s1" } });
    expect(c2.calls[0]).toEqual({ op: "sessions.get", params: { sessionId: "s1" } });
  });

  it.each([
    ["POST", "/api/c2/listeners"],
    ["POST", "/api/c2/listeners/l1/start"],
    ["POST", "/api/c2/sessions/s1/tasks"],
    ["POST", "/api/c2/payloads/build"],
    ["DELETE", "/api/c2/sessions"],
    ["GET", "/api/c2/tasks"],
    ["GET", "/api/c2/events"],
  ] as const)("%s %s is stubbed 501, not dispatched without a scope/grant gate", async (method, url) => {
    const response = await app.inject({ method, url, headers: auth(), payload: {} });
    expect(response.statusCode).toBe(501);
    expect(c2.calls).toHaveLength(0);
  });
});
