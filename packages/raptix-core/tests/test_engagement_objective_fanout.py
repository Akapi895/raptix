"""Round-trip and default tests for the ADR-0077 fan-out fields on ``Objective``."""

from __future__ import annotations

from raptix_core.types.engagement import OPPLAN, EffectClass, Objective


def _objective(**overrides: object) -> Objective:
    fields: dict = {
        "id": "OBJ-001",
        "phase": "recon",
        "title": "Enumerate surface",
        "description": "Map the target.",
        "acceptance_criteria": ["Ports recorded in the KG."],
        "priority": 1,
    }
    fields.update(overrides)
    return Objective(**fields)


def test_fanout_fields_default_conservative() -> None:
    obj = _objective()
    assert obj.effects is EffectClass.MUTATE
    assert obj.resources == []
    assert obj.parallel_safe is None
    assert obj.fragile_target is False


def test_fanout_fields_round_trip() -> None:
    obj = _objective(
        effects="read",
        resources=["account:svc_backup", "host:10.0.0.5"],
        parallel_safe=True,
    )
    assert obj.effects is EffectClass.READ
    assert obj.resources == ["account:svc_backup", "host:10.0.0.5"]
    assert obj.parallel_safe is True

    dumped = obj.model_dump(mode="json")
    assert dumped["effects"] == "read"
    restored = Objective(**dumped)
    assert restored == obj


def test_opplan_persistence_keeps_fanout_fields() -> None:
    plan = OPPLAN(
        engagement_name="demo",
        threat_profile="n/a",
        objectives=[
            _objective(effects="destructive", resources=["host:10.0.0.9"], parallel_safe=False)
        ],
    )
    round_tripped = OPPLAN(**plan.model_dump(mode="json"))
    child = round_tripped.objectives[0]
    assert child.effects is EffectClass.DESTRUCTIVE
    assert child.parallel_safe is False
    assert child.resources == ["host:10.0.0.9"]
