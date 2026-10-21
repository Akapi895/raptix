/**
 * Planning documents port (plan P09, Planning slice). It serves the planning
 * handoff: the PREPARE documents and their states, the OPPLAN the operations
 * agent maintains, the bundle readiness, the one-way handoff confirmation and
 * the server-side draft editor. Readiness is a runtime signal and never grants
 * execution. Only the real backend keeps these documents; the mock console has
 * its own document workspace, so this port has no mock adapter.
 */
import type { RequestContext, ServiceResult } from '../../domain/service'

export type PlanningDocumentState = 'ready' | 'missing' | 'invalid' | 'unavailable'

export interface PlanningFact { label: string; value: string }

/** One planning document as the console shows it. Facts and prose come only from a ready document. */
export interface PlanningDocumentCard {
  name: string
  title: string
  state: PlanningDocumentState
  facts: PlanningFact[]
  body: string | null
}

export interface PlanningObjective {
  id: string
  title: string
  description: string
  phase: string
  status: string
  blockedBy: string[]
}

export interface PlanningOpplan extends PlanningDocumentCard {
  threatProfile: string | null
  objectives: PlanningObjective[]
}

export interface PlanningRead {
  ready: boolean
  /** The bundle's blocking reasons in plain words; empty when ready. */
  reasons: string[]
  /** The runtime readiness signal. It never grants execution permission. */
  runtimeSignal: string
  /** Every PREPARE document except the OPPLAN, in bundle order. */
  documents: PlanningDocumentCard[]
  opplan: PlanningOpplan
}

/** The stored document with its schema validation, read for the draft editor. */
export interface PlanningDocumentSource {
  name: string
  /** Digest of the published bytes: the precondition every save and publish carries. Null when absent. */
  digest: string | null
  /** The published text when the file is readable. */
  source: string | null
  /** The actor's saved draft, if any. */
  draft: string | null
  valid: boolean
  errors: string[]
  /** False for a document the console never publishes (ROE is governed by the Scope & ROE workflow). */
  publishable: boolean
}

export interface PlanningDraftInput { body: string; baseDigest: string | null }

export interface PlanningService {
  read(ctx: RequestContext): Promise<ServiceResult<PlanningRead>>
  /** One-way: the server stamps the handoff once; the project detail carries the timestamp. */
  confirmHandoff(ctx: RequestContext): Promise<ServiceResult<{ confirmed: true }>>
  source(ctx: RequestContext, name: string): Promise<ServiceResult<PlanningDocumentSource>>
  saveDraft(ctx: RequestContext, name: string, input: PlanningDraftInput): Promise<ServiceResult<PlanningDocumentSource>>
  publish(ctx: RequestContext, name: string, input: PlanningDraftInput): Promise<ServiceResult<{ digest: string }>>
  discardDraft(ctx: RequestContext, name: string): Promise<ServiceResult<{ discarded: boolean }>>
}

