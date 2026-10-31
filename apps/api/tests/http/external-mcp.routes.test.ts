import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeExternalMcpStore } from "../support/fake-external-mcp-store.js";

describe("external-mcp routes", () => {
  let app: FastifyInstance;
  let token: string;
  let externalMcpStore: FakeExternalMcpStore;

  beforeEach(async () => {
    externalMcpStore = new FakeExternalMcpStore();
    ({ app, token } = await buildAuthedTestApp({ externalMcpStore }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/external-mcp" });
    expect(response.statusCode).toBe(401);
  });

  it("upserts via PUT, lists, reads one and reports real stats", async () => {
    const put = await app.inject({ method: "PUT", url: "/api/external-mcp/kali", headers: auth(), payload: { config: { command: "uvx", args: ["hexstrike"] } } });
    expect(put.json()).toMatchObject({ status: "unknown", config: { command: "uvx" } });

    const list = await app.inject({ method: "GET", url: "/api/external-mcp", headers: auth() });
    expect(list.json().servers.kali).toMatchObject({ status: "unknown" });
    expect(list.json().stats).toEqual({ total: 1, enabled: 1, disabled: 0, connected: 0 });

    const stats = await app.inject({ method: "GET", url: "/api/external-mcp/stats", headers: auth() });
    expect(stats.json()).toEqual({ total: 1, enabled: 1, disabled: 0, connected: 0 });

    const one = await app.inject({ method: "GET", url: "/api/external-mcp/kali", headers: auth() });
    expect(one.json()).toMatchObject({ config: { command: "uvx" } });
  });

  it("external_mcp_enable:false marks a server disabled", async () => {
    await app.inject({ method: "PUT", url: "/api/external-mcp/dormant", headers: auth(), payload: { config: { command: "x", external_mcp_enable: false } } });
    const stats = await app.inject({ method: "GET", url: "/api/external-mcp/stats", headers: auth() });
    expect(stats.json()).toEqual({ total: 1, enabled: 0, disabled: 1, connected: 0 });
  });

  it("404s a GET for a missing server", async () => {
    const response = await app.inject({ method: "GET", url: "/api/external-mcp/missing", headers: auth() });
    expect(response.statusCode).toBe(404);
  });

  it("rejects a PUT with no config", async () => {
    const response = await app.inject({ method: "PUT", url: "/api/external-mcp/kali", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("deletes a server", async () => {
    await app.inject({ method: "PUT", url: "/api/external-mcp/kali", headers: auth(), payload: { config: { command: "x" } } });
    const deleted = await app.inject({ method: "DELETE", url: "/api/external-mcp/kali", headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
  });

  it("start/stop are stubbed 501 -- RAPTIX_MCP__SERVERS is parsed once at process startup, no live control plane", async () => {
    await app.inject({ method: "PUT", url: "/api/external-mcp/kali", headers: auth(), payload: { config: { command: "x" } } });
    const start = await app.inject({ method: "POST", url: "/api/external-mcp/kali/start", headers: auth() });
    expect(start.statusCode).toBe(501);
    const stop = await app.inject({ method: "POST", url: "/api/external-mcp/kali/stop", headers: auth() });
    expect(stop.statusCode).toBe(501);
  });
});
