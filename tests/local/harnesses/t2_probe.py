"""Local probe: summarize a T2 run's live thread state, outside the regular suite."""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

from langgraph_sdk import get_client


async def main() -> None:
    run_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("workspace/t2-juice-b1/runs/A1")
    url = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:2400"
    prov = json.loads((run_dir / "provenance.json").read_text())
    tid = prov["thread_id"]
    client = get_client(url=url)
    try:
        state = await client.threads.get_state(tid)
    except Exception as exc:  # noqa: BLE001 - probe only
        print(f"thread={tid} ERR {type(exc).__name__}: {exc}")
        return
    values = state.get("values") or {}
    msgs = values.get("messages") or []
    ai = sum(1 for m in msgs if (m.get("type") or m.get("role")) not in ("human", "user"))
    tok = sum(
        (m.get("usage_metadata") or {}).get("total_tokens", 0)
        for m in msgs
        if isinstance(m.get("usage_metadata"), dict)
    )
    objs = values.get("objectives") or []
    obj_str = ", ".join(f"{o.get('id')}:{o.get('status')}" for o in objs)
    print(f"thread={tid} msgs={len(msgs)} ai={ai} tokens={tok} objectives={len(objs)} [{obj_str}]")


if __name__ == "__main__":
    asyncio.run(main())
