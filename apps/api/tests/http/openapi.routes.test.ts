import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

const FIXTURE_PATH = fileURLToPath(new URL("../fixtures/openapi-fixture.yaml", import.meta.url));

describe("openapi routes", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp({ openApiSpecPath: FIXTURE_PATH }));
    const response = await app.inject({ method: "GET", url: "/api/openapi/spec" });
    expect(response.statusCode).toBe(401);
  });

  it("parses the real YAML file on disk and serves it as JSON", async () => {
    ({ app, token } = await buildAuthedTestApp({ openApiSpecPath: FIXTURE_PATH }));
    const response = await app.inject({ method: "GET", url: "/api/openapi/spec", headers: auth() });
    expect(response.json()).toMatchObject({ openapi: "3.1.0", info: { title: "Fixture spec" }, paths: { "/api/health": { get: { summary: "Health check" } } } });
  });

  it("503s honestly when the spec file is unreachable, never a fabricated empty spec", async () => {
    ({ app, token } = await buildAuthedTestApp({ openApiSpecPath: "/does/not/exist.yaml" }));
    const response = await app.inject({ method: "GET", url: "/api/openapi/spec", headers: auth() });
    expect(response.statusCode).toBe(503);
  });
});
