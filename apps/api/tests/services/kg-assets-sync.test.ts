import { describe, expect, it } from "vitest";
import { syncAssetsFromKnowledgeGraph } from "../../src/services/kg-assets-sync.js";
import { FakeAssetStore } from "../support/fake-asset-store.js";
import { FakeKnowledgeGraph } from "../support/fake-knowledge-graph.js";

describe("knowledge-graph asset sync", () => {
  it("keeps the scanner's recorded domain and the services observed on the host", async () => {
    const kg = new FakeKnowledgeGraph();
    kg.hostsByEngagement.set("eng-1", [
      {
        host: "103.143.207.183",
        ip: "103.143.207.183",
        hostname: "ctsv.example.test",
        services: [
          { port: 3306, protocol: "tcp", service: "", banner: "", status: "" },
          { port: 80, protocol: "tcp", service: "http", banner: "", status: "200" },
        ],
      },
    ]);
    const store = new FakeAssetStore();

    await syncAssetsFromKnowledgeGraph(kg, store, "p1", "eng-1");

    const [asset] = (await store.list({ projectId: "p1", limit: 10, offset: 0 })).assets;
    expect(asset).toMatchObject({
      host: "103.143.207.183",
      ip: "103.143.207.183",
      domain: "ctsv.example.test",
      port: 80,
      protocol: "tcp",
      source: "neo4j-kg",
    });
    expect(asset?.server).toContain("tcp/3306");
    expect(asset?.server).toContain("tcp/80 http");
  });

  it("folds the several KG nodes recorded for one address into a single row with every name and service", async () => {
    const kg = new FakeKnowledgeGraph();
    kg.hostsByEngagement.set("eng-1", [
      { host: "112.137.132.251", ip: "112.137.132.251", hostname: "idp.example.test", services: [] },
      { host: "112.137.132.251", ip: "112.137.132.251", hostname: "mail.example.test", services: [{ port: 443, protocol: "tcp", service: "https", banner: "", status: "200" }] },
    ]);
    const store = new FakeAssetStore();

    await syncAssetsFromKnowledgeGraph(kg, store, "p1", "eng-1");

    const rows = (await store.list({ projectId: "p1", limit: 10, offset: 0 })).assets;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ domain: "idp.example.test, mail.example.test", port: 443, protocol: "tcp" });
  });

  it("runs overlapping syncs of one project one after another, so a new host gets exactly one row", async () => {
    const kg = new FakeKnowledgeGraph();
    kg.hostsByEngagement.set("eng-1", [{ host: "10.1.1.1", ip: "10.1.1.1", hostname: "", services: [] }]);
    const store = new FakeAssetStore();
    const events: string[] = [];
    const upsert = store.importUpsert.bind(store);
    store.importUpsert = async (items) => {
      events.push("start");
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result = await upsert(items);
      events.push("end");
      return result;
    };

    await Promise.all([
      syncAssetsFromKnowledgeGraph(kg, store, "p1", "eng-1"),
      syncAssetsFromKnowledgeGraph(kg, store, "p1", "eng-1"),
    ]);

    expect(events).toEqual(["start", "end", "start", "end"]);
    expect((await store.list({ projectId: "p1", limit: 10, offset: 0 })).assets).toHaveLength(1);
  });

  it("keeps only hostname-shaped names, dropping free text the scanner put in the label", async () => {
    const kg = new FakeKnowledgeGraph();
    kg.hostsByEngagement.set("eng-1", [
      { host: "10.2.2.2", ip: "10.2.2.2", hostname: "tk.cet.example.test DNS note", services: [] },
      { host: "10.2.2.2", ip: "10.2.2.2", hostname: "tk.cet.example.test", services: [] },
    ]);
    const store = new FakeAssetStore();

    await syncAssetsFromKnowledgeGraph(kg, store, "p1", "eng-1");

    const [asset] = (await store.list({ projectId: "p1", limit: 10, offset: 0 })).assets;
    expect(asset?.domain).toBe("tk.cet.example.test");
  });

  it("does not store the IP as a domain when the host has no recorded name", async () => {
    const kg = new FakeKnowledgeGraph();
    kg.hostsByEngagement.set("eng-1", [{ host: "10.0.0.5", ip: "10.0.0.5", hostname: "10.0.0.5", services: [] }]);
    const store = new FakeAssetStore();

    await syncAssetsFromKnowledgeGraph(kg, store, "p1", "eng-1");

    const [asset] = (await store.list({ projectId: "p1", limit: 10, offset: 0 })).assets;
    expect(asset?.domain).toBe("");
  });
});
