import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeUnavailableError } from "../../src/adapters/runtime/errors.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("specialists routes", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/specialists" });
    expect(response.statusCode).toBe(401);
  });

  it("lists the live graphs as specialists, excluding the orchestrator, enriched with a known catalog entry or a title-cased fallback", async () => {
    const runtime = new FakeRuntime();
    runtime.graphIds = ["raptix", "recon", "exploit", "a_brand_new_graph"];
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const response = await app.inject({ method: "GET", url: "/api/specialists", headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json().specialists).toEqual([
      { id: "a_brand_new_graph", name: "A Brand New Graph", description: "" },
      { id: "exploit", name: "Exploit", description: "Initial access and vulnerability exploitation." },
      { id: "recon", name: "Recon", description: "Autonomous reconnaissance and intelligence gathering." },
    ]);
  });

  it("503s honestly when the runtime is unreachable instead of claiming an empty catalog", async () => {
    const runtime = new FakeRuntime();
    runtime.pingError = new RuntimeUnavailableError();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const response = await app.inject({ method: "GET", url: "/api/specialists", headers: auth() });
    expect(response.statusCode).toBe(503);
  });
});
