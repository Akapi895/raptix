"""Controlled W00 capture of the production subagent_streaming emitter shape.

Loads a copied source module via importlib (no network, no graph runs) and
drives StreamingRunnable's private emitters directly: writer=live_list.append
captures the live channel, a transcript list the persisted checkpoint copy.
No invoke/ainvoke/stream. Usage: python capture-runtime.py --source <f> --output <dir>
Exit: 0 assertions passed; 3 assertion failure; 2 usage/load error.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

from langchain_core.messages import AIMessage, ToolMessage
from langchain_core.runnables import RunnableLambda

PROVENANCE = "source-emitter-controlled"
AGENT_NAME = "recon"
TOOL_NAME = "inspect_fixture"
TOOL_CALL_ID = "call-w00-1"
ORPHAN_RESULT_ID = "call-w00-orphan"
TOOL_ARGS = {"subject": "example.test.local", "mode": "passive"}
ELAPSED_S = 85.125
PROMPT = "Passive recon of the public example lab range (harmless fixture data only)."
AI_TEXT = "Scope confirmed: passive collection on the example lab range only."
TOOL_RESULT = "x" * 8001
SID_A, SID_B, SID_ERR = "aaaa1111aaaa", "bbbb2222bbbb", "cccc3333cccc"
SID_CANCEL, SID_NOID = "dddd4444dddd", "eeee5555eeee"
OUTPUT_NAME = "runtime-emitter-capture.json"
EVENT_TYPES = [
    "subagent_start",
    "subagent_message",
    "subagent_tool_call",
    "subagent_tool_result",
    "subagent_end",
]


def load_source_module(source: Path):
    spec = importlib.util.spec_from_file_location("w00_captured_subagent_streaming", source)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot build import spec from {source}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def ai_message(tool_calls=None, content=AI_TEXT):
    try:
        return AIMessage(content=content, tool_calls=tool_calls)
    except Exception:
        return AIMessage.model_construct(content=content, tool_calls=tool_calls)


def emit_session(run, session_id, batches, *, error=False, cancelled=False):
    live: list = []
    transcript: list = []
    run._emit_start(None, False, live.append, PROMPT, session_id, transcript)
    active: dict = {}
    for batch in batches:
        run._process_messages(batch, active, None, False, live.append, session_id, transcript)
    run._emit_end(
        None,
        False,
        live.append,
        ELAPSED_S,
        session_id,
        cancelled=cancelled,
        error=error,
        transcript=transcript,
    )
    return {"sessionId": session_id, "live": live, "persisted": transcript}


def build_sessions(run):
    paired = [{"name": TOOL_NAME, "args": dict(TOOL_ARGS), "id": TOOL_CALL_ID, "type": "tool_call"}]
    idless = [{"name": TOOL_NAME, "args": dict(TOOL_ARGS), "id": None, "type": "tool_call"}]
    full = ToolMessage(content=TOOL_RESULT, tool_call_id=TOOL_CALL_ID)
    orphan = ToolMessage(
        content="fixture orphan tool result (harmless).", tool_call_id=ORPHAN_RESULT_ID
    )
    return {
        "parallel-a": emit_session(run, SID_A, [[ai_message(tool_calls=paired)], [full]]),
        "parallel-b": emit_session(run, SID_B, []),
        "error": emit_session(run, SID_ERR, [], error=True),
        "cancelled": emit_session(run, SID_CANCEL, [], cancelled=True),
        "no-tool-id": emit_session(
            run, SID_NOID, [[ai_message(tool_calls=idless, content="")], [orphan]]
        ),
    }


def events_of(events, etype):
    return [event for event in events if event.get("type") == etype]


def channel_events(sessions):
    return [ev for s in sessions.values() for ch in ("live", "persisted") for ev in s[ch]]


def iso_utc_ok(value):
    try:
        return datetime.fromisoformat(value).utcoffset().total_seconds() == 0
    except (TypeError, ValueError, AttributeError):
        return False


def build_checks(run, module, sessions):
    live_a = sessions["parallel-a"]["live"]
    call = events_of(live_a, "subagent_tool_call")[0]
    live_res = events_of(live_a, "subagent_tool_result")[0]
    pers_res = events_of(sessions["parallel-a"]["persisted"], "subagent_tool_result")[0]
    pers_txt = pers_res.get("content", "")
    nid_call = events_of(sessions["no-tool-id"]["live"], "subagent_tool_call")[0]
    orphan = events_of(sessions["no-tool-id"]["live"], "subagent_tool_result")[0]
    starts = {
        n: events_of(sessions[n]["live"], "subagent_start")[0] for n in ("parallel-a", "parallel-b")
    }
    ends = {n: events_of(s["live"], "subagent_end")[0] for n, s in sessions.items()}
    cap = module._transcript_result_cap()
    marker = module._TRANSCRIPT_TRUNCATION_MARKER
    stamp_ok = all(iso_utc_ok(ev.get("created_at")) for ev in channel_events(sessions))
    mirror_ok = all(
        s["persisted"][i] is ev
        for s in sessions.values()
        for i, ev in enumerate(s["live"])
        if ev["type"] != "subagent_tool_result"
    )
    return {
        "ids": {
            "toolCallIdPaired": call.get("id") == TOOL_CALL_ID,
            "toolResultIdPaired": live_res.get("id") == TOOL_CALL_ID,
            "toolNameResolvedFromCall": live_res.get("tool") == TOOL_NAME,
            "parallelSessionIdsDistinct": starts["parallel-a"].get("session_id")
            != starts["parallel-b"].get("session_id"),
            "missingToolCallIdIsNull": nid_call.get("id") is None,
            "orphanResultFallsBackToUnknown": orphan.get("tool") == "unknown"
            and orphan.get("id") == ORPHAN_RESULT_ID,
        },
        "created_at": {"isoUtcOnEveryEvent": stamp_ok},
        "elapsed": {
            "everyEndReportsSeconds": ELAPSED_S,
            "matches": all(e.get("elapsed") == ELAPSED_S for e in ends.values()),
        },
        "parallel": {
            "sameAgentBothSessions": all(s.get("agent") == AGENT_NAME for s in starts.values()),
            "oneStartPerSession": all(
                len(events_of(sessions[n]["live"], "subagent_start")) == 1
                for n in ("parallel-a", "parallel-b")
            ),
        },
        "truncation": {
            "sourceCapIs8000": cap == 8000,
            "liveContentFull": live_res.get("content") == TOOL_RESULT,
            "persistedContentCapped": len(pers_txt) == cap + len(marker),
            "persistedMarkerApplied": pers_txt.endswith(marker) and pers_txt.startswith("x" * cap),
        },
        "units": {
            "eventOrderPerSession": [ev["type"] for ev in live_a] == EVENT_TYPES,
            "commonFieldsOnEveryEvent": all(
                {"type", "created_at", "agent", "session_id"} <= set(ev)
                for ev in channel_events(sessions)
            ),
            "agentNameOnEveryEvent": all(
                ev.get("agent") == AGENT_NAME for ev in channel_events(sessions)
            ),
        },
        "ends": {
            "errorVariant": ends["error"].get("error") is True
            and ends["error"].get("cancelled") is False,
            "cancelledVariant": ends["cancelled"].get("cancelled") is True
            and ends["cancelled"].get("error") is False,
            "normalVariant": ends["parallel-a"].get("error") is False
            and ends["parallel-a"].get("cancelled") is False,
        },
        "persistence": {"nonResultEventsByteIdenticalObject": mirror_ok},
        "constructor": {
            "classNameIsStreamingRunnable": type(run).__name__ == "StreamingRunnable",
            "agentNameProperty": run._name == AGENT_NAME,
        },
    }


def failing_paths(checks):
    return [
        f"{g}.{n}"
        for g, body in checks.items()
        for n, ok in body.items()
        if isinstance(ok, bool) and not ok
    ]


def main() -> int:
    parser = argparse.ArgumentParser(description="W00 controlled source-emitter capture (offline)")
    parser.add_argument("--source", required=True, help="copied subagent_streaming.py")
    parser.add_argument("--output", required=True, help="fixture output directory")
    args = parser.parse_args()

    source = Path(args.source).resolve()
    if not source.is_file():
        print(f"source file not found: {source}", file=sys.stderr)
        return 2
    out_dir = Path(args.output).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    try:
        module = load_source_module(source)
    except Exception as exc:
        print(f"source load failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2

    run = module.StreamingRunnable(RunnableLambda(lambda state: state), AGENT_NAME)
    sessions = build_sessions(run)
    checks = build_checks(run, module, sessions)
    failures = failing_paths(checks)
    payload = {
        "provenance": PROVENANCE,
        "schemaSource": {
            "file": source.name,
            "agent": AGENT_NAME,
            "class": type(run).__name__,
            "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "transcriptResultCap": module._transcript_result_cap(),
            "truncationMarker": module._TRANSCRIPT_TRUNCATION_MARKER,
            "eventTypes": EVENT_TYPES,
        },
        "liveEvents": {name: sess["live"] for name, sess in sessions.items()},
        "checkpointEvents": {name: sess["persisted"] for name, sess in sessions.items()},
        "checks": {**checks, "allPassed": not failures, "failures": failures},
    }
    out_path = out_dir / OUTPUT_NAME
    with out_path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    print(f"capture written: {out_path}")
    if failures:
        print(f"emitter-shape assertion failures: {', '.join(failures)}", file=sys.stderr)
        return 3
    print("all emitter-shape assertions passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
