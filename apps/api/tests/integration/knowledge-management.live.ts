/** Disposable PostgreSQL + Neo4j + authenticated Python runtime + real production UI. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import { createDbClient } from "../../src/db/client.js";
import { PrismaProjectStore } from "../../src/db/project-store.js";
import { PrismaConversationStore } from "../../src/db/conversation-store.js";
import { PrismaKnowledgeItemStore } from "../../src/db/knowledge-item-store.js";
import { PrismaAppConfigStore } from "../../src/db/app-config-store.js";
import { PrismaRetrievalLogStore } from "../../src/db/retrieval-log-store.js";
import { RuntimeClient } from "../../src/adapters/runtime/client.js";
import { KnowledgeConfigurationService } from "../../src/services/knowledge-configuration.js";
import { buildAuthedTestApp } from "../support/build-test-app.js";

const connectionString = process.env.GRAPH_CHECK_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.includes("knowledge_check")) throw new Error("Use a disposable knowledge_check database via GRAPH_CHECK_DATABASE_URL");
const runtime = new RuntimeClient({ apiUrl: process.env.GRAPH_CHECK_RUNTIME_URL ?? "http://127.0.0.1:18112", apiToken: "knowledge-acceptance-runtime-token-0123456789abcdef", timeoutMs: 30000 });
const db = createDbClient({ connectionString });
const projects = new PrismaProjectStore(db), conversations = new PrismaConversationStore(db), config = new PrismaAppConfigStore(db);
const project = await projects.create({ name: "Knowledge acceptance project" });
const threadId = randomUUID();
const conversation = await conversations.create({ title: "Knowledge acceptance conversation", projectId: project.id, runtimeThreadId: threadId });
const built = await buildAuthedTestApp({ runtime, projectStore: projects, conversationStore: conversations, knowledgeItemStore: new PrismaKnowledgeItemStore(db), appConfigStore: config, retrievalLogStore: new PrismaRetrievalLogStore(db) });
built.app.log.level = "silent";
const address = await built.app.listen({ host: "127.0.0.1", port: 0 });
process.env.VITE_MOCK = "0";
const uiRoot = resolve("apps/ui-app");
const vite = await createServer({ root: uiRoot, configFile: join(uiRoot, "vite.config.ts"), mode: "production", server: { host: "127.0.0.1", port: 55174, strictPort: true, proxy: { "^/api(?:/|$)": { target: address, changeOrigin: true } } } });
await vite.listen();
const socket = vite.httpServer!.address();
if (!socket || typeof socket === "string") throw new Error("Missing UI address");
const ui = `http://127.0.0.1:${socket.port}`;
const browser = await chromium.launch();
const headers = { authorization: `Bearer ${built.token}`, "content-type": "application/json" };
const screenshots = join(tmpdir(), "opencode");

async function get(path: string) {
  const response = await fetch(address + path, { headers });
  assert.equal(response.status, 200, path + ": " + response.status);
  return response.json();
}
async function waitForJob() {
  const deadline = Date.now() + 240000;
  while (Date.now() < deadline) {
    const status = await get("/api/knowledge/index-status") as { is_rebuilding: boolean; job: { state: string; error?: string }; discovered_items: number; indexed_items: number; corpus_sha256?: string; current_items?: number };
    if (!status.is_rebuilding) {
      assert.notEqual(status.job.state, "failed", status.job.error);
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  throw new Error("Knowledge job did not finish within 240 seconds");
}

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
  page.setDefaultTimeout(30000);
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("dialog", dialog => { void dialog.accept(); });
  const sourceAction = async (action: string) => {
    if (await page.locator('.kn-actions').getAttribute('open') === null) await page.locator('.kn-actions > summary').click();
    await page.locator(`.kn-actions [data-action="knowledge.${action}"]`).click();
  };
  await page.goto(ui + "/#knowledge");
  await page.locator("#login-username").fill("admin");
  await page.locator("#login-password").fill("pw");
  await page.locator('#login-form button[type="submit"]').click();
  await expect(page.locator("#page-knowledge-management.active")).toBeVisible();
  await expect(page.locator("#page-knowledge-management h2").first()).toHaveText("Knowledge");
  const scan = await waitForJob();
  assert.equal(scan.discovered_items, 5850, "Actual repository corpus must be discovered");
  const manifest = JSON.parse(await readFile(resolve('docs/design/graph-corpus-manifest.json'), 'utf8')) as { corpus_sha256: string };
  assert.equal(scan.corpus_sha256, manifest.corpus_sha256, 'The normalized source corpus must retain its pinned checksum');
  await page.locator('[data-action="knowledge.refreshPage"]').click();
  await expect(page.locator(".knowledge-item-card").first()).toBeVisible();
  assert.ok(await page.locator(".knowledge-item-card").count() <= 10, "Initial library page is bounded");
  process.stdout.write(`Discovered ${scan.discovered_items} actual corpus files; initial UI is paginated\n`);

  const scanRequest = page.waitForResponse(response => response.url().endsWith('/api/knowledge/scan') && response.request().method() === 'POST');
  await sourceAction('refresh');
  assert.equal((await scanRequest).status(), 200);
  await waitForJob();
  const indexRequest = page.waitForResponse(response => response.url().includes('/api/knowledge/index') && response.request().method() === 'POST');
  await sourceAction('build');
  assert.equal((await indexRequest).status(), 200);
  const indexed = await waitForJob();
  assert.equal(indexed.indexed_items, 5850);
  assert.equal(indexed.current_items, 5850);
  const repeated = await fetch(address + "/api/knowledge/index", { method: "POST", headers, body: "{}" });
  assert.equal(repeated.status, 200);
  assert.equal((await waitForJob()).indexed_items, 5850, "Indexing must not duplicate the corpus");
  await page.locator('[data-action="knowledge.refreshPage"]').click();
  await expect(page.locator("#knowledge-stats")).toContainText("5,850");
  process.stdout.write("Actual reference indexing and idempotent repeat passed (5850 indexed documents)\n");

  await page.locator("#knowledge-source-filter").selectOption("attack");
  await page.locator("#knowledge-search").fill("Command and Scripting Interpreter");
  await page.locator("#knowledge-search").press("Enter");
  await expect(page.locator("#knowledge-items-list")).toContainText("Command and Scripting Interpreter");
  await page.locator(".kn-document-link").first().click();
  await expect(page.locator("#knowledge-document-modal")).toBeVisible();
  await expect(page.locator(".kn-source-content")).toContainText("source: attack");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(screenshots, "knowledge-library-desktop.png") });

  const toggle = page.locator("#knowledge-graph-enabled");
  if (!await toggle.isChecked()) { await toggle.check(); await expect(page.locator("#knowledge-graph-status")).toContainText("enabled"); }
  await toggle.uncheck();
  await expect(page.locator("#knowledge-graph-status")).toContainText("Disabled");
  await page.reload();
  await expect(toggle).not.toBeChecked();
  await expect(page.locator("#knowledge-graph-status")).toContainText("Disabled");
  const preference = new KnowledgeConfigurationService(new PrismaAppConfigStore(db));
  assert.equal((await preference.snapshot()).enabled, false, "A recreated configuration service must load the persisted preference");
  const probeEnv = { ...process.env, RAPTIX_SKIP_BOOT: "1", RAPTIX_USE_SKILLOGY: "0", RAPTIX_NEO4J_URI: "bolt://127.0.0.1:17690", RAPTIX_NEO4J_USER: "neo4j", RAPTIX_NEO4J_PASSWORD: "knowledge-check-password", RAPTIX_KNOWLEDGE_STATE_DIR: resolve("tests/local/artifacts/knowledge-management-state") };
  const runProbe = (enabled: boolean) => execFileSync(resolve(".venv/Scripts/python.exe"), [resolve("packages/raptix/tests/integration/knowledge_management_probe.py"), JSON.stringify({ enabled, engagement: project.workspaceSlug, thread_id: threadId })], { env: probeEnv, timeout: 60000, encoding: "utf8" });
  assert.match(runProbe(false), /"retrieval_executed": false/);
  await toggle.check();
  await expect(page.locator("#knowledge-graph-status")).toContainText("enabled");
  assert.match(runProbe(true), /"retrieval_executed": true/);
  process.stdout.write("Saved UI preference changes actual compiled-agent graph tools; enabled run executes live Neo4j retrieval\n");

  await page.locator('[data-action="knowledge.add"]').click();
  await page.locator("#knowledge-item-category").fill("Acceptance notes");
  await page.locator("#knowledge-item-title").fill("Knowledge acceptance note");
  await page.locator("#knowledge-item-content").fill("# Acceptance note\n\nA real Postgres library record.");
  await page.locator('[data-action="knowledge.save"]').click();
  await expect(page.locator("#knowledge-item-modal")).toBeHidden();
  assert.equal(await db.knowledgeItem.count({ where: { title: "Knowledge acceptance note" } }), 1);
  await sourceAction('openRetrieve');
  await page.locator("#knowledge-retrieval-query").fill("command");
  await page.locator('[data-action="knowledge.retrieve"]').click();
  await expect(page.locator("#knowledge-retrieval-results")).toContainText("matches");
  assert.ok(await page.locator("#knowledge-retrieval-results li").count() > 0);
  await page.locator('[data-action="knowledge.retrieveHistory"]').click();
  await expect(page.locator("#retrieval-logs-list")).toContainText("Knowledge acceptance conversation");
  await expect(page.locator("#retrieval-logs-list")).toContainText("Operator retrieval test");
  assert.equal(new URL(page.url()).hash, "#knowledge", "Tab changes must not require query parameters");
  await page.locator("#retrieval-logs-conversation-id").fill(conversation.title);
  await page.locator('[data-action="knowledge.filterLogs"]').click();
  await expect(page.locator(".retrieval-log-card")).toHaveCount(1);
  await page.locator('[data-action="knowledge.logDetails"]').click();
  await expect(page.locator("#retrieval-log-details-modal")).toContainText("Technical identifiers");
  await page.keyboard.press("Escape");
  await page.screenshot({ path: join(screenshots, "knowledge-history-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.locator("#page-knowledge-management").evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  await page.screenshot({ path: join(screenshots, "knowledge-history-mobile.png") });
  await page.getByRole("tab", { name: "Knowledge Library", exact: true }).click();
  await page.screenshot({ path: join(screenshots, "knowledge-library-mobile.png") });
  await page.goto(ui + "/#knowledge-management");
  await expect(page.locator("#page-knowledge-management.active")).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash).toBe("#knowledge");
  await page.getByRole("tab", { name: "Knowledge Library", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Retrieval History", exact: true })).toBeFocused();
  assert.deepEqual(pageErrors, []);
  process.stdout.write("Production UI: source scan/index/refresh/search/details/add, real retrieval events, persistence, route alias, keyboard tabs and mobile layout passed\n");
} finally {
  await browser.close();
  await vite.close();
  await built.app.close();
  await db.knowledgeItem.deleteMany({ where: { title: "Knowledge acceptance note" } });
  await db.project.deleteMany({ where: { id: project.id } });
  await db.$disconnect();
}
