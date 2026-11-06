import { describe, expect, it } from "vitest";
import { captureChildEvents, captureExecutionEvents, commitPendingToolCalls, createToolCallBuffer } from "../../src/services/execution-events.js";

describe("captureChildEvents", () => {
  it("translates a subagent_start event, carrying the parent tool_call id", () => {
    const events = captureChildEvents({
      type: "subagent_start",
      agent: "appsec_specialist",
      prompt: "test sqli on /search",
      session_id: "sess-1",
      parent_tool_call_id: "orch-call-42",
    });

    expect(events).toEqual([
      {
        eventType: "child_start",
        data: { einoAgent: "appsec_specialist", parentToolCallId: "orch-call-42", sessionId: "sess-1", prompt: "test sqli on /search" },
      },
    ]);
  });

  it("translates a subagent_message event", () => {
    const events = captureChildEvents({
      type: "subagent_message",
      agent: "appsec_specialist",
      text: "Confirmed SQLi on /search?q=",
      session_id: "sess-1",
      parent_tool_call_id: "orch-call-42",
    });

    expect(events).toEqual([
      {
        eventType: "child_message",
        data: { einoAgent: "appsec_specialist", parentToolCallId: "orch-call-42", sessionId: "sess-1", text: "Confirmed SQLi on /search?q=" },
      },
    ]);
  });

  it("translates a subagent_tool_call event with its own tool_call id and args", () => {
    const events = captureChildEvents({
      type: "subagent_tool_call",
      agent: "appsec_specialist",
      tool: "bash",
      args: { command: "curl /search?q=1" },
      id: "child-tc-1",
      session_id: "sess-1",
      parent_tool_call_id: "orch-call-42",
    });

    expect(events).toEqual([
      {
        eventType: "child_tool_call",
        data: {
          einoAgent: "appsec_specialist",
          parentToolCallId: "orch-call-42",
          sessionId: "sess-1",
          toolName: "bash",
          toolCallId: "child-tc-1",
          argumentsObj: { command: "curl /search?q=1" },
        },
      },
    ]);
  });

  it("translates a subagent_tool_result event, mapping status to isError/success", () => {
    const events = captureChildEvents({
      type: "subagent_tool_result",
      agent: "appsec_specialist",
      tool: "bash",
      content: "HTTP/1.1 500",
      status: "error",
      id: "child-tc-1",
      session_id: "sess-1",
      parent_tool_call_id: "orch-call-42",
    });

    expect(events).toEqual([
      {
        eventType: "child_tool_result",
        data: {
          einoAgent: "appsec_specialist",
          parentToolCallId: "orch-call-42",
          sessionId: "sess-1",
          toolName: "bash",
          toolCallId: "child-tc-1",
          content: "HTTP/1.1 500",
          isError: true,
          success: false,
        },
      },
    ]);
  });

  it("translates a subagent_end event", () => {
    const events = captureChildEvents({
      type: "subagent_end",
      agent: "appsec_specialist",
      elapsed: 12.5,
      cancelled: false,
      error: false,
      session_id: "sess-1",
      parent_tool_call_id: "orch-call-42",
    });

    expect(events).toEqual([
      {
        eventType: "child_end",
        data: { einoAgent: "appsec_specialist", parentToolCallId: "orch-call-42", sessionId: "sess-1", cancelled: false, error: false },
      },
    ]);
  });

  it("returns no events for an unrecognized type", () => {
    expect(captureChildEvents({ type: "something_else", agent: "appsec_specialist" })).toEqual([]);
  });

  it("returns no events when agent is missing", () => {
    expect(captureChildEvents({ type: "subagent_start", prompt: "x" })).toEqual([]);
  });

  it("returns no events for a non-object chunk", () => {
    expect(captureChildEvents("not an object")).toEqual([]);
    expect(captureChildEvents(null)).toEqual([]);
  });

  it("defaults parentToolCallId/sessionId to null when absent, never leaking undefined", () => {
    const events = captureChildEvents({ type: "subagent_message", agent: "exploit", text: "hi" });
    expect(events[0]?.data).toEqual({ einoAgent: "exploit", parentToolCallId: null, sessionId: null, text: "hi" });
  });

  it("coexists with the orchestrator's own tool-call buffering without interference", () => {
    const buffer = createToolCallBuffer();
    captureExecutionEvents({ type: "ai", tool_calls: [{ id: "orch-call-42", name: "task", args: { subagent_type: "appsec_specialist" } }] }, buffer);
    const settled = commitPendingToolCalls(buffer);
    expect(settled).toHaveLength(1);
    expect(settled[0]?.data).toMatchObject({ toolCallId: "orch-call-42" });

    const childEvents = captureChildEvents({ type: "subagent_start", agent: "appsec_specialist", prompt: "go", session_id: "s1", parent_tool_call_id: "orch-call-42" });
    expect(childEvents[0]?.data).toMatchObject({ parentToolCallId: "orch-call-42" });
  });
});
