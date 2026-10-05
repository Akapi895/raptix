"""Execution subsystem boundary (W3).

Future owner of everything that touches targets and sandboxes:

- ``tools/`` receives ``tools/`` in W6 (domain folders kept initially;
  domain-specific tools migrate to plugins over time),
- ``sandbox/`` receives ``sandbox_{kernel,server,web}`` as
  ``sandbox/{kernel,server,web}`` in W6,
- ``backends/`` receives ``backends/`` in W6,
- ``sessions/`` (long-lived terminal/tmux/interactive jobs) forms later.

Nothing is imported here yet. The exploit-execution path and its
guardrails (``SafeCommand``, RoE, egress, HITL) are untouched; ownership
moves are import-level only (see ``raptix-repository-architecture.md``
§10 and §32, waves W3 and W6).
"""
