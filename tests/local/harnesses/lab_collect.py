"""Shadow collector: archive the trace of a run driven elsewhere (e.g. the CLI).

Attaches to an existing LangGraph thread (explicit id or the newest one),
polls thread state until the latest run goes terminal AND the message list
stops growing, then writes the same evidence layout as ``lab_run.py``:

* ``trace/`` — transcript, derived model/tool-call logs, objective + state
  snapshots, final state, thread runs list
* ``workspace/`` — copy of the engagement workspace from the sandbox
* ``logs/`` — time-bounded docker logs of the stack
* ``manifest.json`` / ``summary.json`` — provenance + outcome (no secrets)

Model/tool-call derivation rule is identical to ``lab_run.py`` (message
diffs: AIMessage -> model call, ToolMessage -> tool call). Exits 0 when the
run ends terminally, 2 on timeout/stall/stop, 1 on setup errors. Ctrl-C
finalizes whatever was captured.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

_TRANSIENT = (httpx.HTTPError, asyncio.TimeoutError)


def _log(msg: str) -> None:
    print(f"[collect {datetime.now(UTC).strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _jsonable(obj: Any) -> Any:
    try:
        json.dumps(obj)
        return obj
    except (TypeError, ValueError):
        return str(obj)


def _msg_get(msg: Any, key: str, default: Any = None) -> Any:
    if isinstance(msg, dict):
        return msg.get(key, default)
    return getattr(msg, key, default)


def _msg_kind(msg: Any) -> str:
    kind = _msg_get(msg, "type") or _msg_get(msg, "role") or ""
    return str(kind).lower()


def _msg_id(msg: Any, index: int) -> str:
    for key in ("id", "tool_call_id"):
        val = _msg_get(msg, key)
        if val:
            return f"{key}={val}"
    content = _msg_get(msg, "content", "")
    calls = _msg_get(msg, "tool_calls", "")
    return _sha256_text(f"{index}|{content}|{calls}")[:16]


def _objective_statuses(values: dict[str, Any]) -> list[str]:
    objectives = values.get("objectives") if isinstance(values, dict) else None
    if not isinstance(objectives, list):
        return []
    return [o.get("status", "") for o in objectives if isinstance(o, dict)]


async def _api(factory: Any, *, timeout: float, attempts: int = 4) -> Any:
    delay = 2.0
    last: Exception | None = None
    for _ in range(attempts):
        try:
            return await asyncio.wait_for(factory(), timeout=timeout)
        except _TRANSIENT as exc:
            last = exc
            await asyncio.sleep(delay)
            delay = min(delay * 2, 15)
    raise RuntimeError(f"LangGraph API call failed after {attempts} attempts: {last}")


def _docker(args: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Shadow-collect a CLI-driven lab run.")
    p.add_argument("--langgraph-url", default="http://localhost:2400")
    p.add_argument("--thread", default=None, help="Thread id; default: newest thread.")
    p.add_argument("--engagement", required=True)
    p.add_argument("--container-workspace", required=True)
    p.add_argument("--out-dir", required=True, type=Path)
    p.add_argument("--interval", type=float, default=60)
    p.add_argument(
        "--max-idle-polls", type=int, default=20, help="Stop after N polls with no change."
    )
    p.add_argument("--wall-clock", type=float, default=10800)
    p.add_argument("--sandbox-container", default="raptix-sandbox")
    p.add_argument("--log-containers", default="raptix-langgraph,raptix-sandbox,raptix-litellm")
    return p.parse_args(argv)


async def _amain(args: argparse.Namespace, run_dir: Path) -> dict[str, Any]:
    from langgraph_sdk import get_client

    trace_dir = run_dir / "trace"
    logs_dir = run_dir / "logs"
    workspace_dir = run_dir / "workspace"
    for d in (trace_dir, logs_dir, workspace_dir):
        d.mkdir(parents=True, exist_ok=True)

    client = get_client(url=args.langgraph_url)
    started_iso = _now_iso()
    start_epoch = int(time.time())

    thread_id = args.thread
    if not thread_id:
        threads = await _api(lambda: client.threads.search(limit=1), timeout=30)
        items = threads if isinstance(threads, list) else []
        if not items:
            raise RuntimeError("no threads found on the server")
        thread_id = items[0].get("thread_id")
        _log(f"attached to newest thread {thread_id}")
    else:
        _log(f"attached to thread {thread_id}")

    transcript_path = trace_dir / "transcript.json"
    snap_path = trace_dir / "state-snapshots.jsonl"
    obj_path = trace_dir / "objectives.jsonl"
    model_fh = (trace_dir / "model-calls.jsonl").open("a", encoding="utf-8")
    tool_fh = (trace_dir / "tool-calls.jsonl").open("a", encoding="utf-8")
    seen_ids: set[str] = set()
    counters = {"model": 0, "tool": 0, "poll": 0}
    idle = 0
    last_sig: tuple[Any, ...] | None = None
    values: dict[str, Any] = {}
    status = "collecting"
    deadline = time.monotonic() + args.wall_clock if args.wall_clock > 0 else None

    try:
        while True:
            if deadline is not None and time.monotonic() > deadline:
                status = "timeout"
                break
            counters["poll"] += 1
            try:
                state = await _api(lambda: client.threads.get_state(thread_id), timeout=120)
            except RuntimeError as exc:
                _log(f"state read failed: {exc}")
                status = f"api-error: {exc}"
                break
            values = state.get("values") if isinstance(state, dict) else {}
            values = values if isinstance(values, dict) else {}
            messages = values.get("messages")
            messages = messages if isinstance(messages, list) else []
            statuses = _objective_statuses(values)
            transcript_path.write_text(
                json.dumps(
                    {"objectives": values.get("objectives", []), "messages": messages},
                    indent=2,
                    default=str,
                ),
                encoding="utf-8",
            )
            with snap_path.open("a", encoding="utf-8") as fh:
                fh.write(
                    json.dumps(
                        {
                            "ts": _now_iso(),
                            "poll": counters["poll"],
                            "msg_count": len(messages),
                            "objective_statuses": statuses,
                        },
                        default=str,
                    )
                    + "\n"
                )
            with obj_path.open("a", encoding="utf-8") as fh:
                fh.write(
                    json.dumps(
                        {"poll": counters["poll"], "ts": _now_iso(), "statuses": statuses},
                        default=str,
                    )
                    + "\n"
                )
            fresh = [m for i, m in enumerate(messages) if _msg_id(m, i) not in seen_ids]
            for i, m in enumerate(messages):
                seen_ids.add(_msg_id(m, i))
            for m in fresh:
                kind = _msg_kind(m)
                if kind in ("ai", "assistant", "aimessage"):
                    model_fh.write(
                        json.dumps(
                            _jsonable(
                                {
                                    "seq": counters["model"],
                                    "poll": counters["poll"],
                                    "ts": _now_iso(),
                                    "content": _msg_get(m, "content", ""),
                                    "tool_calls": _msg_get(m, "tool_calls", []) or [],
                                    "usage": _msg_get(m, "usage_metadata")
                                    or _msg_get(m, "usage")
                                    or {},
                                    "name": _msg_get(m, "name", ""),
                                    "id": _msg_get(m, "id", ""),
                                }
                            ),
                            default=str,
                        )
                        + "\n"
                    )
                    counters["model"] += 1
                elif kind in ("tool", "toolmessage"):
                    tool_fh.write(
                        json.dumps(
                            _jsonable(
                                {
                                    "seq": counters["tool"],
                                    "poll": counters["poll"],
                                    "ts": _now_iso(),
                                    "tool": _msg_get(m, "name", ""),
                                    "content": _msg_get(m, "content", ""),
                                    "status": _msg_get(m, "status", ""),
                                    "tool_call_id": _msg_get(m, "tool_call_id", ""),
                                }
                            ),
                            default=str,
                        )
                        + "\n"
                    )
                    counters["tool"] += 1
            model_fh.flush()
            tool_fh.flush()

            # Terminal check: latest run terminal AND no state change.
            run_status: str | None = None
            try:
                runs = await _api(lambda: client.runs.list(thread_id), timeout=60)
                items = runs if isinstance(runs, list) else []
                if items:
                    run_status = items[0].get("status")
            except RuntimeError:
                run_status = None
            sig = (run_status, len(messages), tuple(statuses))
            if sig == last_sig:
                idle += 1
            else:
                idle = 0
            last_sig = sig
            _log(
                f"poll {counters['poll']} msgs={len(messages)} new={len(fresh)} "
                f"run={run_status} idle={idle}"
            )
            terminal_runs = {"success", "error", "interrupted", "cancelled", "timeout"}
            if run_status in terminal_runs and idle >= 3:
                status = f"run-{run_status}"
                break
            if idle >= args.max_idle_polls:
                status = "stalled"
                break
            await asyncio.sleep(args.interval)
    except (asyncio.CancelledError, KeyboardInterrupt):
        status = "stopped"
    finally:
        model_fh.close()
        tool_fh.close()

    ended_iso = _now_iso()
    try:
        final_state = await _api(lambda: client.threads.get_state(thread_id), timeout=180)
    except RuntimeError as exc:
        final_state = {"error": str(exc)}
    (trace_dir / "final-state.json").write_text(
        json.dumps(_jsonable(final_state), indent=2, default=str), encoding="utf-8"
    )
    try:
        runs = await _api(lambda: client.runs.list(thread_id), timeout=60)
        (trace_dir / "thread-runs.json").write_text(
            json.dumps(_jsonable(runs), indent=2, default=str), encoding="utf-8"
        )
    except RuntimeError as exc:
        _log(f"thread runs list failed: {exc}")

    ws_src = args.container_workspace.strip("/")
    try:
        cp = _docker(
            ["cp", f"{args.sandbox_container}:/{ws_src}", str(workspace_dir / "engagement")],
            timeout=600,
        )
        ws_note = "copied" if cp.returncode == 0 else f"docker cp failed: {cp.stderr[:500]}"
    except Exception as exc:  # noqa: BLE001
        ws_note = f"docker cp error: {exc}"
    for container in [c.strip() for c in args.log_containers.split(",") if c.strip()]:
        try:
            lp = _docker(["logs", "--since", str(start_epoch), container], timeout=120)
            (logs_dir / f"{container}.log").write_text(
                (lp.stdout or "") + ("\n---STDERR---\n" + lp.stderr if lp.stderr else ""),
                encoding="utf-8",
                errors="replace",
            )
        except Exception as exc:  # noqa: BLE001
            (logs_dir / f"{container}.log").write_text(
                f"log capture failed: {exc}", encoding="utf-8"
            )

    transcript_text = (
        transcript_path.read_text(encoding="utf-8") if transcript_path.exists() else ""
    )
    summary = {
        "status": status,
        "thread_id": thread_id,
        "polls": counters["poll"],
        "started_at": started_iso,
        "ended_at": ended_iso,
        "model_calls": counters["model"],
        "tool_calls": counters["tool"],
        "objective_statuses": _objective_statuses(values),
        "user_txt_mentioned": "user.txt" in transcript_text,
        "root_txt_mentioned": "root.txt" in transcript_text,
        "workspace_capture": ws_note,
    }
    (run_dir / "summary.json").write_text(
        json.dumps(_jsonable(summary), indent=2), encoding="utf-8"
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.out_dir / f"{stamp}_{args.engagement}-cli"
    run_dir.mkdir(parents=True, exist_ok=True)
    manifest = {
        "collector": "tests/local/harnesses/lab_collect.py",
        "mode": "shadow (run driven externally, e.g. CLI)",
        "run_id": run_dir.name,
        "created_at": _now_iso(),
        "engagement": args.engagement,
        "container_workspace": args.container_workspace,
        "thread": args.thread,
        "poll_interval_s": args.interval,
        "capture_model": (
            "periodic thread-state transcripts; model_calls/tool_calls DERIVED "
            "from message diffs; workspace copy; time-bounded container logs. "
            "No in-process middleware changes."
        ),
    }
    try:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=30
        )
        manifest["repo_head"] = (head.stdout or "").strip() or None
    except Exception as exc:  # noqa: BLE001
        manifest["repo_head"] = f"unknown: {exc}"
    try:
        imgs = _docker(
            [
                "inspect",
                "raptix-langgraph",
                "raptix-sandbox",
                "raptix-litellm",
                "--format",
                "{{.Name}} {{.Image}}",
            ],
            timeout=30,
        )
        manifest["container_images"] = (imgs.stdout or "").strip().splitlines()
    except Exception as exc:  # noqa: BLE001
        manifest["container_images"] = [f"unknown: {exc}"]
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    _log(f"run dir: {run_dir}")
    summary = asyncio.run(_amain(args, run_dir))
    _log(f"collector terminal: {summary['status']}")
    return 0 if summary["status"] == "run-success" else 2


if __name__ == "__main__":
    raise SystemExit(main())
