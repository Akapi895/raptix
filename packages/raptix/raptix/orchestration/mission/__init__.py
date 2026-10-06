"""orchestration.mission — engagement lifecycle and objective tracking.

Owns the stateful middleware that manages engagement context
(``EngagementContextMiddleware``) and operational planning objectives
(``OPPLANMiddleware``). These are subsystem state owners, not
cross-cutting adapters, so they live under orchestration rather than
middleware. See ADR-0040.
"""
