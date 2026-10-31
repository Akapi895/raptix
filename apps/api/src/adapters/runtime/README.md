Runtime adapter layer: translates between `apps/ui-app`'s contract shapes and
the Python runtime's LangGraph HTTP API. Holds `RAPTIX_RUNTIME_API_TOKEN_FILE`
— see `packages/raptix/raptix/interfaces/api/auth.py`. No other part of
`apps/api` (and never `apps/ui-app`) reads that token.

Not yet implemented — see
`docs/design/2026-10-31-ui-app-integration-implementation-plan.md`.
