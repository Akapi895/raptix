import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime, UnavailableRuntime } from "../support/fake-runtime.js";

describe("conversation routes", () => {
  let app: FastifyInstance;
  let token: string;
  let runtime: FakeRuntime;

  beforeEach(async () => {
    runtime = new FakeRuntime();
    ({ app, token } = await buildAuthedTestApp({ runtime }));
  });

  afterEach(async () => {
    await app.close();
  });

  const headers = () => ({ authorization: `Bearer ${token}` });

  it("creating a conversation creates a real runtime thread", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: headers(),
      payload: { title: "Recon" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ title: "Recon", pinned: false, agentMode: "eino_single" });
    expect(runtime.createdThreads).toHaveLength(1);
  });

  it("fails with 503 instead of a fabricated conversation when the runtime is down", async () => {
    const built = await buildAuthedTestApp({ runtime: new UnavailableRuntime() });
    const response = await built.app.inject({
      method: "POST",
      url: "/api/conversations",
      headers: { authorization: `Bearer ${built.token}` },
      payload: { title: "X" },
    });
    expect(response.statusCode).toBe(503);
    await built.app.close();
  });

  it("lists, reads, renames, pins, reassigns and deletes a conversation", async () => {
    const create = await app.inject({ method: "POST", url: "/api/conversations", headers: headers(), payload: {} });
    const id = create.json().id;

    const list = await app.inject({ method: "GET", url: "/api/conversations", headers: headers() });
    expect(list.json()).toMatchObject({ total: 1, limit: 50, offset: 0 });

    const get = await app.inject({ method: "GET", url: `/api/conversations/${id}`, headers: headers() });
    expect(get.json()).toMatchObject({ id, messages: [] });

    const rename = await app.inject({
      method: "PUT",
      url: `/api/conversations/${id}`,
      headers: headers(),
      payload: { title: "Renamed" },
    });
    expect(rename.json().title).toBe("Renamed");

    const pin = await app.inject({
      method: "PUT",
      url: `/api/conversations/${id}/pinned`,
      headers: headers(),
      payload: { pinned: true },
    });
    expect(pin.json().pinned).toBe(true);

    const project = await app.inject({
      method: "PUT",
      url: `/api/conversations/${id}/project`,
      headers: headers(),
      payload: { projectId: "proj-1" },
    });
    expect(project.json().projectId).toBe("proj-1");

    const del = await app.inject({ method: "DELETE", url: `/api/conversations/${id}`, headers: headers() });
    expect(del.json()).toEqual({ success: true });

    const missing = await app.inject({ method: "GET", url: `/api/conversations/${id}`, headers: headers() });
    expect(missing.statusCode).toBe(404);
  });

  it("transcript/plan/results/token-usage sub-resources are stubbed 501", async () => {
    const create = await app.inject({ method: "POST", url: "/api/conversations", headers: headers(), payload: {} });
    const id = create.json().id;
    const response = await app.inject({ method: "GET", url: `/api/conversations/${id}/token-usage`, headers: headers() });
    expect(response.statusCode).toBe(501);
  });
});
