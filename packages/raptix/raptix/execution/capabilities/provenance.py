"""Execution provenance metadata (Wave T6 step 6).

Builds the version-chain metadata recorded alongside every execution so
results stay reproducible: which tool (binary), adapter, parser, and
tool-data corpus versions produced an observation. The dict is meant to
be embedded in execution metadata by the T7 adapters / T10 workers —
this module only defines the shape and the non-empty guarantees.

Telemetry rule (never violated here): provenance carries VERSION
strings only — never raw parameter values, credentials, hashes, tokens,
or keys.
"""

from __future__ import annotations

from typing import Any


def build_execution_provenance(
    *,
    tool_name: str,
    tool_version: str | None = None,
    adapter_version: str | None = None,
    parser_version: str | None = None,
    tool_data_version: str | None = None,
) -> dict[str, Any]:
    """Return the provenance metadata dict for one execution.

    ``tool_name`` is required (which executor ran); every version field
    is optional and omitted from the dict when ``None`` so consumers can
    distinguish "unknown version" from "not applicable".
    """
    if not tool_name:
        raise ValueError("provenance needs a non-empty tool_name")
    provenance: dict[str, Any] = {"tool_name": tool_name}
    for key, value in (
        ("tool_version", tool_version),
        ("adapter_version", adapter_version),
        ("parser_version", parser_version),
        ("tool_data_version", tool_data_version),
    ):
        if value is not None:
            provenance[key] = value
    return provenance
