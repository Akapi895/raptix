"""Sandbox subsystem of the execution layer (W6).

Groups the sandbox kernel primitives (``kernel/``), the in-container
FastAPI daemon (``server/``) and the open-web engine (``web/``) that
were previously top-level ``sandbox_{kernel,server,web}`` packages.
``backends`` (agent-side transports) and ``tools`` live as sibling
subsystems under ``raptix.execution``.

Modules under this package are NOT a public plugin surface. External
plugin authors get execution contracts via ``raptix_core.contracts``;
touching anything under ``execution/sandbox/`` directly is unsupported
and may break across minor releases.
"""
