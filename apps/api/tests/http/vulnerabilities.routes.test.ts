import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("vulnerability routes", () => {
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

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function create(overrides: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: "POST",
      url: "/api/vulnerabilities",
      headers: auth(),
      payload: { title: "SQL injection", severity: "high", target: "https://example.com/login", ...overrides },
    });
    return response.json();
  }

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/vulnerabilities" });
    expect(response.statusCode).toBe(401);
  });

  it("rejects create with no title/severity", async () => {
    const response = await app.inject({ method: "POST", url: "/api/vulnerabilities", headers: auth(), payload: {} });
    expect(response.statusCode).toBe(400);
  });

  it("creates, lists, reads, updates and deletes a vulnerability", async () => {
    const created = await create();
    expect(created).toMatchObject({ title: "SQL injection", severity: "high", status: "open" });

    const list = await app.inject({ method: "GET", url: "/api/vulnerabilities", headers: auth() });
    expect(list.json()).toMatchObject({ total: 1, page: 1, page_size: 20 });

    const get = await app.inject({ method: "GET", url: `/api/vulnerabilities/${created.id}`, headers: auth() });
    expect(get.json().id).toBe(created.id);

    const updated = await app.inject({
      method: "PUT",
      url: `/api/vulnerabilities/${created.id}`,
      headers: auth(),
      payload: { status: "fixed" },
    });
    expect(updated.json()).toMatchObject({ status: "fixed", title: "SQL injection" }); // partial patch: title untouched.

    const deleted = await app.inject({ method: "DELETE", url: `/api/vulnerabilities/${created.id}`, headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
  });

  it("retest creates a real conversation (real runtime thread) and logs it on the vulnerability", async () => {
    const created = await create();
    const retest = await app.inject({
      method: "POST",
      url: `/api/vulnerabilities/${created.id}/retest`,
      headers: auth(),
      payload: { prompt: "Verify the fix" },
    });
    expect(retest.statusCode).toBe(200);
    const body = retest.json();
    expect(body.prompt).toBe("Verify the fix");
    expect(typeof body.conversation.id).toBe("string");
    expect(runtime.createdThreads).toHaveLength(1);

    const after = await app.inject({ method: "GET", url: `/api/vulnerabilities/${created.id}`, headers: auth() });
    expect(after.json().retest_log).toContain(body.conversation.id);
  });

  it("batch delete removes everything matching the current filter, not an explicit id list", async () => {
    await create({ severity: "high" });
    await create({ severity: "low", title: "Weak TLS cipher" });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/api/vulnerabilities/batch?severity=high",
      headers: auth(),
    });
    expect(deleted.json()).toEqual({ deleted: 1 });

    const list = await app.inject({ method: "GET", url: "/api/vulnerabilities", headers: auth() });
    expect(list.json().total).toBe(1);
    expect(list.json().vulnerabilities[0].severity).toBe("low");
  });

  it("export groups by conversation into real generated files", async () => {
    await create();
    const response = await app.inject({ method: "GET", url: "/api/vulnerabilities/export", headers: auth() });
    const body = response.json();
    expect(body.files).toHaveLength(1);
    expect(body.files[0].content).toContain("SQL injection");
  });

  it("filter-options and stats are real aggregates", async () => {
    await create({ severity: "high" });
    await create({ severity: "low", title: "Weak TLS cipher" });

    const options = await app.inject({ method: "GET", url: "/api/vulnerabilities/filter-options", headers: auth() });
    expect(options.json().severities.sort()).toEqual(["high", "low"]);

    const stats = await app.inject({ method: "GET", url: "/api/vulnerabilities/stats", headers: auth() });
    expect(stats.json()).toMatchObject({ total: 2, by_severity: { high: 1, low: 1 } });
  });

  it("the alert subscription round-trips through a real store", async () => {
    const save = await app.inject({
      method: "PUT",
      url: "/api/vulnerability-alerts/subscription",
      headers: auth(),
      payload: { enabled: true, min_severity: "critical" },
    });
    expect(save.json()).toEqual({ enabled: true, min_severity: "critical" });

    const read = await app.inject({ method: "GET", url: "/api/vulnerability-alerts/subscription", headers: auth() });
    expect(read.json()).toEqual({ enabled: true, min_severity: "critical" });
  });
});
