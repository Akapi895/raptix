import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";
import { FakeAppConfigStore } from "../support/fake-app-config-store.js";
import { RuntimeUnavailableError } from "../../src/adapters/runtime/errors.js";

describe("Knowledge management integration", () => {
  let app: FastifyInstance;
  afterEach(async () => { await app?.close(); });

  it("paginates real library records together with reference projections without copying them", async () => {
    const runtime = new FakeRuntime();
    runtime.knowledgeResponses.library = { items: [{ id: "ref::attack:T1059", title: "Command and Scripting Interpreter", source: "attack", category: "technique", index_status: "indexed", read_only: true }], total: 5850, status: { indexed_items: 5850 } };
    runtime.knowledgeResponses.detail = { id: "ref::attack:T1059", title: "Command and Scripting Interpreter", content: "id: attack:T1059", read_only: true };
    const built = await buildAuthedTestApp({ runtime }); app = built.app;
    const headers = { authorization: `Bearer ${built.token}` };
    await app.inject({ method: "POST", url: "/api/knowledge/items", headers, payload: { category: "notes", title: "Manual note", content: "# Preserved" } });
    const result = await app.inject({ url: "/api/knowledge/items?view=documents&limit=2", headers });
    expect(result.json()).toMatchObject({ total: 5851, document_page: true, items: [{ title: "Manual note", index_status: "library" }, { id: "ref::attack:T1059", read_only: true }] });
    expect(runtime.knowledgeCalls.at(-1)).toMatchObject({ action: "library", body: { offset: 0, limit: 1 } });
    const detail = await app.inject({ url: "/api/knowledge/items/ref%3A%3Aattack%3AT1059", headers });
    expect(detail.json()).toMatchObject({ content: "id: attack:T1059", read_only: true });
  });

  it("saves a revision-checked graph preference and preserves it across app recreation", async () => {
    const appConfigStore = new FakeAppConfigStore();
    const runtime = new FakeRuntime();
    runtime.knowledgeResponses.status = { graph_available: true, initialized: true };
    const first = await buildAuthedTestApp({ runtime, appConfigStore }); app = first.app;
    const headers = { authorization: `Bearer ${first.token}` };
    const initial = await app.inject({ url: "/api/knowledge/graph-configuration", headers });
    expect(initial.json()).toMatchObject({ enabled: true, revision: 0, status: { graph_available: true } });
    const saved = await app.inject({ method: "PUT", url: "/api/knowledge/graph-configuration", headers, payload: { enabled: false, revision: 0 } });
    expect(saved.json()).toEqual({ enabled: false, revision: 1 });
    const stale = await app.inject({ method: "PUT", url: "/api/knowledge/graph-configuration", headers, payload: { enabled: true, revision: 0 } });
    expect(stale.statusCode).toBe(409);
    await app.close();
    const second = await buildAuthedTestApp({ runtime, appConfigStore }); app = second.app;
    const reloaded = await app.inject({ url: "/api/knowledge/graph-configuration", headers: { authorization: `Bearer ${second.token}` } });
    expect(reloaded.json()).toMatchObject({ enabled: false, revision: 1 });
  });

  it.each(["/api/eino-agent", "/api/eino-agent/stream"])("applies the saved graph preference to new executions through %s", async (url) => {
    const runtime = new FakeRuntime();
    runtime.stateValues = { messages: [{ type: "ai", content: "configuration observed" }] };
    const built = await buildAuthedTestApp({ runtime, sandboxKey: "test-key".repeat(8) }); app = built.app;
    const headers = { authorization: `Bearer ${built.token}` };
    const project = (await app.inject({ method: "POST", url: "/api/projects", headers, payload: { name: "Graph preference" } })).json();
    await app.inject({ method: "PUT", url: "/api/knowledge/graph-configuration", headers, payload: { enabled: false, revision: 0 } });
    const response = await app.inject({ method: "POST", url, headers, payload: { projectId: project.id, message: "Observe configuration", knowledge_graph: { enabled: true } } });
    expect(response.statusCode).toBe(200);
    const config = url.endsWith("/stream") ? runtime.streamConfigs[0] : runtime.createdRuns[0]?.config;
    expect(config).toMatchObject({ configurable: { knowledge_graph: { enabled: false, revision: 1 }, kg_engagement: expect.any(String) } });
  });

  it("distinguishes runtime availability from the saved enabled preference", async () => {
    class DownRuntime extends FakeRuntime {
      public override async knowledgeRequest(): Promise<never> { throw new RuntimeUnavailableError("offline"); }
    }
    const built = await buildAuthedTestApp({ runtime: new DownRuntime() }); app = built.app;
    const headers = { authorization: `Bearer ${built.token}` };
    expect((await app.inject({ url: "/api/knowledge/graph-configuration", headers })).json()).toMatchObject({ enabled: true, status: { graph_available: false, initialized: false } });
    const page = await app.inject({ url: "/api/knowledge/items?view=documents", headers });
    expect(page.json().reference_error).toContain("unavailable");
    expect((await app.inject({ method: "POST", url: "/api/knowledge/index", headers })).statusCode).toBe(503);
  });

  it("rejects unauthenticated changes and invalid configuration values", async () => {
    const built = await buildAuthedTestApp(); app = built.app;
    const url = "/api/knowledge/graph-configuration";
    expect((await app.inject({ method: "PUT", url, payload: { enabled: true, revision: 0 } })).statusCode).toBe(401);
    expect((await app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${built.token}` }, payload: { enabled: "false", revision: -1 } })).statusCode).toBe(400);
  });
});
