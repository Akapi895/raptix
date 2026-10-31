import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("skills routes (stubbed -- Skillogy's REST surface has no unconditional list, corpus writes need its own pipeline)", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  it.each([
    ["GET", "/api/skills"],
    ["POST", "/api/skills"],
    ["GET", "/api/skills/oauth"],
    ["PUT", "/api/skills/oauth"],
    ["DELETE", "/api/skills/oauth"],
    ["GET", "/api/skills/oauth/bound-roles"],
    ["GET", "/api/skills/oauth/file"],
    ["PUT", "/api/skills/oauth/file"],
    ["GET", "/api/skills/oauth/files"],
    ["DELETE", "/api/skills/oauth/stats"],
    ["DELETE", "/api/skills/stats"],
    ["GET", "/api/skills/stats"],
  ] as const)("%s %s is stubbed 501", async (method, url) => {
    const response = await app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, payload: {} });
    expect(response.statusCode).toBe(501);
  });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/skills" });
    expect(response.statusCode).toBe(401);
  });
});
