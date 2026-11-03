import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeProjectStore } from "../support/fake-project-store.js";
import { FakeSandbox } from "../support/fake-sandbox.js";

describe("hitl routes", () => {
  let app: FastifyInstance;
  let token: string;
  let projectStore: FakeProjectStore;
  let sandbox: FakeSandbox;

  beforeEach(async () => {
    projectStore = new FakeProjectStore();
    sandbox = new FakeSandbox();
    ({ app, token } = await buildAuthedTestApp({ projectStore, sandbox }));
  });

  afterEach(async () => {
    await app.close();
  });

  const headers = () => ({ authorization: `Bearer ${token}` });

  async function seedPendingRequest(projectName: string) {
    const project = await projectStore.create({ name: projectName });
    await sandbox.append(
      project.workspaceSlug,
      "approvals/requests.jsonl",
      Buffer.from(
        `${JSON.stringify({
          kind: "approval_request",
          request_id: "req-1",
          engagement_name: project.workspaceSlug,
          tool_name: "bash",
          tool_args_redacted: { command: "whoami" },
          reason: "dangerous command",
          created_at: 1700000000,
        })}\n`,
      ),
    );
    return project;
  }

  it("still requires a session", async () => {
    const response = await app.inject({ method: "GET", url: "/api/hitl/pending" });
    expect(response.statusCode).toBe(401);
  });

  it("pending is empty, not stubbed, when no project has a pending approval", async () => {
    const response = await app.inject({ method: "GET", url: "/api/hitl/pending", headers: headers() });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], total: 0 });
  });

  it("surfaces a real pending approval written by the Python middleware's JSONL wire format", async () => {
    await seedPendingRequest("Reddish");
    const response = await app.inject({ method: "GET", url: "/api/hitl/pending", headers: headers() });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: Array<Record<string, unknown>>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ id: "req-1", toolName: "bash", status: "pending" });
    expect(JSON.parse(body.items[0]!.payload as string)).toEqual({
      argumentsObj: { command: "whoami" },
      userMessage: "[Reddish] dangerous command",
    });
  });

  it("approving a pending request appends an allow decision to that project's sandbox", async () => {
    const project = await seedPendingRequest("Reddish");
    const response = await app.inject({
      method: "POST",
      url: "/api/hitl/decision",
      headers: headers(),
      payload: { interruptId: "req-1", decision: "approve", comment: "looks fine" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ success: true, decision: "approve" });

    const decisions = await sandbox.read(project.workspaceSlug, "approvals/decisions.jsonl");
    const decision = JSON.parse(decisions!.toString("utf-8").trim());
    expect(decision).toMatchObject({ kind: "approval_decision", request_id: "req-1", action: "allow", operator_note: "looks fine" });

    const again = await app.inject({ method: "GET", url: "/api/hitl/pending", headers: headers() });
    expect(again.json()).toEqual({ items: [], total: 0 });
  });

  it("rejecting writes a deny decision", async () => {
    await seedPendingRequest("Reddish");
    const response = await app.inject({
      method: "POST",
      url: "/api/hitl/decision",
      headers: headers(),
      payload: { interruptId: "req-1", decision: "reject" },
    });
    expect(response.json()).toEqual({ success: true, decision: "reject" });
  });

  it("dismiss denies too -- never leaves a gated tool call ambiguously open", async () => {
    const project = await seedPendingRequest("Reddish");
    const response = await app.inject({
      method: "POST",
      url: "/api/hitl/dismiss",
      headers: headers(),
      payload: { interruptId: "req-1" },
    });
    expect(response.statusCode).toBe(200);
    const decisions = await sandbox.read(project.workspaceSlug, "approvals/decisions.jsonl");
    expect(JSON.parse(decisions!.toString("utf-8").trim())).toMatchObject({ action: "deny" });
  });

  it("deciding an unknown request id is 409, not a fabricated success", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/hitl/decision",
      headers: headers(),
      payload: { interruptId: "does-not-exist", decision: "approve" },
    });
    expect(response.statusCode).toBe(409);
  });
});
