"""Orchestration subsystem (W3 boundary, populated in W7).

Owner of mission context, planning, UKC phase state, and dispatch:

- ``phases/`` landed in W7: the three UKC macro-phases as runtime state
  with a shadow-mode state machine — never agent or skill folders,
- ``mission/``, ``planning/`` and ``dispatch/`` ownership migrates in
  later waves once ``intelligence/`` and ``execution/`` boundaries are
  populated.

Nothing else is imported here yet (see
``raptix-repository-architecture.md`` §7 and §32, waves W3–W7).
"""
