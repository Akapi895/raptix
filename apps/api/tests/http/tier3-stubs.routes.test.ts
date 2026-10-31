import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("storage routes (stubbed -- no Raptix equivalent built yet)", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  // Attack chains are real now (attack-chains.routes.test.ts); Storage has no
  // Raptix equivalent -- there is no artifact store behind apps/api to clean.
  it.each([
    ["GET", "/api/storage/meta"],
    ["GET", "/api/storage/status"],
    ["POST", "/api/storage/cleanup"],
  ] as const)("%s %s is stubbed 501, not a fabricated response", async (method, url) => {
    const response = await app.inject({ method, url, headers: auth(), payload: {} });
    expect(response.statusCode).toBe(501);
  });
});
