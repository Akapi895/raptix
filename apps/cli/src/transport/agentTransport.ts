/**
 * The agent hook's transport. It keeps the call shapes the hook already uses (threads, runs, cancel), and each call
 * goes through the control plane for the project the session selected. There is no raw runtime client.
 */

import { randomUUID } from "node:crypto";
import type { FacadeClient, RequestAck } from "./facadeClient.js";
import { runChunks, snapshotState, type RunChunk } from "./projectedRun.js";

export interface StreamOptions {
  input?: { messages?: { role: string; content: string }[] };
  command?: { resume?: unknown };
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface AgentTransport {
  threads: {
    create(): Promise<{ thread_id: string }>;
    getState(threadId: string): Promise<{ values: { messages: unknown[] } }>;
  };
  runs: {
    stream(threadId: string, assistantId: string, options: StreamOptions): AsyncGenerator<RunChunk>;
    cancel(threadId: string, runId: string, wait: boolean, action: "interrupt" | "rollback"): Promise<void>;
  };
}

const requestId = (): string => `cli-${randomUUID()}`;

function runIdOf(ack: RequestAck): string {
  if (ack.runId === null) throw new Error("The control plane has not started the run yet. Try again.");
  return ack.runId;
}

function threadIdOf(ack: RequestAck): string {
  if (ack.threadId === null) throw new Error("The control plane has not created the conversation yet. Try again.");
  return ack.threadId;
}

/** `engagement` resolves the session's project once, so every call stays in that project. */
export function createAgentTransport(facade: FacadeClient, engagement: () => Promise<string>, defaults: { assistantId: string }): AgentTransport {
  return {
    threads: {
      async create() {
        const engagementId = await engagement();
        const ack = await facade.createThread(engagementId, { requestId: requestId(), kind: "execution", assistantId: defaults.assistantId });
        return { thread_id: threadIdOf(ack) };
      },
      async getState(threadId) {
        const engagementId = await engagement();
        const view = await facade.snapshot(engagementId, threadId);
        const messages = Array.isArray(view.messages) ? (view.messages as { role: string; content: string }[]) : [];
        return snapshotState({ messages }) as { values: { messages: unknown[] } };
      },
    },
    runs: {
      async *stream(threadId, _assistantId, options) {
        const engagementId = await engagement();
        const resume = options.command?.resume;
        let ack: RequestAck;
        if (resume !== undefined) {
          ack = resume === true
            ? await facade.resumeRun(engagementId, threadId, requestId())
            : await facade.resume(engagementId, threadId, { requestId: requestId(), value: asResumeValue(resume), questionId: null });
        } else {
          const message = [...(options.input?.messages ?? [])].reverse().find(m => m.role === "user");
          if (message === undefined) throw new Error("A message is required to start a run.");
          ack = await facade.submitRun(engagementId, threadId, { requestId: requestId(), message: message.content });
        }
        const runId = runIdOf(ack);
        const frames = facade.events(engagementId, threadId, runId, "-1", options.signal ?? new AbortController().signal);
        yield* runChunks(runId, threadId, frames);
      },
      async cancel(threadId, runId, _wait, action) {
        const engagementId = await engagement();
        if (action === "interrupt") await facade.pauseRun(engagementId, threadId, runId);
        else await facade.cancelRun(engagementId, threadId, runId);
      },
    },
  };
}

function asResumeValue(value: unknown): string | string[] {
  if (typeof value === "string" || (Array.isArray(value) && value.every(v => typeof v === "string"))) return value as string | string[];
  return JSON.stringify(value);
}
