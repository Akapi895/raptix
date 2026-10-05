"""Orchestration subsystem boundary (W3).

Future owner of mission context, planning, UKC phase state, and dispatch:

- ``orchestration/phases/`` lands in W7 (three UKC macro-phases as runtime
  state — never agent or skill folders),
- ``mission/``, ``planning/`` and ``dispatch/`` ownership migrates in later
  waves once ``intelligence/`` and ``execution/`` boundaries are populated.

Nothing is imported here yet. Compatibility re-export shims are added
wave by wave as ownership moves (see ``raptix-repository-architecture.md``
§7 and §32, waves W3–W7).
"""
