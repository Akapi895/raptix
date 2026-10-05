"""Execution subsystem (W3 boundary, populated in W6).

Owner of everything that touches targets and sandboxes:

- ``tools/`` received ``tools/`` in W6 (domain folders kept initially;
  domain-specific tools migrate to plugins over time),
- ``sandbox/`` received ``sandbox_{kernel,server,web}`` as
  ``sandbox/{kernel,server,web}`` in W6,
- ``backends/`` received ``backends/`` in W6,
- ``sessions/`` (long-lived terminal/tmux/interactive jobs) forms later.

Deprecated re-export shims keep the old ``raptix.tools``,
``raptix.backends`` and ``raptix.sandbox_{kernel,server,web}`` import
paths alive until W11. The exploit-execution path and its guardrails
(``SafeCommand``, RoE, egress, HITL) are untouched; ownership moves are
import-level only (see ``raptix-repository-architecture.md`` §10 and
§32, waves W3 and W6).
"""
