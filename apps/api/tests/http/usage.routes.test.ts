import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("usage routes (stubbed -- LiteLLM's /spend/logs schema can't be verified in this environment)", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/usage/tokens" });
    expect(response.statusCode).toBe(401);
  });

  it("is stubbed 501", async () => {
    const response = await app.inject({ method: "GET", url: "/api/usage/tokens?days=7&limit=20", headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(501);
  });
});
