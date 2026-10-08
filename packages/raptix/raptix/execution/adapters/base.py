"""Adapter layer foundations (Wave T7 of the tool-optimization plan).

An adapter translates one :class:`CapabilityRequest` into the
:class:`ExecutionSpec` a sandbox executor runs â€” nothing more. It never
executes, never parses output, and never swallows errors: execution
belongs to the sandbox dispatch (where the RoE / authorization /
SafeCommand guards live) and output normalization belongs to the T3
``ParserRegistry``. Splitting those concerns is the whole point of the
wave: the adapter is the deterministic, unit-testable WHATâ†’HOW step.

The :class:`CommandAdapter` base covers the ``ExecutorKind.COMMAND``
shape every binary-backed adapter shares:

* ``payload`` is ``{"argv": [...]}`` â€” the executor receives the argv
  as a list and must run it without a shell. Adapters therefore reject
  whitespace / control characters in single-token parameters and offer
  no raw-argument escape hatch: unknown request parameters are IGNORED
  (a planner asking for ``extra_args`` gets nothing), known ones are
  validated up front and raise :class:`AdapterParameterError`.
* ``implementation_id`` is passed in by the resolver â€” it must be the
  ``ImplementationSpec.id`` the resolver actually resolved (frozen T2
  contract), not a value the adapter invents.
* ``expected_artifact_formats`` names the output format ids the binary
  produces so the T3 registry resolves a parser deterministically; a
  format id with no registered parser surfaces as a hard parse error,
  never a silent guess.
"""

from __future__ import annotations

import re
import shutil
from typing import ClassVar, Protocol, runtime_checkable

from raptix_core.types.capability import (
    CapabilityId,
    CapabilityRequest,
    ExecutionSpec,
    ExecutorKind,
    JsonValue,
)


class AdapterParameterError(ValueError):
    """A capability request carried parameters an adapter rejects."""


@runtime_checkable
class ToolAdapter(Protocol):
    """Contract for one deterministic capabilityâ†’executor translation.

    Identity metadata is class-level (one adapter class serves one
    capability/binary pair). ``is_available`` answers the
    technical-executor question (binary on PATH); eligibility and
    authorization are evaluated elsewhere and must never leak into an
    adapter.
    """

    capability_id: ClassVar[CapabilityId]
    adapter_id: ClassVar[str]
    executable: ClassVar[str]

    def is_available(self) -> bool: ...

    def build_execution(
        self, request: CapabilityRequest, *, implementation_id: str
    ) -> ExecutionSpec: ...


# Single-token characters that never belong in an argv element built by
# an adapter: control characters (including NUL) are outright rejects.
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")


def str_param(
    request: CapabilityRequest,
    key: str,
    *,
    default: str | None = None,
    required: bool = True,
    allow_spaces: bool = False,
    allow_leading_dash: bool = False,
) -> str:
    """Fetch and validate one string parameter.

    Rejects non-strings, empty values, control characters, and (unless
    ``allow_spaces``) any whitespace â€” argv elements are single tokens.

    Also rejects a leading ``-`` unless ``allow_leading_dash=True``. A
    value built into an argv list as a bare positional (e.g. ``target``,
    a principal string) that starts with ``-`` can be misread by the
    binary's own argument parser as a flag rather than a value â€”
    argument injection, distinct from shell injection (no shell is
    invoked here) but still lets a planner smuggle an unintended flag
    into the command. No current adapter parameter legitimately needs a
    leading dash; the escape hatch exists for a future one that does, so
    that case is explicit and auditable rather than silently permitted
    for everyone.
    """
    value = request.parameters.get(key)
    if value is None:
        if required and default is None:
            raise AdapterParameterError(f"parameter {key!r} is required")
        return default or ""
    if not isinstance(value, str):
        raise AdapterParameterError(f"parameter {key!r} must be a string")
    if not value:
        raise AdapterParameterError(f"parameter {key!r} must not be empty")
    if _CONTROL_CHARS.search(value):
        raise AdapterParameterError(f"parameter {key!r} contains control characters")
    if not allow_leading_dash and value.startswith("-"):
        raise AdapterParameterError(
            f"parameter {key!r} must not start with '-' (looks like a flag, not a value)"
        )
    if not allow_spaces and re.search(r"\s", value):
        raise AdapterParameterError(f"parameter {key!r} must not contain whitespace")
    return value


def int_param(
    request: CapabilityRequest,
    key: str,
    *,
    default: int | None = None,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int | None:
    """Fetch and validate one integer parameter (bools rejected)."""
    value = request.parameters.get(key)
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int):
        raise AdapterParameterError(f"parameter {key!r} must be an integer")
    if minimum is not None and value < minimum:
        raise AdapterParameterError(f"parameter {key!r} must be >= {minimum}")
    if maximum is not None and value > maximum:
        raise AdapterParameterError(f"parameter {key!r} must be <= {maximum}")
    return value


def bool_param(request: CapabilityRequest, key: str, *, default: bool = False) -> bool:
    """Fetch and validate one boolean parameter (strings rejected)."""
    value = request.parameters.get(key)
    if value is None:
        return default
    if not isinstance(value, bool):
        raise AdapterParameterError(f"parameter {key!r} must be a boolean")
    return value


