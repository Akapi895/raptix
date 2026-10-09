"""Placement-aware capability health (TC-2 of the tool-capability plan).

``AvailabilityEvaluator`` answers executor presence with import/PATH
probes in the *agent process*. Those checks cannot distinguish a binary
that exists only on the host from one inside the sandbox, an enabled
build flag from an installed package, or a declared output format from
a registered parser. This module adds the missing diagnostics — it does
NOT replace the evaluator and does NOT touch the frozen
``CapabilityStatus`` semantics (D1: all healthy → AVAILABLE, some →
PARTIAL, none → UNAVAILABLE).

What it adds, per implementation:

* a bounded probe **inside the declared placement** (the sandbox, via
  the runner seam) — presence first, then a best-effort version read;
* profile gating: an implementation that names an opt-in profile the
  environment did not enable is ``profile_disabled`` — never probed;
* output-contract checks: every artifact format the implementation
  declares must have a registered parser, else ``parser_missing``;
* adapter-registration checks: a healthy carrier with no registered
  route is ``route_unregistered`` — import success is not a route;
* distinct failure reasons for missing binary, incompatible version,
  unreachable runner, and probe errors, so a report never collapses
  them into one "unavailable".

Health results are **environment-keyed and TTL-bounded**: a restarted
or rebuilt container (new environment id) never inherits stale
verdicts, and a cached verdict expires after ``ttl_seconds``.

Startup probes never scan targets or need credentials: the probe runs
``command -v`` plus ``<binary> --version`` inside the sandbox and
nothing else.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any, Protocol

from raptix_core.types.capability import (
    CapabilityManifest,
    CapabilityStatus,
    ImplementationKind,
)


class ProbeFailureReason(Enum):
    """Distinct, reportable failure causes (TC-2 work item 5)."""

    OK = "ok"
    PROFILE_DISABLED = "profile_disabled"
    ROUTE_UNREGISTERED = "route_unregistered"
    BINARY_MISSING = "binary_missing"
    VERSION_INCOMPATIBLE = "version_incompatible"
    PARSER_MISSING = "parser_missing"
    RUNNER_UNREACHABLE = "runner_unreachable"
    PROBE_ERROR = "probe_error"


# Runtime diagnostics own this extra reason; the frozen core status
# vocabulary is untouched.
UNPROBED = "unprobed"


class SandboxRunner(Protocol):
    """The guarded sandbox command seam (``BaseSandbox.execute`` shape).

    Startup probes only run ``command -v``/``--version`` — never target
    scans, never credential use.
    """

    def execute(self, command: str, *, timeout: int | None = None) -> Any: ...


_PRESENT_MARKER = "__RAPTIX_PRESENT__"
_ABSENT_MARKER = "__RAPTIX_ABSENT__"
_VERSION_RE = re.compile(r"\d+\.\d[\w.\-+]*")
_MANIFEST_DIR = "/opt/raptix/tool-versions"


def _probe_script(binary: str) -> str:
    # presence first (never infer it from a failing --version), then the
    # version banner, best-effort and bounded.
    return (
        f"if command -v -- {binary} >/dev/null 2>&1; then "
        f"echo {_PRESENT_MARKER}; "
        f"({binary} --version 2>/dev/null || true) | head -c 256; "
        f"else echo {_ABSENT_MARKER}; fi"
    )


def _probe_profiles_script() -> str:
    return f"ls {_MANIFEST_DIR}/*.tsv 2>/dev/null | xargs -r -n1 basename 2>/dev/null"


def _parse_version(output: str) -> str | None:
    for line in output.splitlines():
        if _PRESENT_MARKER in line or _ABSENT_MARKER in line:
            continue
        match = _VERSION_RE.search(line)
        if match is not None:
            return match.group(0)
    return None


@dataclass(frozen=True)
class ImplementationHealth:
    """One implementation's placement-aware verdict."""

    implementation_id: str
    healthy: bool
    reason: str
    detail: str = ""
    version: str | None = None


