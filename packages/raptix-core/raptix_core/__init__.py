"""raptix-core — contract layer for the Raptix agent framework.

Pure types, protocols, plugin contracts, and registry primitives. This
package never imports ``langchain``, ``langgraph``, ``deepagents``,
``httpx``, or ``fastapi`` — see the design spec at
``docs/superpowers/specs/2026-05-23-core-framework-sdk-split-design.md``.

Phase 1.A status: ``types`` submodule extracted from the framework
(engagement / llm / kg). Subsequent commits add ``protocols``,
``contracts``, ``registry``, and ``utils`` per spec §6.1.
"""

from __future__ import annotations

from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _version


def _alias_legacy_env() -> None:
    """Back-compat shim: mirror legacy ``DECEPTICON_*`` env vars onto their
    ``RAPTIX_*`` equivalents so existing ``.env`` files and deployments keep
    working after the rename. Runs once at import, before any env is read.
    A ``RAPTIX_*`` value already set always wins. Legacy names are removed at
    2.0.0. Uses only stdlib to preserve the core layer's import guarantees.
    """
    import os
    import warnings

    legacy_prefix = "DECEPTICON_"
    aliased = 0
    for key in list(os.environ):
        if not key.startswith(legacy_prefix):
            continue
        new_key = "RAPTIX_" + key[len(legacy_prefix) :]
        if new_key not in os.environ:
            os.environ[new_key] = os.environ[key]
            aliased += 1
    if aliased:
        warnings.warn(
            f"{legacy_prefix}* environment variables are deprecated; use RAPTIX_* "
            f"instead (aliased {aliased} at startup; legacy names removed at 2.0.0).",
            DeprecationWarning,
            stacklevel=2,
        )


_alias_legacy_env()

from raptix_core import (  # noqa: E402  (env shim must run before submodule imports)
    contracts,
    plugin_loader,
    protocols,
    registry,
    types,
    utils,
)

try:
    # pyproject carries a "0.0.0" sentinel; release.yml stamps the real
    # tag into the wheel metadata at build time, and importlib.metadata
    # reads it back here. Local checkouts read 0.0.0.
    __version__ = _version("raptix-core")
except PackageNotFoundError:
    __version__ = "0.0.0"

__all__ = [
    "__version__",
    "contracts",
    "plugin_loader",
    "protocols",
    "registry",
    "types",
    "utils",
]
