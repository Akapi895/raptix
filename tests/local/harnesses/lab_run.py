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

Isolation model: one engagement bind-mounted at ``/workspace`` in both
containers, verified before turn 1, plus one fresh thread. Never reuse a
thread across labs; named shared-root stacks are refused (ADR-0042).

Exit codes: 0 = objectives-complete; 2 = any other terminal state (evidence
still saved); 1 = runner usage / setup error.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from raptix_core.utils.engagement_scope import is_valid_engagement_label

_TRANSIENT = (httpx.HTTPError, asyncio.TimeoutError)

ACTIONABLE = {"pending", "in-progress", "in_progress"}
CAPTURE_CHANNELS = (
    "api",
    "model_calls",
    "tool_calls",
    "transcripts",
    "state_snapshots",
    "thread_runs",
    "workspace_isolation",
    "workspace_ensure",
    "kg_reset",
    "workspace_copy",
    "container_logs",
)


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
    """Exercise the authenticated daemon ensure route before any agent turn."""
    probe = (
        "import json, os, urllib.request; "
        "headers={'Content-Type':'application/json'}; "
        "token=os.environ.get('SANDBOX_TOKEN'); "
        "headers.update({'Authorization':'Bearer '+token} if token else {}); "
        "req=urllib.request.Request('http://127.0.0.1:9999/workspace/ensure', "
        "data=json.dumps({'path':'/workspace'}).encode(), headers=headers); "
        "print(urllib.request.urlopen(req, timeout=10).read().decode())"
    )
    try:
        rc = _docker(["exec", args.sandbox_container, "python3", "-c", probe], timeout=30)
        if rc.returncode != 0:
            raise RuntimeError(rc.stderr.strip()[:300])
    except (OSError, subprocess.TimeoutExpired, RuntimeError) as exc:
        note = f"failed: workspace ensure: {exc}"
        _capture_status(trace_dir, "workspace_ensure", note)
        raise RuntimeError(note) from exc
    _capture_status(trace_dir, "workspace_ensure", f"ok: {args.container_workspace}")
    _log(f"workspace ensured in sandbox: {args.container_workspace}")


def _canonical_mount_source(source: str) -> str:
    """Normalize Docker Desktop's known Windows-drive alias, not arbitrary mounts."""
    path = source.replace("\\", "/").rstrip("/")
    alias = re.fullmatch(r"/run/desktop/mnt/host/([A-Za-z])/(.*)", path)
    if alias:
        path = f"{alias[1].upper()}:/{alias[2]}"
    if re.match(r"^[A-Za-z]:/", path):
        path = path[0].upper() + path[1:]
    return path


def _verify_workspace_isolation(args: argparse.Namespace) -> dict[str, Any]:
    """Verify the operator's deployment claim against both actual Docker mounts."""
    sources: dict[str, str] = {}
    errors = []
    if args.container_workspace != "/workspace":
        errors.append("--container-workspace must be /workspace (the engagement bind root)")
    containers = {
        "langgraph": args.langgraph_container,
        "sandbox": args.sandbox_container,
    }
    for service, container in containers.items():
        inspection = _docker(["inspect", container, "--format", "{{json .}}"], timeout=30)
        if inspection.returncode != 0:
            errors.append(f"{container}: cannot inspect deployment")
            continue
        try:
            deployed = json.loads(inspection.stdout)
            env = dict(value.split("=", 1) for value in deployed["Config"]["Env"] if "=" in value)
            mounts = [m for m in deployed["Mounts"] if m["Destination"] == "/workspace"]
            source = mounts[0]["Source"] if len(mounts) == 1 else ""
            sources[service] = source
            if (
                env.get("RAPTIX_ENGAGEMENT") != args.engagement
                or env.get("RAPTIX_WORKSPACE_ISOLATED") != "1"
                or len(mounts) != 1
                or mounts[0]["Type"] != "bind"
                or source.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1] != args.engagement
            ):
                errors.append(
                    f"{container}: mount or engagement does not match {args.engagement!r}"
                )
        except (ValueError, KeyError, TypeError) as exc:
            errors.append(f"{container}: invalid deployment inspection ({type(exc).__name__})")
    if len({_canonical_mount_source(source) for source in sources.values()}) != 1:
        errors.append("langgraph and sandbox must mount the same engagement directory")
    if errors:
        raise SystemExit(
            "run requires an isolated engagement workspace:\n  "
            + "\n  ".join(errors)
            + "\nRecreate both services with RAPTIX_ENGAGEMENT=<slug> and "
            "RAPTIX_ENGAGEMENT_WORKSPACE=<absolute host workspace>/<slug>; "
            "use --container-workspace /workspace."
        )
    return {
        "engagement": args.engagement,
        "root": "/workspace",
        "sources": sources,
        "verdict": "ok",
    }


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
    if head.returncode != 0 or not expected:
        offenders.append("checkout HEAD is unknown; cannot verify image revisions")
    containers = {
        "langgraph": getattr(args, "langgraph_container", "raptix-langgraph"),
        "sandbox": getattr(args, "sandbox_container", "raptix-sandbox"),
    }
    for svc, container in containers.items():
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
        if revision == "<no value>":
            revision = ""
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
    args.image_revisions = result
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