def str_list_param(
    request: CapabilityRequest, key: str, *, default: tuple[str, ...] = ()
) -> tuple[str, ...]:
    """Fetch and validate one list-of-strings parameter."""
    value = request.parameters.get(key)
    if value is None:
        return default
    if not isinstance(value, list):
        raise AdapterParameterError(f"parameter {key!r} must be a list of strings")
    items: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item:
            raise AdapterParameterError(f"parameter {key!r} must be a list of non-empty strings")
        if _CONTROL_CHARS.search(item):
            raise AdapterParameterError(f"parameter {key!r} contains control characters")
        if item.startswith("-"):
            raise AdapterParameterError(
                f"parameter {key!r} entries must not start with '-' (looks like a flag)"
            )
        if re.search(r"\s", item):
            raise AdapterParameterError(f"parameter {key!r} entries must not contain whitespace")
        items.append(item)
    return tuple(items)


def artifact_name_param(request: CapabilityRequest, key: str, *, default: str) -> str:
    """A flat artifact filename inside the sandbox workspace.

    No directories, no traversal â€” the executor's fresh working
    directory is the only place an adapter names.
    """
    value = str_param(request, key, default=default, required=False)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", value):
        raise AdapterParameterError(
            f"parameter {key!r} must be a plain artifact filename (got {value!r})"
        )
    return value


def http_url_param(request: CapabilityRequest, key: str) -> str:
    """An http(s) URL parameter."""
    value = str_param(request, key)
    if not value.startswith(("http://", "https://")):
        raise AdapterParameterError(f"parameter {key!r} must be an http(s) URL")
    return value


def domain_param(request: CapabilityRequest, key: str) -> str:
    """A DNS domain-ish token (``subfinder -d``)."""
    value = str_param(request, key)
    if not re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?", value) or ".." in value:
        raise AdapterParameterError(f"parameter {key!r} is not a valid domain")
    return value


class CommandAdapter:
    """Shared COMMAND-executor behavior for binary-backed adapters.

    Subclasses declare ``capability_id`` / ``adapter_id`` /
    ``executable`` / ``artifact_formats`` as class attributes and
    implement :meth:`build_argv`.
    """

    capability_id: ClassVar[CapabilityId]
    adapter_id: ClassVar[str]
    executable: ClassVar[str]
    artifact_formats: ClassVar[tuple[str, ...]] = ()
    default_timeout_seconds: ClassVar[int | None] = None

    def is_available(self) -> bool:
        return shutil.which(self.executable) is not None

    def build_execution(
        self, request: CapabilityRequest, *, implementation_id: str
    ) -> ExecutionSpec:
        argv = self.build_argv(request)
        entries: list[JsonValue] = []
        entries.extend(argv)
        return ExecutionSpec(
            implementation_id=implementation_id,
            executor_kind=ExecutorKind.COMMAND,
            executor_id=self.executable,
            payload={"argv": entries},
            expected_artifact_formats=self.artifact_formats,
            timeout_seconds=self.default_timeout_seconds,
        )

    def build_argv(self, request: CapabilityRequest) -> list[str]:
        """Validate parameters and return the deterministic argv list."""
        raise NotImplementedError

    def _choice(
        self,
        request: CapabilityRequest,
        key: str,
        mapping: dict[str, str],
        *,
        default: str,
    ) -> str:
        value = str_param(request, key, default=default, required=False)
        if value not in mapping:
            raise AdapterParameterError(f"parameter {key!r} must be one of {sorted(mapping)}")
        return value

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"{type(self).__name__}(adapter_id={self.adapter_id!r})"


def adapter_classes() -> tuple[type[CommandAdapter], ...]:
    """Every binary-backed adapter shipped with the runtime (T7 + TC-2/5/7/8)."""
    from raptix.execution.adapters.ad.bloodhound_collect import NetExecBloodHoundAdapter
    from raptix.execution.adapters.ad.impacket import (
        ImpacketCredentialDumpAdapter,
        ImpacketLateralMoveAdapter,
    )
    from raptix.execution.adapters.ad.netexec import NetExecAdapter
    from raptix.execution.adapters.ad.responder import ResponderAdapter
    from raptix.execution.adapters.contracts.slither import SlitherAdapter
    from raptix.execution.adapters.credentials.john import JohnAdapter
    from raptix.execution.adapters.network.nmap import NmapAdapter
    from raptix.execution.adapters.network.snmpwalk import SnmpwalkAdapter
    from raptix.execution.adapters.network.subfinder import SubfinderAdapter
    from raptix.execution.adapters.web.gobuster import GobusterAdapter
    from raptix.execution.adapters.web.nikto import NiktoAdapter
    from raptix.execution.adapters.web.nuclei import NucleiAdapter
    from raptix.execution.adapters.web.sqlmap import SqlmapAdapter

    return (
        NmapAdapter,
        SubfinderAdapter,
        SqlmapAdapter,
        GobusterAdapter,
        NiktoAdapter,
        NucleiAdapter,
        ImpacketLateralMoveAdapter,
        ImpacketCredentialDumpAdapter,
        NetExecAdapter,
        ResponderAdapter,
        NetExecBloodHoundAdapter,
        JohnAdapter,
        SnmpwalkAdapter,
        SlitherAdapter,
    )
