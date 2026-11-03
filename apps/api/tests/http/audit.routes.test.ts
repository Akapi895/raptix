import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeAuditLogStore } from "../support/fake-audit-log-store.js";

describe("audit routes", () => {
  let app: FastifyInstance;
  let token: string;
  let auditLogStore: FakeAuditLogStore;

  beforeEach(async () => {
    auditLogStore = new FakeAuditLogStore();
    ({ app, token } = await buildAuthedTestApp({ auditLogStore }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/audit/logs" });
    expect(response.statusCode).toBe(401);
  });

  it("login records a real audit entry, visible through the list and summary", async () => {
    // buildAuthedTestApp already logged in once to get `token`.
    const list = await app.inject({ method: "GET", url: "/api/audit/logs", headers: auth() });
    const body = list.json();
    expect(body.total).toBe(1);
    expect(body.logs[0]).toMatchObject({ category: "auth", action: "login", result: "success", actor: "admin" });

    const summary = await app.inject({ method: "GET", url: "/api/audit/summary", headers: auth() });
    expect(summary.json()).toMatchObject({ total: 1, failures: 0 });
  });

  it("a failed login records a failure entry, not a fabricated success", async () => {
    await app.inject({ method: "POST", url: "/api/auth/login", payload: { username: "admin", password: "wrong" } });
    const list = await app.inject({ method: "GET", url: "/api/audit/logs?result=failure", headers: auth() });
    expect(list.json().logs).toHaveLength(1);
    expect(list.json().logs[0]).toMatchObject({ action: "login", result: "failure" });
  });

  it("change-password records success and failure", async () => {
    await app.inject({ method: "POST", url: "/api/auth/change-password", headers: auth(), payload: { oldPassword: "wrong", newPassword: "new" } });
    await app.inject({ method: "POST", url: "/api/auth/change-password", headers: auth(), payload: { oldPassword: "pw", newPassword: "new-pw" } });
    const list = await app.inject({ method: "GET", url: "/api/audit/logs?action=change_password", headers: auth() });
    const actions = list.json().logs.map((log: { result: string }) => log.result);
    expect(actions.sort()).toEqual(["failure", "success"]);
  });

  it("reads a single log by id and 404s a missing one", async () => {
    const list = await app.inject({ method: "GET", url: "/api/audit/logs", headers: auth() });
    const id = list.json().logs[0].id;
    const detail = await app.inject({ method: "GET", url: `/api/audit/logs/${id}`, headers: auth() });
    expect(detail.json()).toMatchObject({ id, category: "auth" });

    const missing = await app.inject({ method: "GET", url: "/api/audit/logs/missing", headers: auth() });
    expect(missing.statusCode).toBe(404);
  });

  it("export returns JSON by default and CSV when asked", async () => {
    const json = await app.inject({ method: "GET", url: "/api/audit/logs/export", headers: auth() });
    expect(json.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(json.body)).toHaveLength(1);

    const csv = await app.inject({ method: "GET", url: "/api/audit/logs/export?format=csv", headers: auth() });
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.body).toContain("id,createdAt,level,category,action,result,actor,message");
  });
});
