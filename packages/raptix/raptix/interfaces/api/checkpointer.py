"""Durable local Agent Server checkpointer, configured through langgraph.json."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from os import environ
from pathlib import Path

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver


@asynccontextmanager
async def sqlite_checkpointer() -> AsyncIterator[AsyncSqliteSaver]:
    path = Path(environ.get("RAPTIX_CHECKPOINT_PATH", ".langgraph_api/checkpoints.sqlite"))
    path.parent.mkdir(parents=True, exist_ok=True)
    async with AsyncSqliteSaver.from_conn_string(str(path)) as saver:
        await saver.setup()
        yield saver
