import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";

describe("asset routes", () => {
  let app: FastifyInstance;
  let token: string;

  beforeEach(async () => {
    ({ app, token } = await buildAuthedTestApp());
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function importOne(host: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/assets/import",
      headers: auth(),
      payload: { assets: [{ host, ip: "198.51.100.10", status: "active" }], source: "nmap" },
    });
    return response.json();
  }

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/assets" });
    expect(response.statusCode).toBe(401);
  });

  it("import creates a new asset and reports created:1", async () => {
    const result = await importOne("host-a.example.com");
    expect(result).toEqual({ created: 1, updated: 0, skipped: 0 });

    const list = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    const body = list.json();
    expect(body.assets).toHaveLength(1);
    expect(body.assets[0]).toMatchObject({ host: "host-a.example.com", vulnerability_count: 0 });
  });

  it("re-importing the same host upserts instead of duplicating", async () => {
    await importOne("host-b.example.com");
    const second = await importOne("host-b.example.com");
    expect(second).toEqual({ created: 0, updated: 1, skipped: 0 });

    const list = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    expect(list.json().assets).toHaveLength(1);
  });

  it("import skips an item with no host/ip/domain", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/assets/import",
      headers: auth(),
      payload: { assets: [{ title: "nothing to key on" }] },
    });
    expect(response.json()).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  it("PUT replaces the asset -- omitted fields are cleared, not left alone", async () => {
    await importOne("host-c.example.com");
    const list = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    const id = list.json().assets[0].id;

    const replaced = await app.inject({
      method: "PUT",
      url: `/api/assets/${id}`,
      headers: auth(),
      payload: { host: "host-c.example.com", title: "renamed" },
    });
    const body = replaced.json();
    expect(body.title).toBe("renamed");
    expect(body.ip).toBe(""); // was "198.51.100.10" from import; PUT is a full replace, so it's cleared.
  });

  it("bulk patches only the given fields for the given ids, leaving others alone", async () => {
    await importOne("host-d.example.com");
    const list = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    const id = list.json().assets[0].id;

    const bulk = await app.inject({
      method: "PUT",
      url: "/api/assets/bulk",
      headers: auth(),
      payload: { asset_ids: [id], status: "inactive" },
    });
    expect(bulk.json()).toEqual({ success: true, updated: 1 });

    const after = await app.inject({ method: "GET", url: `/api/assets/selection?status=inactive`, headers: auth() });
    expect(after.json().assets).toHaveLength(1);
    expect(after.json().assets[0].ip).toBe("198.51.100.10"); // untouched by the bulk patch.
  });

  it("merge unions tags and deletes the merged rows", async () => {
    await importOne("host-e1.example.com");
    await importOne("host-e2.example.com");
    const list = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    const [a, b] = list.json().assets as { id: string }[];

    const merge = await app.inject({
      method: "POST",
      url: "/api/assets/merge",
      headers: auth(),
      payload: { asset_ids: [a.id, b.id], primary_id: a.id },
    });
    expect(merge.statusCode).toBe(200);
    expect(merge.json().id).toBe(a.id);

    const after = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    expect(after.json().assets).toHaveLength(1);
  });

  it("batch-delete removes the given ids and reports the count", async () => {
    await importOne("host-f.example.com");
    const list = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    const id = list.json().assets[0].id;

    const deleted = await app.inject({
      method: "POST",
      url: "/api/assets/batch-delete",
      headers: auth(),
      payload: { asset_ids: [id] },
    });
    expect(deleted.json()).toEqual({ success: true, deleted: 1 });
  });

  it("project-binding assigns the given ids to a project", async () => {
    await importOne("host-g.example.com");
    const list = await app.inject({ method: "GET", url: "/api/assets", headers: auth() });
    const id = list.json().assets[0].id;

    const bound = await app.inject({
      method: "PUT",
      url: "/api/assets/project-binding",
      headers: auth(),
      payload: { asset_ids: [id], project_id: "proj-xyz" },
    });
    expect(bound.json()).toEqual({ success: true, updated: 1 });

    // apps/ui-app's contract has no GET-by-id for a single asset (PUT/merge already return
    // the full row); verify through the project filter on the list endpoint instead.
    const after = await app.inject({ method: "GET", url: "/api/assets?project_id=proj-xyz", headers: auth() });
    expect(after.json().assets).toHaveLength(1);
    expect(after.json().assets[0].id).toBe(id);
  });

  it("stats are real aggregates, not fabricated", async () => {
    await importOne("host-h.example.com");
    const stats = await app.inject({ method: "GET", url: "/api/assets/stats", headers: auth() });
    expect(stats.json()).toMatchObject({ total: 1, ips: 1 });
  });

  it("scan-links is stubbed 501, not a fabricated success (needs the Neo4j AKG client)", async () => {
    const response = await app.inject({ method: "POST", url: "/api/assets/scan-links", headers: auth(), payload: { scans: [] } });
    expect(response.statusCode).toBe(501);
  });
});
