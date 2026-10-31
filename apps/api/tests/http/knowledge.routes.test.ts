import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeKnowledgeItemStore } from "../support/fake-knowledge-item-store.js";
import { FakeRetrievalLogStore } from "../support/fake-retrieval-log-store.js";

describe("knowledge routes", () => {
  let app: FastifyInstance;
  let token: string;
  let knowledgeItemStore: FakeKnowledgeItemStore;
  let retrievalLogStore: FakeRetrievalLogStore;

  beforeEach(async () => {
    knowledgeItemStore = new FakeKnowledgeItemStore();
    retrievalLogStore = new FakeRetrievalLogStore();
    ({ app, token } = await buildAuthedTestApp({ knowledgeItemStore, retrievalLogStore }));
  });

  afterEach(async () => {
    await app.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it("rejects an unauthenticated request", async () => {
    const response = await app.inject({ method: "GET", url: "/api/knowledge/items" });
    expect(response.statusCode).toBe(401);
  });

  it("creates, lists by category page and deletes an item", async () => {
    const create = await app.inject({ method: "POST", url: "/api/knowledge/items", headers: auth(), payload: { category: "recon", title: "FOFA tips", content: "use qbase64" } });
    expect(create.statusCode).toBe(200);
    const item = create.json();
    expect(item).toMatchObject({ category: "recon", title: "FOFA tips" });

    const categories = await app.inject({ method: "GET", url: "/api/knowledge/categories", headers: auth() });
    expect(categories.json()).toEqual({ enabled: true, categories: ["recon"] });

    const list = await app.inject({ method: "GET", url: "/api/knowledge/items?categoryPage=true&limit=10&offset=0", headers: auth() });
    const body = list.json();
    expect(body.total).toBe(1);
    expect(body.categories[0]).toMatchObject({ category: "recon", itemCount: 1 });

    const deleted = await app.inject({ method: "DELETE", url: `/api/knowledge/items/${item.id}`, headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
  });

  it("rejects create with missing fields", async () => {
    const response = await app.inject({ method: "POST", url: "/api/knowledge/items", headers: auth(), payload: { category: "recon" } });
    expect(response.statusCode).toBe(400);
  });

  it("search finds matches by title or content, flat and unpaginated", async () => {
    await app.inject({ method: "POST", url: "/api/knowledge/items", headers: auth(), payload: { category: "recon", title: "FOFA tips", content: "qbase64 query encoding" } });
    await app.inject({ method: "POST", url: "/api/knowledge/items", headers: auth(), payload: { category: "other", title: "unrelated", content: "nothing here" } });

    const result = await app.inject({ method: "GET", url: "/api/knowledge/items?search=qbase64", headers: auth() });
    const body = result.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({ title: "FOFA tips" });
  });

  it("updates an existing item", async () => {
    const create = await app.inject({ method: "POST", url: "/api/knowledge/items", headers: auth(), payload: { category: "recon", title: "old", content: "old content" } });
    const id = create.json().id;
    const updated = await app.inject({ method: "PUT", url: `/api/knowledge/items/${id}`, headers: auth(), payload: { category: "recon", title: "new", content: "new content" } });
    expect(updated.json()).toMatchObject({ title: "new", content: "new content" });
  });

  it("404s a GET/PUT for a missing item", async () => {
    const get = await app.inject({ method: "GET", url: "/api/knowledge/items/missing", headers: auth() });
    expect(get.statusCode).toBe(404);
    const put = await app.inject({ method: "PUT", url: "/api/knowledge/items/missing", headers: auth(), payload: { category: "a", title: "b", content: "c" } });
    expect(put.statusCode).toBe(404);
  });

  it("stats reports real counts", async () => {
    await app.inject({ method: "POST", url: "/api/knowledge/items", headers: auth(), payload: { category: "recon", title: "a", content: "a" } });
    await app.inject({ method: "POST", url: "/api/knowledge/items", headers: auth(), payload: { category: "other", title: "b", content: "b" } });
    const stats = await app.inject({ method: "GET", url: "/api/knowledge/stats", headers: auth() });
    expect(stats.json()).toEqual({ enabled: true, total_items: 2, total_categories: 2 });
  });

  it("retrieval-logs lists and deletes real rows (empty until something writes one)", async () => {
    const empty = await app.inject({ method: "GET", url: "/api/knowledge/retrieval-logs", headers: auth() });
    expect(empty.json()).toEqual({ logs: [] });

    const seeded = retrievalLogStore.seed({ query: "kerberos", conversationId: "conv-1", messageId: null, riskType: null, retrievedItems: ["item-1"], hits: 1 });
    const list = await app.inject({ method: "GET", url: "/api/knowledge/retrieval-logs?conversationId=conv-1", headers: auth() });
    expect(list.json().logs).toHaveLength(1);
    expect(list.json().logs[0]).toMatchObject({ id: seeded.id, query: "kerberos" });

    const deleted = await app.inject({ method: "DELETE", url: `/api/knowledge/retrieval-logs/${seeded.id}`, headers: auth() });
    expect(deleted.json()).toEqual({ success: true });
  });

  it("scan, index and index-status are stubbed 501 -- no embedding consumer exists yet", async () => {
    const scan = await app.inject({ method: "POST", url: "/api/knowledge/scan", headers: auth() });
    expect(scan.statusCode).toBe(501);
    const index = await app.inject({ method: "POST", url: "/api/knowledge/index", headers: auth() });
    expect(index.statusCode).toBe(501);
    const status = await app.inject({ method: "GET", url: "/api/knowledge/index-status", headers: auth() });
    expect(status.statusCode).toBe(501);
  });
});
