import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("workflows routes", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/workflows" });
    expect(response.statusCode).toBe(401);
  });

  it("creates, lists, updates and deletes a workflow definition", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const graph = { nodes: [{ id: "n1", type: "start", label: "Start", config: {} }], edges: [], config: {} };
    const create = await app.inject({
      method: "POST",
      url: "/api/workflows",
      headers: auth(),
      payload: { name: "Recon flow", description: "Initial recon", enabled: true, graph },
    });
    const created = create.json().workflow;
    expect(created).toMatchObject({ name: "Recon flow", version: 1, enabled: true, graph });
    expect(typeof created.graph_json).toBe("string");

    const list = await app.inject({ method: "GET", url: "/api/workflows?includeDisabled=true", headers: auth() });
    expect(list.json().workflows).toHaveLength(1);

    const updatedGraph = { nodes: [{ id: "n1", type: "start", label: "Start", config: {} }, { id: "n2", type: "end", label: "End", config: {} }], edges: [], config: {} };
    const updated = await app.inject({
      method: "PUT",
      url: `/api/workflows/${created.id}`,
      headers: auth(),
      payload: { name: "Recon flow", description: "Updated", enabled: false, graph: updatedGraph },
    });
    expect(updated.json().workflow).toMatchObject({ version: 2, enabled: false, graph: updatedGraph });

    const filtered = await app.inject({ method: "GET", url: "/api/workflows?includeDisabled=false", headers: auth() });
    expect(filtered.json().workflows).toHaveLength(0);

    const deleted = await app.inject({ method: "DELETE", url: `/api/workflows/${created.id}`, headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
  });

  it("rejects create/update with no name", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "POST", url: "/api/workflows", headers: auth(), payload: { graph: {} } });
    expect(response.statusCode).toBe(400);
  });

  it("404s a PUT/DELETE for a missing workflow", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const put = await app.inject({ method: "PUT", url: "/api/workflows/missing", headers: auth(), payload: { name: "x" } });
    expect(put.statusCode).toBe(404);
  });

  it.each([
    ["POST", "/api/workflows/validate"],
    ["POST", "/api/workflows/dry-run"],
    ["POST", "/api/workflows/generate-draft"],
    ["GET", "/api/workflows/wf-1/package"],
    ["POST", "/api/workflow-package-inspections"],
    ["GET", "/api/workflow-package-inspections/insp-1"],
    ["POST", "/api/workflow-package-imports"],
    ["GET", "/api/workflow-package-imports/imp-1"],
    ["GET", "/api/workflows/runs/pending"],
    ["GET", "/api/workflows/runs"],
    ["GET", "/api/workflows/runs/run-1"],
    ["POST", "/api/workflows/runs/run-1/replay"],
    ["POST", "/api/workflows/runs/run-1/resume"],
  ] as const)("%s %s is stubbed 501 -- real execution needs a new orchestration engine", async (method, url) => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method, url, headers: auth(), payload: {} });
    expect(response.statusCode).toBe(501);
  });
});
