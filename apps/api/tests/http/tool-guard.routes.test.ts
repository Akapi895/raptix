import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("tool-guard routes", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/tool-guard" });
    expect(response.statusCode).toBe(401);
  });

  it("defaults to disabled with no rules", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/tool-guard", headers: { authorization: `Bearer ${token}` } });
    expect(response.json()).toEqual({ enabled: false, rules: [] });
  });

  it("saves a rule set and reads it back", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const headers = { authorization: `Bearer ${token}` };
    const payload = { enabled: true, rules: [{ id: "r1", name: "block rm -rf", enabled: true, pattern: "rm -rf", message: "destructive command blocked" }] };
    const saved = await app.inject({ method: "PUT", url: "/api/tool-guard", headers, payload });
    expect(saved.json()).toEqual(payload);
    const read = await app.inject({ method: "GET", url: "/api/tool-guard", headers });
    expect(read.json()).toEqual(payload);
  });

  it("rejects a PUT with no enabled flag", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "PUT", url: "/api/tool-guard", headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("test matches an enabled rule against tool-call arguments", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({
      method: "PUT",
      url: "/api/tool-guard",
      headers,
      payload: { enabled: true, rules: [{ id: "r1", name: "block rm -rf", enabled: true, pattern: "rm -rf", message: "destructive command blocked" }] },
    });
    const blocked = await app.inject({ method: "POST", url: "/api/tool-guard/test", headers, payload: { toolName: "bash", arguments: { command: "rm -rf /" } } });
    expect(blocked.json()).toMatchObject({ blocked: true, match: { ruleId: "r1", message: "destructive command blocked" } });

    const allowed = await app.inject({ method: "POST", url: "/api/tool-guard/test", headers, payload: { toolName: "bash", arguments: { command: "ls -la" } } });
    expect(allowed.json()).toEqual({ blocked: false, match: null });
  });

  it("test requires a toolName", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "POST", url: "/api/tool-guard/test", headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("a disabled rule never blocks", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const headers = { authorization: `Bearer ${token}` };
    await app.inject({
      method: "PUT",
      url: "/api/tool-guard",
      headers,
      payload: { enabled: true, rules: [{ id: "r1", name: "block rm", enabled: false, pattern: "rm -rf", message: "x" }] },
    });
    const result = await app.inject({ method: "POST", url: "/api/tool-guard/test", headers, payload: { toolName: "bash", arguments: { command: "rm -rf /" } } });
    expect(result.json()).toEqual({ blocked: false, match: null });
  });
});
