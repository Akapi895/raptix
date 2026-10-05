"""Knowledge subsystem boundary (W3).

Future owner of the canonical state abstraction:

- ``graph/`` receives ``middleware/kg_internal`` in W4 — middleware keeps
  only thin adapters afterwards,
- ``findings/``, ``evidence/`` and ``events/`` ownership migrates in later
  waves.

Nothing is imported here yet. KG remains the canonical state store;
compatibility re-export shims are added when ownership moves (see
``raptix-repository-architecture.md`` §8 and §32, waves W3–W4).
"""
