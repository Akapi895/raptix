import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("markdown-agents routes", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/multi-agent/markdown-agents" });
    expect(response.statusCode).toBe(401);
  });

  it("creates, lists, reads, updates and deletes an agent", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const create = await app.inject({
      method: "POST",
      url: "/api/multi-agent/markdown-agents",
      headers: auth(),
      payload: { id: "recon-helper", name: "Recon helper", description: "Finds hosts", tools: ["nmap_scan"], is_orchestrator: false },
    });
    expect(create.json()).toMatchObject({ filename: "recon-helper.md", id: "recon-helper", name: "Recon helper", tools: ["nmap_scan"] });

    const list = await app.inject({ method: "GET", url: "/api/multi-agent/markdown-agents", headers: auth() });
    expect(list.json().agents).toHaveLength(1);

    const one = await app.inject({ method: "GET", url: "/api/multi-agent/markdown-agents/recon-helper.md", headers: auth() });
    expect(one.json()).toMatchObject({ id: "recon-helper" });

    const updated = await app.inject({
      method: "PUT",
      url: "/api/multi-agent/markdown-agents/recon-helper.md",
      headers: auth(),
      payload: { name: "Recon helper v2", description: "Updated" },
    });
    expect(updated.json()).toMatchObject({ name: "Recon helper v2", description: "Updated" });

    const deleted = await app.inject({ method: "DELETE", url: "/api/multi-agent/markdown-agents/recon-helper.md", headers: auth() });
    expect(deleted.json()).toEqual({ success: true });

    const missing = await app.inject({ method: "GET", url: "/api/multi-agent/markdown-agents/recon-helper.md", headers: auth() });
    expect(missing.statusCode).toBe(404);
  });

  it("rejects create with no id or name, and duplicate ids", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const noId = await app.inject({ method: "POST", url: "/api/multi-agent/markdown-agents", headers: auth(), payload: { name: "x" } });
    expect(noId.statusCode).toBe(400);
    const noName = await app.inject({ method: "POST", url: "/api/multi-agent/markdown-agents", headers: auth(), payload: { id: "x" } });
    expect(noName.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/api/multi-agent/markdown-agents", headers: auth(), payload: { id: "dupe", name: "Dupe" } });
    const dupe = await app.inject({ method: "POST", url: "/api/multi-agent/markdown-agents", headers: auth(), payload: { id: "dupe", name: "Dupe again" } });
    expect(dupe.statusCode).toBe(409);
  });

  it("404s a PUT for a missing agent", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "PUT", url: "/api/multi-agent/markdown-agents/missing.md", headers: auth(), payload: { name: "x" } });
    expect(response.statusCode).toBe(404);
  });
});
