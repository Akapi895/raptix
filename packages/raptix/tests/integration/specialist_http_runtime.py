"""Run the real local LangGraph HTTP server with a controlled model and MCP peer.

Use only with a disposable BFF/database. Set RAPTIX_RUNTIME_API_TOKEN_FILE to
a test token file and RAPTIX_HOME to a test directory. No external target/model
is contacted. Ctrl+C stops this foreground test server.
"""

import json
import os
import runpy
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[4]
os.environ["RAPTIX_USE_SKILLOGY"] = "0"
os.environ["LANGGRAPH_NO_VERSION_CHECK"] = "1"
os.environ["LANGSMITH_TRACING"] = "false"
os.environ["RAPTIX_MCP__SERVERS"] = json.dumps(
    {
        "controlled": {
            "transport": "stdio",
            "command": sys.executable,
            "args": [str(Path(__file__).parents[1] / "unit/agents/controlled_mcp_server.py")],
        }
    }
)

Probe = runpy.run_path(
    str(Path(__file__).parents[1] / "unit/agents/test_specialist_configuration.py")
)["CapabilityProbe"]


class HttpProbe(Probe):
    def bind_tools(self, tools: list[Any], **kwargs: Any) -> Any:
        super().bind_tools(tools, **kwargs)
        if self.role == "recon":
            self.expect_additions = any(name.startswith("mcp_") for name in self.offered)
        return self


def main() -> None:
    from langgraph_api.cli import run_server

    from raptix.intelligence.llm import LLMFactory

    LLMFactory.get_model = lambda self, role: HttpProbe(messages=iter([]), role=role)
    LLMFactory.get_fallback_models = lambda self, role: []
    run_server(
        host="127.0.0.1",
        port=int(os.environ.get("SPECIALIST_TEST_RUNTIME_PORT", "58139")),
        reload=False,
        open_browser=False,
        disable_persistence=True,
        graphs={
            role: "raptix.intelligence.agents.configured_graphs:" + role
            for role in ("raptix", "recon")
        },
        auth={"path": str(ROOT / "packages/raptix/raptix/interfaces/api/auth.py") + ":auth"},
        http={"app": str(ROOT / "packages/raptix/raptix/interfaces/api/plugins_api.py") + ":app"},
    )


if __name__ == "__main__":
    main()
