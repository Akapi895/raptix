/**
 * Normalizer tests against W00 source-emitter captured fields.
 *
 * Field values are taken verbatim from
 * apps/web/tests/fixtures/w00/runtime/runtime-emitter-capture.json
 * (provenance: source-emitter-controlled, StreamingRunnable @ subagent_streaming.py).
 */

import { describe, expect, it } from "vitest";
import {
  normalizeSubagentEvent,
  normalizedEventKey,
  normalizedGroupKey,
  type NormalizedSubagentEvent,
  type StreamEvent,
  type SubagentCustomEvent,
} from "../src/index";

const SID_A = "aaaa1111aaaa";
const SID_B = "bbbb2222bbbb";
const CREATED = "2026-10-01T14:22:32.001258+00:00";
const CALL_ID = "call-w00-1";

function rawStart(sessionId: string): SubagentCustomEvent {
  return {
    type: "subagent_start",
    created_at: CREATED,
    agent: "recon",
    prompt: "Passive recon of the public example lab range (harmless fixture data only).",
    session_id: sessionId,
  };
}

function rawEnd(sessionId: string, flags: { cancelled: boolean; error: boolean }): SubagentCustomEvent {
  return {
    type: "subagent_end",
    created_at: CREATED,
    agent: "recon",
    elapsed: 85.125,
    cancelled: flags.cancelled,
    error: flags.error,
    session_id: sessionId,
  };
}

