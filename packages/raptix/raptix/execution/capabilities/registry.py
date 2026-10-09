"""``CapabilityRegistry`` — loads the catalog and answers catalog queries.

This is the runtime half of the T2 contract: manifests describe WHAT
can run and HOW (declarations only); the registry makes them queryable
by id and by role, and produces the startup health snapshot the
availability evaluator fills in.

The registry never resolves implementations by fallback. A capability
id that is not in the catalog simply does not exist here — there is no
implicit bash path and no implicit in-process fallback (see the
implementation plan's "Bash and capability honesty" section).
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

from raptix.execution.capabilities.availability import AvailabilityEvaluator
from raptix_core.types.capability import (
    CapabilityId,
    CapabilityManifest,
    CapabilityStatus,
    RoleId,
)


class UnknownCapabilityError(KeyError):
    """Raised when a capability id is not in the catalog."""


class CapabilityRegistry:
    """Immutable view over the loaded capability manifests.

    Args:
        manifests: the catalog entries. Defaults to
            :func:`raptix.execution.capabilities.catalog.build_catalog`.
        availability: the evaluator used for health snapshots. Defaults
            to a plain :class:`AvailabilityEvaluator` (import/PATH
            probes only — no worker/service executors wired yet).
    """

    def __init__(
        self,
        manifests: tuple[CapabilityManifest, ...] | None = None,
        *,
        availability: AvailabilityEvaluator | None = None,
    ) -> None:
        self._manifests: dict[CapabilityId, CapabilityManifest] = {}
        for manifest in manifests if manifests is not None else _default_catalog():
            if manifest.id in self._manifests:
                raise ValueError(f"duplicate capability id in catalog: {manifest.id!s}")
            self._manifests[manifest.id] = manifest
        self._availability = availability or AvailabilityEvaluator()

    def get(self, capability_id: str | CapabilityId) -> CapabilityManifest:
        manifest = self._manifests.get(CapabilityId(str(capability_id)))
        if manifest is None:
            raise UnknownCapabilityError(str(capability_id))
        return manifest

    @property
    def availability_evaluator(self) -> AvailabilityEvaluator:
        return self._availability

    def __contains__(self, capability_id: object) -> bool:
        return CapabilityId(str(capability_id)) in self._manifests

    def __len__(self) -> int:
        return len(self._manifests)

    def __iter__(self) -> Iterator[CapabilityManifest]:
        return iter(self._manifests.values())

    def for_role(self, role: str | RoleId) -> tuple[CapabilityManifest, ...]:
        """Manifests whose ``allowed_roles`` admit ``role``.

        ``allowed_roles == ()`` means UNRESTRICTED (every role), per the
        frozen T2 convention — it never means "no roles".
        """
        role_id = RoleId(str(role))
        return tuple(
            m for m in self._manifests.values() if not m.allowed_roles or role_id in m.allowed_roles
        )

    def health_snapshot(self) -> dict[str, Any]:
        """Probe every implementation once and return the queryable
        startup health record: capability id → status + healthy
        implementation ids. Availability reflects executor presence
        only — never AKG state (that is eligibility) and never
        permission (that is the invocation-time guard).
        """
        return {
            str(manifest.id): {
                "status": availability.status.value,
                "healthy_implementations": list(availability.healthy_implementations),
            }
            for manifest in self._manifests.values()
            for availability in (self._availability.evaluate(manifest),)
        }


def _default_catalog() -> tuple[CapabilityManifest, ...]:
    # Imported lazily so the registry module stays import-light for
    # consumers that pass their own manifests.
    from raptix.execution.capabilities.catalog import build_catalog

    return build_catalog()


def health_check(
    registry: CapabilityRegistry,
    *,
    fail_on: Callable[[CapabilityStatus], bool] | None = None,
) -> bool:
    """Convenience startup gate: True when no capability is in a status
    ``fail_on`` rejects (default: UNAVAILABLE fails, PARTIAL passes)."""
    reject = fail_on or (lambda status: status is CapabilityStatus.UNAVAILABLE)
    snapshot = registry.health_snapshot()
    return not any(reject(CapabilityStatus(entry["status"])) for entry in snapshot.values())
