"""RoE guardrail middleware - the advisory command-parse RoE gate.

This middleware sits between the LLM and the tool surface. Every
``bash`` (and other tool) call is evaluated against the engagement's
``roe.json:machine_enforcement`` block. The outcome is one of:

  * **PASS** in audit mode - logged, allowed to proceed.
  * **WARN** in warn mode - logged, a SystemMessage is appended to the
    tool's return so the model sees it failed RoE, but the call still
    executes.
  * **REFUSE** in enforce mode - logged, the tool call short-circuits
    with a ``[ROE_REFUSED]`` ToolMessage before the handler runs.

Defense-in-depth: this middleware is a *guardrail*, not the sole gate.
It parses the literal command text for target hosts, which is a strong
**fast-fail UX signal** (it tells the model early, before a wasted
round-trip) but cannot be the authoritative boundary — a determined
agent can hide a target behind variable indirection, command
substitution, or DNS resolution the parser never sees. The
authoritative scope boundary is the sandbox's network **egress**
(``middleware/egress.py`` → DNS allowlist + nftables connect
allowlist), compiled from the *same* ``machine_enforcement`` rules, so
the packet cannot leave even when the parse misses. One scope
definition, two enforcement points.

Every decision (PASS too, not just REFUSE) lands in the HMAC-chained
audit ledger via :class:`RoEAuditSink`. The ledger is the legal record
of "what the agent tried, what was approved, what was blocked" - the
key artifact for paid / regulated engagement out-briefs.

Reading the RoE (ADR-0102):

  * The document is ``plan/roe.json`` in the project's own sandbox. The runtime
    holds no project volume, so every read goes through the sandbox the run is
    routed to, and it is re-read on every gated call (hot-reload, no restart).
  * A missing document or a missing ``machine_enforcement`` block means audit
    only: the planner has not finished writing the RoE yet. A document that
    cannot be read or parsed, a sandbox that cannot be reached, and an unknown
    mode all refuse gated calls. Nothing falls back to audit-only silently.
  * The emergency stop is ``.abort`` in the same sandbox. An unreachable sandbox
    counts as aborted.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import random
import re
import threading
import time
from collections.abc import Callable
from contextlib import asynccontextmanager, contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from langchain.agents.middleware import AgentMiddleware
from langchain_core.messages import ToolMessage
from langgraph.types import Command
from typing_extensions import override

from raptix.execution.backends.project_files import (
    ProjectFiles,
    ProjectFileUnavailable,
    project_files_for,
    project_sandbox_for,
)
from raptix.middleware._audit_sink import RoEAuditSink
from raptix.middleware._command_targets import extract_targets
from raptix.orchestration.mission.objective_context import ObjectiveContextState
from raptix_core.types.roe import (
    Decision,
    EnforcementMode,
    MachineEnforcement,
    evaluate_command,
    evaluate_target,
    evaluate_time_window,
)

log = logging.getLogger(__name__)


GATED_TOOL_NAMES: frozenset[str] = frozenset(
    {
        "bash",
        "bash_output",
        "bash_kill",
        "http_request",
        "proxy_send_request",
        "browser_action",
        # Open-web engine tools (ADR-0010). web_fetch is target-gated on its
        # url; web_search is OSINT (allowlisted provider) — gated for audit/
        # throttle but target-exempt via a no-op extractor below.
        "web_fetch",
        "web_search",
        "detect_tech_stack",
    }
)


def _host_from_url(url: Any) -> list[str]:
    if not isinstance(url, str) or not url:
        return []
    try:
        host = urlsplit(url).hostname
    except ValueError:
        return []
    return [host] if host else []


def _hosts_from_url_arg(args: dict[str, Any]) -> list[str]:
    return _host_from_url(args.get("url"))


def _hosts_from_browser_action(args: dict[str, Any]) -> list[str]:
    raw = args.get("params_json")
    if not isinstance(raw, str) or not raw:
        return []
    try:
        params = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return []
    if not isinstance(params, dict):
        return []
    return _host_from_url(params.get("url"))


def _hosts_from_web_search(_args: dict[str, Any]) -> list[str]:
    """OSINT exemption: web_search hits an allowlisted provider, not a target.

    Returning no hosts means the per-target scope check is a no-op (the call is
    still audited + throttled because web_search is in GATED_TOOL_NAMES).
    """
    return []


NETWORK_TARGET_EXTRACTORS: dict[str, Callable[[dict[str, Any]], list[str]]] = {
    "http_request": _hosts_from_url_arg,
    "proxy_send_request": _hosts_from_url_arg,
    "web_fetch": _hosts_from_url_arg,
    "web_search": _hosts_from_web_search,
    "detect_tech_stack": _hosts_from_url_arg,
    "browser_action": _hosts_from_browser_action,
}


ROE_PATH = "plan/roe.json"
ABORT_PATH = ".abort"
AUDIT_PATH = "audit/roe-decisions.jsonl"
_KNOWN_MODES = frozenset(mode.value for mode in EnforcementMode)
# Used when the RoE cannot be read: every gated call is refused, whatever the mode the document would have set.
_UNAVAILABLE_RULES = MachineEnforcement(mode=EnforcementMode.ENFORCE)


def _project_files_for_request(request) -> ProjectFiles:
    """The project's files for this tool call's run. Raises ProjectFileUnavailable when the run has no sandbox."""
    runtime = getattr(request, "runtime", None)
    return project_files_for(getattr(runtime, "config", None))


def load_rules(files: ProjectFiles) -> MachineEnforcement:
    """The engagement's machine rules, read from its own sandbox (ADR-0102).

    A missing roe.json is audit-only, because the planner has not written one yet. A document that cannot be read or
    parsed, and a mode the runtime does not know, raise ProjectFileUnavailable, so the caller refuses gated calls.
    """
    raw = files.read_bytes(ROE_PATH)
    if raw is None:
        return MachineEnforcement()
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProjectFileUnavailable(f"{ROE_PATH} is not valid JSON") from exc
    if not isinstance(data, dict):
        raise ProjectFileUnavailable(f"{ROE_PATH} is not a JSON object")
    block = data.get("machine_enforcement")
    if block is None:
        return MachineEnforcement()
    if not isinstance(block, dict):
        raise ProjectFileUnavailable(f"{ROE_PATH} machine_enforcement is not an object")
    mode = str(block.get("mode", EnforcementMode.AUDIT.value)).lower()
    if mode not in _KNOWN_MODES:
        raise ProjectFileUnavailable(
            f"{ROE_PATH} machine_enforcement.mode {mode!r} is not a known mode"
        )
    try:
        return MachineEnforcement.from_dict(block)
    except (TypeError, ValueError, KeyError) as exc:
        raise ProjectFileUnavailable(f"{ROE_PATH} machine_enforcement is malformed: {exc}") from exc


def _abort_marker_present(files: ProjectFiles) -> bool:
    return files.exists(ABORT_PATH)


def _halted_message(tool_name: str, tool_call_id: str | None) -> ToolMessage:
    body = (
        f"[AGENT_HALTED] code=EMERGENCY_ABORT tool={tool_name}\n"
        "An out-of-band emergency abort was signalled by the operator "
        "(.abort marker in the workspace). This gated call was NOT executed.\n"
        "Stop work immediately and await operator instructions - do NOT "
        "retry or attempt alternative commands this turn."
    )
    return ToolMessage(content=body, tool_call_id=tool_call_id or "", status="error")


def _refused_message(decision: Decision, tool_name: str, tool_call_id: str | None) -> ToolMessage:
    body = (
        f"[ROE_REFUSED] code={decision.reason_code} tool={tool_name}\n"
        f"reason: {decision.reason_detail}\n\n"
        "The engagement's RoE blocked this call. If you believe this is a\n"
        "false positive, ask the operator to update plan/roe.json "
        "(machine_enforcement block) and re-run the objective. Continuing\n"
        "with a different target / different technique is the expected\n"
        "response - do NOT re-issue the same command this turn."
    )
    return ToolMessage(content=body, tool_call_id=tool_call_id or "", status="error")


def _warn_message(decision: Decision, tool_message: ToolMessage) -> ToolMessage:
    body = (
        f"[ROE_WARN] code={decision.reason_code}\n"
        f"reason: {decision.reason_detail}\n\n"
        "The tool call ran, but the RoE evaluator flagged it. Review the\n"
        "operator's intent before continuing.\n\n"
        "----- ORIGINAL TOOL OUTPUT -----\n"
        f"{_to_text(tool_message.content)}"
    )
    return ToolMessage(
        content=body,
        tool_call_id=tool_message.tool_call_id,
        status=tool_message.status,
        name=tool_message.name,
    )


def _to_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks: list[str] = []
        for item in content:
            if isinstance(item, str):
                chunks.append(item)
            elif isinstance(item, dict) and item.get("type") == "text":
                chunks.append(str(item.get("text", "")))
        return "".join(chunks)
    return str(content)


_REDACT_MASK = "***"

_SECRET_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?i)(sshpass\s+-p\s+)('[^']*'|\"[^\"]*\"|\S+)"),
    re.compile(r"(?i)(\bPGPASSWORD=)('[^']*'|\"[^\"]*\"|\S+)"),
    re.compile(
        r"(?i)((?:--password|--pass|--token)(?:[=\s]+)|-p\s+)"
        r"('[^']*'|\"[^\"]*\"|\S+)"
    ),
    re.compile(r"(?i)((?:-u|--user)\s+)('[^']*'|\"[^\"]*\"|[^\s:]+):(\S+)"),
    re.compile(
        r"(?i)((?:-H|--header)(?:[=\s]+))"
        r"('(?:[^']*(?:authorization|bearer|api-key|apikey|x-api-key)[^']*)'"
        r"|\"(?:[^\"]*(?:authorization|bearer|api-key|apikey|x-api-key)[^\"]*)\")",
    ),
    re.compile(r"(?i)([^\s/@:]+/[^\s/@:]+:)([^\s@]+)(@)"),
    re.compile(r"(?i)([A-Za-z][\w.-]*:)([^\s@:]+)(@[\w.-]+)"),
)


def _redact_header_value(match: re.Match[str]) -> str:
    flag, raw = match.group(1), match.group(2)
    quote = raw[0]
    inner = raw[1:-1]
    if ":" in inner:
        name, _, _value = inner.partition(":")
        return f"{flag}{quote}{name}: {_REDACT_MASK}{quote}"
    return f"{flag}{quote}{_REDACT_MASK}{quote}"


def _redact_secrets(cmd: str) -> str:
    if not cmd:
        return cmd
    out = cmd
    out = _SECRET_PATTERNS[0].sub(lambda m: f"{m.group(1)}{_REDACT_MASK}", out)
    out = _SECRET_PATTERNS[1].sub(lambda m: f"{m.group(1)}{_REDACT_MASK}", out)
    out = _SECRET_PATTERNS[2].sub(lambda m: f"{m.group(1)}{_REDACT_MASK}", out)
    out = _SECRET_PATTERNS[3].sub(lambda m: f"{m.group(1)}{m.group(2)}:{_REDACT_MASK}", out)
    out = _SECRET_PATTERNS[4].sub(_redact_header_value, out)
    out = _SECRET_PATTERNS[5].sub(lambda m: f"{m.group(1)}{_REDACT_MASK}{m.group(3)}", out)
    out = _SECRET_PATTERNS[6].sub(lambda m: f"{m.group(1)}{_REDACT_MASK}{m.group(3)}", out)
    return out


def _tool_call_args(request) -> dict[str, Any]:
    args = getattr(request, "tool_call_args", None)
    if not isinstance(args, dict):
        last = getattr(request, "tool_call", None)
        args = last.get("args") if isinstance(last, dict) else getattr(last, "args", None)
    return args if isinstance(args, dict) else {}


def _objective_for_tool(request: Any, tool_name: str) -> str:
    state = getattr(request, "state", None) or {}
    get = state.get if hasattr(state, "get") else (lambda _key, _default=None: None)
    if tool_name != "task":
        return str(get("active_objective_id") or get("current_objective") or "")
    # Task audit happens before dispatch. Attribute only IDs present in the
    # trusted objective catalog, never the parent's stale completion cursor.
    objective = _tool_call_args(request).get("objective_id")
    if isinstance(objective, str) and any(
        isinstance(row, dict) and row.get("id") == objective for row in get("objectives") or []
    ):
        return objective
    return ""


def _command_from_tool_call(request) -> str:
    args = _tool_call_args(request)
    cmd = args.get("command") or args.get("cmd") or ""
    return cmd if isinstance(cmd, str) else ""


def _egress_disabled() -> bool:
    """Whether the Layer-2 egress guardrail is turned OFF (opt-out).

    Default ON: an ``enforce``-mode engagement automatically gets the
    authoritative network boundary compiled + pushed to the sandbox — no
    extra env needed. ``RAPTIX_EGRESS_DISABLE=1`` is the escape hatch
    for an operator whose environment the in-sandbox firewall doesn't fit
    (it falls back to the parser layer alone). audit / warn modes never
    touch the network regardless.
    """
    return os.environ.get("RAPTIX_EGRESS_DISABLE", "").strip().lower() in {
        "1",
        "true",
        "yes",
    }


class RoEGuardrailMiddleware(AgentMiddleware):
    """Evaluate every bash tool call against the engagement's RoE.

    Args:
        sink: ``RoEAuditSink`` instance. The middleware records every
            evaluation (PASS, WARN, REFUSE) so the engagement deliverable
            carries the full record.
        gated_tools: Override the default tool-name set. Use this to
            extend enforcement to additional tools (e.g. an HTTP
            request tool).
        jitter_frac: Fraction of ``min_inter_request_delay_ms`` added as
            random OPSEC jitter on top of the floor when a gated call is
            paced (0 disables jitter; the floor is still honoured).
    """

    state_schema = ObjectiveContextState

    def __init__(
        self,
        *,
        sink: RoEAuditSink | None = None,
        gated_tools: frozenset[str] | None = None,
        now: Callable[[], datetime] | None = None,
        jitter_frac: float = 0.25,
    ) -> None:
        super().__init__()
        self._sink = sink
        self._gated = gated_tools or GATED_TOOL_NAMES
        self._conc_lock = threading.Lock()
        self._conc_limit: int | None = None
        self._sync_sema: threading.Semaphore | None = None
        self._async_sema: asyncio.Semaphore | None = None
        self._now = now or (lambda: datetime.now(timezone.utc))
        self._jitter_frac = max(0.0, jitter_frac)
        self._pace_lock = threading.Lock()
        self._last_gated_monotonic = 0.0
        self._egress_lock = threading.Lock()
        self._egress_provisioned: set[str] = set()
        self._sink_lock = threading.Lock()
        self._project_sinks: dict[str, RoEAuditSink] = {}

    @override
    def before_agent(self, state, runtime) -> None:
        self._maybe_provision_egress()
        return None

    @override
    async def abefore_agent(self, state, runtime) -> None:
        # Provisioning does a one-time synchronous HTTP round-trip to the
        # sandbox daemon; offload it so the event loop isn't blocked.
        await asyncio.to_thread(self._maybe_provision_egress)
        return None

    @override
    def wrap_tool_call(self, request, handler) -> ToolMessage | Command:
        return self._dispatch_sync(request, handler)

    @override
    async def awrap_tool_call(self, request, handler) -> ToolMessage | Command:
        return await self._dispatch_async(request, handler)

    def _dispatch_sync(self, request, handler):
        halt = self._check_abort(request)
        if halt is not None:
            return halt
        decision, rules, tool_name = self._evaluate(request)
        self._record(request, tool_name, decision, rules.mode)
        if not decision.allow and rules.mode == EnforcementMode.ENFORCE:
            return _refused_message(decision, tool_name, _tcid(request))
        wait = self._pace_wait_seconds(rules)
        if wait > 0:
            self._record_throttle(request, tool_name, wait)
            time.sleep(wait)
        gated = tool_name in self._gated
        with self._sync_gate(rules, gated):
            result = handler(request)
        if (
            not decision.allow
            and rules.mode == EnforcementMode.WARN
            and isinstance(result, ToolMessage)
        ):
            return _warn_message(decision, result)
        return result

    async def _dispatch_async(self, request, handler):
        halt = self._check_abort(request)
        if halt is not None:
            return halt
        decision, rules, tool_name = self._evaluate(request)
        self._record(request, tool_name, decision, rules.mode)
        if not decision.allow and rules.mode == EnforcementMode.ENFORCE:
            return _refused_message(decision, tool_name, _tcid(request))
        wait = self._pace_wait_seconds(rules)
        if wait > 0:
            self._record_throttle(request, tool_name, wait)
            await asyncio.sleep(wait)
        gated = tool_name in self._gated
        async with self._async_gate(rules, gated):
            result = await handler(request)
        if (
            not decision.allow
            and rules.mode == EnforcementMode.WARN
            and isinstance(result, ToolMessage)
        ):
            return _warn_message(decision, result)
        return result

    def _resolve_limit(self, rules: MachineEnforcement) -> int | None:
        limit = rules.max_concurrent_connections
        if limit is None or limit <= 0:
            return None
        with self._conc_lock:
            if self._conc_limit is None:
                self._conc_limit = limit
            return self._conc_limit

    @contextmanager
    def _sync_gate(self, rules: MachineEnforcement, gated: bool):
        limit = self._resolve_limit(rules) if gated else None
        if limit is None:
            yield
            return
        with self._conc_lock:
            if self._sync_sema is None:
                self._sync_sema = threading.Semaphore(limit)
            sema = self._sync_sema
        sema.acquire()
        try:
            yield
        finally:
            sema.release()

    @asynccontextmanager
    async def _async_gate(self, rules: MachineEnforcement, gated: bool):
        limit = self._resolve_limit(rules) if gated else None
        if limit is None:
            yield
            return
        with self._conc_lock:
            if self._async_sema is None:
                self._async_sema = asyncio.Semaphore(limit)
            sema = self._async_sema
        async with sema:
            yield

    def _check_abort(self, request) -> ToolMessage | None:
        tool = getattr(request, "tool", None)
        tool_name = getattr(tool, "name", "unknown") if tool else "unknown"
        if tool_name not in self._gated:
            return None
        try:
            present = _abort_marker_present(_project_files_for_request(request))
        except ProjectFileUnavailable as exc:
            # The emergency stop cannot be checked, so the run counts as aborted (ADR-0102).
            log.error("roe: abort marker unreadable, treating the run as aborted: %s", exc)
            present = True
        if not present:
            return None
        self._record_abort(request, tool_name)
        return _halted_message(tool_name, _tcid(request))

    def _sink_for(self, request) -> RoEAuditSink | None:
        """The audit ledger for this run: an operator-pinned sink, else the project's own ledger in its sandbox."""
        if self._sink is not None:
            return self._sink
        try:
            files = _project_files_for_request(request)
        except ProjectFileUnavailable as exc:
            log.error("roe: no project ledger for this call: %s", exc)
            return None
        with self._sink_lock:
            sink = self._project_sinks.get(files.key)
            if sink is None:
                sink = RoEAuditSink.for_project(files, AUDIT_PATH)
                self._project_sinks[files.key] = sink
            return sink

    def _record_abort(self, request, tool_name: str) -> None:
        sink = self._sink_for(request)
        if sink is None:
            return
        state = getattr(request, "state", {}) or {}
        get = state.get if hasattr(state, "get") else (lambda _k, _d=None: None)
        engagement = get("engagement_name") or "unknown-engagement"
        objective = _objective_for_tool(request, tool_name)
        record = {
            "ts": time.time(),
            "event": "abort",
            "engagement": engagement,
            "objective_id": objective,
            "tool": tool_name,
            "decision": "refuse",
            "reason_code": "EMERGENCY_ABORT",
            "command_excerpt": _command_from_tool_call(request)[:512],
        }
        try:
            sink.append(record)
        except Exception as exc:  # noqa: BLE001 - audit must never break tool execution
            log.error("roe: audit sink write failed: %s", exc)

    def _maybe_provision_egress(self) -> None:
        """Compile + push the Layer-2 egress guardrail, once per project sandbox.

        Default ON for ``enforce`` mode: skipped only when the operator
        opts out via ``RAPTIX_EGRESS_DISABLE``. audit / warn modes
        never reach here (guarded below). Best-effort: any failure is
        logged and never propagates into agent execution.
        """
        if _egress_disabled():
            return
        try:
            from langgraph.config import get_config

            config = get_config()
        except RuntimeError:
            config = None
        try:
            files = project_files_for(config)
        except ProjectFileUnavailable:
            return
        try:
            rules = load_rules(files)
        except ProjectFileUnavailable as exc:
            log.warning("roe: egress skipped, RoE unreadable: %s", exc)
            return
        if rules.mode != EnforcementMode.ENFORCE:
            return
        with self._egress_lock:
            if files.key in self._egress_provisioned:
                return
            self._egress_provisioned.add(files.key)
        try:
            from raptix.middleware.egress import compile_egress_policy

            policy = compile_egress_policy(rules)
            result = project_sandbox_for(config).provision_egress(policy)
            log.info(
                "roe: egress provisioned for %s: applied=%s detail=%s",
                files.key,
                result.get("applied"),
                result.get("detail"),
            )
        except Exception as exc:  # noqa: BLE001 - provisioning must never break the run
            log.error("roe: egress provisioning failed for %s: %s", files.key, exc)
            # Un-mark so a later agent turn can retry rather than silently
            # leaving the engagement with no network boundary.
            with self._egress_lock:
                self._egress_provisioned.discard(files.key)

    def _evaluate(self, request) -> tuple[Decision, MachineEnforcement, str]:
        tool = getattr(request, "tool", None)
        tool_name = getattr(tool, "name", "unknown") if tool else "unknown"
        if tool_name not in self._gated:
            return Decision.allow_default(), MachineEnforcement(), tool_name
        try:
            rules = load_rules(_project_files_for_request(request))
        except ProjectFileUnavailable as exc:
            unavailable = Decision.refuse(
                "ROE_UNAVAILABLE",
                f"the engagement's RoE could not be read from its project sandbox ({exc})",
            )
            return unavailable, _UNAVAILABLE_RULES, tool_name
        time_decision = evaluate_time_window(self._now(), rules)
        if not time_decision.allow:
            return time_decision, rules, tool_name
        extractor = NETWORK_TARGET_EXTRACTORS.get(tool_name)
        if extractor is not None:
            hosts = extractor(_tool_call_args(request))
            for host in sorted(set(hosts)):
                target_decision = evaluate_target(host, rules)
                if not target_decision.allow:
                    return target_decision, rules, tool_name
            return Decision.allow_default(), rules, tool_name
        command = _command_from_tool_call(request)
        cmd_decision = evaluate_command(command, rules)
        if not cmd_decision.allow:
            return cmd_decision, rules, tool_name
        targets = extract_targets(command)
        for target in sorted(targets):
            target_decision = evaluate_target(target, rules)
            if not target_decision.allow:
                return target_decision, rules, tool_name
        return Decision.allow_default(), rules, tool_name

    def _record(
        self,
        request,
        tool_name: str,
        decision: Decision,
        mode: EnforcementMode,
    ) -> None:
        sink = self._sink_for(request)
        if sink is None:
            return
        state = getattr(request, "state", {}) or {}
        get = state.get if hasattr(state, "get") else (lambda _k, _d=None: None)
        engagement = get("engagement_name") or "unknown-engagement"
        objective = _objective_for_tool(request, tool_name)
        record = {
            "ts": time.time(),
            "engagement": engagement,
            "objective_id": objective,
            "tool": tool_name,
            "decision": "allow" if decision.allow else "refuse",
            "reason_code": decision.reason_code,
            "reason_detail": decision.reason_detail,
            "risk": decision.risk,
            "matched_targets": list(decision.matched_targets),
            "mode": mode.value,
            "command_excerpt": _redact_secrets(_command_from_tool_call(request))[:512],
        }
        try:
            sink.append(record)
        except Exception as exc:  # noqa: BLE001 - audit must never break tool execution
            log.error("roe: audit sink write failed: %s", exc)

    def _pace_wait_seconds(self, rules: MachineEnforcement) -> float:
        """Seconds to sleep before a gated call to honour ``min_inter_request_delay_ms``.

        The first runtime request-cadence control (opplan only prints an OPSEC
        label). Isolated calls never wait; bursts are spaced to the floor plus
        up to ``jitter_frac`` of it, so the cadence is not a fixed-interval IOC.
        Never goes below the configured minimum; returns 0 when unset.
        """
        floor = rules.min_inter_request_delay_ms / 1000.0
        if floor <= 0:
            return 0.0
        now = time.monotonic()
        with self._pace_lock:
            start_at = max(now, self._last_gated_monotonic + floor)
            self._last_gated_monotonic = start_at
        wait = start_at - now
        if wait > 0 and self._jitter_frac > 0:
            wait += random.uniform(0.0, floor * self._jitter_frac)
        return wait

    def _record_throttle(self, request, tool_name: str, wait_seconds: float) -> None:
        sink = self._sink_for(request)
        if sink is None:
            return
        state = getattr(request, "state", {}) or {}
        get = state.get if hasattr(state, "get") else (lambda _k, _d=None: None)
        record = {
            "ts": time.time(),
            "engagement": get("engagement_name") or "unknown-engagement",
            "objective_id": _objective_for_tool(request, tool_name),
            "tool": tool_name,
            "event": "throttle",
            "reason_code": "MIN_INTER_REQUEST_DELAY",
            "delay_seconds": round(wait_seconds, 3),
        }
        try:
            sink.append(record)
        except Exception as exc:  # noqa: BLE001 - audit must never break tool execution
            log.error("roe: throttle audit write failed: %s", exc)


def _tcid(request) -> str | None:
    tc = getattr(request, "tool_call_id", None)
    if isinstance(tc, str):
        return tc
    last = getattr(request, "tool_call", None)
    tc_attr = last.get("id") if isinstance(last, dict) else getattr(last, "id", None)
    return tc_attr if isinstance(tc_attr, str) else None


def build_default_sink() -> RoEAuditSink | None:
    """The operator-pinned local ledger from ``RAPTIX_ROE_AUDIT_PATH``, or None.

    None means the middleware keeps each project's ledger in that project's own sandbox (ADR-0102). A local file is only
    for an operator who pins one on purpose.
    """
    env_path = os.environ.get("RAPTIX_ROE_AUDIT_PATH")
    if env_path:
        return RoEAuditSink(path=Path(env_path))
    return None


# Compat alias (removed at 2.0.0). The class was renamed
# ``RoEEnforcementMiddleware`` → ``RoEGuardrailMiddleware`` when RoE
# enforcement became genuinely layered (advisory command-parse here +
# authoritative sandbox egress). Downstream plugins / downstream subagents
# that import the old name keep working for one minor cycle.
RoEEnforcementMiddleware = RoEGuardrailMiddleware
