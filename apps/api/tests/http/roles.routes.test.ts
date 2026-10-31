import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("roles routes (AI roles)", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/roles" });
    expect(response.statusCode).toBe(401);
  });

  it("creates, lists, reads, updates and deletes a role", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const create = await app.inject({
      method: "POST",
      url: "/api/roles",
      headers: auth(),
      payload: { name: "recon-specialist", description: "Recon agent", tools: ["nmap_scan"], mcps: ["kali"] },
    });
    expect(create.json()).toMatchObject({ name: "recon-specialist", description: "Recon agent", tools: ["nmap_scan"], mcps: ["kali"], enabled: true });

    const list = await app.inject({ method: "GET", url: "/api/roles", headers: auth() });
    expect(list.json().roles).toHaveLength(1);

    const one = await app.inject({ method: "GET", url: "/api/roles/recon-specialist", headers: auth() });
    expect(one.json()).toMatchObject({ name: "recon-specialist" });

    const updated = await app.inject({ method: "PUT", url: "/api/roles/recon-specialist", headers: auth(), payload: { description: "Updated", enabled: false } });
    expect(updated.json()).toMatchObject({ description: "Updated", enabled: false });

    const deleted = await app.inject({ method: "DELETE", url: "/api/roles/recon-specialist", headers: auth() });
    expect(deleted.json()).toEqual({ success: true });

    const missing = await app.inject({ method: "GET", url: "/api/roles/recon-specialist", headers: auth() });
    expect(missing.statusCode).toBe(404);
  });

  it("rejects create with no name and duplicate names", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const noName = await app.inject({ method: "POST", url: "/api/roles", headers: auth(), payload: {} });
    expect(noName.statusCode).toBe(400);

    await app.inject({ method: "POST", url: "/api/roles", headers: auth(), payload: { name: "dupe" } });
    const dupe = await app.inject({ method: "POST", url: "/api/roles", headers: auth(), payload: { name: "dupe" } });
    expect(dupe.statusCode).toBe(409);
  });

  it("404s a PUT for a missing role", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "PUT", url: "/api/roles/missing", headers: auth(), payload: { description: "x" } });
    expect(response.statusCode).toBe(404);
  });
});
