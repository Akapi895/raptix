/** GRAPH_CHECK_DATABASE_URL must point to a disposable database with migrations applied. */
import assert from "node:assert/strict";
import { createDbClient } from "../../src/db/client.js";
import { PrismaProjectStore } from "../../src/db/project-store.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeRuntime } from "../support/fake-runtime.js";

const connectionString = process.env.GRAPH_CHECK_DATABASE_URL;
if (!connectionString) throw new Error("GRAPH_CHECK_DATABASE_URL is required (disposable database only)");
const db = createDbClient({ connectionString });
const projects = new PrismaProjectStore(db);
const runtime = new FakeRuntime();
runtime.stateValues = { messages: [{ type: "ai", content: "configuration probe complete" }] };
const built = await buildAuthedTestApp({ projectStore: projects, runtime, sandboxKey: "toggle-check-key".repeat(4) });
built.app.log.level = "silent";
const address = await built.app.listen({ host: "127.0.0.1", port: 0 });
const ids: string[] = [];
const headers = { authorization: `Bearer ${built.token}`, "content-type": "application/json" };
try {
  for (const name of ["Capture enabled", "Capture disabled"]) {
    const response = await fetch(`${address}/api/projects`, { method: "POST", headers, body: JSON.stringify({ name }) });
    assert.equal(response.status, 200);
    const project = await response.json() as { id: string; auto_ingest_enabled: boolean; tried_edges_enabled: boolean };
    ids.push(project.id);
    assert.equal(project.auto_ingest_enabled, false);
    assert.equal(project.tried_edges_enabled, false);
  }
  for (const settings of [
    { auto_ingest_enabled: true, tried_edges_enabled: false },
    { auto_ingest_enabled: false, tried_edges_enabled: true },
    { auto_ingest_enabled: false, tried_edges_enabled: false },
  ]) {
    const response = await fetch(`${address}/api/projects/${ids[0]}`, { method: "PUT", headers, body: JSON.stringify(settings) });
    assert.equal(response.status, 200);
    const saved = await projects.findById(ids[0]!);
    assert.equal(saved?.autoIngestEnabled, settings.auto_ingest_enabled);
    assert.equal(saved?.triedEdgesEnabled, settings.tried_edges_enabled);
    for (const path of ["/api/eino-agent", "/api/eino-agent/stream"]) {
      runtime.queueRunStatuses("success");
      const run = await fetch(address + path, { method: "POST", headers, body: JSON.stringify({ message: "configuration probe", projectId: ids[0] }) });
      assert.equal(run.status, 200);
      await run.text();
      const config = path.endsWith("/stream") ? runtime.streamConfigs.at(-1) : runtime.createdRuns.at(-1)?.config;
      assert.deepEqual((config?.configurable as Record<string, unknown>).graph_toggles, settings);
    }
  }
  const other = await projects.findById(ids[1]!);
  assert.equal(other?.autoIngestEnabled, false);
  assert.equal(other?.triedEdgesEnabled, false);
  const invalid = await fetch(`${address}/api/projects/${ids[0]}`, { method: "PUT", headers, body: JSON.stringify({ auto_ingest_enabled: "false" }) });
  assert.equal(invalid.status, 400);
  const unauthenticated = await fetch(`${address}/api/projects/${ids[0]}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ auto_ingest_enabled: true }) });
  assert.equal(unauthenticated.status, 401);
  process.stdout.write("Live HTTP + Postgres: independent project toggles persist and reach stream/sync run configuration; invalid and unauthenticated updates rejected\n");
} finally {
  await built.app.close();
  await db.project.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
}