PROTOCOL_KINDS = ("hint", "interference", "proceed")


def _load_protocol(path: Path) -> list[dict[str, Any]]:
    """Parse + validate the operator-injection protocol (plan D7).

    One JSON object per line:
      {"turn": <int>, "kind": "hint"|"interference"|"proceed",
       "text": str, "source": str?}

    Delivery semantics (deterministic, enforced by the turn loop):
      turn == -1  kind must be "proceed" — the standing-approval message
                  sent between every turn (legacy --proceed-file).
      turn == 0   appended to the kickoff prompt, in file order.
      turn >= 1   REPLACES the standing message after that turn, before
                  the next API run starts.
    Duplicate turns (>= 1) or unknown kinds are a hard parse error: a
    silently-dropped injection is a corrupt experiment.
    """
    records: list[dict[str, Any]] = []
    seen_turns: set[int] = set()
    for lineno, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError as exc:
            raise SystemExit(f"{path}:{lineno}: invalid JSON: {exc}") from exc
        if not isinstance(rec, dict):
            raise SystemExit(f"{path}:{lineno}: expected a JSON object")
        turn = rec.get("turn")
        kind = rec.get("kind")
        text = rec.get("text")
        if not isinstance(turn, int) or isinstance(turn, bool):
            raise SystemExit(f"{path}:{lineno}: 'turn' must be an int")
        if kind not in PROTOCOL_KINDS:
            raise SystemExit(
                f"{path}:{lineno}: 'kind' must be one of {PROTOCOL_KINDS}, got {kind!r}"
            )
        if not isinstance(text, str) or not text.strip():
            raise SystemExit(f"{path}:{lineno}: 'text' must be a non-empty string")
        if turn == -1:
            if kind != "proceed":
                raise SystemExit(f"{path}:{lineno}: turn -1 is reserved for kind 'proceed'")
            if turn in seen_turns:
                raise SystemExit(f"{path}:{lineno}: duplicate standing-approval record")
            seen_turns.add(turn)
        elif turn >= 1:
            if turn in seen_turns:
                raise SystemExit(f"{path}:{lineno}: duplicate injection for turn {turn}")
            seen_turns.add(turn)
        elif turn != 0:
            raise SystemExit(f"{path}:{lineno}: turn must be -1, 0, or a positive int")
        records.append(
            {
                "turn": turn,
                "kind": kind,
                "text": text,
                "source": str(rec.get("source", "")),
            }
        )
    return records


def _merge_protocol(
    records: list[dict[str, Any]], proceed_text: str | None
) -> list[dict[str, Any]]:
    """Attach the standing-approval record; refuse conflicting sources."""
    standing = any(r["turn"] == -1 for r in records)
    if proceed_text is None:
        if not standing:
            raise SystemExit(
                "provide --proceed-file or one turn=-1 proceed record in --protocol-file"
            )
        return records
    if not proceed_text.strip():
        raise SystemExit("--proceed-file must contain a non-empty standing-approval message")
    if standing:
        raise SystemExit(
            "conflicting standing-approval sources: --proceed-file and a turn=-1 "
            "record in --protocol-file; pick one."
        )
    return records + [
        {"turn": -1, "kind": "proceed", "text": proceed_text, "source": "--proceed-file"}
    ]


