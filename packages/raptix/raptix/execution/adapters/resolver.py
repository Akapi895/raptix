"""Adapter resolver (Wave T7) — picks the adapter for a capability request.

The resolver is the runtime glue between the capability catalog and the
adapter layer:

1. look the capability up in the registry (unknown id → the registry's
   :class:`UnknownCapabilityError`, never a guess);
2. evaluate availability (executor presence only — T6 evaluator);
3. walk the healthy implementations in declared order and hand the
   request to the first one whose ``adapter_id`` has a registered
   adapter, copying the resolved ``ImplementationSpec.id`` into the
   resulting ``ExecutionSpec.implementation_id`` (frozen T2 contract);
4. otherwise raise :class:`AdapterResolutionError`.

There is deliberately **no bash fallback**: a capability whose healthy
implementations have no registered adapter — or that declares no
implementations at all — is unavailable, full stop. Bash is never a
capability implementation and the resolver never synthesizes one.
"""

from __future__ import annotations

from raptix.execution.adapters.base import ToolAdapter, adapter_classes
from raptix.execution.capabilities.availability import AvailabilityEvaluator
from raptix.execution.capabilities.registry import CapabilityRegistry
from raptix_core.types.capability import (
    CapabilityAvailability,
    CapabilityManifest,
    CapabilityRequest,
    CapabilityStatus,
    ExecutionSpec,
    ImplementationKind,
)


class AdapterResolutionError(LookupError):
    """No adapter could be resolved for the capability request."""


def default_adapters() -> dict[str, ToolAdapter]:
    """Every built-in binary-backed adapter, keyed by ``adapter_id``."""
    adapters: list[ToolAdapter] = [adapter_class() for adapter_class in adapter_classes()]
    return {adapter.adapter_id: adapter for adapter in adapters}


class AdapterResolver:
    """Resolve capability requests to executable specs via adapters.

    Args:
        registry: the capability registry to consult.
        availability: availability evaluator (defaults to the T6 one
            with real PATH/import probes).
        adapters: ``adapter_id`` → adapter mapping; defaults to
            :func:`default_adapters`.
    """

    def __init__(
        self,
        registry: CapabilityRegistry,
        *,
        availability: AvailabilityEvaluator | None = None,
        adapters: dict[str, ToolAdapter] | None = None,
    ) -> None:
        self._registry = registry
        self._availability = availability or AvailabilityEvaluator()
        self._adapters: dict[str, ToolAdapter] = (
            adapters if adapters is not None else default_adapters()
        )

    def adapters(self) -> dict[str, ToolAdapter]:
        return dict(self._adapters)

    def availability(self, manifest: CapabilityManifest) -> CapabilityAvailability:
        return self._availability.evaluate(manifest)

    def resolve(self, request: CapabilityRequest) -> ExecutionSpec:
        """Build the :class:`ExecutionSpec` for one capability request.

        Raises:
            raptix.execution.capabilities.registry.UnknownCapabilityError:
                the capability id is not in the catalog.
            AdapterResolutionError: the capability is unavailable, or
                none of its healthy implementations has a registered
                adapter — never silently downgraded, never a bash
                fallback.
            raptix.execution.adapters.base.AdapterParameterError: the
                request's parameters failed adapter validation.
        """
        manifest = self._registry.get(request.capability_id)
        availability = self._availability.evaluate(manifest)
        if availability.status is CapabilityStatus.UNAVAILABLE:
            raise AdapterResolutionError(
                f"{manifest.id}: capability is unavailable "
                "(no healthy implementation — bash is not a fallback)"
            )
        for implementation in manifest.implementations:
            if implementation.id not in availability.healthy_implementations:
                continue
            if implementation.kind is not ImplementationKind.ADAPTER:
                continue
            adapter = self._adapters.get(implementation.adapter_id or "")
            if adapter is None:
                continue
            return adapter.build_execution(request, implementation_id=implementation.id)
        healthy = ", ".join(availability.healthy_implementations) or "none"
        raise AdapterResolutionError(
            f"{manifest.id}: no registered adapter for healthy implementations [{healthy}]"
        )
