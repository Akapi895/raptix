"""PoC validator + CVSS attachment.

Takes a PoC script (bash, python, curl invocation, http request text) and
runs it inside the Docker sandbox against the target. The validator looks
for caller-defined success indicators ("reflected payload", "HTTP 500
with stack trace", "shell spawned") and marks the associated vulnerability
node as ``validated=True`` on hit, alongside provenance (raw output hash,
stdout/stderr excerpt, exit code).

A ZFP (Zero-False-Positive) layer demands *both* a success signal AND
a negative control (same request without payload) to differentiate
"works because of payload" from "works anyway". Optional but strongly
recommended for bounty reports.

CVSS scoring
------------
If the PoC confirms exploitation and the caller supplied a vector string,
scoring is delegated to :mod:`raptix.execution.tools.reporting.cvss` — the
single canonical CVSS 3.1 implementation (base + environmental score, used
by ``cvss_score_tool`` too). This module used to carry its own duplicate
base-score-only formula; see that module for the scoring math itself.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from langchain_core.tools import tool

from raptix.execution.tools.reporting.cvss import parse_vector, score_vector
from raptix.execution.tools.research._state import _json, graph_transaction
from raptix_core.types.kg import (
    Edge,
    EdgeKind,
    KnowledgeGraph,
    Node,
    NodeKind,
    Severity,
)
from raptix_core.utils.logging import get_logger

log = get_logger("research.poc")

_BAND_TO_SEVERITY: dict[str, Severity] = {
    "Critical": Severity.CRITICAL,
    "High": Severity.HIGH,
    "Medium": Severity.MEDIUM,
    "Low": Severity.LOW,
    "None": Severity.INFO,
}


def parse_cvss_vector(vector: str) -> str:
    """Validate a CVSS 3.1 vector string, returning it unchanged on success.

    Delegates validation to :func:`raptix.execution.tools.reporting.cvss.parse_vector`.
    ``CVSSError`` is a ``ValueError`` subclass, so existing ``except ValueError``
    callers (``validate_finding``, ``validate_workspace_finding``) are unaffected.
    """
    parse_vector(vector)
    return vector


# ── PoC validation ──────────────────────────────────────────────────────


@dataclass
class PoCResult:
    """Outcome of a PoC validation run."""

    validated: bool
    vuln_id: str
    summary: str
    success_signals: list[str] = field(default_factory=list)
    negative_signals: list[str] = field(default_factory=list)
    stdout_excerpt: str = ""
    stderr_excerpt: str = ""
    exit_code: int | None = None
    cvss: str | None = None
    cvss_score: float | None = None
    severity: str | None = None
    output_hash: str = ""
    duration_seconds: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return {
            "validated": self.validated,
            "vuln_id": self.vuln_id,
            "summary": self.summary,
            "success_signals": self.success_signals,
            "negative_signals": self.negative_signals,
            "stdout_excerpt": self.stdout_excerpt[:800],
            "stderr_excerpt": self.stderr_excerpt[:400],
            "exit_code": self.exit_code,
            "cvss": self.cvss,
            "cvss_score": self.cvss_score,
            "severity": self.severity,
            "output_hash": self.output_hash,
            "duration_seconds": round(self.duration_seconds, 3),
        }


# Any awaitable that takes a bash command and returns (stdout, stderr, exit_code).
PoCRunner = Callable[[str], Awaitable[tuple[str, str, int]]]


def _hash_output(stdout: str, stderr: str, exit_code: int) -> str:
    h = hashlib.sha1(usedforsecurity=False)
    h.update(stdout.encode("utf-8", errors="replace"))
    h.update(b"||")
    h.update(stderr.encode("utf-8", errors="replace"))
    h.update(f"||{exit_code}".encode())
    return h.hexdigest()[:16]


def _match_signals(blob: str, patterns: list[str]) -> list[str]:
    """Return the subset of patterns whose regex matches the blob."""
    matched: list[str] = []
    for pat in patterns:
        try:
            if re.search(pat, blob, re.DOTALL | re.IGNORECASE):
                matched.append(pat)
        except re.error:
            if pat.lower() in blob.lower():
                matched.append(pat)
    return matched


async def validate_poc(
    *,
    vuln_id: str,
    poc_command: str,
    success_patterns: list[str],
    runner: PoCRunner,
    negative_command: str | None = None,
    negative_patterns: list[str] | None = None,
    cvss: str | None = None,
    graph: KnowledgeGraph | None = None,
) -> PoCResult:
    """Run a PoC command and evaluate against success/negative patterns.

    If ``graph`` is provided, the vuln node is updated with ``validated=True``
    and a ``FINDING`` node is created with a ``VALIDATES`` edge back to it.
    A failed validation is still recorded (``validated=False``) so the
    analyst can iterate without losing attempt history.
    """
    start = time.monotonic()
    stdout, stderr, code = await runner(poc_command)
    duration = time.monotonic() - start
    combined = f"{stdout}\n{stderr}"
    success = _match_signals(combined, success_patterns)

    neg_hits: list[str] = []
    if negative_command and negative_patterns:
        n_out, n_err, _ = await runner(negative_command)
        n_combined = f"{n_out}\n{n_err}"
        neg_hits = _match_signals(n_combined, negative_patterns)
        # ZFP: if the negative control also matched any success pattern,
        # the signal was noise and we demote.
        if _match_signals(n_combined, success_patterns):
            log.warning("vuln %s: negative control also matched — demoting", vuln_id)
            success = []

    # ZFP: if negative control was run, it MUST match its patterns
    # (confirming baseline works). If it didn't run, skip the check.
    neg_ran = bool(negative_command and negative_patterns)
    validated = bool(success) and (not neg_ran or bool(neg_hits))
    summary = (
        f"{len(success)} success signals, {len(neg_hits)} negative hits, "
        f"neg_ran={neg_ran}, exit={code}"
    )
    cvss_vec_str: str | None = None
    cvss_score: float | None = None
    sev: str | None = None
    if cvss is not None:
        scored = score_vector(cvss)
        cvss_vec_str = scored["normalized_vector"]
        if scored["has_environmental"]:
            cvss_score = scored["environmental_score"]
            sev = _BAND_TO_SEVERITY[scored["environmental_severity"]].value
        else:
            cvss_score = scored["base_score"]
            sev = _BAND_TO_SEVERITY[scored["base_severity"]].value

    result = PoCResult(
        validated=validated,
        vuln_id=vuln_id,
        summary=summary,
        success_signals=success,
        negative_signals=neg_hits,
        stdout_excerpt=stdout[:1600],
        stderr_excerpt=stderr[:800],
        exit_code=code,
        cvss=cvss_vec_str,
        cvss_score=cvss_score,
        severity=sev,
        output_hash=_hash_output(stdout, stderr, code),
        duration_seconds=duration,
    )

    if graph is not None:
        _persist_result(graph, result)

    return result


def _persist_result(graph: KnowledgeGraph, result: PoCResult) -> None:
    """Write validation outcome into the graph."""
    vuln = graph.nodes.get(result.vuln_id)
    if vuln is None:
        log.warning("validate_poc: vuln node %s not found in graph", result.vuln_id)
        return
    vuln.props["validated"] = result.validated
    vuln.props["validated_at"] = time.time()
    vuln.props["output_hash"] = result.output_hash
    if result.severity:
        vuln.props["severity"] = result.severity
    if result.cvss_score is not None:
        vuln.props["cvss_score"] = result.cvss_score
        vuln.props["cvss_vector"] = result.cvss
    vuln.updated_at = time.time()

    finding_label = (
        f"validated: {vuln.label[:80]}" if result.validated else f"rejected: {vuln.label[:80]}"
    )
    finding = Node.make(
        NodeKind.FINDING,
        finding_label,
        key=f"finding::{result.output_hash}",
        validated=result.validated,
        vuln_id=result.vuln_id,
        summary=result.summary,
        stdout_excerpt=result.stdout_excerpt[:400],
        exit_code=result.exit_code,
        cvss_score=result.cvss_score,
    )
    graph.upsert_node(finding)
    graph.upsert_edge(Edge.make(finding.id, vuln.id, EdgeKind.VALIDATES))
    graph.upsert_edge(Edge.make(finding.id, vuln.id, EdgeKind.MAPS_TO))

    # Ground-truth telemetry, emitted from the one place a FINDING node is born
    # so the classification is the real one (severity/CWE/MITRE off the vuln
    # node), not a guess made by name-matching the tool. Never the target,
    # label, or stdout. No-op unless the user opted into telemetry. The session
    # id is picked up from the ambient engagement the middleware binds around
    # the tool call, so the finding groups with the run that produced it.
    try:
        from raptix.telemetry.sink import get_sink

        props = vuln.props
        get_sink().record_finding(
            severity=result.severity,
            cwe=[c for c in props.get("cwe", []) or [] if isinstance(c, str)] or None,
            mitre=[m for m in props.get("mitre", []) or [] if isinstance(m, str)] or None,
            confidence="validated" if result.validated else "rejected",
        )
    except Exception:  # noqa: BLE001 — telemetry must never break the tool
        pass


# ── Convenience: build a runner from an HTTPSandbox ─────────────────────

# Typed-error sentinels: callers distinguish a hung runner from a crash by
# inspecting the stderr prefix (return shape stays (stdout, stderr, code)).
POC_ERR_TIMEOUT = "[POC_TIMEOUT]"
POC_ERR_SANDBOX = "[SANDBOX_ERROR]"

# Outer-bound on a single PoC invocation. The inner tmux call has its own
# 60s budget but can wedge — this guards against indefinite hangs.
POC_RUNNER_TIMEOUT_SECONDS: float = 120.0


def sandbox_runner(sandbox: Any, *, timeout: float | None = None) -> PoCRunner:
    """Adapt an ``HTTPSandbox`` into a :data:`PoCRunner` callable.

    The sandbox must expose ``execute_tmux_async`` (or ``execute_tmux``) that
    returns a str output. We split the returned blob on ``[Exit code:`` to
    recover an exit code when present.

    The invocation is bounded by ``timeout`` seconds (defaults to module
    constant :data:`POC_RUNNER_TIMEOUT_SECONDS`). On timeout the stderr
    field is prefixed with :data:`POC_ERR_TIMEOUT`; other sandbox failures
    use :data:`POC_ERR_SANDBOX`. Return arity is unchanged so existing
    callers continue to destructure ``(stdout, stderr, exit_code)``.
    """

    async def _run(command: str) -> tuple[str, str, int]:
        eff_timeout = timeout if timeout is not None else POC_RUNNER_TIMEOUT_SECONDS
        try:
            if hasattr(sandbox, "execute_tmux_async"):
                coro: Awaitable[str] = sandbox.execute_tmux_async(
                    command=command, session="poc", timeout=60, is_input=False
                )
            else:
                coro = asyncio.to_thread(
                    sandbox.execute_tmux,
                    command=command,
                    session="poc",
                    timeout=60,
                    is_input=False,
                )
            out = await asyncio.wait_for(coro, timeout=eff_timeout)
        except asyncio.TimeoutError:
            err_msg = f"{POC_ERR_TIMEOUT} runner exceeded {eff_timeout}s"
            log.error("sandbox_runner timeout: %s", err_msg)
            return "", err_msg, -1
        except Exception as e:
            err_msg = f"{POC_ERR_SANDBOX} {type(e).__name__}: {e}"
            log.error("sandbox_runner failed: %s", err_msg)
            return "", err_msg, -1
        code = 0
        m = re.search(r"\[Exit code:\s*(-?\d+)", out)
        if m:
            try:
                code = int(m.group(1))
            except ValueError:
                pass
        return out, "", code

    return _run


# ── Agent-facing tool ─────────────────────────────────────────────────────


@tool
async def validate_finding(
    vuln_id: str,
    poc_command: str,
    success_patterns: str,
    negative_command: str = "",
    negative_patterns: str = "",
    cvss_vector: str = "",
) -> str:
    """Run a PoC inside the sandbox and mark the vuln validated on hit.

    WHEN TO USE: After identifying a vulnerability, craft a minimal
    reproducer and run it here. The validator applies ZFP (zero false
    positives) by requiring a negative control: if the same request
    without the payload *also* fires the success pattern, the result is
    demoted.

    SUCCESS PATTERNS are Python regexes (DOTALL + IGNORECASE). Use simple
    substrings when you don't need regex power.

    CVSS_VECTOR example: ``"CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"``
    If provided, the base score is computed and written back onto the
    vuln node.

    Args:
        vuln_id: Graph id of the vulnerability node to validate.
        poc_command: Bash command that exercises the vulnerability.
        success_patterns: Comma-separated list of regexes to match in stdout.
        negative_command: Optional baseline command (same request without payload).
        negative_patterns: Comma-separated regexes expected in the baseline.
        cvss_vector: Optional CVSS v3.1 vector string.

    Returns:
        JSON validation record including success signals, negative
        control hits, stdout excerpt, and CVSS score if provided.
    """
    from raptix.execution.tools.bash.bash import get_sandbox

    sandbox = get_sandbox()
    if sandbox is None:
        return _json({"error": "HTTPSandbox not initialized"})

    def _split(s: str) -> list[str]:
        return [p.strip() for p in s.split(",") if p.strip()]

    cvss: str | None = None
    if cvss_vector:
        try:
            cvss = parse_cvss_vector(cvss_vector)
        except ValueError as exc:
            return _json({"error": f"bad CVSS vector: {exc}"})

    with graph_transaction() as graph:
        runner = sandbox_runner(sandbox)
        result = await validate_poc(
            vuln_id=vuln_id,
            poc_command=poc_command,
            success_patterns=_split(success_patterns),
            runner=runner,
            negative_command=negative_command or None,
            negative_patterns=_split(negative_patterns) if negative_patterns else None,
            cvss=cvss,
            graph=graph,
        )
        return _json(result.to_dict())
