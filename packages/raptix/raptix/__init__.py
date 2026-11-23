"""Raptix — AI-powered autonomous red team testing framework."""

import os as _os
from importlib.metadata import PackageNotFoundError
from importlib.metadata import version as _version

try:
    # Read the installed package metadata. Local checkouts default to 0.0.0.
    __version__ = _version("raptix")
except PackageNotFoundError:
    __version__ = "0.0.0"

__package_name__ = "raptix"

# Phase 2 framework boot — register OSS roles with RoleRegistry and
# materialize the PluginRegistry singleton. Idempotent / opt-out via env.
#
# The sandbox container ships only a subset of Raptix
# (execution/sandbox/{kernel,server} + bare __init__.py) without
# raptix-core installed, so it must opt out of the full framework boot.
# The sandbox.Dockerfile sets RAPTIX_SKIP_BOOT=1 in its ENV so this
# import doesn't fail.
if not _os.environ.get("RAPTIX_SKIP_BOOT"):
    from raptix import _boot

    _boot.run()
