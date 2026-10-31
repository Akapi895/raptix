import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("hitl routes", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
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
