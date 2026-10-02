"""Verified foothold contract.

Step 4 of the control-plane fix sequence (ADR-0031). The architecture
audit (P0-3) found that OPPLAN validates transitions/dependencies but
never ties objective completion to a real capability: exploit can
return RCE, a credential, or data extraction, and none of those is
equivalent to being able to propagate. The controller had no typed
artifact to consume at the Initial-Foothold → Network-Propagation
boundary.

This module crystallizes that boundary as a contract:

- ``AccessEvidence`` — typed foothold evidence (the audit's five
  fixture states A–E map onto these fields).
- ``is_usable_access()`` — the fail-closed predicate for state E
  ("live access + required execution/reachability"). States A–D
  deliberately evaluate to False: IF work continues, but NP is not
  permitted.

Design constraints (ARCHITECTURE_AUDIT_FIX.md §4):

- The gate lives ONLY at the IF→NP boundary. Intra-IF exploration
  (recon→exploit cycles, worker self-rotation) must never require
  managed sessions — that is the anti-pattern the review explicitly
  rejects.
- Fail-closed: missing or incomparable evidence is NOT usable access.
  An unverifiable claim must not unlock propagation.

Imports only ``pydantic`` + stdlib — safe for the contract layer.
"""

from __future__ import annotations

from pydantic import BaseModel

# Privilege ordering used by the managed-session path. Unknown levels
# are incomparable (rank ``None``) and fail closed.
PRIVILEGE_RANK: dict[str, int] = {
    "anonymous": 0,
    "user": 1,
    "admin": 2,
    "root": 3,
    "system": 3,
}


class AccessEvidence(BaseModel):
    """Typed foothold evidence consumed at the IF→NP boundary.

    Field semantics mirror the audit's experiment-3 fixtures:

    - ``execution_capability``: the agent can run commands on the
      foothold host (shell, implant, RCE with control). Without this,
      nothing else matters (state A).
    - ``session_managed`` / ``session_live``: a session the controller
      can drive (implant / agent / bound shell) and that is currently
      alive (state D has ``session_live=False``).
    - ``privilege`` / ``required_privilege``: current vs. required
      privilege level on that session (state C has ``user`` when
      ``admin`` is required).
    - ``credential_captured`` / ``credential_usable``: a captured
      credential that actually unlocks the desired access (state B
      captured but unusable).
    - ``reachability_verified``: the target segment/service was
      actually reached with the current access — not assumed from
      network position.
    """

    execution_capability: bool = False
    session_managed: bool = False
    session_live: bool = False
    privilege: str = ""
    required_privilege: str = ""
    credential_captured: bool = False
    credential_usable: bool = False
    reachability_verified: bool = False


def _rank(level: str) -> int | None:
    if not level:
        return None
    return PRIVILEGE_RANK.get(level.strip().lower())


def unmet_access_preconditions(evidence: AccessEvidence | None) -> list[str]:
    """Explain WHY access is not usable — one entry per unmet precondition.

    Returns an empty list exactly when :func:`is_usable_access` returns
    True. The wording mirrors the audit's fixture rationale so the
    orchestrator can act on it directly (state A/B: bind or capture
    access; state C: privesc; state D: re-establish the session).
    """
    if evidence is None:
        return ["no foothold evidence declared"]
    if not evidence.execution_capability:
        return ["execution_capability not verified (no controlled execution on the foothold)"]
    if evidence.session_managed and evidence.session_live:
        if evidence.required_privilege:
            required = _rank(evidence.required_privilege)
            current = _rank(evidence.privilege)
            if required is None or current is None:
                return [
                    "unrecognized privilege level — use one of "
                    f"{', '.join(sorted(PRIVILEGE_RANK))} "
                    f"(got privilege={evidence.privilege!r}, "
                    f"required={evidence.required_privilege!r})"
                ]
            if current < required:
                return [
                    f"insufficient privilege ({evidence.privilege!r} < required "
                    f"{evidence.required_privilege!r}) — privesc needed before propagation"
                ]
        return []
    if evidence.credential_captured and evidence.credential_usable:
        if not evidence.reachability_verified:
            return ["reachability to the target not verified with this credential"]
        return []
    return [
        "neither a live managed session nor a usable+verified credential — "
        "capture or bind access first (audit states A/B)"
    ]


def is_usable_access(evidence: AccessEvidence) -> bool:
    """Return True only for the audit's state-E foothold.

    Usable access requires execution capability PLUS one of:

    1. **Managed-session path** — a session the controller drives that
       is currently live, with privilege at or above what propagation
       requires. When ``required_privilege`` is declared, both levels
       must be recognized (unknown levels fail closed).
    2. **Credential path** — a captured credential that is verified
       usable, with verified reachability to the target.

    Every failure mode is fail-closed: missing fields, unknown
    privilege levels, and empty evidence all return False.
    """
    return not unmet_access_preconditions(evidence)


__all__ = [
    "AccessEvidence",
    "PRIVILEGE_RANK",
    "is_usable_access",
    "unmet_access_preconditions",
]
