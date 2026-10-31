import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAuthedTestApp } from "../support/build-test-app.js";
import { FakeSandbox } from "../support/fake-sandbox.js";

describe("file routes (ADR-0102: project files only through the project sandbox)", () => {
  let app: FastifyInstance;
  let token: string;
  let sandbox: FakeSandbox;
  let projectId: string;

  function auth() {
    return { authorization: `Bearer ${token}` };
  }

  beforeEach(async () => {
    sandbox = new FakeSandbox();
    ({ app, token } = await buildAuthedTestApp({ sandbox }));
    const project = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "Lab" } });
    projectId = project.json().id;
  });

  afterEach(async () => {
    await app.close();
  });

  it("rejects listing files with no project or conversation to resolve a sandbox from", async () => {
    const response = await app.inject({ method: "GET", url: "/api/chat-uploads", headers: auth() });
    expect(response.statusCode).toBe(400);
  });

  it("uploads a file via multipart form, then reads it back through the API", async () => {
    const boundary = "----testboundary";
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="notes.txt"',
      "Content-Type: text/plain",
      "",
      "hello world",
      `--${boundary}`,
      'Content-Disposition: form-data; name="relativeDir"',
      "",
      projectId,
      `--${boundary}--`,
      "",
    ].join("\r\n");

    const response = await app.inject({
      method: "POST",
      url: "/api/chat-uploads",
      headers: { ...auth(), "content-type": `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().files[0]).toMatchObject({ name: "notes.txt" });

    const read = await app.inject({
      method: "GET",
      url: `/api/chat-uploads/content?path=${encodeURIComponent(`${projectId}/notes.txt`)}`,
      headers: auth(),
    });
    expect(read.json()).toEqual({ content: "hello world" });
  });

  it("content round-trips through write then read", async () => {
    const path = `${projectId}/readme.md`;
    const write = await app.inject({
      method: "PUT",
      url: "/api/chat-uploads/content",
      headers: auth(),
      payload: { path, content: "# Hello" },
    });
    expect(write.json()).toEqual({ ok: true });

    const read = await app.inject({ method: "GET", url: `/api/chat-uploads/content?path=${encodeURIComponent(path)}`, headers: auth() });
    expect(read.json()).toEqual({ content: "# Hello" });
  });

  it("list reflects what was written", async () => {
    await app.inject({ method: "PUT", url: "/api/chat-uploads/content", headers: auth(), payload: { path: `${projectId}/a.txt`, content: "a" } });
    const list = await app.inject({ method: "GET", url: `/api/chat-uploads?project=${projectId}`, headers: auth() });
    expect(list.json().files).toEqual([{ relativePath: `${projectId}/a.txt`, name: "a.txt" }]);
  });

  it("rename moves the file within the same project", async () => {
    const path = `${projectId}/old.txt`;
    await app.inject({ method: "PUT", url: "/api/chat-uploads/content", headers: auth(), payload: { path, content: "x" } });
    const rename = await app.inject({
      method: "PUT",
      url: "/api/chat-uploads/rename",
      headers: auth(),
      payload: { path, newName: "new.txt" },
    });
    expect(rename.json()).toEqual({ ok: true });

    const read = await app.inject({
      method: "GET",
      url: `/api/chat-uploads/content?path=${encodeURIComponent(`${projectId}/new.txt`)}`,
      headers: auth(),
    });
    expect(read.json()).toEqual({ content: "x" });
  });

  it("delete removes the file", async () => {
    const path = `${projectId}/to-delete.txt`;
    await app.inject({ method: "PUT", url: "/api/chat-uploads/content", headers: auth(), payload: { path, content: "x" } });
    const del = await app.inject({ method: "DELETE", url: "/api/chat-uploads", headers: auth(), payload: { path } });
    expect(del.json()).toEqual({ ok: true });

    const read = await app.inject({ method: "GET", url: `/api/chat-uploads/content?path=${encodeURIComponent(path)}`, headers: auth() });
    expect(read.statusCode).toBe(404);
  });

  it("fails with 503 instead of a fabricated write when the sandbox is unavailable", async () => {
    // FakeProjectStore's workspaceSlug is deterministic ("test-slug-<n>"); this is the
    // second project created against this store instance (the first is the "Lab" project
    // from beforeEach), so its slug is "test-slug-2" -- see tests/support/fake-project-store.ts.
    const project = await app.inject({ method: "POST", url: "/api/projects", headers: auth(), payload: { name: "Down" } });
    const downId = project.json().id;
    sandbox.unavailableSlugs.add("test-slug-2");

    const response = await app.inject({
      method: "PUT",
      url: "/api/chat-uploads/content",
      headers: auth(),
      payload: { path: `${downId}/x.txt`, content: "x" },
    });
    expect(response.statusCode).toBe(503);
  });
});
