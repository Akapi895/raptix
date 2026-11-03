import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

describe("GET /api/config/tools", () => {
  let app: FastifyInstance;
  let token: string;

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "GET", url: "/api/config/tools" });
    expect(response.statusCode).toBe(401);
  });

  it("unions the real runtime catalogs, marks MCP tools by server, and paginates", async () => {
    const runtime = new FakeRuntime();
    runtime.graphIds = ["raptix", "recon", "exploit"];
    runtime.specialistCatalogs = {
      recon: {
        tools: [
          { name: "nmap_scan", description: "Port scanning" },
          { name: "shared_tool", description: "From recon" },
        ],
        servers: [{ name: "controlled-mcp", tools: [{ name: "controlled-mcp:probe", description: "MCP probe", available: false }] }],
      },
      exploit: {
        tools: [{ name: "shared_tool", description: "" }],
        servers: [],
      },
    };
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const response = await app.inject({ method: "GET", url: "/api/config/tools?page=1&page_size=10", headers: auth() });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(3);
    expect(body.total_pages).toBe(1);
    expect(body.total_enabled).toBe(2);
    expect(body.tools).toEqual([
      { name: "controlled-mcp:probe", description: "MCP probe", enabled: false, is_external: true, external_mcp: "controlled-mcp" },
      { name: "nmap_scan", description: "Port scanning", enabled: true, is_external: false, external_mcp: "" },
      { name: "shared_tool", description: "From recon", enabled: true, is_external: false, external_mcp: "" },
    ]);
  });

  it("filters by search across names and descriptions", async () => {
    const runtime = new FakeRuntime();
    runtime.graphIds = ["recon"];
    runtime.specialistCatalogs = {
      recon: {
        tools: [
          { name: "nmap_scan", description: "Port scanning" },
          { name: "dns_lookup", description: "Resolves names" },
        ],
        servers: [],
      },
    };
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const response = await app.inject({ method: "GET", url: "/api/config/tools?search=port&page=1&page_size=10", headers: auth() });
    expect(response.statusCode).toBe(200);
    expect(response.json().tools.map((tool: { name: string }) => tool.name)).toEqual(["nmap_scan"]);
  });

  it("503s honestly when every runtime catalog is unreachable", async () => {
    const runtime = new FakeRuntime();
    runtime.graphIds = ["recon"];
    runtime.specialistCatalogs = {};
    runtime.specialistCatalog = new Error("runtime down");
    runtime.specialistRequest = async () => { throw new Error("runtime down"); };
    ({ app, token } = await buildAuthedTestApp({ runtime }));
    const response = await app.inject({ method: "GET", url: "/api/config/tools", headers: auth() });
    expect(response.statusCode).toBe(503);
  });

  it("keeps global tool toggling stubbed at 501", async () => {
    ({ app, token } = await buildAuthedTestApp());
    const response = await app.inject({ method: "PUT", url: "/api/config/tools", headers: { ...auth(), "content-type": "application/json" }, payload: {} });
    expect(response.statusCode).toBe(501);
  });
});
