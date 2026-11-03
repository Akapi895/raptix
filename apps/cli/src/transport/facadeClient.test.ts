import { describe, expect, it } from "vitest";
import { FacadeClient, FacadeError } from "./facadeClient.js";

function respond(status: number, body: unknown, calls: { url: string; init: RequestInit }[] = []): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

describe("FacadeClient", () => {
  it("talks only to the control plane and never to a LangGraph runtime", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = new FacadeClient({ baseUrl: "http://127.0.0.1:8081/", fetchImpl: respond(200, { threads: [] }, calls) });
    await client.listThreads("eng-a");
    expect(calls[0]?.url).toBe("http://127.0.0.1:8081/api/engagements/eng-a/threads");
    expect(calls[0]?.init.redirect).toBe("error");
  });

  it("returns a busy, stale or refused command answer as data, not as an error", async () => {
    const busy = { status: "busy", phase: "ready", version: 4, commandId: "cmd-1" };
    const client = new FacadeClient({ baseUrl: "http://127.0.0.1:8081", fetchImpl: respond(409, busy) });
    await expect(client.environmentCommand("eng-b", { requestId: "act-b-0001", action: "activate", expectedVersion: 4 })).resolves.toEqual(busy);
  });

  it("raises a typed error with the server's stable code for any other failure", async () => {
    const client = new FacadeClient({ baseUrl: "http://127.0.0.1:8081", fetchImpl: respond(404, { statusCode: 404, error: { code: "not_found", message: "Not found" } }) });
    const failure = await client.environment("eng-x").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FacadeError);
    expect(failure).toMatchObject({ status: 404, code: "not_found" });
  });

  it("refuses a control-plane URL that carries credentials, a query or a non-HTTP scheme", () => {
    expect(() => new FacadeClient({ baseUrl: "http://user:pass@127.0.0.1:8081" })).toThrow(/credentials/);
    expect(() => new FacadeClient({ baseUrl: "http://127.0.0.1:8081?x=1" })).toThrow(/credentials/);
    expect(() => new FacadeClient({ baseUrl: "file:///etc/passwd" })).toThrow(/HTTP/);
  });

  it("parses the run event stream frame by frame and keeps the cursor", async () => {
    const frame = `id: 7\nevent: run-event\ndata: ${JSON.stringify({ eventId: "e1", payload: { type: "message" } })}\n\n`;
    const fetchImpl = (async () => new Response(frame, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    const client = new FacadeClient({ baseUrl: "http://127.0.0.1:8081", fetchImpl });
    const seen: { event: string; id?: string; data: unknown }[] = [];
    for await (const item of client.events("eng-a", "t-a", "run-1", "-1", new AbortController().signal)) seen.push(item);
    expect(seen).toEqual([{ event: "run-event", id: "7", data: { eventId: "e1", payload: { type: "message" } } }]);
  });
});
