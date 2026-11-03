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

  it("transcript/results/token-usage sub-resources are stubbed 501", async () => {
    const create = await app.inject({ method: "POST", url: "/api/conversations", headers: headers(), payload: {} });
    const id = create.json().id;
    const response = await app.inject({ method: "GET", url: `/api/conversations/${id}/token-usage`, headers: headers() });
    expect(response.statusCode).toBe(501);
  });

  it("plan-tasks is honestly empty when the conversation has no project or no opplan.json yet", async () => {
    const create = await app.inject({ method: "POST", url: "/api/conversations", headers: headers(), payload: {} });
    const id = create.json().id;
    const response = await app.inject({ method: "GET", url: `/api/conversations/${id}/plan-tasks`, headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tasks: [], running: false, total: 0, completed: 0 });
  });

  it("plan-tasks reads Raptix's real OPPLAN objectives from the project sandbox", async () => {
    const { app: scopedApp, token: scopedToken, options } = await buildAuthedTestApp();
    const scopedAuth = { authorization: `Bearer ${scopedToken}` };
    const project = await scopedApp.inject({ method: "POST", url: "/api/projects", headers: scopedAuth, payload: { name: "MonitorsTwo" } });
    const projectId = project.json().id as string;
    const record = await options.projectStore.findById(projectId);
    await options.sandbox.write(
      record!.workspaceSlug,
      "plan/opplan.json",
      Buffer.from(
        JSON.stringify({
          summary: { total: 2, completed: 1 },
          objectives: [
            { id: "OBJ-001", title: "Validate target connectivity", status: "completed", blocked_by: [] },
            { id: "OBJ-002", title: "Verify RCE", status: "in_progress", description: "Exploiting CVE-2022-46169", blocked_by: ["OBJ-001"] },
          ],
        }),
      ),
    );
    const created = await scopedApp.inject({ method: "POST", url: "/api/conversations", headers: scopedAuth, payload: { projectId } });
    const conversationId = created.json().id as string;

    const response = await scopedApp.inject({ method: "GET", url: `/api/conversations/${conversationId}/plan-tasks`, headers: scopedAuth });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      running: true,
      total: 2,
      completed: 1,
      tasks: [
        { id: "OBJ-001", subject: "Validate target connectivity", status: "completed", blockedBy: [] },
        { id: "OBJ-002", subject: "Verify RCE", status: "in_progress", activeForm: "Exploiting CVE-2022-46169", blockedBy: ["OBJ-001"] },
      ],
    });
    await scopedApp.close();
  });

  it("plan-tasks 404s for a missing conversation", async () => {
    const response = await app.inject({ method: "GET", url: "/api/conversations/missing/plan-tasks", headers: headers() });
    expect(response.statusCode).toBe(404);
  });
});
