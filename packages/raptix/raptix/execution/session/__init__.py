"""Runtime infrastructure for the Raptix orchestrator process.

Each runtime module (event log, graceful shutdown, recording, CART, ...)
ships in its own PR. This package init imports every known module
best-effort so each PR can land in any order without colliding on
this file.
"""

_exports: list[str] = []

try:
    from raptix.execution.session.event_log import (  # noqa: F401  # re-exported via __all__
        EngagementEvent,
        EventLog,
        EventType,
        read_events,
    )

    _exports += ["EngagementEvent", "EventLog", "EventType", "read_events"]
except ImportError:
    pass

try:
    from raptix.execution.session.shutdown import (  # noqa: F401  # re-exported via __all__
        LangGraphState,
        install_shutdown_handlers,
    )

    _exports += ["LangGraphState", "install_shutdown_handlers"]
except ImportError:
    pass

try:
    from raptix.execution.session.recording import (  # noqa: F401
        RecordingMiddleware,
        ReplayMiddleware,
        ReplayMismatchError,
        open_record,
        open_replay,
    )

    _exports += [
        "RecordingMiddleware",
        "ReplayMiddleware",
        "ReplayMismatchError",
        "open_record",
        "open_replay",
    ]
except ImportError:
    pass

try:
    from raptix.execution.session.task_spec import (  # noqa: F401
        Dispatcher,
        SubAgentTaskSpec,
    )

    _exports += ["Dispatcher", "SubAgentTaskSpec"]
except ImportError:
    pass

try:
    from raptix.execution.session.cart import (  # noqa: F401
        ChangeEvent,
        EngagementSnapshot,
        LinearOPPLANAdapter,
        OPPLANAdapter,
        ReplayPlan,
        ReplayRunner,
        SnapshotDelta,
        SnapshotNodeKey,
        Watcher,
        diff_snapshots,
    )

    _exports += [
        "ChangeEvent",
        "EngagementSnapshot",
        "LinearOPPLANAdapter",
        "OPPLANAdapter",
        "ReplayPlan",
        "ReplayRunner",
        "SnapshotDelta",
        "SnapshotNodeKey",
        "Watcher",
        "diff_snapshots",
    ]
except ImportError:
    pass

__all__ = _exports
