"""Resolve runtime exports on demand; shutdown must not import the model stack."""

from importlib import import_module
from typing import Any

_MODULES = {
    "EngagementEvent": "event_log",
    "EventLog": "event_log",
    "EventType": "event_log",
    "read_events": "event_log",
    "LangGraphState": "shutdown",
    "install_shutdown_handlers": "shutdown",
    "RecordingMiddleware": "recording",
    "ReplayMiddleware": "recording",
    "ReplayMismatchError": "recording",
    "open_record": "recording",
    "open_replay": "recording",
    "Dispatcher": "task_spec",
    "SubAgentTaskSpec": "task_spec",
    "ChangeEvent": "cart",
    "EngagementSnapshot": "cart",
    "LinearOPPLANAdapter": "cart",
    "OPPLANAdapter": "cart",
    "ReplayPlan": "cart",
    "ReplayRunner": "cart",
    "SnapshotDelta": "cart",
    "SnapshotNodeKey": "cart",
    "Watcher": "cart",
    "diff_snapshots": "cart",
}
__all__ = list(_MODULES)


def __getattr__(name: str) -> Any:
    if name not in _MODULES:
        raise AttributeError(name)
    value = getattr(import_module(f"{__name__}.{_MODULES[name]}"), name)
    globals()[name] = value
    return value
