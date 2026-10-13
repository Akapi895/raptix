/**
 * Shared domain and service contracts for the web console — the contracts
 * side of the service/domain boundary in ADR-0067 (Proposed),
 * docs/adr/0067-web-console-service-domain-boundary.md.
 *
 * Rules for this module:
 * - One definition per type lives here. Legacy import sites (`./data`,
 *   `./store`) re-export these names so existing imports keep working until
 *   retirement tickets 65–67 remove the remaining callers.
 * - Contracts only: no implementations, handlers or React code. Feature
 *   tickets own handlers; ticket 04 owns the factory, bridge and clock
 *   lifecycle that inject {@link RequestContext}.
 * - Findings/evidence vocabulary preserves opaque references and
 *   capture-integrity terms from the root GLOSSARY.md (`./evidence`).
 */
export type * from './entities'
export type * from './permissions'
export type * from './service'
export type * from './evidence'
