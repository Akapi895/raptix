import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReconProviderRejectedError, ReconProviderUnconfiguredError } from "../../src/adapters/recon/errors.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRecon } from "../support/fake-recon.js";

describe("fofa routes", () => {
  let app: FastifyInstance;
  let token: string;
  let recon: FakeRecon;

  beforeEach(async () => {
    recon = new FakeRecon();
    ({ app, token } = await buildAuthedTestApp({ recon }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "POST", url: "/api/fofa/search", payload: {} });
    expect(response.statusCode).toBe(401);
  });

  it("rejects a search with no query or an unknown provider", async () => {
    const noQuery = await app.inject({ method: "POST", url: "/api/fofa/search", headers: auth(), payload: { provider: "fofa" } });
    expect(noQuery.statusCode).toBe(400);
    const badProvider = await app.inject({ method: "POST", url: "/api/fofa/search", headers: auth(), payload: { provider: "bing", query: "x" } });
    expect(badProvider.statusCode).toBe(400);
  });

  it("dispatches a real search call through the recon transport and returns its result", async () => {
    recon.responses.set("shodan", { provider: "shodan", query: "product:nginx", fields: ["ip_str"], results: [{ ip_str: "1.2.3.4" }], total: 1, page: 1, size: 100 });
    const response = await app.inject({ method: "POST", url: "/api/fofa/search", headers: auth(), payload: { provider: "shodan", query: "product:nginx", size: 100, page: 1 } });
    expect(response.json()).toMatchObject({ provider: "shodan", total: 1, results: [{ ip_str: "1.2.3.4" }] });
    expect(recon.calls[0]).toMatchObject({ provider: "shodan", query: "product:nginx" });
  });

  it("maps an unconfigured provider to 503, not a fabricated empty result", async () => {
    recon.rejections.set("fofa", new ReconProviderUnconfiguredError("fofa"));
    const response = await app.inject({ method: "POST", url: "/api/fofa/search", headers: auth(), payload: { query: "app=nginx" } });
    expect(response.statusCode).toBe(503);
  });

  it("maps a provider rejection to 502", async () => {
    recon.rejections.set("fofa", new ReconProviderRejectedError("fofa", "invalid key"));
    const response = await app.inject({ method: "POST", url: "/api/fofa/search", headers: auth(), payload: { query: "app=nginx" } });
    expect(response.statusCode).toBe(502);
  });

  it("parse is stubbed 501 -- needs an LLM call apps/api has no direct client for", async () => {
    const response = await app.inject({ method: "POST", url: "/api/fofa/parse", headers: auth(), payload: { provider: "fofa", text: "nginx in china" } });
    expect(response.statusCode).toBe(501);
  });
});
