import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SandboxFilesClient } from "../../src/adapters/sandbox/client.js";
import { SandboxUnavailableError } from "../../src/adapters/sandbox/errors.js";
import { sandboxTokenFor } from "../../src/adapters/sandbox/routing.js";

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(chunk as Uint8Array);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(body));
}

const KEY = "test-sandbox-hmac-key-at-least-32-bytes-long";
const SLUG = "lab-a";

describe("SandboxFilesClient", () => {
  let server: Server;
  let baseUrl: string;
  let lastAuthHeader: string | undefined;
  let files: Map<string, string>; // rel path -> base64

  beforeEach(async () => {
    files = new Map();
    server = createServer((request, response) => {
      lastAuthHeader = request.headers.authorization;
      void readJson(request).then((body) => {
        if (request.url === "/execute") {
          const command = String(body.command);
          const stat = /^stat -c '%s %Y %F' -- '(.+)'$/.exec(command);
          if (stat) {
            const path = stat[1]!.replace("/workspace/", "");
            const data = files.get(path);
            if (data === undefined) return send(response, 200, { output: "stat: No such file or directory\n", exit_code: 1 });
            return send(response, 200, { output: `${Buffer.from(data, "base64").length} 1700000000 regular file\n`, exit_code: 0 });
          }
          const rename = /^mv -f -- '(.+)' '(.+)'$/.exec(command);
          if (rename) {
            const [, from, to] = rename.map((p) => p.replace(`${WORKSPACE}/`, ""));
            const data = files.get(from!);
            if (data !== undefined) {
              files.delete(from!);
              files.set(to!, data);
            }
            return send(response, 200, { output: "", exit_code: data !== undefined ? 0 : 1 });
          }
          const remove = /^rm -f -- '(.+)'$/.exec(command);
          if (remove) {
            files.delete(remove[1]!.replace(`${WORKSPACE}/`, ""));
            return send(response, 200, { output: "", exit_code: 0 });
          }
          const list = /^find '(.+)' -mindepth 1 -maxdepth 1 -printf/.exec(command);
          if (list) {
            const prefix = list[1]!.replace(`${WORKSPACE}`, "").replace(/^\//, "");
            if (prefix !== "" && ![...files.keys()].some((k) => k.startsWith(`${prefix}/`))) {
              return send(response, 200, { output: "find: 'x': No such file or directory\n", exit_code: 1 });
            }
            const names = new Set<string>();
            for (const key of files.keys()) {
              if (prefix && !key.startsWith(`${prefix}/`)) continue;
              const rest = prefix ? key.slice(prefix.length + 1) : key;
              names.add(rest.split("/")[0]!);
            }
            return send(response, 200, { output: [...names].map((n) => `f ${n}\n`).join(""), exit_code: 0 });
          }
          return send(response, 200, { output: "", exit_code: 0 });
        }
        if (request.url === "/upload_files") {
          const uploaded = (body.files as { path: string; data_b64: string }[])[0]!;
          files.set(uploaded.path.replace(`${WORKSPACE}/`, ""), uploaded.data_b64);
          return send(response, 200, { files: [{ path: uploaded.path }] });
        }
        if (request.url === "/download_files") {
          const path = (body.paths as string[])[0]!.replace(`${WORKSPACE}/`, "");
          const data = files.get(path);
          if (data === undefined) return send(response, 200, { files: [{ path, error: "file_not_found" }] });
          return send(response, 200, { files: [{ path, data_b64: data }] });
        }
        if (request.url === "/workspace/ensure") {
          return send(response, 200, { ok: true });
        }
        send(response, 500, { error: "unhandled in test fixture" });
      });
    });
    const WORKSPACE = "/workspace";
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected a bound TCP address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** sandboxUrlFor() always builds http://sbx-<slug>:9999 -- redirect to the local test server instead. */
  function clientWithLocalFetch(): SandboxFilesClient {
    const fetchImpl: typeof fetch = (input, init) => {
      const url = new URL(typeof input === "string" ? input : (input as Request).url);
      return fetch(`${baseUrl}${url.pathname}${url.search}`, init);
    };
    return new SandboxFilesClient(KEY, fetchImpl);
  }

  it("sends the HMAC-derived bearer token for the slug", async () => {
    const client = clientWithLocalFetch();
    await client.write(SLUG, "a.txt", Buffer.from("hi"));
    expect(lastAuthHeader).toBe(`Bearer ${sandboxTokenFor(KEY, SLUG)}`);
  });

  it("write then read round-trips the bytes", async () => {
    const client = clientWithLocalFetch();
    await client.write(SLUG, "notes.txt", Buffer.from("hello"));
    const data = await client.read(SLUG, "notes.txt");
    expect(data?.toString("utf8")).toBe("hello");
  });

  it("read returns null for a file that does not exist", async () => {
    const client = clientWithLocalFetch();
    await expect(client.read(SLUG, "missing.txt")).resolves.toBeNull();
  });

  it("stat reflects size and existence", async () => {
    const client = clientWithLocalFetch();
    await client.write(SLUG, "a.txt", Buffer.from("hello"));
    const stat = await client.stat(SLUG, "a.txt");
    expect(stat).toMatchObject({ size: 5, isFile: true, isDirectory: false });
    await expect(client.stat(SLUG, "missing.txt")).resolves.toBeNull();
  });

  it("rename moves the file", async () => {
    const client = clientWithLocalFetch();
    await client.write(SLUG, "old.txt", Buffer.from("x"));
    await client.rename(SLUG, "old.txt", "new.txt");
    await expect(client.read(SLUG, "new.txt")).resolves.toEqual(Buffer.from("x"));
    await expect(client.read(SLUG, "old.txt")).resolves.toBeNull();
  });

  it("remove deletes the file", async () => {
    const client = clientWithLocalFetch();
    await client.write(SLUG, "a.txt", Buffer.from("x"));
    await client.remove(SLUG, "a.txt");
    await expect(client.read(SLUG, "a.txt")).resolves.toBeNull();
  });

  it("list reflects writes at the root", async () => {
    const client = clientWithLocalFetch();
    await client.write(SLUG, "a.txt", Buffer.from("x"));
    await client.write(SLUG, "b.txt", Buffer.from("y"));
    const entries = await client.list(SLUG, "");
    expect(entries?.map((e) => e.name).sort()).toEqual(["a.txt", "b.txt"]);
  });

  it("rejects a path that escapes the workspace", async () => {
    const client = clientWithLocalFetch();
    await expect(client.write(SLUG, "../escape.txt", Buffer.from("x"))).rejects.toThrow();
  });

  it("maps a connection failure to SandboxUnavailableError", async () => {
    const client = new SandboxFilesClient(KEY, undefined, 500);
    await expect(client.read(SLUG, "a.txt")).rejects.toBeInstanceOf(SandboxUnavailableError);
  });
});
