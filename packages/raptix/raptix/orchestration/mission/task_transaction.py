"""Serialize task documents in-process and across local filesystem workers."""

import os
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

_LOCKS = tuple(threading.RLock() for _ in range(64))
_LOCAL = threading.local()
_WAIT_SECONDS = 2.0


@contextmanager
def task_transaction(path: str, backend: Any = None) -> Iterator[None]:
    resolved = path
    transport = backend
    while hasattr(transport, "_backend"):
        if hasattr(transport, "_real"):
            resolved = transport._real(resolved)
        transport = transport._backend
    if hasattr(transport, "_get_backend_and_key"):
        transport, resolved = transport._get_backend_and_key(resolved)
    local_path = None
    from deepagents.backends.filesystem import FilesystemBackend

    if isinstance(transport, FilesystemBackend):
        local_path = transport._resolve_path(resolved)
    identity = str(local_path) if local_path is not None else resolved
    lock = _LOCKS[hash(identity) % len(_LOCKS)]
    if not lock.acquire(timeout=_WAIT_SECONDS):
        raise TimeoutError("task document transaction busy")
    held = getattr(_LOCAL, "held", set())
    _LOCAL.held = held
    descriptor = None
    try:
        if local_path is not None and identity not in held:
            local_path.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(str(local_path) + ".lock", os.O_RDWR | os.O_CREAT, 0o600)
            if os.fstat(descriptor).st_size == 0:
                os.write(descriptor, b"0")
            deadline = time.monotonic() + _WAIT_SECONDS
            while True:
                try:
                    if os.name == "nt":
                        import msvcrt

                        os.lseek(descriptor, 0, os.SEEK_SET)
                        msvcrt.locking(descriptor, msvcrt.LK_NBLCK, 1)
                    else:
                        import fcntl

                        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("task file transaction busy") from None
                    time.sleep(0.01)
            held.add(identity)
        yield
    finally:
        if descriptor is not None:
            held.discard(identity)
            os.close(descriptor)
        lock.release()
