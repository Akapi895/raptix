import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("attack-chain and storage routes (stubbed -- no Raptix equivalent built yet)", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it.each([
    ["GET", "/api/attack-chain/conv-1"],
    ["POST", "/api/attack-chain/conv-1/regenerate"],
    ["GET", "/api/conversations/conv-1/attack-chain"],
    ["GET", "/api/storage/meta"],
    ["GET", "/api/storage/status"],
    ["POST", "/api/storage/cleanup"],
  ] as const)("%s %s is stubbed 501, not a fabricated response", async (method, url) => {
    const response = await app.inject({ method, url, headers: auth(), payload: {} });
    expect(response.statusCode).toBe(501);
  });
});
