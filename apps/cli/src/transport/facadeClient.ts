/**
 * The CLI's only path to a project, its threads and its runs (ADR-0092 §4.4). It talks to the web control plane,
 * which owns project authority, the run ledger, the environment slot and the runtime routing. It never reaches
 * a LangGraph runtime directly.
 */

import { decodeSse } from "@raptix/streaming";

export type EnvironmentState = "unprovisioned" | "starting" | "ready" | "stopping" | "stopped" | "uncertain";
export type SlotPhase = "idle" | "starting" | "ready" | "stopping" | "uncertain";

export interface EnvironmentStateView {
  engagementId: string;
  environment: { observedState: EnvironmentState; desiredState: string; generation: number; observedAt: string | null };
  slot: { phase: SlotPhase; version: number; held: boolean; ownedByThisProject: boolean; activeEngagementId: string | null };
}

export interface EnvironmentCommandResult {
  status: "accepted" | "replayed" | "busy" | "stale" | "refused";
  phase: SlotPhase;
  version: number;
  commandId: string | null;
  activeEngagementId?: string | null;
  reason?: string;
}

export interface RequestAck {
  engagementId: string;
  requestId: string;
  operation: "create_thread" | "create_run" | "resume";
  state: "creating" | "accepted" | "uncertain" | "rejected";
  threadId: string | null;
  runId: string | null;
}

export interface ThreadBinding {
  engagementId: string;
  threadId: string;
  assistantId: string;
  kind: "planning" | "execution";
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary { id: string; displayName: string; workspaceSlug: string; status: string }

/** One frame of a run's event stream, as the web projects it. Shape mirrors PublicStreamEvent. */
export interface ProjectedEvent {
  eventId: string;
  threadId: string;
  runId: string | null;
  streamRunId: string;
  upstreamCursor?: string;
  payload: { type: string; [key: string]: unknown };
}

export class FacadeError extends Error {
  public constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "FacadeError";
  }
}

export interface FacadeConfig {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

export class FacadeClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(config: FacadeConfig) {
    const parsed = new URL(config.baseUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("The control plane URL must be HTTP(S).");
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("The control plane URL must not carry credentials, a query or a fragment.");
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  public listProjects(): Promise<ProjectSummary[]> {
    return this.json("GET", "/api/engagements");
  }

  public environment(engagementId: string): Promise<EnvironmentStateView> {
    return this.json("GET", `/api/engagements/${enc(engagementId)}/environment`);
  }

  /** A busy, stale or refused answer is data, so its body is returned with its status instead of thrown. */
  public async environmentCommand(engagementId: string, body: { requestId: string; action: "activate" | "stop"; expectedVersion: number }): Promise<EnvironmentCommandResult> {
    const response = await this.send("POST", `/api/engagements/${enc(engagementId)}/environment/commands`, body);
    if (response.status === 200 || response.status === 409) return response.body as EnvironmentCommandResult;
    throw toError(response.status, response.body);
  }

  public createThread(engagementId: string, body: { requestId: string; kind: "planning" | "execution"; assistantId?: string }): Promise<RequestAck> {
    return this.json("POST", `/api/engagements/${enc(engagementId)}/threads`, body);
  }

  public listThreads(engagementId: string): Promise<{ threads: ThreadBinding[] }> {
    return this.json("GET", `/api/engagements/${enc(engagementId)}/threads`);
  }

  public submitRun(engagementId: string, threadId: string, body: { requestId: string; message: string }): Promise<RequestAck> {
    return this.json("POST", `/api/engagements/${enc(engagementId)}/threads/${enc(threadId)}/runs`, body);
  }

  public resume(engagementId: string, threadId: string, body: { requestId: string; value: string | string[]; questionId: string | null; answers?: { questionId: string; value: string | string[] }[] }): Promise<RequestAck> {
    return this.json("POST", `/api/engagements/${enc(engagementId)}/threads/${enc(threadId)}/resume`, body);
  }

  /** Continues a paused operation as a new run on the same thread. */
  public resumeRun(engagementId: string, threadId: string, requestId: string): Promise<RequestAck> {
    return this.json("POST", `/api/engagements/${enc(engagementId)}/threads/${enc(threadId)}/resume-run`, { requestId });
  }

  public cancelRun(engagementId: string, threadId: string, runId: string): Promise<unknown> {
    return this.json("POST", `/api/engagements/${enc(engagementId)}/threads/${enc(threadId)}/runs/${enc(runId)}/cancel`);
  }

  public pauseRun(engagementId: string, threadId: string, runId: string): Promise<unknown> {
    return this.json("POST", `/api/engagements/${enc(engagementId)}/threads/${enc(threadId)}/runs/${enc(runId)}/pause`);
  }

  public snapshot(engagementId: string, threadId: string): Promise<Record<string, unknown>> {
    return this.json("GET", `/api/engagements/${enc(engagementId)}/threads/${enc(threadId)}`);
  }

  /** Subscribes to one run's projected events. The cursor resumes after the last event the caller saw. */
  public async *events(engagementId: string, threadId: string, runId: string, cursor: string, signal: AbortSignal): AsyncGenerator<{ event: string; data: unknown; id?: string }> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/engagements/${enc(engagementId)}/threads/${enc(threadId)}/runs/${enc(runId)}/events`, {
      method: "GET",
      headers: { accept: "text/event-stream", "last-event-id": cursor },
      signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) throw toError(response.status, null);
    for await (const frame of decodeSse(response.body)) {
      let data: unknown = frame.data;
      try { data = JSON.parse(frame.data); } catch { /* keep the raw text for the adapter to reject */ }
      yield { event: frame.event, data, ...(frame.id === undefined ? {} : { id: frame.id }) };
    }
  }

  private async json<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await this.send(method, path, body);
    if (response.status >= 200 && response.status < 300) return response.body as T;
    throw toError(response.status, response.body);
  }

  private async send(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: unknown }> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
    });
    const text = await response.text();
    if (text.length > MAX_BODY_BYTES) throw new FacadeError(response.status, "response_too_large", "The control plane answered with more data than the CLI accepts.");
    let parsed: unknown = null;
    if (text.length > 0) {
      try { parsed = JSON.parse(text); } catch { throw new FacadeError(response.status, "invalid_response", "The control plane answered with data the CLI cannot read."); }
    }
    return { status: response.status, body: parsed };
  }
}

const enc = (value: string): string => encodeURIComponent(value);

function toError(status: number, body: unknown): FacadeError {
  const envelope = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  const code = typeof envelope?.code === "string" ? envelope.code : "request_failed";
  const message = typeof envelope?.message === "string" ? envelope.message : `The control plane answered ${status}.`;
  return new FacadeError(status, code, message);
}
