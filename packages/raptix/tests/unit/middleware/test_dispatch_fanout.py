"""Wiring tests: generic fan-out admission in DispatchMiddleware (ADR-0077).

Flag-off must reproduce the legacy blind-ceiling behaviour exactly;
flag-on decisions come from objective annotations, never from role names.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from langchain_core.runnables import Runnable

from raptix.core.subagent_streaming import StreamingRunnable
from raptix.middleware.dispatch import DispatchMiddleware
from raptix.middleware.fanout_admission import WorkUnit
from raptix_core.types.engagement import EffectClass


def _middleware() -> DispatchMiddleware:
    inner = StreamingRunnable(_Ok(), "exploit")
    return DispatchMiddleware(
        backend=object(),
        subagents=[{"name": "exploit", "description": "test role", "runnable": inner}],
    )


class _Ok(Runnable):
    def stream(self, input: Any, config: Any = None, **kwargs: Any):
        yield "ok"

    async def astream(self, input: Any, config: Any = None, **kwargs: Any):
        yield "ok"

    def invoke(self, input: Any, config: Any = None, **kwargs: Any) -> Any:
        return "ok"


def _runtime(objectives: list[dict]) -> SimpleNamespace:
    return SimpleNamespace(
        state={"objectives": objectives, "dispatch_ledger": {}, "engagement_name": "demo"},
        tool_call_id="tool-1",
        config={"configurable": {"thread_id": "thread-1"}},
    )


def obj(oid: str, **fanout: Any) -> dict:
    base = {
        "id": oid,
        "title": oid,
        "phase": "recon",
        "description": "d",
        "acceptance_criteria": ["a"],
        "priority": 1,
        "status": "pending",
    }
    base.update(fanout)
    return base


def _prepare(mw: DispatchMiddleware, runtime: Any, dispatch_id: str, objective_id: str | None):
    return mw._prepare(f"intent {dispatch_id}", "exploit", runtime, objective_id, dispatch_id)


def _reject(command: Any) -> dict:
    return json.loads(command.update["messages"][0].content)


# ── flag off: legacy behaviour, byte-for-byte ─────────────────────────


def test_flag_off_blind_ceiling_admits_unannotated_mutating_pair(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("RAPTIX_FANOUT_ADMISSION", raising=False)
    mw = _middleware()
    runtime = _runtime([obj("OBJ-001"), obj("OBJ-002")])
    first = _prepare(mw, runtime, "d1", "OBJ-001")
    assert not hasattr(first, "update")
    second = _prepare(mw, runtime, "d2", "OBJ-002")
    assert not hasattr(second, "update")  # unknown mutates overlap under legacy ceiling


def test_flag_off_still_enforces_capacity(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("RAPTIX_FANOUT_ADMISSION", raising=False)
    mw = _middleware()
    ids = [("d1", "OBJ-001"), ("d2", "OBJ-002"), ("d3", "OBJ-003")]
    runtime = _runtime([obj(oid) for _d, oid in ids] + [obj("OBJ-004")])
    for dispatch_id, oid in ids:
        assert not hasattr(_prepare(mw, runtime, dispatch_id, oid), "update")
    rejected = _reject(_prepare(mw, runtime, "d4", "OBJ-004"))
    assert rejected["error"] == "dispatch_capacity_exceeded"


# ── flag on: annotation-driven decisions ──────────────────────────────


@pytest.fixture()
def fanout_on(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("RAPTIX_FANOUT_ADMISSION", "1")


def test_shared_resource_conflict_rejected(fanout_on: None) -> None:
    mw = _middleware()
    runtime = _runtime(
        [
            obj("OBJ-001", effects="mutate", resources=["account:svc"], parallel_safe=True),
            obj("OBJ-002", effects="mutate", resources=["account:svc"], parallel_safe=True),
        ]
    )
    assert not hasattr(_prepare(mw, runtime, "d1", "OBJ-001"), "update")
    rejected = _reject(_prepare(mw, runtime, "d2", "OBJ-002"))
    assert rejected["error"] == "dispatch_resource_conflict"


def test_unknown_mutating_work_serializes(fanout_on: None) -> None:
    mw = _middleware()
    runtime = _runtime([obj("OBJ-001"), obj("OBJ-002")])
    assert not hasattr(_prepare(mw, runtime, "d1", "OBJ-001"), "update")
    rejected = _reject(_prepare(mw, runtime, "d2", "OBJ-002"))
    assert rejected["error"] == "dispatch_effect_conflict"


def test_distinct_resources_unblock_declared_safe_mutators(fanout_on: None) -> None:
    mw = _middleware()
    runtime = _runtime(
        [
            obj("OBJ-001", effects="mutate", resources=["res:a"], parallel_safe=True),
            obj("OBJ-002", effects="mutate", resources=["res:b"], parallel_safe=True),
        ]
    )
    assert not hasattr(_prepare(mw, runtime, "d1", "OBJ-001"), "update")
    assert not hasattr(_prepare(mw, runtime, "d2", "OBJ-002"), "update")


def test_destructive_gate(fanout_on: None, monkeypatch: pytest.MonkeyPatch) -> None:
    mw = _middleware()
    runtime = _runtime([obj("OBJ-001", effects="destructive")])
    rejected = _reject(_prepare(mw, runtime, "d1", "OBJ-001"))
    assert rejected["error"] == "dispatch_effect_conflict"
    monkeypatch.setenv("RAPTIX_FANOUT_ALLOW_DESTRUCTIVE", "1")
    mw2 = _middleware()
    assert not hasattr(_prepare(mw2, runtime, "d1", "OBJ-001"), "update")


def test_unwidened_resource_caps_reads_then_widens(fanout_on: None) -> None:
    mw = _middleware()
    runtime = _runtime([obj("OBJ-001", effects="read", resources=["host:1"])])
    assert not hasattr(_prepare(mw, runtime, "d1", "OBJ-001"), "update")
    second = _reject(_prepare(mw, runtime, "d2", "OBJ-001"))
    assert second["error"] == "dispatch_fragile_cap"
    # Three clean outcomes widen the resource; two reads then overlap.
    for i in ("d1", "d3", "d4"):
        mw._record_outcome(("thread-1", i), ok=True)
    third = _prepare(mw, runtime, "d5", "OBJ-001")
    assert not hasattr(third, "update")


def test_capacity_remains_the_outer_bound(fanout_on: None) -> None:
    mw = _middleware()
    reads = [obj(f"OBJ-00{i}", effects="read", resources=[f"host:{i}"]) for i in range(1, 6)]
    runtime = _runtime(reads)
    for i in (1, 2, 3):
        assert not hasattr(_prepare(mw, runtime, f"d{i}", f"OBJ-00{i}"), "update")
    rejected = _reject(_prepare(mw, runtime, "d4", "OBJ-004"))
    assert rejected["error"] == "dispatch_capacity_exceeded"


def test_release_clears_unit_and_outcome_recording_widens(fanout_on: None) -> None:
    mw = _middleware()
    runtime = _runtime([obj("OBJ-001", effects="read", resources=["host:9"])])
    prepared = _prepare(mw, runtime, "d1", "OBJ-001")
    assert not hasattr(prepared, "update")
    _context, key, _fingerprint = prepared
    mw._record_outcome(key, ok=False)
    assert ("thread-1", "d1") not in mw._active_units
    assert mw._resilience["thread-1"].resilient_map().get("host:9") is not True


def test_work_unit_defaults_are_conservative(fanout_on: None) -> None:
    mw = _middleware()
    runtime = _runtime([obj("OBJ-001")])
    unit = mw._work_unit_for(runtime, "OBJ-001", "exploit", "d1")
    assert unit.effects is EffectClass.MUTATE
    assert unit.parallel_safe is None
    assert unit.resources == frozenset()
    assert isinstance(unit, WorkUnit)