def _injection_for_turn(scheduled: dict[int, dict[str, Any]], proceed_text: str, turn: int) -> str:
    """Text delivered after ``turn``, before the next run starts."""
    record = scheduled.get(turn)
    return record["text"] if record else proceed_text


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
    except Exception as exc:  # noqa: BLE001 — an explicit fresh baseline must fail closed
        note = f"failed: {exc}"[:300]
        _capture_status(trace_dir, "kg_reset", note)
        raise RuntimeError(f"KG reset failed for {args.engagement!r}: {exc}") from exc
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
    p.add_argument(
        "--container-workspace", default="/workspace", help="Engagement bind root: /workspace"
    )
    p.add_argument("--target", required=True)
    p.add_argument("--prompt-file", required=True, type=Path)
    p.add_argument(
        "--proceed-file",
        default=None,
        type=Path,
        help="Standing-approval message sent between turns (legacy form of a "
        "turn=-1 'proceed' record; prefer --protocol-file for auditable injections).",
    )
    p.add_argument(
        "--protocol-file",
        default=None,
        type=Path,
        help=(
            "JSONL of operator injections {turn, kind: hint|interference|proceed, "
            "text, source?}. turn 0 appends to the kickoff; turn >= 1 replaces the "
            "standing message after that turn; turn -1 is the standing approval. "
            "Normalized into input/protocol.jsonl; delivered injections are counted."
        ),
    )
    p.add_argument("--plan-dir", default=None, type=Path, help="roe/conops/deconfliction json dir")
    p.add_argument("--out-dir", required=True, type=Path, help="Base dir holding per-run dirs.")
    p.add_argument("--max-turns", type=int, default=60)
    p.add_argument("--wall-clock", type=float, default=10800)
    p.add_argument("--per-turn-cap", type=float, default=1800)
    p.add_argument("--snapshot-interval", type=float, default=120)
    stack = os.environ.get("RAPTIX_STACK_NAME", "")
    prefix = f"raptix-{stack}" if stack else "raptix"
    p.add_argument("--sandbox-container", default=f"{prefix}-sandbox")
    p.add_argument("--langgraph-container", default=f"{prefix}-langgraph")
    p.add_argument("--log-containers", default=None)
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
    args = p.parse_args(argv)
    if args.log_containers is None:
        args.log_containers = (
            f"{args.langgraph_container},{args.sandbox_container},{prefix}-litellm"
        )
    return args


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
    (run_dir / "input" / "prompt.txt").write_text(kickoff, encoding="utf-8")
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
    try:
        manifest["workspace_isolation"] = _verify_workspace_isolation(args)
    except (SystemExit, OSError, subprocess.TimeoutExpired) as exc:
        _capture_status(trace_dir, "workspace_isolation", f"failed: {exc}")
        raise
    _capture_status(trace_dir, "workspace_isolation", "ok")
    _ensure_container_workspace(args, trace_dir)
    _reset_kg(args, trace_dir)
    started_iso = _now_iso()
    start_epoch = int(time.time())
    await _api(lambda: client.threads.create(thread_id=thread_id), timeout=30)
    _log(f"thread {thread_id} created")

    # Injection schedule (plan D7): turn-0 records append to the kickoff;
    # turn >= 1 records replace the standing message AFTER that turn;
    # turn -1 is the standing approval used everywhere else.
    records = getattr(args, "protocol_records", [])
    turn0_texts = [r["text"] for r in records if r["turn"] == 0]
    scheduled = {r["turn"]: r for r in records if r["turn"] >= 1}
    proceed_text = next((r["text"] for r in records if r["turn"] == -1), "")
    if turn0_texts:
        kickoff = kickoff + "\n\n" + "\n\n".join(turn0_texts)
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
    delivered = dict.fromkeys(PROTOCOL_KINDS, 0)
    pending_injections = [r for r in records if r["turn"] == 0]

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
                for record in pending_injections:
                    delivered[record["kind"]] += 1
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
            next_turn = turns + 1
            injection_record = scheduled.get(turns)
            injection = _injection_for_turn(scheduled, proceed_text, turns)
            if injection_record:
                _log(
                    f"injection applied at turn {next_turn}: "
                    f"kind={injection_record['kind']} source={injection_record['source']!r}"
                )
            next_input = {"messages": [{"role": "human", "content": injection}]}
            pending_injections = [injection_record] if injection_record else [{"kind": "proceed"}]

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
        ws_note = "ok: copied" if cp.returncode == 0 else f"failed: docker cp: {cp.stderr[:500]}"
    except Exception as exc:  # noqa: BLE001
        ws_note = f"failed: docker cp: {exc}"
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
            if lp.returncode == 0:
                log_ok += 1
        except Exception as exc:  # noqa: BLE001
            (logs_dir / f"{container}.log").write_text(
                f"log capture failed: {exc}", encoding="utf-8"
            )
    logs_note = f"{'ok' if log_ok == log_total else 'failed'}: {log_ok}/{log_total} containers"
    _capture_status(trace_dir, "container_logs", logs_note)

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
    for channel, count in (("model_calls", counters["model"]), ("tool_calls", counters["tool"])):
        _capture_status(
            trace_dir, channel, f"ok ({count} entries)" if count else "absent (0 entries)"
        )
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
        "workspace_isolation": _read_capture_note(trace_dir, "workspace_isolation"),
        "model_calls": _read_capture_note(trace_dir, "model_calls"),
        "tool_calls": _read_capture_note(trace_dir, "tool_calls"),
        "kg_reset": _read_capture_note(trace_dir, "kg_reset"),
        "workspace_copy": ws_note,
        "container_logs": logs_note,
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
        "injections": delivered,
        "injections_planned": {
            kind: sum(1 for r in records if r["kind"] == kind) for kind in PROTOCOL_KINDS
        },
        "capture_channels": capture_channels,
    }
    (run_dir / "summary.json").write_text(
        json.dumps(_jsonable(summary), indent=2), encoding="utf-8"
    )
    return summary


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    if not is_valid_engagement_label(args.engagement):
        raise SystemExit("--engagement must be a valid engagement slug")
    stamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    run_dir = args.out_dir / f"{stamp}_{args.engagement}"
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "input").mkdir(exist_ok=True)
    for channel in CAPTURE_CHANNELS:
        _capture_status(run_dir / "trace", channel, "absent: not captured yet")

    for name, src in (("prompt.txt", args.prompt_file), ("proceed.txt", args.proceed_file)):
        if src is None:
            continue
        if not src.is_file():
            print(f"missing {name}: {src}", file=sys.stderr)
            return 1

    # Archive the effective protocol, including any merged legacy approval.
    protocol_records: list[dict[str, Any]] = []
    if args.protocol_file:
        if not args.protocol_file.is_file():
            print(f"missing protocol file: {args.protocol_file}", file=sys.stderr)
            return 1
        protocol_records = _load_protocol(args.protocol_file)
    proceed = args.proceed_file.read_text(encoding="utf-8") if args.proceed_file else None
    if proceed is not None:
        (run_dir / "input" / "proceed.txt").write_text(proceed, encoding="utf-8")
    args.protocol_records = _merge_protocol(protocol_records, proceed)
    (run_dir / "input" / "protocol.jsonl").write_text(
        "".join(json.dumps(record) + "\n" for record in args.protocol_records), encoding="utf-8"
    )

    manifest = {
        "runner": "tests/local/harnesses/lab_run.py",
        "run_id": run_dir.name,
        "created_at": _now_iso(),
        "assistant": args.assistant,
        "engagement": args.engagement,
        "container_workspace": args.container_workspace,
        "target": args.target,
        "prompt_sha256": _sha256_text(args.prompt_file.read_text(encoding="utf-8")),
        "proceed_sha256": _sha256_text(proceed) if proceed is not None else None,
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
            "mode comes from the captured plan/roe.json machine_enforcement block; "
            "tool audit decisions remain the authority for invocation enforcement"
        ),
        "injections": dict.fromkeys(PROTOCOL_KINDS, 0),
        "injections_planned": {
            kind: sum(1 for r in args.protocol_records if r["kind"] == kind)
            for kind in PROTOCOL_KINDS
        },
        "protocol_sha256": _sha256_text(
            (run_dir / "input" / "protocol.jsonl").read_text(encoding="utf-8")
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
            "working tree has uncommitted changes; compare image revisions and build mode"
            if manifest["repo_dirty"]
            else ""
        )
    except Exception as exc:  # noqa: BLE001
        manifest["repo_head"] = f"unknown: {exc}"
    try:
        imgs = _docker(
            [
                "inspect",
                *args.log_containers.split(","),
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
    try:
        summary = asyncio.run(_amain(args, run_dir, manifest))
        manifest["injections"] = summary["injections"]
    finally:
        channels = {c: _read_capture_note(run_dir / "trace", c) for c in CAPTURE_CHANNELS}
        manifest["api_reachable"] = channels["api"] == "ok"
        manifest["capture_channels"] = channels
        if hasattr(args, "image_revisions"):
            manifest["image_revisions"] = args.image_revisions
        (run_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    _log(f"terminal status: {summary['status']} after {summary['turns']} turns")
    return 0 if summary["status"] == "objectives-complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
