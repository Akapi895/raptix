"""Execution subsystem (W3 boundary, populated in W6).

Owner of everything that touches targets and sandboxes:

- ``tools/`` received ``tools/`` in W6 (domain folders kept initially;
  domain-specific tools migrated to plugins in W10),
- ``sandbox/`` received ``sandbox_{kernel,server,web}`` as
  ``sandbox/{kernel,server,web}`` in W6,
- ``backends/`` received ``backends/`` in W6,
- ``sessions/`` (long-lived terminal/tmux/interactive jobs) forms later.

The W6 compatibility shims (``raptix.tools``, ``raptix.backends`` and
``raptix.sandbox_{kernel,server,web}``) were retired in W11, along with
the W10 analyzer re-export shims under ``tools/``. The exploit-execution
path and its guardrails
(``SafeCommand``, RoE, egress, HITL) are untouched; ownership moves are
import-level only (see ``raptix-repository-architecture.md`` §10 and
§32, waves W3 and W6).
"""
