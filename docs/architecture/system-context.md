# System Context

Raptix is an AI-powered red team engagement platform. It orchestrates LLM-driven agents through structured kill-chain phases, using domain-specific tools and skills to execute offensive security operations under human-in-the-loop approval.

## External boundaries

| Boundary | Direction | What crosses it |
|----------|-----------|----------------|
| LLM providers (OpenAI, Anthropic, etc.) | Outbound | Model calls via `intelligence/llm/` provider router |
| Neo4j | Bidirectional | Knowledge graph reads/writes via `knowledge/graph/` |
| Sandbox containers | Outbound | Tool execution via `execution/backends/` |
| MCP clients | Inbound | Model Context Protocol via `interfaces/mcp/` |
| Web/CLI/Desktop | Inbound | User commands via `interfaces/api/` and apps/ |
| Target infrastructure | Outbound | Engagement tools (bash, network, web) — gated by RoE + HITL |

## Trust boundaries

- **RoE guardrail**: All tool execution passes through `middleware/roe.py` enforcement.
- **HITL approval**: High-impact actions require human approval via `middleware/hitl.py`.
- **Engagement context**: Scoped by `orchestration/mission/engagement.py` — workspace isolation.
- **Prompt injection shield**: Untrusted output from tools is screened by `middleware/prompt_injection_shield.py`.
