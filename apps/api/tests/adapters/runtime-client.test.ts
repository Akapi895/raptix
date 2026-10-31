import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RuntimeClient } from "../../src/adapters/runtime/client.js";
import { RuntimeRejectedError, RuntimeUnavailableError } from "../../src/adapters/runtime/errors.js";

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk as Uint8Array);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? JSON.parse(text) : undefined;
}

function send(response: ServerResponse, status: number, body?: unknown): void {
  response.statusCode = status;
  if (body === undefined) {
    response.end();
    return;
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

describe("RuntimeClient", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuthHeader: string | undefined;

  beforeEach(async () => {
    server = createServer((request, response) => {
      lastAuthHeader = request.headers.authorization;
      void readBody(request).then((body) => {
        if (request.url === "/info" && request.method === "GET") {
          send(response, 200, { version: "9.9.9" });
          return;
        }
        if (request.url === "/assistants/search" && request.method === "POST") {
          send(response, 200, [{ graph_id: "raptix" }, { graph_id: "soundwave" }, { graph_id: "raptix" }]);
          return;
        }
        if (request.url === "/threads" && request.method === "POST") {
          const payload = body as { thread_id: string };
          send(response, 200, { thread_id: payload.thread_id, metadata: { seeded: true } });
          return;
        }
        if (request.url === "/threads/missing" && request.method === "GET") {
          send(response, 404);
          return;
        }
        if (request.url?.startsWith("/threads/t1/runs/r1") && request.method === "GET") {
          send(response, 200, {
            thread_id: "t1",
            run_id: "r1",
            status: "success",
            metadata: {},
            created_at: "2026-10-31T00:00:00.000Z",
            updated_at: "2026-10-31T00:00:01.000Z",
          });
          return;
        }
        if (request.url === "/threads/t1/runs/r2/cancel?wait=1&action=interrupt" && request.method === "POST") {
          send(response, 204);
          return;
        }
        send(response, 500, { error: "unhandled in test fixture" });
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sends the bearer token on every call", async () => {
    const client = new RuntimeClient({ apiUrl: baseUrl, apiToken: "a".repeat(32) });
    await client.ping();
    expect(lastAuthHeader).toBe(`Bearer ${"a".repeat(32)}`);
  });

  it("omits the Authorization header when no token is configured", async () => {
    const client = new RuntimeClient({ apiUrl: baseUrl });
    await client.ping();
    expect(lastAuthHeader).toBeUndefined();
  });

  it("ping() dedupes graph ids and sorts them", async () => {
    const client = new RuntimeClient({ apiUrl: baseUrl });
    const result = await client.ping();
    expect(result).toEqual({ version: "9.9.9", graphIds: ["raptix", "soundwave"] });
  });

  it("createThread() round-trips the thread id", async () => {
    const client = new RuntimeClient({ apiUrl: baseUrl });
    const result = await client.createThread("abc-123");
    expect(result).toEqual({ threadId: "abc-123", metadata: { seeded: true } });
  });

  it("getRun() returns a well-typed run", async () => {
    const client = new RuntimeClient({ apiUrl: baseUrl });
    const run = await client.getRun("t1", "r1");
    expect(run).toEqual({
      runId: "r1",
      threadId: "t1",
      status: "success",
      createdAt: "2026-10-31T00:00:00.000Z",
      updatedAt: "2026-10-31T00:00:01.000Z",
      metadata: {},
    });
  });

  it("cancelRun() sends POST with no body and tolerates 204", async () => {
    const client = new RuntimeClient({ apiUrl: baseUrl });
    await expect(client.cancelRun("t1", "r2")).resolves.toBeUndefined();
  });

  it("maps a 404 to RuntimeRejectedError", async () => {
    const client = new RuntimeClient({ apiUrl: baseUrl });
    await expect(client.getThread("missing")).rejects.toBeInstanceOf(RuntimeRejectedError);
  });

  it("maps an unreachable host to RuntimeUnavailableError", async () => {
    const client = new RuntimeClient({ apiUrl: "http://127.0.0.1:1", timeoutMs: 500 });
    await expect(client.ping()).rejects.toBeInstanceOf(RuntimeUnavailableError);
  });
});
