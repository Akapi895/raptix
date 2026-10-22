/**
 * The mock implementation of the operations port (ADR-0096): the factory the demo composition builds the operations service with.
 * Port types and the pure read helpers stay in ./service; this file owns the authority-backed handlers the factory wires.
 */
import type { DbAuthority } from '../../demo/authority'
import type { Clock, ServiceResult } from '../../domain/service'
import {
  createOperationDraft, updateOperationDraft, scheduleOperation, replaceOperationAgent, runOperationPreflight, operationStartGate,
  startOperation, pauseOperation, resumeOperation, stopOperation, completeOperation, reviewOperationStep, operationDraftOptions,
  operationDetail, readPreflightChecks, listOperations, type OperationService,
} from './service'

/** Builds the typed list service; `guard` is the factory's superseded-scope read guard. */
export function createOperationService(
  authority: DbAuthority,
  clock: Clock,
  guard: <T>(produce: () => ServiceResult<T>) => Promise<ServiceResult<T>>,
): OperationService {
  return {
    list: (ctx, query) => guard(() => listOperations(authority.snapshot(), ctx, query)),
    // Writes capture ctx at call time and commit once; they are never cancelled
    // mid-flight (the factory's superseded-scope guard only covers reads).
    draftOptions: (ctx, forOperation) => Promise.resolve(operationDraftOptions(authority.snapshot(), ctx, forOperation)),
    create: (ctx, input) => Promise.resolve(createOperationDraft(authority, clock, ctx, input)),
    update: (ctx, id, patch) => Promise.resolve(updateOperationDraft(authority, clock, ctx, id, patch)),
    schedule: (ctx, id, at) => Promise.resolve(scheduleOperation(authority, clock, ctx, id, at)),
    detail: (ctx, id) => Promise.resolve(operationDetail(authority.snapshot(), ctx, id)),
    preflightChecks: (ctx, id) => guard(() => readPreflightChecks(authority.snapshot(), clock.now(), ctx, id)),
    preflight: (ctx, id) => Promise.resolve(runOperationPreflight(authority, clock, ctx, id)),
    startGate: (ctx, id) => Promise.resolve(operationStartGate(authority, clock, ctx, id)),
    start: (ctx, id) => Promise.resolve(startOperation(authority, clock, ctx, id)),
    pause: (ctx, id, reason) => Promise.resolve(pauseOperation(authority, clock, ctx, id, reason)),
    resume: (ctx, id) => Promise.resolve(resumeOperation(authority, clock, ctx, id)),
    stop: (ctx, id, reason) => Promise.resolve(stopOperation(authority, clock, ctx, id, reason)),
    complete: (ctx, id) => Promise.resolve(completeOperation(authority, clock, ctx, id)),
    reviewStep: (ctx, id, stepId, decision, note) => Promise.resolve(reviewOperationStep(authority, clock, ctx, id, stepId, decision, note)),
    replaceAgent: (ctx, id, from, to, reason) => Promise.resolve(replaceOperationAgent(authority, clock, ctx, id, from, to, reason)),
  }
}

