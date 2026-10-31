import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("terminal routes (stubbed -- gated on ADR-0095, still Proposed)", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["POST", "/api/terminal/run"],
    ["POST", "/api/terminal/run/stream"],
  ] as const)("%s %s is stubbed 501", async (method, url) => {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(response.statusCode).toBe(501);
  });
});