@dataclass(frozen=True)
class CapabilityHealth:
    """Placement-aware health for one capability.

    ``status`` reuses the frozen aggregation (D1); ``implementations``
    carries the per-route diagnostics the evaluator cannot express.
    """

    capability_id: str
    status: CapabilityStatus
    implementations: tuple[ImplementationHealth, ...] = ()


class PlacementHealthChecker:
    """Bounded, environment-keyed health checks against the real sandbox.

    Args:
        runner: the sandbox command seam to probe through.
        environment: identity of the probed environment (image ref or
            container id). Cache keys include it, so a rebuilt container
            never inherits stale verdicts.
        enabled_profiles: explicit profile set; when ``None`` the checker
            probes the sandbox's ``/opt/raptix/tool-versions`` manifests
            once per TTL window. ``base`` is always enabled.
        required_versions: binary → required version prefix; a probed
            version that does not start with it is ``version_incompatible``.
        parser_format_ids: callable returning the registered parser
            format ids (defaults to the live ``ParserRegistry``).
        ttl_seconds: cache lifetime for probe verdicts.
        clock: injectable monotonic clock (tests).
    """

    def __init__(
        self,
        *,
        runner: SandboxRunner,
        environment: str,
        enabled_profiles: set[str] | None = None,
        required_versions: Mapping[str, str] | None = None,
        parser_format_ids: Callable[[], set[str]] | None = None,
        adapter_ids: Callable[[], set[str]] | None = None,
        ttl_seconds: float = 300.0,
        probe_timeout: int = 10,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._runner = runner
        self._environment = environment
        self._enabled_profiles = enabled_profiles
        self._required_versions = dict(required_versions or {})
        self._parser_format_ids = parser_format_ids or _default_parser_format_ids
        self._adapter_ids = adapter_ids or _default_adapter_ids
        self._ttl_seconds = ttl_seconds
        self._probe_timeout = probe_timeout
        self._clock = clock
        self._cache: dict[str, tuple[float, CapabilityHealth]] = {}
        self._profiles_cache: tuple[float, frozenset[str]] | None = None

    def _profiles(self) -> frozenset[str]:
        if self._enabled_profiles is not None:
            return frozenset(self._enabled_profiles)
        if self._profiles_cache is not None:
            stamp, profiles = self._profiles_cache
            if self._clock() - stamp < self._ttl_seconds:
                return profiles
        try:
            response = self._runner.execute(_probe_profiles_script(), timeout=self._probe_timeout)
            output = str(getattr(response, "output", "") or "")
            names = {
                line.removesuffix(".tsv").strip()
                for line in output.splitlines()
                if line.strip().endswith(".tsv")
            }
            profiles = frozenset(names | {"base"})
        except Exception:
            profiles = frozenset({"base"})
        self._profiles_cache = (self._clock(), profiles)
        return profiles

    def check(self, manifest: CapabilityManifest) -> CapabilityHealth:
        """Probe (or recall) placement-aware health for one capability."""
        cache_key = f"{self._environment}:{manifest.id}"
        cached = self._cache.get(cache_key)
        if cached is not None:
            stamp, health = cached
            if self._clock() - stamp < self._ttl_seconds:
                return health
        health = self._probe(manifest)
        self._cache[cache_key] = (self._clock(), health)
        return health

    def check_catalog(
        self, manifests: tuple[CapabilityManifest, ...] | None = None
    ) -> dict[str, CapabilityHealth]:
        from raptix.capabilities.catalog import build_catalog

        return {
            str(manifest.id): self.check(manifest)
            for manifest in (manifests if manifests is not None else build_catalog())
        }

    def _probe(self, manifest: CapabilityManifest) -> CapabilityHealth:
        rows: list[ImplementationHealth] = []
        if not manifest.implementations:
            return CapabilityHealth(
                capability_id=str(manifest.id),
                status=CapabilityStatus.UNAVAILABLE,
                implementations=(
                    ImplementationHealth(
                        implementation_id="",
                        healthy=False,
                        reason=ProbeFailureReason.PROBE_ERROR.value,
                        detail="capability declares no implementations",
                    ),
                ),
            )
        for implementation in manifest.implementations:
            rows.append(self._probe_implementation(implementation, _artifact_formats(manifest)))
        healthy = tuple(row.implementation_id for row in rows if row.healthy)
        if len(healthy) == len(manifest.implementations):
            status = CapabilityStatus.AVAILABLE
        elif healthy:
            status = CapabilityStatus.PARTIAL
        else:
            status = CapabilityStatus.UNAVAILABLE
        return CapabilityHealth(
            capability_id=str(manifest.id), status=status, implementations=tuple(rows)
        )

    def _probe_implementation(
        self, implementation: Any, manifest_formats: tuple[str, ...]
    ) -> ImplementationHealth:
        if implementation.kind is not ImplementationKind.ADAPTER:
            # Workers/MCP/SERVICE health stays with AvailabilityEvaluator
            # and their registries; this checker owns the sandbox route.
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=UNPROBED,
                detail=f"{implementation.kind.value} implementations are probed by their own registry",
            )
        adapter_id = implementation.adapter_id or ""
        if adapter_id.startswith("builtin.") or adapter_id not in self._adapter_ids():
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=ProbeFailureReason.ROUTE_UNREGISTERED.value,
                detail=f"no registered adapter for {adapter_id!r} — import success is not a route",
            )
        profile = implementation.profile or "base"
        if profile != "base" and profile not in self._profiles():
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=ProbeFailureReason.PROFILE_DISABLED.value,
                detail=f"profile {profile!r} is not enabled in {self._environment}",
            )
        binary = implementation.executable or ""
        if not binary:
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=ProbeFailureReason.PROBE_ERROR.value,
                detail="ADAPTER implementation declares no executable",
            )
        try:
            response = self._runner.execute(_probe_script(binary), timeout=self._probe_timeout)
        except Exception as exc:
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=ProbeFailureReason.RUNNER_UNREACHABLE.value,
                detail=str(exc)[:200],
            )
        output = str(getattr(response, "output", "") or "")
        if _ABSENT_MARKER in output and _PRESENT_MARKER not in output:
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=ProbeFailureReason.BINARY_MISSING.value,
                detail=f"{binary!r} not found in placement {self._environment!r}",
            )
        version = _parse_version(output)
        required = self._required_versions.get(binary)
        if required is not None and (version is None or not version.startswith(required)):
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=ProbeFailureReason.VERSION_INCOMPATIBLE.value,
                detail=(
                    f"{binary!r} probed version {version!r} does not match required {required!r}"
                ),
                version=version,
            )
        missing = self._missing_parsers(manifest_formats)
        if missing:
            return ImplementationHealth(
                implementation_id=implementation.id,
                healthy=False,
                reason=ProbeFailureReason.PARSER_MISSING.value,
                detail=f"no registered parser for {missing}",
            )
        return ImplementationHealth(
            implementation_id=implementation.id,
            healthy=True,
            reason=ProbeFailureReason.OK.value,
            version=version,
        )

    def _missing_parsers(self, manifest_formats: tuple[str, ...]) -> tuple[str, ...]:
        registered = self._parser_format_ids()
        return tuple(fmt for fmt in manifest_formats if "." not in fmt and fmt not in registered)


def _artifact_formats(manifest: CapabilityManifest) -> tuple[str, ...]:
    """Artifact-format outputs (no dot) the capability must normalize."""
    return tuple(output for output in manifest.outputs if "." not in output)


def _default_parser_format_ids() -> set[str]:
    from raptix.knowledge.ingest.registry import default_registry

    return {parser.format_id for parser in default_registry().parsers()}


def _default_adapter_ids() -> set[str]:
    from raptix.execution.adapters.resolver import default_adapters

    return set(default_adapters())
