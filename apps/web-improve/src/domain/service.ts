/**
 * Typed contracts for the console service layer (ADR-0067,
 * docs/adr/0067-web-console-service-domain-boundary.md).
 *
 * Every service call resolves to an explicit union: success carries required
 * data, failure carries a kind and message. `not-found` and `forbidden` are
 * distinct failure kinds, so callers never confuse "empty" with "missing" or
 * "denied". Request context captures actor and project explicitly — a persona
 * or project switch never retargets an in-flight mutation. Time is an absolute
 * instant from the injected clock; deadlines are enforced in handlers, never
 * in tests or screens.
 *
 * This module fixes shapes only. Handler implementations belong to the
 * feature tickets; the factory, bridge and clock lifecycle belong to ticket 04.
 */
import type { Role } from './entities'

/**
 * Milliseconds since the Unix epoch — an absolute instant, independent of the
 * dataset's demo-date display anchor. The mock clock advances elapsed time as
 * absolute instants (including date rollover); expiry rules compare instants,
 * never the display strings stored on entities.
 */
export type Instant = number

/** Time source injected by the service factory (real or fake). */
export interface Clock {
  now(): Instant
}

/** Absolute expiry instant; elapsed once `clock.now() >= deadline`. */
export type Deadline = Instant

/** Who a request acts as. Backed by the shared auth authority, not UI state. */
export interface ActorRef {
  /** Actor display id (persona name until ticket 06 introduces stable ids). */
  id: string
  role: Role
}

/** Explicit per-request authorization scope; supplied by the factory, not callers. */
export interface RequestContext {
  actor: ActorRef
  /** Project the request is scoped to; '' is the aggregate all-projects view. */
  projectId: string
  /** Correlation id shared by every write of one user-visible action. */
  corr: string
}

/**
 * Why a request failed. `not-found` and `forbidden` are distinct kinds so
 * callers can differentiate missing from denied without string parsing.
 * - `not-found`: the addressed entity does not exist (or is out of scope).
 * - `forbidden`: the actor lacks the role/membership/action permission.
 * - `conflict`: the mutation clashes with committed state (e.g. stale read).
 * - `validation`: the input violates a domain rule or ROE/policy constraint.
 * - `unavailable`: a transient environment failure (retry may succeed).
 */
export type ServiceErrorKind = 'not-found' | 'forbidden' | 'conflict' | 'validation' | 'unavailable'

export interface ServiceFailure {
  kind: ServiceErrorKind
  /** Human-readable explanation, safe to render directly. */
  message: string
  /** Entity the failure is about, when it refers to one. */
  entity?: EntityRef
}

/**
 * The only result shape services return. `data` is required on success —
 * there is no ambiguous optional success payload; absence of data is a
 * failure with an explicit kind.
 */
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; failure: ServiceFailure }

/** Single-entity read or a mutation outcome. */
export type ReadResult<T> = ServiceResult<T>

/** Offset page request; `page` starts at 1. */
export interface PageRequest {
  page: number
  pageSize: number
}

/** Page envelope for list reads. */
export interface Page<T> {
  items: T[]
  /** Echoed request position (1-based). */
  page: number
  pageSize: number
  /** Total items matching the query across all pages. */
  total: number
}

/** Paginated list read. */
export type ListResult<T> = ServiceResult<Page<T>>

/**
 * Every entity collection the one database owns (ADR-0067). Names mirror the
 * seed collections so bridge snapshots and Query keys stay aligned.
 */
export type EntityKind =
  | 'project'
  | 'operation'
  | 'step'
  | 'agent'
  | 'agent-group'
  | 'asset'
  | 'evidence'
  | 'finding'
  | 'report'
  | 'report-export'
  | 'playbook'
  | 'technique'
  | 'approval'
  | 'template'
  | 'integration'
  | 'policy'
  | 'retention'
  | 'audit'
  | 'notice'
  | 'plan'
  | 'plan-step'
  | 'tool-event'
  | 'conversation'
  | 'chat-message'
  | 'branch'
  | 'branch-group'
  | 'ai-worker'
  | 'c2-node'
  | 'channel'
  | 'session'
  | 'session-request'
  | 'session-grant'
  | 'stop-state'

/** Identity of one entity; sufficient to build a Query key for invalidation. */
export interface EntityRef {
  kind: EntityKind
  id: string
  /** Owning project, when the entity is project-scoped. */
  projectId?: string
}

/**
 * Identities published by one committed mutation. The Query bridge
 * invalidates/refetches matching keys and the legacy subscriber receives the
 * same snapshot from this one publication (execution contract: "One data
 * authority during migration").
 */
export interface ChangeSet {
  /** Entities whose committed state changed (created, updated or removed). */
  entities: EntityRef[]
  /** Project whose scoped views changed wholesale (e.g. scope invalidation, estop). */
  projectId?: string
  /** Commit instant from the factory clock. */
  at: Instant
  /** Correlation id of the request that committed the change. */
  corr: string
}

/**
 * Minimal async read seam every per-entity service starts from. Handlers are
 * owned by feature tickets; this module fixes only the contract.
 */
export interface EntityReader<T> {
  get(ctx: RequestContext, id: string): Promise<ReadResult<T>>
  list(ctx: RequestContext, page?: PageRequest): Promise<ListResult<T>>
}
