# orchestration/mission

Engagement lifecycle and objective tracking subsystem.

## Responsibility boundary

| Owns | Does NOT own |
|------|-------------|
| `EngagementContextMiddleware` — hydrates engagement slug, workspace path, benchmark context into agent state | `execution/tools/opplan.py` — tool implementations and persistence (stays in execution/) |
| `OPPLANMiddleware` — injects OPPLAN status, registers OPPLAN tools, enforces single-call-per-step | `raptix_core.types.engagement` — `Objective`/`ObjectivePhase` type definitions (stays in core) |
| State channel reducers for engagement/workspace convergence | `middleware/state_reducers.py` — generic shared reducers (stays in middleware/) |

## Migration history

- **W16**: Broke circular coupling between `engagement.py` and `opplan.py` (ADR-0040)
- **W17**: Scaffolded this directory
- **W17–W18**: Moved `middleware/engagement.py` and `middleware/opplan.py` here; re-export shims left at old paths
