# Tool ownership and verification

The Core contract defines capabilities. The runtime resolves eligible tools, executes them and normalizes their results.

## Ownership

| Layer | Responsibility |
| --- | --- |
| Core contracts | Define capability requirements and distinguish availability, eligibility and authorization. [Capability types](../../packages/raptix-core/raptix_core/types/capability.py) |
| Runtime | Resolve capabilities, assemble role-specific tools, execute through adapters and normalize observations through the ingest layer. [Runtime boundaries](runtime-boundaries.md) |
| Safeguards | Check scope and approval at invocation time. [Security controls](../security/security-controls.md) |

## Verification

- Inspect the assembled role and its configuration. Middleware and plugins can add tools beyond the static inventory.
- Record availability, authorization and actual execution separately. A catalog entry or dispatch acknowledgement establishes only part of the result.
- For changes to admission, concurrency or pruning, record the test configuration, baseline and results used for comparison. Preserve held-out inputs.

## Tool classification

| Class | Meaning |
| --- | --- |
| Semantic capability | A goal described by the Core capability contract |
| Worker primitive | An individual operation used within a capability |
| Control-plane tool | A plan, engagement, approval or dispatch operation |
| Execution primitive | General execution available to an authorized role |
| Adapter | A concrete implementation selected by the runtime |
| Internal service | Support code for tasks such as parsing, bookkeeping or rendering |

Classification records a function's role in the system. The exposed surface records which assembled roles receive it. The baseline counted decorator-based tools, functional registrations and middleware contributions. Dynamic external providers were outside its measured surface.

The historical inventory and full classification table are available in `docs/architecture/tool-classification.md` at Git commit `8e5d356b`.
