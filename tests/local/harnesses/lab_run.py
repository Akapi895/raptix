"""Generic single-lab autonomous runner with full trace capture.

Runs ONE authorized lab target through a LangGraph assistant (default: the
``raptix`` orchestrator) and archives everything needed for deep analysis:

* ``input/``      — the exact kickoff prompt, proceed message, plan files, scope
* ``trace/``      — per-turn transcripts, derived model/tool-call logs,
                    objective snapshots, live state snapshots, final state
* ``workspace/``  — copy of the engagement workspace from the sandbox
* ``logs/``       — time-bounded docker logs of the stack
* ``manifest.json`` / ``summary.json`` — provenance + outcome (no secrets)

Capture model: the runner drives the thread turn by turn (fresh thread per
run, standing-approval proceed messages between turns — the same pattern as
``juice_shop_t2._dispatch``). Per-turn thread state carries the full message
history, so ``model_calls.jsonl`` / ``tool_calls.jsonl`` are DERIVED from
message diffs (AIMessage -> model call, ToolMessage -> tool call), not from
in-process middleware. This needs no code change in the system under test;
the derivation rule is recorded in the manifest.

Isolation model: one engagement = one ``engagement_name`` + one container
workspace dir + one fresh thread. Never reuse a thread across labs.

Exit codes: 0 = objectives-complete; 2 = any other terminal state (evidence
still saved); 1 = runner usage / setup error.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import shutil
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

_TRANSIENT = (httpx.HTTPError, asyncio.TimeoutError)

ACTIONABLE = {"pending", "in-progress", "in_progress"}


def _log(msg: str) -> None:
    print(f"[lab {datetime.now(UTC).strftime('%H:%M:%S')}] {msg}", file=sys.stderr, flush=True)


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


async def _await_run_terminal(
    client: Any, thread_id: str, run_uuid: str, timeout_s: float
) -> str | None:
    terminal = {"success", "error", "interrupted", "cancelled", "timeout"}
    start = time.monotonic()

    async def _poll() -> str | None:
        polls = 0
        while True:
            elapsed = time.monotonic() - start
            if elapsed >= timeout_s:
                _log(f"poll hit cap at {elapsed:.0f}s (cap={timeout_s:.0f}s), {polls} polls")
                return None
            try:
                run_status = await asyncio.wait_for(
                    client.runs.get(thread_id, run_uuid), timeout=10
                )
            except _TRANSIENT:
                await asyncio.sleep(5)
                continue
            polls += 1
            status = run_status.get("status") if isinstance(run_status, dict) else None
            if status in terminal:
                _log(f"run terminal '{status}' at {elapsed:.0f}s, {polls} polls")
                return status
            await asyncio.sleep(5)

    try:
        result = await asyncio.wait_for(_poll(), timeout=timeout_s + 60)
    except asyncio.TimeoutError:
        _log(f"outer wait_for tripped at {time.monotonic() - start:.0f}s (cap+60 safety net)")
        result = None
    if result is not None:
        return result
    _log(f"interrupting run {run_uuid} at {time.monotonic() - start:.0f}s")
    try:
        await asyncio.wait_for(
            client.runs.cancel(thread_id, run_uuid, wait=True, action="interrupt"), timeout=60
        )
        _log(f"cancel returned at {time.monotonic() - start:.0f}s")
    except _TRANSIENT as exc:
        _log(f"cancel unconfirmed ({type(exc).__name__}) at {time.monotonic() - start:.0f}s")
    return "timeout"


def _objective_statuses(values: dict[str, Any]) -> list[str]:
    objectives = values.get("objectives") if isinstance(values, dict) else None
    if not isinstance(objectives, list):
        return []
    return [o.get("status", "") for o in objectives if isinstance(o, dict)]


def _sum_tokens(messages: list[Any]) -> int | None:
    total = 0
    found = False
    for msg in messages:
        usage = _msg_get(msg, "usage_metadata") or _msg_get(msg, "usage") or {}
        if isinstance(usage, dict):
            for key in ("input_tokens", "output_tokens", "total_tokens"):
                val = usage.get(key)
                if isinstance(val, (int, float)):
                    if key != "total_tokens":
                        total += int(val)
                    found = True
    return total if found else None


def _derive_calls(
    new_messages: list[Any],
    *,
    turn: int,
    model_fh: Any,
    tool_fh: Any,
    counters: dict[str, int],
) -> None:
    """Append derived model/tool-call entries for messages first seen this turn."""
    for msg in new_messages:
        kind = _msg_kind(msg)
        if kind in ("ai", "assistant", "aimessage"):
            entry = {
                "seq": counters["model"],
                "turn": turn,
                "ts": _now_iso(),
                "content": _msg_get(msg, "content", ""),
                "tool_calls": _msg_get(msg, "tool_calls", []) or [],
                "usage": _msg_get(msg, "usage_metadata") or _msg_get(msg, "usage") or {},
                "name": _msg_get(msg, "name", ""),
                "id": _msg_get(msg, "id", ""),
            }
            model_fh.write(json.dumps(_jsonable(entry), default=str) + "\n")
            counters["model"] += 1
        elif kind in ("tool", "toolmessage"):
            entry = {
                "seq": counters["tool"],
                "turn": turn,
                "ts": _now_iso(),
                "tool": _msg_get(msg, "name", ""),
                "content": _msg_get(msg, "content", ""),
                "status": _msg_get(msg, "status", ""),
                "tool_call_id": _msg_get(msg, "tool_call_id", ""),
            }
            tool_fh.write(json.dumps(_jsonable(entry), default=str) + "\n")
            counters["tool"] += 1
    model_fh.flush()
    tool_fh.flush()


def _docker(args: list[str], *, timeout: int = 120) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["docker", *args], capture_output=True, text=True, timeout=timeout)


def _probe_api(url: str, *, timeout: float = 10.0) -> tuple[bool, str]:
    """Pre-flight probe. Mode-C used to mean "API dead from turn 0" and produced
    a silent empty trace; now the run refuses to start and names the fix."""
    import urllib.request

    try:
        with urllib.request.urlopen(f"{url.rstrip('/')}/ok", timeout=timeout) as resp:
            return resp.status == 200, f"HTTP {resp.status}"
    except Exception as exc:  # noqa: BLE001
        return False, f"{type(exc).__name__}: {exc}"


def _capture_status(trace_dir: Path, channel: str, note: str) -> None:
    """Per-channel capture marker under ``trace/capture/``.

    A post-mortem must never have to infer "missing" vs "never captured"
    from the absence of a file (the 0-byte Pandora trace).
    """
    cap_dir = trace_dir / "capture"
    cap_dir.mkdir(parents=True, exist_ok=True)
    (cap_dir / f"{channel}.status").write_text(f"{_now_iso()} {note}\n", encoding="utf-8")


def _read_capture_note(trace_dir: Path, channel: str) -> str:
    path = trace_dir / "capture" / f"{channel}.status"
    if not path.exists():
        return "absent"
    return path.read_text(encoding="utf-8").strip().split(" ", 1)[-1]


def _ensure_container_workspace(args: argparse.Namespace, trace_dir: Path) -> None:
    """mkdir -p the engagement dir inside the sandbox before turn 1.

    The in-container dir is otherwise created lazily by the first bash
    tool call (kernel/tmux.py); teardown capture that ran before any
    bash call found nothing to copy and reported the channel missing
    ("docker cp failed"). The agent side also ensures via the daemon's
    fenced /workspace/ensure — this is the belt to its suspenders, and it
    covers capture-before-first-bash. Failure is a captured warning, not
    a run abort: a missing dir at teardown now reports via
    capture_channels instead of being inferred from absence.
    """
    rc = _docker(
        [
            "exec",
            args.sandbox_container,
            "mkdir",
            "-p",
            args.container_workspace,
        ],
        timeout=30,
    )
    if rc.returncode == 0:
        _capture_status(trace_dir, "workspace_ensure", f"ok: {args.container_workspace}")
        _log(f"workspace ensured in sandbox: {args.container_workspace}")
    else:
        note = f"docker exec mkdir failed: {rc.stderr.strip()[:300]}"
        _capture_status(trace_dir, "workspace_ensure", note)
        _log(f"WARNING: {note}")


def _verify_image_provenance(args: argparse.Namespace) -> dict[str, str]:
    """Refuse to run on images that don't match the checkout (plan D6).

    Reads org.opencontainers.image.revision off the running stack's
    langgraph + sandbox containers and compares against HEAD. Refuses by
    default: an evidence run from an image built from other code is not
    an evidence run. --allow-dirty downgrades to a recorded warning for
    the dev loop.
    """
    head = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=30)
    expected = (head.stdout or "").strip()
    result: dict[str, str] = {"expected_head": expected or "unknown"}
    offenders: list[str] = []
    for svc in ("langgraph", "sandbox"):
        container = f"raptix-{svc}"
        insp = _docker(
            [
                "inspect",
                container,
                "--format",
                '{{index .Config.Labels "org.opencontainers.image.revision"}}',
            ],
            timeout=30,
        )
        revision = (insp.stdout or "").strip()
        result[svc] = revision or "unlabeled"
        if insp.returncode != 0:
            offenders.append(f"{svc}: container not found ({insp.stderr.strip()[:120]})")
        elif not revision:
            offenders.append(f"{svc}: no org.opencontainers.image.revision label")
        elif expected and revision != expected:
            offenders.append(f"{svc}: image at {revision[:12]} but checkout at {expected[:12]}")
    result["verdict"] = (
        "allow-dirty" if offenders and args.allow_dirty else ("ok" if not offenders else "refused")
    )
    if offenders:
        rebuild = (
            "rebuild with:\n"
            "  RAPTIX_REPO_HEAD=$(git rev-parse HEAD) docker compose build "
            "sandbox langgraph\n"
            "then `docker compose up -d sandbox langgraph`"
        )
        if args.allow_dirty:
            _log(f"WARNING: image/checkout mismatch (--allow-dirty): {'; '.join(offenders)}")
        else:
            raise SystemExit(
                "deployed images do not match this checkout:\n  "
                + "\n  ".join(offenders)
                + f"\n{rebuild}\n"
                "or pass --allow-dirty to record and continue anyway."
            )
    return result


def _reset_kg(args: argparse.Namespace, trace_dir: Path) -> str:
    """Opt-in clean graph for this engagement slice before turn 1.

    Scoped exactly like every KGStore method: only nodes whose
    engagement label matches --engagement are deleted; other labs'
    slices are untouched. Never automatic — the flag is explicit.
    """
    if not getattr(args, "fresh_kg", False):
        note = "skipped (default; pass --fresh-kg for a clean graph)"
        _capture_status(trace_dir, "kg_reset", note)
        return note
    try:
        from raptix.knowledge.graph.store import KGStore

        store = KGStore.from_env()
        try:
            deleted = store.delete_engagement(engagement=args.engagement)
        finally:
            store.close()
        note = f"ok: {deleted} nodes deleted from {args.engagement!r}"
    except Exception as exc:  # noqa: BLE001 — never block the run on reset
        note = f"failed: {exc}"[:300]
    _capture_status(trace_dir, "kg_reset", note)
    _log(f"kg reset: {note}")
    return note


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Run one authorized lab with full trace capture.")
    # 2024 = the compose langgraph port (docker-compose.yml). 2400 was a stale
    # default that silently produced empty traces (mode-C).
    p.add_argument("--langgraph-url", default="http://localhost:2024")
    p.add_argument("--assistant", default="raptix")
    p.add_argument("--thread", default=None, help="Thread id; default: fresh timestamped id.")
    p.add_argument("--engagement", required=True)
    p.add_argument("--container-workspace", required=True, help="e.g. /workspace/lab-silentium-01")
    p.add_argument("--target", required=True)
    p.add_argument("--prompt-file", required=True, type=Path)
    p.add_argument("--proceed-file", required=True, type=Path)
    p.add_argument("--plan-dir", default=None, type=Path, help="roe/conops/deconfliction json dir")
    p.add_argument("--out-dir", required=True, type=Path, help="Base dir holding per-run dirs.")
    p.add_argument("--max-turns", type=int, default=60)
    p.add_argument("--wall-clock", type=float, default=10800)
    p.add_argument("--per-turn-cap", type=float, default=1800)
    p.add_argument("--snapshot-interval", type=float, default=120)
    p.add_argument("--sandbox-container", default="raptix-sandbox")
    p.add_argument("--log-containers", default="raptix-langgraph,raptix-sandbox,raptix-litellm")
    p.add_argument("--recursion-limit", type=int, default=400)
    p.add_argument(
        "--fresh-kg",
        action="store_true",
        help=(
            "Reset this engagement's attack-graph slice before the run "
            "(same slug reruns start clean). Other engagements untouched. "
            "Default off: only an operator asking for a clean graph gets one."
        ),
    )
    p.add_argument(
        "--allow-dirty",
        action="store_true",
        help=(
            "Downgrade image/checkout mismatch from a refusal to a "
            "recorded warning (dev loop; evidence runs should rebuild)."
        ),
    )
    return p.parse_args(argv)


async def _snapshotter(
    client: Any, thread_id: str, trace_dir: Path, interval_s: float, stop: asyncio.Event
) -> None:
    path = trace_dir / "state-snapshots.jsonl"
    while not stop.is_set():
        try:
            await asyncio.wait_for(asyncio.sleep(interval_s), timeout=interval_s + 5)
        except asyncio.TimeoutError:
            pass
        if stop.is_set():
            break
        try:
            state = await asyncio.wait_for(client.threads.get_state(thread_id), timeout=120)
            values = state.get("values") if isinstance(state, dict) else {}
            values = values if isinstance(values, dict) else {}
            messages = values.get("messages")
            messages = messages if isinstance(messages, list) else []
            entry = {
                "ts": _now_iso(),
                "msg_count": len(messages),
                "objective_statuses": _objective_statuses(values),
            }
            with path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(_jsonable(entry), default=str) + "\n")
        except Exception as exc:  # noqa: BLE001 — snapshots must never disturb the run
            _log(f"snapshot failed ({type(exc).__name__}): {exc}")


async def _amain(
    args: argparse.Namespace, run_dir: Path, manifest: dict[str, Any]
) -> dict[str, Any]:
    from langgraph_sdk import get_client

    trace_dir = run_dir / "trace"
    logs_dir = run_dir / "logs"
    evidence_dir = run_dir / "evidence"
    workspace_dir = run_dir / "workspace"
    for d in (run_dir / "input", trace_dir, logs_dir, evidence_dir, workspace_dir):
        d.mkdir(parents=True, exist_ok=True)

    kickoff = args.prompt_file.read_text(encoding="utf-8")
    proceed = args.proceed_file.read_text(encoding="utf-8")
    (run_dir / "input" / "prompt.txt").write_text(kickoff, encoding="utf-8")
    (run_dir / "input" / "proceed.txt").write_text(proceed, encoding="utf-8")
    scope = {
        "engagement": args.engagement,
        "container_workspace": args.container_workspace,
        "target": args.target,
        "assistant": args.assistant,
    }
    (run_dir / "input" / "scope.json").write_text(json.dumps(scope, indent=2), encoding="utf-8")
    if args.plan_dir and args.plan_dir.is_dir():
        for plan_file in sorted(args.plan_dir.glob("*.json")):
            shutil.copy2(plan_file, run_dir / "input" / plan_file.name)

    thread_id = args.thread or str(uuid.uuid4())
    client = get_client(url=args.langgraph_url)
    api_ok, api_detail = _probe_api(args.langgraph_url)
    _capture_status(trace_dir, "api", "ok" if api_ok else f"failed: {api_detail}")
    if not api_ok:
        raise SystemExit(
            f"LangGraph API unreachable at {args.langgraph_url} ({api_detail}); "
            "start it with `docker compose up langgraph` or pass --langgraph-url."
        )
    _log(f"api ok: {api_detail}")
    provenance = _verify_image_provenance(args)
    manifest["image_revisions"] = provenance
    _ensure_container_workspace(args, trace_dir)
    _reset_kg(args, trace_dir)
    started_iso = _now_iso()
    start_epoch = int(time.time())
    await _api(lambda: client.threads.create(thread_id=thread_id), timeout=30)
    _log(f"thread {thread_id} created")

    config = {
        "configurable": {
            "engagement_name": args.engagement,
            "workspace_path": args.container_workspace,
            "target": args.target,
        },
        "recursion_limit": args.recursion_limit,
    }
    first_input = {
        "messages": [{"role": "human", "content": kickoff}],
        "engagement_name": args.engagement,
        "workspace_path": args.container_workspace,
        "target": args.target,
    }

    deadline = time.monotonic() + args.wall_clock if args.wall_clock > 0 else None
    next_input: dict[str, Any] = first_input
    run_uuid = ""
    status: str | None = None
    tokens: int | None = None
    values: dict[str, Any] = {}
    turns = 0
    stall = 0
    prev_sig: tuple[Any, ...] | None = None
    seen_ids: set[str] = set()
    counters = {"model": 0, "tool": 0}

    stop = asyncio.Event()
    snap_task = asyncio.create_task(
        _snapshotter(client, thread_id, trace_dir, args.snapshot_interval, stop)
    )
    transcript_path = trace_dir / "transcript.json"
    objectives_path = trace_dir / "objectives.jsonl"

    with (
        (trace_dir / "model-calls.jsonl").open("a", encoding="utf-8") as model_fh,
        (trace_dir / "tool-calls.jsonl").open("a", encoding="utf-8") as tool_fh,
        objectives_path.open("a", encoding="utf-8") as obj_fh,
    ):
        while True:
            remaining = (deadline - time.monotonic()) if deadline is not None else args.per_turn_cap
            if remaining <= 0:
                status = "timeout"
                break
            turns += 1
            turn_cap = min(remaining, args.per_turn_cap)
            _log(f"turn {turns} start (cap={turn_cap:.0f}s)")
            try:
                run = await _api(
                    lambda ni=next_input: client.runs.create(
                        thread_id, args.assistant, input=ni, config=config
                    ),
                    timeout=60,
                )
                run_uuid = run["run_id"]
                run_status = await _await_run_terminal(client, thread_id, run_uuid, turn_cap)
                state = await _api(lambda: client.threads.get_state(thread_id), timeout=180)
            except RuntimeError as exc:
                status = f"api-error: {exc}"
                break
            values = state.get("values") if isinstance(state, dict) else None
            values = values if isinstance(values, dict) else {}
            raw_messages = values.get("messages")
            messages = raw_messages if isinstance(raw_messages, list) else []
            tokens = _sum_tokens(messages)
            statuses = _objective_statuses(values)
            transcript_path.write_text(
                json.dumps(
                    {"objectives": values.get("objectives", []), "messages": messages},
                    indent=2,
                    default=str,
                ),
                encoding="utf-8",
            )
            obj_fh.write(
                json.dumps({"turn": turns, "ts": _now_iso(), "statuses": statuses}, default=str)
                + "\n"
            )
            obj_fh.flush()
            fresh = [m for i, m in enumerate(messages) if _msg_id(m, i) not in seen_ids]
            for i, m in enumerate(messages):
                seen_ids.add(_msg_id(m, i))
            _derive_calls(fresh, turn=turns, model_fh=model_fh, tool_fh=tool_fh, counters=counters)
            _log(
                f"turn {turns} terminal={run_status} msgs={len(messages)} "
                f"new={len(fresh)} model_calls={counters['model']} tool_calls={counters['tool']}"
            )

            if run_status == "timeout":
                status = "timeout"
                break
            if statuses and not any(s in ACTIONABLE for s in statuses):
                status = "objectives-complete"
                break
            if turns >= args.max_turns:
                status = "max-turns"
                break
            agent_msgs = sum(1 for m in messages if _msg_kind(m) not in ("human", "user", "system"))
            signature = (tuple(statuses), agent_msgs)
            stall = stall + 1 if signature == prev_sig else 0
            if stall >= 2:
                status = "stalled"
                break
            prev_sig = signature
            next_input = {"messages": [{"role": "human", "content": proceed}]}

    stop.set()
    snap_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await snap_task

    ended_iso = _now_iso()
    final_state: dict[str, Any] = {}
    try:
        final_state = await _api(lambda: client.threads.get_state(thread_id), timeout=180)
    except RuntimeError as exc:
        _log(f"final state read failed: {exc}")
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

    # Engagement workspace copy (evidence of files the agent wrote).
    ws_src = args.container_workspace.strip("/")
    try:
        cp = _docker(
            ["cp", f"{args.sandbox_container}:/{ws_src}", str(workspace_dir / "engagement")],
            timeout=600,
        )
        ws_note = "copied" if cp.returncode == 0 else f"docker cp failed: {cp.stderr[:500]}"
    except Exception as exc:  # noqa: BLE001
        ws_note = f"docker cp error: {exc}"
    _log(f"workspace: {ws_note}")
    _capture_status(trace_dir, "workspace_copy", ws_note)

    # Time-bounded container logs.
    log_ok, log_total = 0, 0
    for container in [c.strip() for c in args.log_containers.split(",") if c.strip()]:
        log_total += 1
        try:
            lp = _docker(["logs", "--since", str(start_epoch), container], timeout=120)
            (logs_dir / f"{container}.log").write_text(
                (lp.stdout or "") + ("\n---STDERR---\n" + lp.stderr if lp.stderr else ""),
                encoding="utf-8",
                errors="replace",
            )
            log_ok += 1
        except Exception as exc:  # noqa: BLE001
            (logs_dir / f"{container}.log").write_text(
                f"log capture failed: {exc}", encoding="utf-8"
            )
    _capture_status(trace_dir, "container_logs", f"{log_ok}/{log_total} containers")

    transcript_text = (
        transcript_path.read_text(encoding="utf-8") if transcript_path.exists() else ""
    )
    # Derived-transcript channel status (the run loop already finished).
    derived_ok = counters["model"] > 0 or counters["tool"] > 0
    derived_note = (
        f"ok (model={counters['model']}, tool={counters['tool']})"
        if derived_ok
        else "absent (0 entries; run died before the first model call?)"
    )
    _capture_status(trace_dir, "transcripts", derived_note)
    snaps = trace_dir / "state-snapshots.jsonl"
    _capture_status(
        trace_dir,
        "state_snapshots",
        f"ok ({snaps.stat().st_size} bytes)"
        if snaps.exists() and snaps.stat().st_size
        else "absent",
    )
    _capture_status(
        trace_dir,
        "thread_runs",
        "ok" if (trace_dir / "thread-runs.json").exists() else "absent",
    )
    capture_channels = {
        "api": "ok" if api_ok else f"failed: {api_detail}",
        "transcripts": derived_note,
        "state_snapshots": _read_capture_note(trace_dir, "state_snapshots"),
        "thread_runs": _read_capture_note(trace_dir, "thread_runs"),
        "workspace_ensure": _read_capture_note(trace_dir, "workspace_ensure"),
        "kg_reset": _read_capture_note(trace_dir, "kg_reset"),
        "workspace_copy": ws_note,
        "container_logs": f"{log_ok}/{log_total} containers",
    }
    summary = {
        "status": status,
        "turns": turns,
        "thread_id": thread_id,
        "last_run_id": run_uuid,
        "started_at": started_iso,
        "ended_at": ended_iso,
        "token_estimate": tokens,
        "model_calls": counters["model"],
        "tool_calls": counters["tool"],
        "objective_statuses": _objective_statuses(values),
        "user_txt_mentioned": "user.txt" in transcript_text,
        "root_txt_mentioned": "root.txt" in transcript_text,
        "workspace_capture": ws_note,
        "api_reachable": api_ok,
        "capture_channels": capture_channels,
    }
    (run_dir / "summary.json").write_text(
        json.dumps(_jsonable(summary), indent=2), encoding="utf-8"
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.out_dir / f"{stamp}_{args.engagement}"
    run_dir.mkdir(parents=True, exist_ok=True)

    for name in ("prompt.txt", "proceed.txt"):
        src: Path = args.prompt_file if name == "prompt.txt" else args.proceed_file
        if not src.is_file():
            print(f"missing {name}: {src}", file=sys.stderr)
            return 1

    manifest = {
        "runner": "tests/local/harnesses/lab_run.py",
        "run_id": run_dir.name,
        "created_at": _now_iso(),
        "assistant": args.assistant,
        "engagement": args.engagement,
        "container_workspace": args.container_workspace,
        "target": args.target,
        "prompt_sha256": _sha256_text(args.prompt_file.read_text(encoding="utf-8")),
        "proceed_sha256": _sha256_text(args.proceed_file.read_text(encoding="utf-8")),
        "plan_sha256": (
            {
                p.name: _sha256_text(p.read_text(encoding="utf-8"))
                for p in sorted(args.plan_dir.glob("*.json"))
            }
            if args.plan_dir and args.plan_dir.is_dir()
            else {}
        ),
        "drive": {
            "max_turns": args.max_turns,
            "wall_clock_s": args.wall_clock,
            "per_turn_cap_s": args.per_turn_cap,
            "snapshot_interval_s": args.snapshot_interval,
            "recursion_limit": args.recursion_limit,
        },
        "capture_model": (
            "turn-by-turn thread-state transcripts; model_calls/tool_calls DERIVED "
            "from message diffs (AIMessage->model call, ToolMessage->tool call); "
            "state snapshots; workspace copy; time-bounded container logs. "
            "No in-process middleware changes. Per-channel capture status in "
            "trace/capture/<channel>.status + summary.capture_channels."
        ),
        "roe_enforcement": (
            "audit-only (plan/roe.json ships no machine_enforcement block); "
            "scope enforced by single-target prompt + operator monitoring"
        ),
    }
    try:
        head = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=30
        )
        manifest["repo_head"] = (head.stdout or "").strip() or None
        st = subprocess.run(
            ["git", "status", "--short"], capture_output=True, text=True, timeout=30
        )
        manifest["repo_dirty"] = bool((st.stdout or "").strip())
        manifest["repo_dirty_note"] = (
            "working tree has uncommitted changes NOT in the deployed image"
            if manifest["repo_dirty"]
            else ""
        )
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
    summary = asyncio.run(_amain(args, run_dir, manifest))
    _log(f"terminal status: {summary['status']} after {summary['turns']} turns")
    # Capture provenance lands in the manifest too (it is written before the
    # run; merge the post-run statuses back in).
    manifest["api_reachable"] = summary.get("api_reachable")
    manifest["capture_channels"] = summary.get("capture_channels", {})
    (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0 if summary["status"] == "objectives-complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
