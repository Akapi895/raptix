#!/bin/bash
# Host tooling reads captured workspaces back via `docker cp`; it never
# needs to WRITE into a live engagement. So: world-readable only.
# - umask 022: new files 644 / dirs 755 (host-readable, not host-writable)
# - single chmod of the mount root: the old `chmod -R 777` ran once at
#   container start anyway (dirs created later were never covered) and
#   made the workspace world-WRITABLE, which let one engagement clobber
#   another's findings on a shared tree.
# Security boundary is the container itself; file modes only decide
# whether the host operator can read results back without sudo.
chmod 755 /workspace 2>/dev/null || true
umask 022

# HTTP daemon mode (default ON). The container runs the FastAPI sandbox
# server on ``localhost:9999`` for every deployment target — dev,
# local-docker, GCE Spot VMs, and Cloud Run multi-container. The agent
# process (HTTPSandbox in raptix/execution/backends/http_sandbox.py) talks to
# it over HTTP. The previous default of ``0`` (tail -f keep-alive) is
# kept as an opt-out for legacy ``docker exec`` workflows: set
# ``SANDBOX_DAEMON=0`` to disable the daemon.
if [ "${SANDBOX_DAEMON:-1}" = "1" ]; then
    exec python3 -m raptix.execution.sandbox.server
fi

exec "$@"
