"""Local stdio MCP peer for capability wiring tests; no target access."""

from mcp.server.fastmcp import FastMCP

server = FastMCP("specialist-configuration-test")


@server.tool()
def echo_marker(marker: str) -> str:
    """Return a marker without accessing a network or filesystem target."""
    return "controlled-mcp:" + marker


@server.tool()
def unselected_tool() -> str:
    """This tool must never be attached by selecting echo_marker."""
    return "not-selected"


if __name__ == "__main__":
    server.run(transport="stdio")