describe("normalizeSubagentEvent — captured W00 fields", () => {
  it("maps raw session_id/created_at to sessionId/createdAt and keeps unit fields", () => {
    const n = normalizeSubagentEvent(rawStart(SID_A));
    expect(n).not.toBeNull();
    expect(n!.type).toBe("subagent_start");
    expect(n!.agent).toBe("recon");
    expect(n!.sessionId).toBe(SID_A);
    expect(n!.createdAt).toBe(CREATED);
    expect(n!.prompt).toContain("harmless fixture data");
    expect("toolId" in n!).toBe(false);
    expect(n!.toolPhase).toBeUndefined();
  });

  it("reports elapsed in SECONDS without conversion (85.125 stays 85.125)", () => {
    const n = normalizeSubagentEvent(rawEnd(SID_A, { cancelled: false, error: false }));
    expect(n!.elapsedSeconds).toBe(85.125);
  });

  it("distinguishes explicit null tool id from an absent one", () => {
    const idlessCall = normalizeSubagentEvent({
      type: "subagent_tool_call",
      created_at: "2026-10-01T14:22:32.001406+00:00",
      agent: "recon",
      tool: "inspect_fixture",
      args: { subject: "example.test.local", mode: "passive" },
      id: null,
      session_id: "eeee5555eeee",
    });
    expect(idlessCall!.toolId).toBeNull();
    expect("toolId" in idlessCall!).toBe(true);

    const noIdKey = normalizeSubagentEvent(rawStart(SID_A));
    expect("toolId" in noIdKey!).toBe(false);
  });

  it("keeps a same-id call/result pair distinct (no collapse)", () => {
    const base = {
      created_at: "2026-10-01T14:22:32.001277+00:00",
      agent: "recon",
      tool: "inspect_fixture",
      args: { subject: "example.test.local", mode: "passive" },
      session_id: SID_A,
    };
    const call = normalizeSubagentEvent({
      type: "subagent_tool_call",
      ...base,
      id: CALL_ID,
    });
    const result = normalizeSubagentEvent({
      type: "subagent_tool_result",
      ...base,
      content: "fixture result",
      status: "success",
      id: CALL_ID,
    });
    expect(call!.toolId).toBe(CALL_ID);
    expect(result!.toolId).toBe(CALL_ID);
    expect(call!.toolPhase).toBe("call");
    expect(result!.toolPhase).toBe("result");
    expect(normalizedEventKey(call!)).not.toBe(normalizedEventKey(result!));
  });

  it("separates parallel same-agent sessions by session_id", () => {
    const a = normalizeSubagentEvent(rawStart(SID_A));
    const b = normalizeSubagentEvent(rawStart(SID_B));
    expect(a!.agent).toBe(b!.agent);
    expect(a!.sessionId).not.toBe(b!.sessionId);
    expect(normalizedEventKey(a!)).not.toBe(normalizedEventKey(b!));
  });

  it("preserves cancelled and error flags on subagent_end", () => {
    const cancelled = normalizeSubagentEvent(rawEnd("dddd4444dddd", { cancelled: true, error: false }));
    const failed = normalizeSubagentEvent(rawEnd("cccc3333cccc", { cancelled: false, error: true }));
    const normal = normalizeSubagentEvent(rawEnd(SID_A, { cancelled: false, error: false }));
    expect(cancelled!.cancelled).toBe(true);
    expect(cancelled!.error).toBe(false);
    expect(failed!.error).toBe(true);
    expect(failed!.cancelled).toBe(false);
    expect(normal!.cancelled).toBe(false);
    expect(normal!.error).toBe(false);
  });

  it("passes live-full vs checkpoint-truncated content through verbatim, never collapsing", () => {
    const full = "x".repeat(8001);
    const capped = "x".repeat(8000) + "…[truncated]";
    const base = {
      type: "subagent_tool_result" as const,
      created_at: "2026-10-01T14:22:32.001283+00:00",
      agent: "recon",
      tool: "inspect_fixture",
      args: { subject: "example.test.local" },
      status: "success",
      id: CALL_ID,
      session_id: SID_A,
    };
    const live = normalizeSubagentEvent({ ...base, content: full });
    const checkpoint = normalizeSubagentEvent({ ...base, content: capped });
    expect(live!.content).toBe(full);
    expect(checkpoint!.content).toBe(capped);
    expect(normalizedEventKey(live!)).toBe(normalizedEventKey(checkpoint!));
    expect(live).not.toBe(checkpoint);
  });

  it("accepts events without raw identity fields (ask_user_question)", () => {
    const n = normalizeSubagentEvent({
      type: "ask_user_question",
      agent: "soundwave",
      id: "call-q-1",
      question: "Proceed?",
      header: "Approval",
      options: [{ label: "Yes", description: "Go ahead" }, { label: 42 } as unknown as { label: string }],
      multi_select: false,
      allow_other: true,
    });
    expect(n).not.toBeNull();
    expect("sessionId" in n!).toBe(false);
    expect("createdAt" in n!).toBe(false);
    expect(n!.questionId).toBe("call-q-1");
    expect("toolId" in n!).toBe(false);
    expect(n!.toolPhase).toBeUndefined();
    expect(n!.question).toBe("Proceed?");
    expect(n!.header).toBe("Approval");
    expect(n!.options).toEqual([{ label: "Yes", description: "Go ahead" }]);
    expect(n!.multiSelect).toBe(false);
    expect(n!.allowOther).toBe(true);
    expect(normalizedEventKey(n!)).toBe(`soundwave::ask_user_question#call-q-1`);
  });

  it("round-trips background_complete payload incl. null exit_code", () => {
    const base = {
      type: "background_complete" as const,
      agent: "sandbox",
      tool: "bash",
      command: "nmap -sV example.test.local",
      content: "done",
      elapsed: 2.5,
    };
    const done = normalizeSubagentEvent({ ...base, session: "bg-123", exit_code: 0 });
    expect(done!.session).toBe("bg-123");
    expect(done!.command).toBe("nmap -sV example.test.local");
    expect(done!.exitCode).toBe(0);
    expect(done!.elapsedSeconds).toBe(2.5);

    const noExit = normalizeSubagentEvent({ ...base, session: "bg-124", exit_code: null });
    expect(noExit!.exitCode).toBeNull();
    // No id and no created_at on this raw emitter: no provable unique key.
    expect(normalizedEventKey(noExit!)).toBeNull();
  });

  it("gives repeated same-agent messages distinct keys via created_at", () => {
    const first = normalizeSubagentEvent({
      type: "subagent_message",
      created_at: "2026-10-01T14:22:32.001273+00:00",
      agent: "recon",
      text: "first",
      session_id: SID_A,
    });
    const second = normalizeSubagentEvent({
      type: "subagent_message",
      created_at: "2026-10-01T14:22:33.004321+00:00",
      agent: "recon",
      text: "second",
      session_id: SID_A,
    });
    const keyA = normalizedEventKey(first!);
    const keyB = normalizedEventKey(second!);
    expect(keyA).not.toBeNull();
    expect(keyB).not.toBeNull();
    expect(keyA).not.toBe(keyB);
    expect(normalizedGroupKey(first!)).toBe(normalizedGroupKey(second!));
  });

  it("returns null keys for idless events without created_at (no guessed identity)", () => {
    const legacy = normalizeSubagentEvent({ type: "subagent_message", agent: "recon", text: "hi" });
    const idlessCall = normalizeSubagentEvent({
      type: "subagent_tool_call",
      agent: "recon",
      tool: "bash",
      id: null,
    });
    expect(normalizedEventKey(legacy!)).toBeNull();
    expect(normalizedEventKey(idlessCall!)).toBeNull();
  });

  it("groups by session with an agent-only legacy fallback", () => {
    const a = normalizeSubagentEvent(rawStart(SID_A))!;
    const b = normalizeSubagentEvent(rawStart(SID_B))!;
    expect(normalizedGroupKey(a)).toBe(`${SID_A}::recon`);
    expect(normalizedGroupKey(a)).not.toBe(normalizedGroupKey(b));
    const legacyA = normalizeSubagentEvent({ type: "subagent_message", agent: "recon" })!;
    const legacyB = normalizeSubagentEvent({ type: "subagent_message", agent: "exploit" })!;
    expect(normalizedGroupKey(legacyA)).toBe("::recon");
    expect(normalizedGroupKey(legacyA)).not.toBe(normalizedGroupKey(legacyB));
  });

  it("drops per-field type mismatches without failing the event", () => {
    const n = normalizeSubagentEvent({
      type: "subagent_end",
      created_at: 123,
      agent: "recon",
      elapsed: "85.125",
      session_id: SID_A,
    });
    expect(n).not.toBeNull();
    expect("createdAt" in n!).toBe(false);
    expect("elapsedSeconds" in n!).toBe(false);
    expect(n!.sessionId).toBe(SID_A);
  });
});

