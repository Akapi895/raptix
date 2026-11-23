"""Plugin scaffolding CLI — ``raptix-sdk plugin new --kind=...``.

The generator creates a buildable plugin package with pyproject.toml, src/<name>/__init__.py
wired to the right entry-point group, and a short README.

Six plugin kinds covered: ``tool``, ``middleware``, ``agent``,
``callback``, ``skill``, ``prompt``.

Usage:

    raptix-sdk plugin new --kind=middleware --name=my-plugin --path=./my-plugin
"""

from __future__ import annotations

from raptix_sdk.scaffold.cli import app

__all__ = ["app"]
