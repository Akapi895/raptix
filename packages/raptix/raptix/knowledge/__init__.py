"""Knowledge subsystem boundary (W3).

Owner of the canonical state abstraction:

- ``graph/`` received the engagement-graph implementation from
  ``middleware/kg_internal`` in W4 — middleware keeps only thin adapters
  (``kg.py``, ``kg_autoingest.py``, ``tried_edges.py``) plus a
  deprecated re-export shim at ``raptix.middleware.kg_internal``,
- ``findings/``, ``evidence/`` and ``events/`` ownership migrates in later
  waves.

KG remains the canonical state store. Nothing here duplicates the graph
implementation (see ``raptix-repository-architecture.md`` §8 and §32,
waves W3–W4).
"""