describe("normalizeSubagentEvent — invalid payloads", () => {
  it("rejects non-objects and malformed events", () => {
    const invalid: unknown[] = [
      null,
      undefined,
      42,
      "subagent_start",
      [],
      {},
      { agent: "recon" },
      { type: "not_an_event", agent: "recon" },
      { type: "subagent_start" },
      { type: "subagent_start", agent: "" },
    ];
    for (const payload of invalid) {
      expect(normalizeSubagentEvent(payload)).toBeNull();
    }
  });
});

describe("compatibility with existing shapes", () => {
  it("normalized sessionId bridges onto the camelCase StreamEvent shape", () => {
    const n: NormalizedSubagentEvent = normalizeSubagentEvent(rawStart(SID_A))!;
    const streamEvent: StreamEvent = {
      id: "e1",
      type: n.type,
      timestamp: Date.parse(n.createdAt ?? "1970-01-01T00:00:00Z"),
      subagent: n.agent,
      sessionId: n.sessionId,
    };
    expect(streamEvent.sessionId).toBe(SID_A);
  });

  it("still accepts legacy raw events without the new additive fields", () => {
    const legacy: SubagentCustomEvent = { type: "subagent_tool_call", agent: "recon", tool: "bash" };
    const n = normalizeSubagentEvent(legacy);
    expect(n).not.toBeNull();
    expect(n!.tool).toBe("bash");
    expect("sessionId" in n!).toBe(false);
  });
});
